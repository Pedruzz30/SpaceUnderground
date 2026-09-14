"""SSRF protection for the outbound URL check.

`preview_url` is edited in the Admin, and the live-preview step makes the server
fetch it. That is the textbook request-forgery shape, so these are not
nice-to-have assertions: each one closes a specific way out of the allowlist.

Nothing here reaches the network. DNS is stubbed so a hostile resolver can be
simulated, and HTTP goes through an httpx MockTransport.
"""

from __future__ import annotations

import httpx
import pytest

from app.services import url_check_service
from app.services.url_check_service import check_url, validate_url


@pytest.fixture
def resolves(monkeypatch):
    """Points every hostname at chosen addresses, without touching DNS."""

    def apply(addresses: list[str]):
        def fake_getaddrinfo(host, *args, **kwargs):
            return [(None, None, None, "", (address, 0)) for address in addresses]

        monkeypatch.setattr(url_check_service.socket, "getaddrinfo", fake_getaddrinfo)

    return apply


def transport(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


# --- scheme and shape ------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "gopher://evil.example.com/",
        "ftp://example.com/x",
        "javascript:alert(1)",
        "data:text/html,<script>",
    ],
)
def test_only_http_and_https_are_allowed(url):
    result = validate_url(url)

    assert result.ok is False
    assert result.reason in {"blocked_scheme", "missing_host"}


def test_an_empty_or_malformed_url_is_refused():
    assert validate_url("").reason == "empty_url"
    assert validate_url("   ").reason == "empty_url"
    assert validate_url("https://").reason == "missing_host"


# --- literal addresses -----------------------------------------------------


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1",
        "0.0.0.0",
        "10.0.0.5",
        "172.16.0.1",
        "192.168.1.10",
        # Cloud metadata. The single most valuable SSRF target there is.
        "169.254.169.254",
        "[::1]",
        # Loopback wearing an IPv6 hat.
        "[::ffff:127.0.0.1]",
    ],
)
def test_private_and_reserved_addresses_are_blocked(host):
    result = validate_url(f"http://{host}/")

    assert result.ok is False
    assert result.reason == "blocked_address"


def test_a_public_literal_address_is_allowed():
    assert validate_url("https://93.184.216.34/").ok is True


@pytest.mark.parametrize("host", ["localhost", "LOCALHOST", "metadata.google.internal"])
def test_known_internal_hostnames_are_blocked_before_dns(host):
    result = validate_url(f"http://{host}/")

    assert result.ok is False
    assert result.reason == "blocked_host"


# --- DNS ------------------------------------------------------------------


def test_a_hostname_resolving_to_loopback_is_blocked(resolves):
    # The string looks public; only resolution reveals it is not. Checking the
    # literal alone is exactly the hole this closes.
    resolves(["127.0.0.1"])

    result = validate_url("http://totally-public.example.com/")

    assert result.ok is False
    assert result.reason == "blocked_address"


def test_a_hostname_resolving_to_metadata_is_blocked(resolves):
    resolves(["169.254.169.254"])

    assert validate_url("https://harmless.example.com/").ok is False


def test_a_split_resolution_is_blocked_entirely(resolves):
    """One public and one private answer is a rebinding attempt.

    Picking the public address would walk straight into it, so the whole name
    is refused.
    """
    resolves(["93.184.216.34", "10.0.0.1"])

    assert validate_url("https://rebinding.example.com/").ok is False


def test_a_hostname_that_does_not_resolve_is_blocked(monkeypatch):
    import socket as real_socket

    def boom(*args, **kwargs):
        raise real_socket.gaierror("no such host")

    monkeypatch.setattr(url_check_service.socket, "getaddrinfo", boom)

    assert validate_url("https://nowhere.example.com/").ok is False


def test_a_fully_public_hostname_is_allowed(resolves):
    resolves(["93.184.216.34"])

    assert validate_url("https://example.com/embed").ok is True


# --- requests and redirects ------------------------------------------------


@pytest.mark.asyncio
async def test_a_reachable_url_reports_its_status(resolves):
    resolves(["93.184.216.34"])

    async def handler(request):
        return httpx.Response(200, text="<html>ok</html>")

    async with transport(handler) as client:
        result = await check_url("https://example.com/embed", client=client)

    assert result.ok is True
    assert result.reason == "reachable"
    assert result.status_code == 200


@pytest.mark.asyncio
async def test_a_server_error_is_reported_but_not_fatal(resolves):
    resolves(["93.184.216.34"])

    async def handler(request):
        return httpx.Response(500)

    async with transport(handler) as client:
        result = await check_url("https://example.com/embed", client=client)

    assert result.ok is False
    assert result.reason == "bad_status"
    assert result.status_code == 500


@pytest.mark.asyncio
async def test_a_redirect_into_a_private_range_is_blocked(monkeypatch):
    """The classic escape: a public URL that redirects to metadata.

    httpx's own follow_redirects would validate the first hostname and then
    chase it anywhere, which is why redirects are followed by hand.
    """

    def fake_getaddrinfo(host, *args, **kwargs):
        address = "169.254.169.254" if "metadata" in host else "93.184.216.34"
        return [(None, None, None, "", (address, 0))]

    monkeypatch.setattr(url_check_service.socket, "getaddrinfo", fake_getaddrinfo)

    async def handler(request):
        return httpx.Response(302, headers={"location": "http://metadata.internal/latest/meta-data/"})

    async with transport(handler) as client:
        result = await check_url("https://example.com/embed", client=client)

    assert result.ok is False
    assert result.reason == "blocked_redirect"


@pytest.mark.asyncio
async def test_a_safe_redirect_is_followed(resolves):
    resolves(["93.184.216.34"])
    seen = []

    async def handler(request):
        seen.append(str(request.url))
        if len(seen) == 1:
            return httpx.Response(302, headers={"location": "/final"})
        return httpx.Response(200, text="ok")

    async with transport(handler) as client:
        result = await check_url("https://example.com/embed", client=client)

    assert result.ok is True
    assert result.redirects == 1
    assert result.final_url == "https://example.com/final"


@pytest.mark.asyncio
async def test_a_redirect_loop_is_capped(resolves):
    resolves(["93.184.216.34"])
    hops = []

    async def handler(request):
        hops.append(1)
        return httpx.Response(302, headers={"location": f"/hop{len(hops)}"})

    async with transport(handler) as client:
        result = await check_url("https://example.com/", client=client)

    assert result.ok is False
    assert result.reason == "too_many_redirects"
    assert len(hops) <= url_check_service.MAX_REDIRECTS + 1


@pytest.mark.asyncio
async def test_a_redirect_with_no_location_is_refused(resolves):
    resolves(["93.184.216.34"])

    async def handler(request):
        return httpx.Response(302)

    async with transport(handler) as client:
        result = await check_url("https://example.com/", client=client)

    assert result.ok is False
    assert result.reason == "bad_redirect"


@pytest.mark.asyncio
async def test_a_timeout_is_a_controlled_result(resolves):
    resolves(["93.184.216.34"])

    async def handler(request):
        raise httpx.ConnectTimeout("too slow")

    async with transport(handler) as client:
        result = await check_url("https://example.com/", client=client)

    assert result.ok is False
    assert result.reason == "timeout"


@pytest.mark.asyncio
async def test_an_unreachable_host_is_a_controlled_result(resolves):
    resolves(["93.184.216.34"])

    async def handler(request):
        raise httpx.ConnectError("refused")

    async with transport(handler) as client:
        result = await check_url("https://example.com/", client=client)

    assert result.ok is False
    assert result.reason == "unreachable"


@pytest.mark.asyncio
async def test_a_blocked_url_never_issues_a_request(resolves):
    called = []

    async def handler(request):  # pragma: no cover - must not run
        called.append(1)
        return httpx.Response(200)

    async with transport(handler) as client:
        result = await check_url("http://127.0.0.1:8000/admin", client=client)

    assert result.ok is False
    assert called == [], "a blocked address must be refused before any request"


@pytest.mark.asyncio
async def test_the_response_body_is_capped_and_never_returned(resolves):
    resolves(["93.184.216.34"])
    huge = "a" * (url_check_service.MAX_RESPONSE_BYTES * 3)

    async def handler(request):
        return httpx.Response(200, text=huge)

    async with transport(handler) as client:
        result = await check_url("https://example.com/", client=client)

    assert result.ok is True
    assert result.details["bytes_read"] <= url_check_service.MAX_RESPONSE_BYTES
    # The check reports that something answered; it never hands back content.
    assert "aaa" not in str(result.as_dict())
