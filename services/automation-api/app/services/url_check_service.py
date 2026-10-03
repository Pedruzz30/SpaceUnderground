"""Safe outbound URL checking.

This is the one place in the service that fetches a URL supplied by data rather
than by code, which makes it the one place that can be turned into a
server-side request forgery tool. A project's `preview_url` is edited in the
Admin, so "check the demo still loads" is really "make this server fetch
whatever someone typed".

The protections are therefore not optional extras:

  * only http and https -- no file://, gopher://, ftp://
  * the hostname is resolved first, and every address it resolves to must be
    public. Checking the literal string is not enough: `localhost.example.com`
    can resolve to 127.0.0.1, and so can a DNS record an attacker controls.
  * redirects are followed manually, re-validating each hop, and capped. A
    public URL that redirects to 169.254.169.254 is the classic cloud metadata
    escape.
  * a short timeout and a capped read, so a slow or enormous response cannot
    hold a worker or fill memory.

The check never returns the body. Callers get a status, not content.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.logging import get_logger, log_event

logger = get_logger("urlcheck")

ALLOWED_SCHEMES = {"http", "https"}
MAX_REDIRECTS = 3
DEFAULT_TIMEOUT_SECONDS = 5.0
# Enough to see that something answered; never the whole page.
MAX_RESPONSE_BYTES = 64 * 1024

# Hostnames that are always refused, before DNS is even consulted. Resolution
# still runs for everything else -- this list is a fast path, not the defence.
BLOCKED_HOSTNAMES = {"localhost", "localhost.localdomain", "metadata", "metadata.google.internal"}


@dataclass
class UrlCheckResult:
    ok: bool
    reason: str
    status_code: int | None = None
    final_url: str | None = None
    redirects: int = 0
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "reason": self.reason,
            "status_code": self.status_code,
            "final_url": self.final_url,
            "redirects": self.redirects,
            **self.details,
        }


def _is_public_address(raw: str) -> bool:
    """Whether an IP is safe for this service to talk to.

    Everything Python can already classify is refused: loopback, private,
    link-local (which covers 169.254.169.254), multicast, reserved and
    unspecified. IPv4-mapped IPv6 is unwrapped first, because ::ffff:127.0.0.1
    is loopback wearing a different hat.
    """
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        return False

    if getattr(address, "ipv4_mapped", None):
        address = address.ipv4_mapped

    return not (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def resolve_public_addresses(hostname: str) -> list[str]:
    """Every address a hostname resolves to, or [] when any of them is unsafe.

    All-or-nothing on purpose. A name that resolves to one public and one
    private address is a rebinding attempt, and picking the public one would
    walk straight into it.
    """
    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return []

    addresses = sorted({info[4][0] for info in infos})
    if not addresses:
        return []

    return addresses if all(_is_public_address(address) for address in addresses) else []


def validate_url(raw: str) -> UrlCheckResult:
    """Static and DNS validation. No request is made."""
    candidate = (raw or "").strip()
    if not candidate:
        return UrlCheckResult(ok=False, reason="empty_url")

    try:
        parsed = urlparse(candidate)
    except ValueError:
        return UrlCheckResult(ok=False, reason="malformed_url")

    if parsed.scheme not in ALLOWED_SCHEMES:
        return UrlCheckResult(ok=False, reason="blocked_scheme", details={"scheme": parsed.scheme or ""})

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return UrlCheckResult(ok=False, reason="missing_host")

    if hostname in BLOCKED_HOSTNAMES:
        return UrlCheckResult(ok=False, reason="blocked_host", details={"host": hostname})

    # A literal IP skips DNS but not the address rules.
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        if not _is_public_address(hostname):
            return UrlCheckResult(ok=False, reason="blocked_address", details={"host": hostname})
        return UrlCheckResult(ok=True, reason="allowed", final_url=candidate)

    if not resolve_public_addresses(hostname):
        return UrlCheckResult(ok=False, reason="blocked_address", details={"host": hostname})

    return UrlCheckResult(ok=True, reason="allowed", final_url=candidate)


async def check_url(
    raw: str,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    client: httpx.AsyncClient | None = None,
) -> UrlCheckResult:
    """Confirms a URL answers, re-validating every redirect hop.

    Redirects are followed by hand rather than by httpx so each new location
    passes the same address checks as the first. `follow_redirects=True` would
    validate the hostname once and then happily chase it into a private range.
    """
    validation = validate_url(raw)
    if not validation.ok:
        log_event(logger, logging.WARNING, "urlcheck.rejected", reason=validation.reason)
        return validation

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=timeout, follow_redirects=False)
    target = validation.final_url or raw
    redirects = 0

    try:
        while True:
            try:
                response = await http.get(target, headers={"Accept": "text/html,*/*"})
            except httpx.TimeoutException:
                return UrlCheckResult(ok=False, reason="timeout", final_url=target, redirects=redirects)
            except httpx.HTTPError:
                return UrlCheckResult(ok=False, reason="unreachable", final_url=target, redirects=redirects)

            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location", "")
                if not location:
                    return UrlCheckResult(
                        ok=False, reason="bad_redirect", status_code=response.status_code, final_url=target
                    )

                redirects += 1
                if redirects > MAX_REDIRECTS:
                    return UrlCheckResult(
                        ok=False, reason="too_many_redirects", final_url=target, redirects=redirects
                    )

                # Relative locations are resolved against the current target,
                # then validated exactly like the original URL.
                next_url = str(httpx.URL(target).join(location))
                hop = validate_url(next_url)
                if not hop.ok:
                    log_event(logger, logging.WARNING, "urlcheck.redirect.blocked", reason=hop.reason)
                    return UrlCheckResult(
                        ok=False, reason="blocked_redirect", final_url=next_url, redirects=redirects
                    )

                target = next_url
                continue

            body = response.content[:MAX_RESPONSE_BYTES]
            ok = 200 <= response.status_code < 400

            return UrlCheckResult(
                ok=ok,
                reason="reachable" if ok else "bad_status",
                status_code=response.status_code,
                final_url=target,
                redirects=redirects,
                details={"bytes_read": len(body)},
            )
    finally:
        if owns_client:
            await http.aclose()
