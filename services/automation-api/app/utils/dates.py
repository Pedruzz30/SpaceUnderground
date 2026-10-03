"""Date helpers for the analysis and reporting rules.

Supabase returns timestamptz as ISO-8601 strings, sometimes with a `Z` suffix
that `datetime.fromisoformat` rejected before 3.11 and still surprises people.
Parsing lives here so a malformed date degrades to None in one place rather
than raising from inside a scoring rule.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, timezone, tzinfo


def parse_timestamp(value: object) -> datetime | None:
    """Parses a Supabase timestamp. Returns None for anything unusable."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)

    if not isinstance(value, str) or not value.strip():
        return None

    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def utc_now() -> datetime:
    return datetime.now(UTC)


def days_since(value: object, *, now: datetime | None = None) -> int | None:
    """Whole days between `value` and now. None when the date is unusable.

    A future timestamp reports 0 rather than a negative age: clock skew should
    not read as "updated tomorrow".
    """
    parsed = parse_timestamp(value)
    if parsed is None:
        return None

    reference = now or utc_now()
    delta = reference - parsed
    return max(delta.days, 0)


def isoformat(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


# Brazil has kept a fixed UTC-03:00 since daylight saving ended in 2019. Used
# only when the host has no IANA time zone database (Windows without tzdata),
# so a missing package can never move "today" by three hours silently.
_FIXED_OFFSETS = {"America/Sao_Paulo": timedelta(hours=-3), "UTC": timedelta(0)}


def business_timezone(name: str) -> tzinfo:
    """The time zone business days are counted in."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - ZoneInfoNotFoundError, ValueError, missing tzdata
        return timezone(_FIXED_OFFSETS.get(name, timedelta(0)), name)


def business_today(name: str, *, now: datetime | None = None) -> date:
    """Today's calendar date in the business time zone.

    "Overdue" compares a due date with this, the way the Admin compares it
    with the operator's local day.
    """
    return (now or utc_now()).astimezone(business_timezone(name)).date()
