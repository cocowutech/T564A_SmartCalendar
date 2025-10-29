from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterable, List

from dateutil.rrule import DAILY, MONTHLY, WEEKLY, rrule

WEEKDAY_LOOKUP = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}

RRULE_WEEKDAY = {
    0: 0,  # Monday
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5,
    6: 6,
}


@dataclass
class RecurrenceException:
    """Represents a single date or date range to skip."""

    start: date
    end: date | None = None

    def matches(self, target: datetime) -> bool:
        match_end = self.end or self.start
        return self.start <= target.date() <= match_end


@dataclass
class RecurrenceRule:
    """Normalized recurrence rule definition."""

    frequency: str
    interval: int = 1
    weekdays: List[int] = field(default_factory=list)  # 0=Mon
    until: datetime | None = None
    max_occurrences: int | None = None
    exceptions: List[RecurrenceException] = field(default_factory=list)

    def resolve_freq(self) -> int:
        freq_map = {
            "daily": DAILY,
            "weekly": WEEKLY,
            "biweekly": WEEKLY,
            "monthly": MONTHLY,
        }
        if self.frequency not in freq_map:
            raise ValueError(f"Unsupported frequency: {self.frequency}")
        return freq_map[self.frequency]

    def resolve_interval(self) -> int:
        if self.frequency == "biweekly":
            base = self.interval or 1
            return max(1, base) * 2
        return max(1, self.interval or 1)


def parse_weekday_tokens(tokens: Iterable[str]) -> List[int]:
    days: List[int] = []
    for token in tokens:
        token_lower = token.lower()
        if token_lower in WEEKDAY_LOOKUP:
            days.append(WEEKDAY_LOOKUP[token_lower])
    # Deduplicate while preserving order
    seen = set()
    ordered: List[int] = []
    for day in days:
        if day not in seen:
            seen.add(day)
            ordered.append(day)
    return ordered


def generate_occurrences(
    *,
    rule: RecurrenceRule,
    start: datetime,
    end: datetime,
) -> List[tuple[datetime, datetime]]:
    """
    Expand recurrence rule into concrete datetime ranges.

    Returns list of (start, end) tuples ordered chronologically.
    """
    freq = rule.resolve_freq()
    interval = rule.resolve_interval()
    duration = end - start
    if duration <= timedelta(0):
        raise ValueError("Event duration must be positive")

    rrule_kwargs = {
        "freq": freq,
        "interval": interval,
        "dtstart": start,
    }

    if rule.until:
        rrule_kwargs["until"] = rule.until

    if freq == WEEKLY and rule.weekdays:
        # dateutil weekday uses MO=0 etc
        rrule_kwargs["byweekday"] = rule.weekdays

    if freq == MONTHLY:
        # Lock to day-of-month of the start datetime
        rrule_kwargs["bymonthday"] = [start.day]

    occurrences: List[tuple[datetime, datetime]] = []
    counter = 0
    limit = rule.max_occurrences or 200  # safety guard

    for dt in rrule(**rrule_kwargs):
        if counter >= limit:
            break
        counter += 1

        skip = False
        for exception in rule.exceptions:
            if exception.matches(dt):
                skip = True
                break
        if skip:
            continue

        occ_end = dt + duration
        occurrences.append((dt, occ_end))

    return occurrences
