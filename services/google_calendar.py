from __future__ import annotations

import json
import logging
import os
import os.path
import pickle
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow, Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from zoneinfo import ZoneInfo

from core.config import Settings
from core.session import get_user_token_path

logger = logging.getLogger(__name__)

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.readonly'
]


class GoogleCalendarService:
    """Service for interacting with Google Calendar API."""

    def __init__(self, session_id: Optional[str] = None):
        self._credentials = None
        self._calendar_service = None
        self._session_id = session_id

    def _get_token_file(self, settings: Settings) -> Path:
        """Get the token file path - per-user if session_id is set."""
        if self._session_id:
            # Multi-user mode: use session-specific token
            return get_user_token_path(self._session_id)
        else:
            # Single-user mode (local development): use default token dir
            token_dir = Path(settings.google_token_dir).expanduser()
            token_dir.mkdir(parents=True, exist_ok=True)
            return token_dir / 'token.pickle'

    def has_valid_credentials(self, settings: Settings) -> bool:
        """Check if user has valid credentials without triggering auth flow."""
        token_file = self._get_token_file(settings)
        if not token_file.exists():
            return False

        try:
            with open(token_file, 'rb') as f:
                creds = pickle.load(f)
            if creds and creds.valid:
                return True
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                with open(token_file, 'wb') as f:
                    pickle.dump(creds, f)
                return True
        except Exception:
            return False
        return False

    def get_auth_url(self, settings: Settings, redirect_uri: str) -> str:
        """Generate OAuth authorization URL for web-based flow."""
        client_secrets = settings.get_client_secrets_path()

        # Load client secrets and check type
        with open(client_secrets, 'r') as f:
            secrets_data = json.load(f)

        # Determine if web or installed app credentials
        if 'web' in secrets_data:
            flow = Flow.from_client_secrets_file(
                client_secrets,
                scopes=SCOPES,
                redirect_uri=redirect_uri
            )
        else:
            # For installed app credentials, we need to use a special redirect
            flow = Flow.from_client_secrets_file(
                client_secrets,
                scopes=SCOPES,
                redirect_uri=redirect_uri
            )

        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )
        return auth_url

    def exchange_code(self, settings: Settings, code: str, redirect_uri: str) -> bool:
        """Exchange authorization code for credentials."""
        try:
            client_secrets = settings.get_client_secrets_path()

            flow = Flow.from_client_secrets_file(
                client_secrets,
                scopes=SCOPES,
                redirect_uri=redirect_uri
            )
            flow.fetch_token(code=code)
            creds = flow.credentials

            # Save credentials
            token_file = self._get_token_file(settings)
            token_file.parent.mkdir(parents=True, exist_ok=True)
            with open(token_file, 'wb') as f:
                pickle.dump(creds, f)

            self._credentials = creds
            return True
        except Exception as e:
            logger.error(f"Failed to exchange OAuth code: {e}")
            return False

    def _get_credentials(self, settings: Settings) -> Credentials:
        """Get or refresh Google OAuth credentials."""
        if self._credentials and self._credentials.valid:
            return self._credentials

        token_file = self._get_token_file(settings)

        creds = None
        # Token file stores the user's access and refresh tokens
        if token_file.exists():
            with open(token_file, 'rb') as token:
                creds = pickle.load(token)

        # If there are no valid credentials, let the user log in
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                except RefreshError as exc:
                    logger.warning(
                        "Google OAuth refresh failed (%s); removing cached token and re-authenticating",
                        exc
                    )
                    try:
                        token_file.unlink(missing_ok=True)
                    except OSError:
                        logger.exception("Failed to delete invalid Google token cache at %s", token_file)
                    creds = None

            if not creds:
                # In web mode, we can't use local server flow
                if self._session_id:
                    raise ValueError("User needs to authenticate via OAuth flow")
                else:
                    # Local development fallback
                    flow = InstalledAppFlow.from_client_secrets_file(
                        settings.get_client_secrets_path(), SCOPES
                    )
                    creds = flow.run_local_server(port=0)

            # Save the credentials for the next run
            if creds:
                with open(token_file, 'wb') as token:
                    pickle.dump(creds, token)

        self._credentials = creds
        return creds

    def _get_calendar_service(self, settings: Settings):
        """Get Google Calendar API service."""
        if not self._calendar_service:
            creds = self._get_credentials(settings)
            self._calendar_service = build('calendar', 'v3', credentials=creds)
        return self._calendar_service

    def logout(self, settings: Settings) -> bool:
        """Remove user's stored credentials."""
        try:
            token_file = self._get_token_file(settings)
            if token_file.exists():
                token_file.unlink()
            self._credentials = None
            self._calendar_service = None
            return True
        except Exception as e:
            logger.error(f"Failed to logout: {e}")
            return False

    async def list_events(
        self,
        settings: Settings,
        time_min: datetime | None = None,
        time_max: datetime | None = None,
        max_results: int = 100
    ) -> list[dict]:
        """Fetch events from Google Calendar."""
        service = self._get_calendar_service(settings)

        # Default to events from now onwards
        if not time_min:
            time_min = datetime.utcnow()
        if not time_max:
            time_max = time_min + timedelta(days=90)

        # Format datetime for Google Calendar API
        # If timezone-aware, use RFC3339 format; if naive, treat as UTC and add 'Z'
        if time_min.tzinfo is not None:
            time_min_str = time_min.isoformat()
        else:
            time_min_str = time_min.isoformat() + 'Z'

        if time_max.tzinfo is not None:
            time_max_str = time_max.isoformat()
        else:
            time_max_str = time_max.isoformat() + 'Z'

        events_result = service.events().list(
            calendarId=settings.google_calendar_id,
            timeMin=time_min_str,
            timeMax=time_max_str,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])

        # Format events for frontend
        formatted_events = []
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            end = event['end'].get('dateTime', event['end'].get('date'))
            title = event.get('summary', 'No Title')
            extended_properties = event.get('extendedProperties', {})
            private_props = extended_properties.get('private', {}) if extended_properties else {}

            # Detect event source from title prefix
            # Events synced from Canvas have [Canvas], [Harvard Canvas], [MIT Canvas] prefix
            source = 'Google'  # Default
            if title.startswith('[Harvard Canvas]'):
                source = 'Harvard Canvas'
            elif title.startswith('[MIT Canvas]'):
                source = 'MIT Canvas'
            elif title.startswith('[Canvas]'):
                source = 'Canvas'
            elif title.startswith('['):
                # Extract any other source in brackets
                match = re.match(r'^\[([^\]]+)\]', title)
                if match:
                    source = match.group(1)

            formatted_events.append({
                'id': event['id'],
                'title': title,
                'date': start.split('T')[0] if 'T' in start else start,
                'time': start.split('T')[1][:5] if 'T' in start else None,
                'location': event.get('location'),
                'description': event.get('description'),
                'start': start,
                'end': end,
                'source': source,
                'allDay': 'date' in event['start'],  # All-day events use 'date' instead of 'dateTime'
                'metadata': {
                    'smartSeriesParent': private_props.get('smart_series_parent'),
                    'smartSeriesOrigin': private_props.get('smart_series_origin'),
                    'smartSeriesIndex': private_props.get('smart_series_index'),
                },
                'extendedProperties': extended_properties or None,
            })

        return formatted_events

    def _build_event_body(
        self,
        *,
        settings: Settings,
        summary: str,
        start_time: datetime,
        end_time: datetime,
        description: str | None = None,
        location: str | None = None,
        all_day: bool = False,
        attendees: list[dict] | None = None,
        extended_properties: dict | None = None,
        event_timezone: str | None = None,
    ) -> dict:
        timezone_name = event_timezone or settings.timezone
        start = self._normalize_datetime(start_time, timezone_name)
        end = self._normalize_datetime(end_time, timezone_name)

        event: dict = {
            'summary': summary,
        }

        if all_day:
            event['start'] = {'date': self._datetime_to_date_str(start)}
            event['end'] = {'date': self._datetime_to_date_str(end)}
        else:
            event['start'] = {
                'dateTime': start.isoformat(),
                'timeZone': timezone_name,
            }
            event['end'] = {
                'dateTime': end.isoformat(),
                'timeZone': timezone_name,
            }

        if description:
            event['description'] = description
        if location:
            event['location'] = location
        if attendees:
            event['attendees'] = attendees
        if extended_properties:
            event['extendedProperties'] = extended_properties

        return event

    @staticmethod
    def _normalize_datetime(dt: datetime, timezone_name: str) -> datetime:
        tz = ZoneInfo(timezone_name)

        if dt.tzinfo is None:
            return dt.replace(tzinfo=tz)

        return dt.astimezone(tz)

    @staticmethod
    def _datetime_to_date_str(dt: datetime) -> str:
        return dt.date().isoformat()

    async def create_event(
        self,
        settings: Settings,
        summary: str,
        start_time: datetime,
        end_time: datetime,
        description: str | None = None,
        location: str | None = None,
        *,
        all_day: bool = False,
        attendees: list[dict] | None = None,
        event_id: str | None = None,
        extended_properties: dict | None = None,
        event_timezone: str | None = None,
    ) -> dict:
        """Create a new event in Google Calendar."""
        service = self._get_calendar_service(settings)
        event = self._build_event_body(
            settings=settings,
            summary=summary,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location=location,
            all_day=all_day,
            attendees=attendees,
            extended_properties=extended_properties,
            event_timezone=event_timezone,
        )

        if event_id:
            event['id'] = event_id

        created_event = service.events().insert(
            calendarId=settings.google_calendar_id,
            body=event,
        ).execute()

        return created_event

    async def create_or_update_event(
        self,
        settings: Settings,
        summary: str,
        start_time: datetime,
        end_time: datetime,
        description: str | None = None,
        location: str | None = None,
        *,
        all_day: bool = False,
        attendees: list[dict] | None = None,
        event_id: str | None = None,
        extended_properties: dict | None = None,
        event_timezone: str | None = None,
    ) -> dict:
        """Create a calendar event or update an existing one when IDs collide."""
        service = self._get_calendar_service(settings)
        event_body = self._build_event_body(
            settings=settings,
            summary=summary,
            start_time=start_time,
            end_time=end_time,
            description=description,
            location=location,
            all_day=all_day,
            attendees=attendees,
            extended_properties=extended_properties,
            event_timezone=event_timezone,
        )

        if event_id:
            event_body['id'] = event_id
            # Check if event already exists before trying to insert
            try:
                existing = service.events().get(
                    calendarId=settings.google_calendar_id,
                    eventId=event_id,
                ).execute()
                # Event exists, update it
                logger.info(f"Event {event_id} already exists, updating instead of creating")
                event = service.events().update(
                    calendarId=settings.google_calendar_id,
                    eventId=event_id,
                    body=event_body,
                ).execute()
                return {"action": "updated", "event": event}
            except HttpError as get_exc:
                if get_exc.resp.status == 404:
                    # Event doesn't exist, proceed with insert
                    pass
                else:
                    raise

        try:
            event = service.events().insert(
                calendarId=settings.google_calendar_id,
                body=event_body,
            ).execute()
            logger.info(f"Created new event: {event.get('id')} - {summary}")
            return {"action": "created", "event": event}
        except HttpError as exc:
            if exc.resp.status == 409 and event_id:
                logger.warning(f"Event {event_id} conflict on insert, updating instead")
                event = service.events().update(
                    calendarId=settings.google_calendar_id,
                    eventId=event_id,
                    body=event_body,
                ).execute()
                return {"action": "updated", "event": event}
            raise

    async def get_event(self, settings: Settings, event_id: str) -> dict:
        """Fetch a single event by ID."""
        service = self._get_calendar_service(settings)
        return service.events().get(
            calendarId=settings.google_calendar_id,
            eventId=event_id,
        ).execute()

    async def delete_event(self, settings: Settings, event_id: str) -> dict:
        """Delete an event from Google Calendar."""
        service = self._get_calendar_service(settings)

        try:
            service.events().delete(
                calendarId=settings.google_calendar_id,
                eventId=event_id
            ).execute()
            logger.info(f"Deleted event: {event_id}")
            return {"action": "deleted", "event_id": event_id}
        except HttpError as exc:
            if exc.resp.status == 404:
                logger.warning(f"Event {event_id} not found, may already be deleted")
                return {"action": "not_found", "event_id": event_id}
            raise
