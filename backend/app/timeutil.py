"""All timestamps are stored as UTC. SQLite hands back naive datetimes while PostgreSQL returns aware ones,
so every read goes through as_utc() and every API timestamp through iso_utc()."""
from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def iso_utc(value: datetime | None) -> str | None:
    value = as_utc(value)
    return value.isoformat() if value else None
