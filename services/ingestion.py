from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any
import hashlib
import logging
import re

import httpx
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from icalendar import Calendar
from zoneinfo import ZoneInfo

from core.config import Settings
from services.google_calendar import GoogleCalendarService


logger = logging.getLogger(__name__)

EVENT_ID_ALLOWED_CHARS = re.compile(r"[^a-z0-9_-]")


class GmailIngestionService:
    """Gmail ingestion service for reservation emails."""

    def __init__(self) -> None:
        self.calendar_service = GoogleCalendarService()

    async def ingest(self, payload: dict, *, settings: Settings) -> dict:
        """Search Gmail for reservation emails and extract events."""
        _ = payload

        try:
            creds = self.calendar_service._get_credentials(settings)
            gmail_service = build('gmail', 'v1', credentials=creds)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Failed to initialise Gmail service")
            return {"handled": False, "reason": str(exc)}

        app_config = settings.load_app_config()
        query = app_config.gmail.search_query if app_config.gmail else ''

        try:
            results = gmail_service.users().messages().list(
                userId='me',
                q=query,
                maxResults=50,
            ).execute()
        except HttpError as exc:
            logger.exception("Gmail query failed")
            return {"handled": False, "reason": exc.error_details if hasattr(exc, 'error_details') else str(exc)}

        messages = results.get('messages', [])

        # Placeholder for future OpenAI/NLP powered extraction
        return {
            "handled": True,
            "emails_scanned": len(messages),
            "events_created": 0,
            "note": "Email parsing not yet implemented",
        }


class IcsIngestionService:
    """ICS ingestion service covering Canvas and generic feeds."""

    def __init__(self) -> None:
        self.calendar_service = GoogleCalendarService()

    async def ingest_canvas(self, payload: dict, *, settings: Settings) -> dict:
        """
        Fetch Canvas ICS feeds but do NOT sync to Google Calendar.
        
        Canvas events are kept separate and merged with Google Calendar events
        in the frontend only. This prevents Canvas events from cluttering
        Google Calendar while still allowing them to be displayed in the UI.
        """
        _ = payload
        app_config = settings.load_app_config()

        canvas_sources = app_config.get_all_canvas_sources()
        if not canvas_sources:
            return {"handled": False, "reason": "No Canvas ICS URLs configured"}

        # Just verify Canvas sources are accessible, don't sync to Google Calendar
        total_events = 0
        errors = []

        for source in canvas_sources:
            try:
                result = await self._fetch_canvas_events(
                    url=str(source.url),
                    source_name=source.name,
                )
                if result.get("handled"):
                    total_events += result.get("events_count", 0)
            except Exception as e:
                errors.append(f"{source.name}: {str(e)}")

        return {
            "handled": True,
            "events_count": total_events,
            "sources_processed": len(canvas_sources),
            "errors": errors if errors else None,
            "note": "Canvas events are NOT synced to Google Calendar - they are displayed in UI only"
        }
    
    async def fetch_canvas_events_for_display(self, *, settings: Settings) -> list[dict]:
        """
        Fetch Canvas events directly from ICS feeds for display in the UI.
        These events are NOT stored in Google Calendar.
        """
        app_config = settings.load_app_config()
        canvas_sources = app_config.get_all_canvas_sources()
        
        all_events = []
        timezone = self._get_timezone(settings.timezone)
        
        for source in canvas_sources:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(str(source.url))
                    response.raise_for_status()
                
                calendar = Calendar.from_ical(response.content)
                
                for component in calendar.walk():
                    if component.name != "VEVENT":
                        continue
                    
                    try:
                        payload = self._build_event_payload(component, timezone)
                        
                        # Format event for frontend (similar to Google Calendar format)
                        event = {
                            'id': f"canvas-{source.name.lower().replace(' ', '-')}-{payload['uid']}",
                            'title': payload['summary'],
                            'source': source.name,  # "Harvard Canvas", "MIT Canvas", etc.
                            'description': payload.get('description'),
                            'location': payload.get('location'),
                            'start': payload['start'].isoformat(),
                            'end': payload['end'].isoformat(),
                            'allDay': payload['all_day'],
                        }
                        all_events.append(event)
                    except ValueError:
                        continue
                        
            except Exception as exc:
                logger.warning(f"Failed to fetch Canvas events from {source.name}: {exc}")
                continue
        
        return all_events
    
    async def _fetch_canvas_events(self, *, url: str, source_name: str) -> dict:
        """Fetch and parse Canvas ICS data without syncing to Google Calendar."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.exception("Failed to fetch Canvas ICS feed", extra={"url": url})
            return {"handled": False, "source": source_name, "error": str(exc)}

        try:
            calendar = Calendar.from_ical(response.content)
        except Exception as exc:
            logger.exception("Failed to parse ICS feed", extra={"url": url})
            return {"handled": False, "source": source_name, "error": f"Invalid ICS data: {exc}"}

        event_count = sum(1 for component in calendar.walk() if component.name == "VEVENT")

        return {
            "handled": True,
            "source": source_name,
            "events_count": event_count,
        }

    async def ingest_generic(self, payload: dict, *, settings: Settings) -> dict:
        """Ingest any additional ICS feeds defined in the config."""
        _ = payload
        app_config = settings.load_app_config()

        if not app_config.ics_sources:
            return {"handled": False, "reason": "No ICS sources configured"}

        results = []
        for source in app_config.ics_sources:
            result = await self._ingest_ics_url(
                url=str(source.url),
                source_name=source.name,
                settings=settings,
            )
            results.append(result)

        return {
            "handled": True,
            "sources_processed": len(results),
            "results": results,
        }

    async def ingest_outlook(self, payload: dict, *, settings: Settings) -> dict:
        """
        Fetch Outlook Calendar events but do NOT sync to Google Calendar.

        Outlook events are kept separate and merged with Google Calendar events
        in the frontend only. This prevents Outlook events from cluttering
        Google Calendar while still allowing them to be displayed in the UI.
        """
        _ = payload
        app_config = settings.load_app_config()

        # Check for Outlook ICS URL in config
        outlook_sources = [s for s in (app_config.ics_sources or []) if 'outlook' in s.name.lower()]

        if not outlook_sources:
            return {
                "handled": False,
                "reason": "No Outlook calendar configured. Please add Outlook ICS URL to app_config.yaml"
            }

        # Just verify Outlook sources are accessible, don't sync to Google Calendar
        total_events = 0
        errors = []

        for source in outlook_sources:
            try:
                result = await self._fetch_outlook_events(
                    url=str(source.url),
                    source_name=source.name,
                )
                if result.get("handled"):
                    total_events += result.get("events_count", 0)
            except Exception as e:
                errors.append(f"{source.name}: {str(e)}")

        return {
            "handled": True,
            "events_count": total_events,
            "sources_processed": len(outlook_sources),
            "errors": errors if errors else None,
            "note": "Outlook events are NOT synced to Google Calendar - they are displayed in UI only"
        }

    async def fetch_outlook_events_for_display(self, *, settings: Settings) -> list[dict]:
        """
        Fetch Outlook events directly from ICS feeds for display in the UI.
        These events are NOT stored in Google Calendar.
        """
        app_config = settings.load_app_config()
        outlook_sources = [s for s in (app_config.ics_sources or []) if 'outlook' in s.name.lower()]

        all_events = []
        timezone = self._get_timezone(settings.timezone)

        for source in outlook_sources:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(str(source.url))
                    response.raise_for_status()

                calendar = Calendar.from_ical(response.content)

                for component in calendar.walk():
                    if component.name != "VEVENT":
                        continue

                    try:
                        payload = self._build_event_payload(component, timezone)

                        # Format event for frontend (similar to Google Calendar format)
                        event = {
                            'id': f"outlook-{source.name.lower().replace(' ', '-')}-{payload['uid']}",
                            'title': payload['summary'],
                            'source': source.name,  # "Outlook"
                            'description': payload.get('description'),
                            'location': payload.get('location'),
                            'start': payload['start'].isoformat(),
                            'end': payload['end'].isoformat(),
                            'allDay': payload['all_day'],
                        }
                        all_events.append(event)
                    except ValueError:
                        continue

            except Exception as exc:
                logger.warning(f"Failed to fetch Outlook events from {source.name}: {exc}")
                continue

        return all_events

    async def _fetch_outlook_events(self, *, url: str, source_name: str) -> dict:
        """Fetch and parse Outlook ICS data without syncing to Google Calendar."""
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.exception("Failed to fetch Outlook ICS feed", extra={"url": url})
            return {"handled": False, "source": source_name, "error": str(exc)}

        try:
            calendar = Calendar.from_ical(response.content)
        except Exception as exc:
            logger.exception("Failed to parse ICS feed", extra={"url": url})
            return {"handled": False, "source": source_name, "error": f"Invalid ICS data: {exc}"}

        event_count = sum(1 for component in calendar.walk() if component.name == "VEVENT")

        return {
            "handled": True,
            "source": source_name,
            "events_count": event_count,
        }

    async def _ingest_ics_url(
        self,
        *,
        url: str,
        source_name: str,
        settings: Settings,
    ) -> dict:
        """Fetch and parse ICS data, then mirror it to Google Calendar."""

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.exception("Failed to fetch ICS feed", extra={"url": url})
            return {"handled": False, "source": source_name, "error": str(exc)}

        try:
            calendar = Calendar.from_ical(response.content)
        except Exception as exc:  # pragma: no cover - ical parse edge cases
            logger.exception("Failed to parse ICS feed", extra={"url": url})
            return {"handled": False, "source": source_name, "error": f"Invalid ICS data: {exc}"}

        timezone = self._get_timezone(settings.timezone)
        created = 0
        updated = 0
        skipped: list[str] = []

        for component in calendar.walk():
            if component.name != "VEVENT":
                continue

            try:
                payload = self._build_event_payload(component, timezone)
            except ValueError as exc:
                summary = str(component.get('summary', 'Untitled')).strip() or 'Untitled'
                skipped.append(f"{summary}: {exc}")
                continue

            event_id = self._generate_event_id(source_name, payload['uid'])

            try:
                result = await self.calendar_service.create_or_update_event(
                    settings=settings,
                    summary=f"[{source_name}] {payload['summary']}",
                    start_time=payload['start'],
                    end_time=payload['end'],
                    description=payload.get('description'),
                    location=payload.get('location'),
                    all_day=payload['all_day'],
                    event_id=event_id,
                )
            except HttpError as exc:
                detail = getattr(exc, 'content', None) or getattr(exc, 'error_details', None) or str(exc)
                logger.warning(f"Skipped event '{payload['summary']}' - {exc}")
                skipped.append(f"{payload['summary']}: {detail}")
                continue

            action = result.get('action')
            if action == 'created':
                created += 1
            elif action == 'updated':
                updated += 1
            else:
                logger.debug("Unknown action returned from calendar service: %s", action)

        return {
            "handled": True,
            "source": source_name,
            "events_created": created,
            "events_updated": updated,
            "events_processed": created + updated,
            "skipped": skipped,
        }

    @staticmethod
    def _build_event_payload(component: Any, timezone: ZoneInfo) -> dict[str, Any]:
        summary = str(component.get('summary', 'Untitled')).strip() or 'Untitled'
        uid = str(component.get('uid', summary)).strip()

        dtstart = component.get('dtstart')
        if not dtstart:
            raise ValueError("Missing DTSTART")
        start = dtstart.dt

        dtend = component.get('dtend')
        duration = component.get('duration')
        if dtend:
            end = dtend.dt
        elif duration:
            end = start + duration.dt
        else:
            end = start

        all_day = isinstance(start, date) and not isinstance(start, datetime)

        start_dt = IcsIngestionService._coerce_datetime(start, timezone)
        end_dt = IcsIngestionService._coerce_datetime(end, timezone)

        if all_day and end_dt <= start_dt:
            end_dt = start_dt + timedelta(days=1)
        elif not all_day and end_dt <= start_dt:
            end_dt = start_dt + timedelta(hours=1)

        description = component.get('description')
        location = component.get('location')

        return {
            'summary': summary,
            'uid': uid,
            'start': start_dt,
            'end': end_dt,
            'all_day': all_day,
            'description': str(description) if description else None,
            'location': str(location) if location else None,
        }

    @staticmethod
    def _coerce_datetime(value: Any, timezone: ZoneInfo) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone)
            return value.astimezone(timezone)

        if isinstance(value, date):
            base = datetime.combine(value, time.min)
            return base.replace(tzinfo=timezone)

        raise ValueError(f"Unsupported date value: {value!r}")

    @staticmethod
    def _generate_event_id(source_name: str, uid: str) -> str:
        """
        Generate a stable event ID for Google Calendar.

        Normalizes Canvas source names to ensure consistent IDs:
        - "Harvard Canvas", "MIT Canvas", "Canvas" all become "canvas"
        - This prevents duplicates when syncing from multiple Canvas sources
        """
        # Normalize Canvas source names to prevent duplicates
        normalized_source = source_name.lower()
        if 'canvas' in normalized_source:
            normalized_source = 'canvas'  # All Canvas sources use same prefix

        # Google Calendar requires event IDs to be alphanumeric only
        base = f"{normalized_source}{uid}".lower()
        # Remove all non-alphanumeric characters
        base = re.sub(r'[^a-z0-9]', '', base)

        if len(base) < 5:
            digest = hashlib.sha1(uid.encode('utf-8', errors='ignore')).hexdigest()
            base = f"{base}{digest[:8]}"

        if len(base) > 1024:
            base = base[:1024]

        return base or hashlib.sha1(uid.encode('utf-8', errors='ignore')).hexdigest()

    @staticmethod
    def _get_timezone(timezone_name: str) -> ZoneInfo:
        try:
            return ZoneInfo(timezone_name)
        except Exception:  # pragma: no cover - fallback for invalid tz
            logger.warning("Unknown timezone '%s', defaulting to UTC", timezone_name)
            return ZoneInfo("UTC")

    async def sync_user_ics_source(
        self,
        *,
        source,  # IcsSource from user_config
        session_id: str,
        settings: Settings,
    ) -> dict:
        """
        Sync a user's ICS source to their Google Calendar.

        This method uses session-based authentication to sync to the specific
        user's Google Calendar, supporting multi-user deployment.
        """
        from core.user_config import IcsSource

        # Create a session-specific calendar service
        user_calendar_service = GoogleCalendarService(session_id=session_id)

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(source.url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.exception("Failed to fetch ICS feed", extra={"url": source.url})
            return {"events_synced": 0, "error": str(exc)}

        try:
            calendar = Calendar.from_ical(response.content)
        except Exception as exc:
            logger.exception("Failed to parse ICS feed", extra={"url": source.url})
            return {"events_synced": 0, "error": f"Invalid ICS data: {exc}"}

        timezone = self._get_timezone(settings.timezone)
        synced = 0
        errors = []

        for component in calendar.walk():
            if component.name != "VEVENT":
                continue

            try:
                payload = self._build_event_payload(component, timezone)
            except ValueError as exc:
                summary = str(component.get('summary', 'Untitled')).strip() or 'Untitled'
                errors.append(f"{summary}: {exc}")
                continue

            event_id = self._generate_event_id(source.name, payload['uid'])

            # Determine display name for the event
            display_name = source.name
            if source.source_type == "canvas":
                display_name = f"[{source.name}]"
            elif source.source_type == "outlook":
                display_name = f"[{source.name}]"
            else:
                display_name = f"[{source.name}]"

            try:
                await user_calendar_service.create_or_update_event(
                    settings=settings,
                    summary=f"{display_name} {payload['summary']}",
                    start_time=payload['start'],
                    end_time=payload['end'],
                    description=payload.get('description'),
                    location=payload.get('location'),
                    all_day=payload['all_day'],
                    event_id=event_id,
                )
                synced += 1
            except Exception as exc:
                logger.warning(f"Failed to sync event '{payload['summary']}': {exc}")
                errors.append(f"{payload['summary']}: {str(exc)}")
                continue

        return {
            "events_synced": synced,
            "source_name": source.name,
            "errors": errors if errors else None,
        }
