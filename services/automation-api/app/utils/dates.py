"""Date helpers for the analysis and reporting rules.

Supabase returns timestamptz as ISO-8601 strings, sometimes with a `Z` suffix
that `datetime.fromisoformat` rejected before 3.11 and still surprises people.
Parsing lives here so a malformed date degrades to None in one place rather
than raising from inside a scoring rule.
"""

from __future__ import annotations

from datetime import UTC, datetime


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
