from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from core.config import Settings, get_settings
from services.google_calendar import GoogleCalendarService
from services.ingestion import GmailIngestionService, IcsIngestionService
from services.voice import VoiceService

router = APIRouter()

# Create singleton instance of VoiceService to maintain session state
_voice_service_instance = None

def get_voice_service() -> VoiceService:
    """Get or create singleton VoiceService instance."""
    global _voice_service_instance
    if _voice_service_instance is None:
        _voice_service_instance = VoiceService()
    return _voice_service_instance


@router.get("/events")
async def get_events(
    settings: Settings = Depends(get_settings),
    calendar_service: GoogleCalendarService = Depends(GoogleCalendarService),
    ics_service: IcsIngestionService = Depends(IcsIngestionService),
) -> dict:
    """
    Get events from Google Calendar AND Canvas for display in UI.
    
    Canvas events are fetched directly from ICS feeds (not from Google Calendar)
    and merged with Google Calendar events in the response.
    """
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
    
    # Merge events, with Canvas events kept separate
    all_events = google_events + canvas_events
    
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
    payload: dict,
    settings: Settings = Depends(get_settings),
    calendar_service: GoogleCalendarService = Depends(GoogleCalendarService),
) -> dict:
    """
    Delete an event from Google Calendar.

    Prevents deletion of Canvas-sourced events.
    """
    event_id = payload.get('event_id')
    event_title = payload.get('title', '')
    event_source = payload.get('source', '')

    if not event_id:
        return {"status": "error", "error": "event_id is required"}

    # Prevent deletion of Canvas events
    if event_source in ['Canvas', 'Harvard Canvas', 'MIT Canvas']:
        return {
            "status": "error",
            "error": "Cannot delete Canvas events from this interface. Please delete from Canvas directly.",
            "protected": True
        }

    # Prevent deletion if title contains Canvas indicator
    if event_title.startswith('[Canvas]') or event_title.startswith('[Harvard Canvas]') or event_title.startswith('[MIT Canvas]'):
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


@router.post("/events/create")
async def create_event(
    payload: dict,
    settings: Settings = Depends(get_settings),
    calendar_service: GoogleCalendarService = Depends(GoogleCalendarService),
) -> dict:
    """
    Create a new event in Google Calendar.
    """
    try:
        summary = payload.get('summary')
        start_time_str = payload.get('start_time')
        end_time_str = payload.get('end_time')
        location = payload.get('location')
        description = payload.get('description')
        all_day = payload.get('all_day', False)

        if not summary:
            return {"status": "error", "error": "Event title (summary) is required"}

        if not start_time_str or not end_time_str:
            return {"status": "error", "error": "Start and end times are required"}

        # Parse datetime strings
        from datetime import datetime
        start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
        end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))

        # Create event
        result = await calendar_service.create_event(
            settings=settings,
            summary=summary,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location=location,
            all_day=all_day
        )

        return {"status": "ok", "event": result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.post("/events/batch_import")
async def batch_import_events(
    payload: dict,
    settings: Settings = Depends(get_settings),
    calendar_service: GoogleCalendarService = Depends(GoogleCalendarService),
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
