from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Iterable, List, Sequence
from zoneinfo import ZoneInfo

import dateparser


def get_timezone(tz_name: str) -> ZoneInfo:
    """Return a ZoneInfo instance, raising a clear error when invalid."""
    try:
        return ZoneInfo(tz_name)
    except Exception as exc:  # pragma: no cover - ZoneInfo raises various subclassed errors
        raise ValueError(f"Invalid timezone '{tz_name}': {exc}") from exc


def ensure_timezone(dt: datetime, tz: ZoneInfo) -> datetime:
    """Ensure a datetime is timezone-aware and localized to the target zone."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def parse_human_datetime(value: str | datetime, tz: ZoneInfo) -> datetime:
    """Parse ISO or natural language datetime strings relative to a timezone."""
    if isinstance(value, datetime):
        return ensure_timezone(value, tz)

    try:
        parsed = datetime.fromisoformat(value)
        return ensure_timezone(parsed, tz)
    except ValueError:
        pass

    parsed = dateparser.parse(value, settings={"TIMEZONE": str(tz), "RETURN_AS_TIMEZONE_AWARE": True})
    if not parsed:
        raise ValueError(f"Unable to parse datetime value '{value}'")
    return parsed.astimezone(tz)


def overlaps(start: datetime, end: datetime, other_start: datetime, other_end: datetime) -> bool:
    """Return True if two intervals overlap."""
    return max(start, other_start) < min(end, other_end)


def merge_intervals(intervals: Sequence[tuple[datetime, datetime]]) -> List[tuple[datetime, datetime]]:
    """Merge overlapping intervals and return a normalized list."""
    if not intervals:
        return []
    sorted_intervals = sorted(intervals, key=lambda iv: iv[0])
    merged: list[tuple[datetime, datetime]] = [sorted_intervals[0]]
    for current_start, current_end in sorted_intervals[1:]:
        last_start, last_end = merged[-1]
        if current_start <= last_end:
            merged[-1] = (last_start, max(last_end, current_end))
        else:
            merged.append((current_start, current_end))
    return merged


def subtract_intervals(
    window: tuple[datetime, datetime], blocks: Iterable[tuple[datetime, datetime]]
) -> List[tuple[datetime, datetime]]:
    """Return free intervals within a window after removing busy blocks."""
    free: list[tuple[datetime, datetime]] = [window]
    for busy_start, busy_end in merge_intervals(list(blocks)):
        next_free: list[tuple[datetime, datetime]] = []
        for free_start, free_end in free:
            if busy_end <= free_start or busy_start >= free_end:
                next_free.append((free_start, free_end))
            else:
                if busy_start > free_start:
                    next_free.append((free_start, busy_start))
                if busy_end < free_end:
                    next_free.append((busy_end, free_end))
        free = next_free
        if not free:
            break
    return free


def to_datetime(day: datetime, t: time, tz: ZoneInfo) -> datetime:
    """Combine a date (datetime) and time component in the same timezone."""
    localized = ensure_timezone(day, tz)
    return localized.replace(hour=t.hour, minute=t.minute, second=t.second, microsecond=0)


def slot_duration(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds() // 60)
