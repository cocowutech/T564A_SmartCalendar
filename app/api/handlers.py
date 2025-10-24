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
) -> dict:
    """Get events from Google Calendar for display in UI."""
    # Get events for the next 90 days
    now = datetime.utcnow()

    events = await calendar_service.list_events(
        settings=settings,
        time_min=now - timedelta(days=30),  # Include recent past
        time_max=now + timedelta(days=365),
        max_results=500
    )
    return {"status": "ok", "events": events}


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
