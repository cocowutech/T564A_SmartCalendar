from datetime import date, datetime, time, timedelta
import re
from typing import List, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request

from core.config import Settings, get_settings
from core.session import get_session_id
from core.user_config import (
    load_user_config,
    save_user_config,
    add_calendar_source,
    remove_calendar_source,
    get_all_ics_sources,
    IcsSource,
)
from services.google_calendar import GoogleCalendarService
from services.ingestion import GmailIngestionService, IcsIngestionService
from services.recurrence import (
    RecurrenceException,
    RecurrenceRule,
    generate_occurrences,
    parse_weekday_tokens,
)
from services.voice import VoiceService

router = APIRouter()


def get_calendar_service(request: Request) -> GoogleCalendarService:
    """Get GoogleCalendarService with session context."""
    session_id = get_session_id(request)
    return GoogleCalendarService(session_id=session_id)

# Create singleton instance of VoiceService to maintain session state
_voice_service_instance = None

def get_voice_service() -> VoiceService:
    """Get or create singleton VoiceService instance."""
    global _voice_service_instance
    if _voice_service_instance is None:
        _voice_service_instance = VoiceService()
    return _voice_service_instance


@router.get("/calendar/presets")
async def get_calendar_presets(
    settings: Settings = Depends(get_settings),
) -> dict:
    """Expose academic calendar presets (term info, holidays) to the frontend."""
    app_config = settings.load_app_config()
    academic = app_config.academic_calendar

    holidays = [
        {"name": holiday.name, "start": holiday.start, "end": holiday.end}
        for holiday in academic.holidays
    ]

    return {
        "status": "ok",
        "presets": {
            "term_name": academic.term_name,
            "term_start_date": academic.term_start_date,
            "term_end_date": academic.term_end_date,
            "holidays": holidays,
        },
    }


@router.get("/events")
async def get_events(
    request: Request,
    settings: Settings = Depends(get_settings),
    ics_service: IcsIngestionService = Depends(IcsIngestionService),
) -> dict:
    """
    Get events from Google Calendar, Canvas, and Outlook for display in UI.

    Canvas and Outlook events are fetched directly from ICS feeds (not from Google Calendar)
    and merged with Google Calendar events in the response.
    """
    calendar_service = get_calendar_service(request)
    now = datetime.utcnow()

    # Fetch Google Calendar events
    google_events = await calendar_service.list_events(
        settings=settings,
        time_min=now - timedelta(days=30),  # Include recent past
        time_max=now + timedelta(days=365),
        max_results=500
    )

    # Fetch Canvas events directly (not from Google Calendar)
    canvas_events = await ics_service.fetch_canvas_events_for_display(settings=settings)

    # Fetch Outlook events directly (not from Google Calendar)
    outlook_events = await ics_service.fetch_outlook_events_for_display(settings=settings)

    # Merge all events
    all_events = google_events + canvas_events + outlook_events

    return {"status": "ok", "events": all_events}


@router.post("/ingest/gmail")
async def ingest_gmail(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: GmailIngestionService = Depends(GmailIngestionService),
) -> dict:
    """Trigger Gmail ingestion flow."""
    result = await service.ingest(payload, settings=settings)
    return {"status": "ok", "summary": result}


@router.post("/ingest/canvas")
async def ingest_canvas(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: IcsIngestionService = Depends(IcsIngestionService),
) -> dict:
    """Ingest Canvas ICS feed using shared ICS ingestion service."""
    result = await service.ingest_canvas(payload, settings=settings)
    return {"status": "ok", "summary": result}


@router.post("/ingest/ics")
async def ingest_ics(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: IcsIngestionService = Depends(IcsIngestionService),
) -> dict:
    result = await service.ingest_generic(payload, settings=settings)
    return {"status": "ok", "summary": result}


@router.post("/ingest/outlook")
async def ingest_outlook(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: IcsIngestionService = Depends(IcsIngestionService),
) -> dict:
    """
    Ingest Outlook Calendar events.

    This endpoint supports two methods:
    1. ICS URL from Outlook.com (read-only)
    2. Microsoft Graph API (full two-way sync) - requires setup
    """
    result = await service.ingest_outlook(payload, settings=settings)
    return {"status": "ok", "summary": result}


@router.post("/voice/add")
async def voice_add(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: VoiceService = Depends(get_voice_service),
) -> dict:
    result = await service.add_recurring(payload, settings=settings)
    return {"status": "ok", "result": result}


@router.post("/voice/query")
async def voice_query(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: VoiceService = Depends(get_voice_service),
) -> dict:
    reply = await service.suggest_time(payload, settings=settings)
    return {"status": "ok", "result": reply}


@router.post("/confirm")
async def confirm_event(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: VoiceService = Depends(get_voice_service),
) -> dict:
    confirmation = await service.confirm_event(payload, settings=settings)
    return {"status": "ok", "result": confirmation}


@router.post("/sync/all")
async def sync_all(
    payload: dict | None = None,
    settings: Settings = Depends(get_settings),
    gmail: GmailIngestionService = Depends(GmailIngestionService),
    ics: IcsIngestionService = Depends(IcsIngestionService),
    voice: VoiceService = Depends(get_voice_service),
) -> dict:
    summary = {
        "gmail": await gmail.ingest(payload or {}, settings=settings),
        "canvas": await ics.ingest_canvas(payload or {}, settings=settings),
        "ics": await ics.ingest_generic(payload or {}, settings=settings),
        "selfcare": await voice.daily_selfcare_summary(settings=settings),
    }
    return {"status": "ok", "summary": summary}


@router.post("/events/delete")
async def delete_event(
    request: Request,
    payload: dict,
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Delete an event from Google Calendar.

    Prevents deletion of Canvas-sourced events.
    """
    calendar_service = get_calendar_service(request)
    event_id = payload.get('event_id')
    event_title = payload.get('title', '')
    event_source = payload.get('source', '')

    if not event_id:
        return {"status": "error", "error": "event_id is required"}

    # Prevent deletion of Canvas events
    if event_source in ['Canvas', 'Harvard Canvas', 'MIT Canvas', 'Harvard Business School Canvas']:
        return {
            "status": "error",
            "error": "Cannot delete Canvas events from this interface. Please delete from Canvas directly.",
            "protected": True
        }

    # Prevent deletion if title contains Canvas indicator
    if (
        event_title.startswith('[Canvas]')
        or event_title.startswith('[Harvard Canvas]')
        or event_title.startswith('[MIT Canvas]')
        or event_title.startswith('[Harvard Business School Canvas]')
    ):
        return {
            "status": "error",
            "error": "Cannot delete Canvas events from this interface.",
            "protected": True
        }

    try:
        result = await calendar_service.delete_event(settings, event_id)
        return {"status": "ok", "result": result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.post("/events/update")
async def update_event(
    request: Request,
    payload: dict,
    settings: Settings = Depends(get_settings),
) -> dict:
    calendar_service = get_calendar_service(request)
    try:
        event_id = payload.get("event_id")
        if not event_id:
            return {"status": "error", "error": "event_id is required"}

        scope = (payload.get("scope") or "single").lower()
        summary = payload.get("summary")
        location = payload.get("location")
        description = payload.get("description")
        all_day = payload.get("all_day", False)
        parent_id = payload.get("series_parent_id")

        tz = ZoneInfo(settings.timezone)

        def parse_dt(value: str | None) -> datetime | None:
            if not value:
                return None
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                return dt.replace(tzinfo=tz)
            return dt.astimezone(tz)

        target_updates: List[dict] = []

        if scope == "single":
            start_time_str = payload.get("start_time")
            end_time_str = payload.get("end_time")
            start_dt = parse_dt(start_time_str)
            end_dt = parse_dt(end_time_str)
            if not start_dt or not end_dt:
                return {"status": "error", "error": "Start and end times are required for updates"}
            target_updates.append({
                "event_id": event_id,
                "start": start_dt,
                "end": end_dt,
            })
        elif scope == "future":
            updates_payload = payload.get("updates") or []
            if not updates_payload:
                return {"status": "error", "error": "Updates list is required for future edits"}
            for update in updates_payload:
                update_id = update.get("event_id")
                start_dt = parse_dt(update.get("start_time"))
                end_dt = parse_dt(update.get("end_time"))
                if not update_id or not start_dt or not end_dt:
                    continue
                target_updates.append({
                    "event_id": update_id,
                    "start": start_dt,
                    "end": end_dt,
                })
            if not target_updates:
                return {"status": "error", "error": "No valid updates provided"}
        else:
            return {"status": "error", "error": f"Unknown update scope: {scope}"}

        updated_events: List[dict] = []

        for update in target_updates:
            if update["end"] <= update["start"]:
                return {"status": "error", "error": "End time must be after start time"}

            existing = await calendar_service.get_event(settings, update["event_id"])
            existing_extended = existing.get("extendedProperties")
            existing_private = existing_extended.get("private", {}) if existing_extended else {}

            if parent_id and existing_private.get("smart_series_parent") and existing_private.get("smart_series_parent") != parent_id:
                return {"status": "error", "error": "Event does not belong to the requested series"}

            existing_summary = existing.get("summary")
            existing_location = existing.get("location")
            existing_description = existing.get("description")
            existing_start = existing.get("start", {})
            is_all_day = 'date' in existing_start if existing_start else all_day

            result = await calendar_service.create_or_update_event(
                settings=settings,
                summary=summary or existing_summary or "Untitled",
                start_time=update["start"],
                end_time=update["end"],
                description=description if description is not None else existing_description,
                location=location if location is not None else existing_location,
                all_day=is_all_day,
                event_id=update["event_id"],
                extended_properties=existing_extended,
            )
            updated_events.append(result.get("event", result))

        return {
            "status": "ok",
            "updated_count": len(updated_events),
            "events": updated_events,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


_EVENT_ID_SANITIZER = re.compile(r"[^a-z0-9]")


def _sanitize_event_id(value: str, *, fallback_prefix: str = "sc") -> str:
    """Ensure the event ID uses allowed characters for Google Calendar."""
    prefix = (fallback_prefix or "sc").lower()
    prefix = _EVENT_ID_SANITIZER.sub("", prefix) or "sc"

    candidate = (value or "").lower()
    candidate = _EVENT_ID_SANITIZER.sub("", candidate)

    if not candidate:
        candidate = f"{prefix}{uuid4().hex[:12]}"

    if not candidate[0].isalpha():
        candidate = f"{prefix}{candidate}"
        candidate = _EVENT_ID_SANITIZER.sub("", candidate)

    if len(candidate) < 5:
        candidate = f"{candidate}{uuid4().hex[:5]}"

    candidate = _EVENT_ID_SANITIZER.sub("", candidate)

    if not candidate:
        candidate = f"{prefix}{uuid4().hex[:12]}"

    return candidate[:1024]


def _build_occurrence_event_id(parent_id: str, occurrence_start: datetime, index: int) -> str:
    timestamp = occurrence_start.strftime("%Y%m%d%H%M%S")
    raw_id = f"{parent_id}{timestamp}{index}"
    return _sanitize_event_id(raw_id, fallback_prefix=parent_id)


def _build_recurrence_rule(
    *,
    recurrence_payload: dict,
    start_time: datetime,
    end_time: datetime,
    settings: Settings,
) -> tuple[RecurrenceRule, str]:
    frequency = (recurrence_payload.get("frequency") or "weekly").lower()
    interval_val = recurrence_payload.get("interval") or 1
    try:
        interval = int(interval_val)
    except (TypeError, ValueError):
        interval = 1

    raw_days = (
        recurrence_payload.get("days")
        or recurrence_payload.get("days_of_week")
        or recurrence_payload.get("daysOfWeek")
        or []
    )
    weekdays = parse_weekday_tokens(raw_days)
    if frequency in {"weekly", "biweekly"} and not weekdays:
        weekdays = [start_time.weekday()]

    app_config = settings.load_app_config()
    timezone = start_time.tzinfo or ZoneInfo(settings.timezone)

    until_type = (
        recurrence_payload.get("repeat_until_type")
        or recurrence_payload.get("repeatUntilType")
        or "date"
    )
    until_value = (
        recurrence_payload.get("repeat_until")
        or recurrence_payload.get("repeatUntilDate")
    )

    until_dt: datetime | None = None

    base_time = time(
        hour=start_time.hour,
        minute=start_time.minute,
        second=start_time.second,
        microsecond=start_time.microsecond,
        tzinfo=timezone,
    )

    if until_type == "end_of_semester":
        term_end = app_config.academic_calendar.resolve_term_end()
        if not term_end:
            raise ValueError("End of semester date is not configured in academic_calendar")
        until_dt = datetime.combine(term_end, base_time)
    elif until_value:
        until_date = date.fromisoformat(until_value)
        until_dt = datetime.combine(until_date, base_time)
    else:
        raise ValueError("Repeat 'until' date is required for recurring events")

    if until_dt < start_time:
        raise ValueError("Repeat end date must be after the start date")

    exceptions_payload = recurrence_payload.get("exceptions") or []
    exceptions: List[RecurrenceException] = []
    for item in exceptions_payload:
        start_str = item.get("start") or item.get("date")
        end_str = item.get("end")
        if not start_str:
            continue
        try:
            start_date = date.fromisoformat(start_str)
        except ValueError:
            continue
        end_date = None
        if end_str:
            try:
                end_date = date.fromisoformat(end_str)
            except ValueError:
                end_date = None
        exceptions.append(RecurrenceException(start=start_date, end=end_date))

    max_occurrences = (
        recurrence_payload.get("max_occurrences")
        or recurrence_payload.get("maxOccurrences")
        or None
    )
    if isinstance(max_occurrences, str) and max_occurrences.isdigit():
        max_occurrences = int(max_occurrences)
    elif not isinstance(max_occurrences, int):
        max_occurrences = None

    rule = RecurrenceRule(
        frequency=frequency,
        interval=interval,
        weekdays=weekdays,
        until=until_dt,
        max_occurrences=max_occurrences,
        exceptions=exceptions,
    )

    parent_id = (
        recurrence_payload.get("parent_id")
        or recurrence_payload.get("parentId")
        or f"sc-{uuid4().hex[:16]}"
    )

    parent_id = _sanitize_event_id(parent_id)

    return rule, parent_id


@router.post("/events/create")
async def create_event(
    request: Request,
    payload: dict,
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Create a new event in Google Calendar.
    """
    calendar_service = get_calendar_service(request)
    try:
        summary = payload.get('summary')
        start_time_str = payload.get('start_time')
        end_time_str = payload.get('end_time')
        location = payload.get('location')
        description = payload.get('description')
        all_day = payload.get('all_day', False)
        recurrence_payload = payload.get('recurrence') or {}
        requested_timezone_raw = payload.get('event_timezone')
        requested_timezone = None
        if isinstance(requested_timezone_raw, str):
            requested_timezone = requested_timezone_raw.strip() or None

        try:
            event_timezone = ZoneInfo(requested_timezone) if requested_timezone else ZoneInfo(settings.timezone)
            event_timezone_name = requested_timezone or settings.timezone
        except Exception:
            event_timezone = ZoneInfo(settings.timezone)
            event_timezone_name = settings.timezone

        if not summary:
            return {"status": "error", "error": "Event title (summary) is required"}

        if not start_time_str or not end_time_str:
            return {"status": "error", "error": "Start and end times are required"}

        # Parse datetime strings with timezone awareness
        # Handle date-only strings for all-day events (format: "2025-11-26")
        if all_day and re.match(r'^\d{4}-\d{2}-\d{2}$', start_time_str):
            # For all-day events with date-only strings, parse as local date at noon
            start_time = datetime.strptime(start_time_str, "%Y-%m-%d").replace(
                hour=12, tzinfo=event_timezone
            )
            end_time = datetime.strptime(end_time_str, "%Y-%m-%d").replace(
                hour=12, tzinfo=event_timezone
            )
        else:
            start_time = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
            end_time = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=event_timezone)
            else:
                start_time = start_time.astimezone(event_timezone)

            if end_time.tzinfo is None:
                end_time = end_time.replace(tzinfo=event_timezone)
            else:
                end_time = end_time.astimezone(event_timezone)

        if recurrence_payload.get("enabled"):
            rule, parent_id = _build_recurrence_rule(
                recurrence_payload=recurrence_payload,
                start_time=start_time,
                end_time=end_time,
                settings=settings,
            )

            occurrences = generate_occurrences(rule=rule, start=start_time, end=end_time)

            if not occurrences:
                return {"status": "error", "error": "No matching dates found for recurrence settings"}

            created_events = []
            for index, (occ_start, occ_end) in enumerate(occurrences, start=1):
                occurrence_id = _build_occurrence_event_id(parent_id, occ_start, index)
                extended_properties = {
                    "private": {
                        "smart_series_parent": parent_id,
                        "smart_series_frequency": rule.frequency,
                        "smart_series_origin": "manual_activity",
                        "smart_series_index": str(index),
                    }
                }

                result = await calendar_service.create_or_update_event(
                    settings=settings,
                    summary=summary,
                    start_time=occ_start,
                    end_time=occ_end,
                    description=description,
                    location=location,
                    all_day=all_day,
                    event_id=occurrence_id,
                    extended_properties=extended_properties,
                    event_timezone=event_timezone_name,
                )
                created_events.append(result.get("event", result))

            return {
                "status": "ok",
                "created_count": len(created_events),
                "series_parent_id": parent_id,
                "events": created_events,
            }

        # Create single event
        result = await calendar_service.create_event(
            settings=settings,
            summary=summary,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location=location,
            all_day=all_day,
            event_timezone=event_timezone_name,
        )

        return {"status": "ok", "event": result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.post("/events/batch_import")
async def batch_import_events(
    request: Request,
    payload: dict,
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Import multiple events from CSV/Excel data.

    Expected payload:
    {
        "events": [
            {
                "title": "Event Name",
                "date": "2025-10-24",
                "start_time": "09:00",
                "end_time": "10:00",
                "location": "Optional",
                "description": "Optional",
                "all_day": false
            },
            ...
        ]
    }
    """
    calendar_service = get_calendar_service(request)
    try:
        events_data = payload.get('events', [])

        if not events_data:
            return {"status": "error", "error": "No events provided"}

        created_events = []
        errors = []

        for idx, event_data in enumerate(events_data):
            try:
                from datetime import datetime, time

                title = event_data.get('title', '').strip()
                date_str = event_data.get('date', '').strip()
                start_time_str = event_data.get('start_time', '').strip()
                end_time_str = event_data.get('end_time', '').strip()
                location = event_data.get('location', '').strip() or None
                description = event_data.get('description', '').strip() or None
                all_day = event_data.get('all_day', False)

                if not title:
                    errors.append(f"Row {idx+1}: Missing title")
                    continue

                if not date_str:
                    errors.append(f"Row {idx+1}: Missing date")
                    continue

                # Parse date
                if 'T' in date_str:
                    base_date = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                else:
                    base_date = datetime.strptime(date_str, '%Y-%m-%d')

                if all_day:
                    # All-day event
                    start_time = base_date.replace(hour=0, minute=0, second=0)
                    end_time = base_date.replace(hour=23, minute=59, second=59)
                else:
                    # Timed event
                    if not start_time_str or not end_time_str:
                        errors.append(f"Row {idx+1}: Missing start or end time for timed event")
                        continue

                    # Parse times
                    start_parts = start_time_str.split(':')
                    end_parts = end_time_str.split(':')

                    start_time = base_date.replace(
                        hour=int(start_parts[0]),
                        minute=int(start_parts[1]) if len(start_parts) > 1 else 0
                    )
                    end_time = base_date.replace(
                        hour=int(end_parts[0]),
                        minute=int(end_parts[1]) if len(end_parts) > 1 else 0
                    )

                # Create event
                result = await calendar_service.create_event(
                    settings=settings,
                    summary=title,
                    start_time=start_time,
                    end_time=end_time,
                    description=description,
                    location=location,
                    all_day=all_day
                )

                created_events.append({
                    "title": title,
                    "date": date_str,
                    "event_id": result.get('id')
                })

            except Exception as e:
                errors.append(f"Row {idx+1}: {str(e)}")
                continue

        return {
            "status": "ok",
            "created_count": len(created_events),
            "error_count": len(errors),
            "created_events": created_events,
            "errors": errors
        }

    except Exception as e:
        return {"status": "error", "error": str(e)}


# ============================================================================
# User Calendar Sources (per-user configuration for multi-user deployment)
# ============================================================================

@router.get("/user/calendar-sources")
async def get_user_calendar_sources(request: Request) -> dict:
    """Get user's configured calendar sources (Canvas, Outlook, etc.)."""
    session_id = get_session_id(request)
    if not session_id:
        return {"status": "error", "error": "Not authenticated"}

    config = load_user_config(session_id)
    return {
        "status": "ok",
        "canvas_sources": [s.model_dump() for s in config.canvas_sources],
        "ics_sources": [s.model_dump() for s in config.ics_sources],
    }


@router.post("/user/calendar-sources")
async def add_user_calendar_source(request: Request, payload: dict) -> dict:
    """
    Add a calendar source for the user.

    Expected payload:
    {
        "name": "Harvard Canvas",
        "url": "https://canvas.harvard.edu/feeds/calendars/...",
        "source_type": "canvas"  // or "outlook", "ics"
    }
    """
    session_id = get_session_id(request)
    if not session_id:
        return {"status": "error", "error": "Not authenticated"}

    name = payload.get("name", "").strip()
    url = payload.get("url", "").strip()
    source_type = payload.get("source_type", "ics").lower()

    if not name:
        return {"status": "error", "error": "Name is required"}

    if not url:
        return {"status": "error", "error": "URL is required"}

    # Validate URL format
    if not url.startswith(("http://", "https://")):
        return {"status": "error", "error": "URL must start with http:// or https://"}

    # Auto-detect source type from URL if not specified
    if source_type == "ics":
        if "canvas" in url.lower():
            source_type = "canvas"
        elif "outlook" in url.lower() or "office365" in url.lower():
            source_type = "outlook"

    config = add_calendar_source(session_id, name, url, source_type)

    return {
        "status": "ok",
        "message": f"Added {source_type} source: {name}",
        "canvas_sources": [s.model_dump() for s in config.canvas_sources],
        "ics_sources": [s.model_dump() for s in config.ics_sources],
    }


@router.delete("/user/calendar-sources")
async def remove_user_calendar_source(request: Request, payload: dict) -> dict:
    """Remove a calendar source by URL."""
    session_id = get_session_id(request)
    if not session_id:
        return {"status": "error", "error": "Not authenticated"}

    url = payload.get("url", "").strip()
    if not url:
        return {"status": "error", "error": "URL is required"}

    config = remove_calendar_source(session_id, url)

    return {
        "status": "ok",
        "message": "Calendar source removed",
        "canvas_sources": [s.model_dump() for s in config.canvas_sources],
        "ics_sources": [s.model_dump() for s in config.ics_sources],
    }


@router.post("/user/sync-sources")
async def sync_user_sources(
    request: Request,
    settings: Settings = Depends(get_settings),
    ics_service: IcsIngestionService = Depends(IcsIngestionService),
) -> dict:
    """
    Sync all user's configured calendar sources to Google Calendar.
    """
    session_id = get_session_id(request)
    if not session_id:
        return {"status": "error", "error": "Not authenticated"}

    calendar_service = get_calendar_service(request)

    # Check if user has valid Google credentials
    if not calendar_service.has_valid_credentials(settings):
        return {"status": "error", "error": "Please connect Google Calendar first"}

    sources = get_all_ics_sources(session_id)
    if not sources:
        return {"status": "ok", "message": "No calendar sources configured", "synced": []}

    results = []
    for source in sources:
        try:
            # Use the ICS service to sync this source
            sync_result = await ics_service.sync_user_ics_source(
                source=source,
                session_id=session_id,
                settings=settings,
            )
            results.append({
                "name": source.name,
                "url": source.url[:50] + "..." if len(source.url) > 50 else source.url,
                "status": "ok",
                "events_synced": sync_result.get("events_synced", 0),
            })
        except Exception as e:
            results.append({
                "name": source.name,
                "status": "error",
                "error": str(e),
            })

    return {"status": "ok", "synced": results}
