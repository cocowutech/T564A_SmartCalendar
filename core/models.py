from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EventSource(str, Enum):
    GMAIL = "gmail"
    CANVAS = "canvas"
    ICS = "ics"
    VOICE = "voice"


class EventItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: EventSource
    source_name: str | None = None
    source_uid: str
    title: str
    description: str | None = None
    location: str | None = None
    start: datetime
    end: datetime
    attendees: list[str] = Field(default_factory=list)
    raw_url: str | None = None
    metadata: dict[str, Any] | None = None

    @property
    def duration_minutes(self) -> int:
        seconds = (self.end - self.start).total_seconds()
        return int(max(0, seconds // 60))


class Proposal(BaseModel):
    start: datetime
    end: datetime
    duration_minutes: int
    reason: str
    confidence: float = 0.5
    task_name: str | None = None


class IngestionSummary(BaseModel):
    source: EventSource
    total_items: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


class IntentType(str, Enum):
    ADD_RECURRING_EVENT = "ADD_RECURRING_EVENT"
    SUGGEST_TIME = "SUGGEST_TIME"
    CONFIRM = "CONFIRM"
    UNKNOWN = "UNKNOWN"


class IntentPayload(BaseModel):
    intent: IntentType
    confidence: float
    entities: dict[str, Any] = Field(default_factory=dict)


class RecurringEventSpec(BaseModel):
    title: str
    start: datetime
    end: datetime
    timezone: str
    weekdays: list[int]
    until: datetime | None = None
    location: str | None = None
    description: str | None = None
    attendees: list[str] = Field(default_factory=list)


class SuggestionRequest(BaseModel):
    task_name: str = "self-care"
    date: datetime
    duration_minutes: int = 120
    fallback_minutes: int | None = 60
    preferred_windows: list[tuple[str, str]] | None = None
    buffers_minutes: int = 10
