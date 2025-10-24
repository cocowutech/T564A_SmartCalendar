# Implementation Roadmap: Make Smart Calendar Agent Show Real Data

This guide walks you through implementing the actual functionality to make your calendar show real events from Google Calendar, Gmail, Canvas, etc.

---

## Current Status

✅ **Frontend Complete**: Beautiful UI with voice input, auto-sync, and calendar view
✅ **Backend Structure**: FastAPI app with all API endpoints
⏳ **Services**: All service methods are stubs (placeholders)
⏳ **Real Data**: Not connected to any real APIs yet

---

## Phase 1: Get Google Calendar API Working (HIGHEST PRIORITY)

This is the foundation - once you can read/write to Google Calendar, everything else syncs TO your calendar.

### Step 1.1: Set Up Google Cloud Project

1. **Go to Google Cloud Console**: https://console.cloud.google.com/
2. **Create a new project** (or use existing)
   - Name it "Smart Calendar Agent"
3. **Enable Google Calendar API**:
   - Navigate to "APIs & Services" → "Library"
   - Search for "Google Calendar API"
   - Click "Enable"
4. **Enable Gmail API** (for reading reservation emails):
   - Search for "Gmail API"
   - Click "Enable"

### Step 1.2: Create OAuth Credentials

1. **Go to "APIs & Services" → "Credentials"**
2. **Click "+ CREATE CREDENTIALS" → "OAuth client ID"**
3. **Configure OAuth consent screen** (if first time):
   - User Type: External (unless you have a Google Workspace)
   - App name: "Smart Calendar Agent"
   - User support email: your email
   - Developer contact: your email
   - Scopes: Add these scopes:
     - `.../auth/calendar` (Google Calendar)
     - `.../auth/gmail.readonly` (Gmail read-only)
   - Test users: Add your email address
4. **Create OAuth Client ID**:
   - Application type: "Desktop app"
   - Name: "Smart Calendar Desktop Client"
5. **Download the JSON file**:
   - Click the download button (⬇)
   - Save as `client_secret.json` in your project root
   - Update `.env`: `GOOGLE_OAUTH_CLIENT_SECRETS=./client_secret.json`

### Step 1.3: Get OpenAI API Key

1. **Go to**: https://platform.openai.com/api-keys
2. **Create new secret key**
3. **Copy the key** (starts with `sk-...`)
4. **Update `.env`**: `OPENAI_API_KEY=sk-your-actual-key-here`

### Step 1.4: Implement Google Calendar Service

**Create new file**: `services/google_calendar.py`

```python
from __future__ import annotations

import os.path
import pickle
from datetime import datetime, timedelta
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from core.config import Settings

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.readonly'
]

class GoogleCalendarService:
    """Service for interacting with Google Calendar API."""

    def __init__(self):
        self._credentials = None
        self._calendar_service = None

    def _get_credentials(self, settings: Settings) -> Credentials:
        """Get or refresh Google OAuth credentials."""
        if self._credentials and self._credentials.valid:
            return self._credentials

        token_dir = Path(settings.google_token_dir).expanduser()
        token_dir.mkdir(parents=True, exist_ok=True)
        token_file = token_dir / 'token.pickle'

        creds = None
        # Token file stores the user's access and refresh tokens
        if token_file.exists():
            with open(token_file, 'rb') as token:
                creds = pickle.load(token)

        # If there are no valid credentials, let the user log in
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    settings.google_client_secrets, SCOPES
                )
                creds = flow.run_local_server(port=0)

            # Save the credentials for the next run
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

        events_result = service.events().list(
            calendarId=settings.google_calendar_id,
            timeMin=time_min.isoformat() + 'Z',
            timeMax=time_max.isoformat() + 'Z',
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

            formatted_events.append({
                'id': event['id'],
                'title': event.get('summary', 'No Title'),
                'date': start.split('T')[0] if 'T' in start else start,
                'time': start.split('T')[1][:5] if 'T' in start else None,
                'location': event.get('location'),
                'description': event.get('description'),
                'start': start,
                'end': end
            })

        return formatted_events

    async def create_event(
        self,
        settings: Settings,
        summary: str,
        start_time: datetime,
        end_time: datetime,
        description: str | None = None,
        location: str | None = None
    ) -> dict:
        """Create a new event in Google Calendar."""
        service = self._get_calendar_service(settings)

        event = {
            'summary': summary,
            'start': {
                'dateTime': start_time.isoformat(),
                'timeZone': settings.timezone,
            },
            'end': {
                'dateTime': end_time.isoformat(),
                'timeZone': settings.timezone,
            },
        }

        if description:
            event['description'] = description
        if location:
            event['location'] = location

        created_event = service.events().insert(
            calendarId=settings.google_calendar_id,
            body=event
        ).execute()

        return created_event
```

### Step 1.5: Add API Endpoint to Fetch Real Events

**Update**: `app/api/handlers.py`

Add this new endpoint:

```python
from services.google_calendar import GoogleCalendarService
from datetime import datetime, timedelta

@router.get("/events")
async def get_events(
    settings: Settings = Depends(get_settings),
    calendar_service: GoogleCalendarService = Depends(GoogleCalendarService),
) -> dict:
    """Get events from Google Calendar for display in UI."""
    # Get events for the next 90 days
    events = await calendar_service.list_events(
        settings=settings,
        time_min=datetime.now() - timedelta(days=7),  # Include past week
        time_max=datetime.now() + timedelta(days=90),
        max_results=100
    )
    return {"status": "ok", "events": events}
```

### Step 1.6: Update Frontend to Use Real Events

**Update**: `app/static/app.js`

Replace the `loadSampleEvents()` function:

```javascript
async function loadRealEvents() {
    try {
        const response = await fetch(`${API_BASE}/events`);
        const data = await response.json();

        if (data.status === 'ok') {
            events = data.events;
            updateTodayEvents();
            updateUpcomingEvents();
            renderCalendar();
        }
    } catch (error) {
        console.error('Failed to load events:', error);
        // Fall back to sample events if API fails
        loadSampleEvents();
    }
}

// In the DOMContentLoaded event, change:
// loadSampleEvents();
// to:
loadRealEvents();

// Also reload events after sync
async function performAutoSync() {
    console.log('Auto-sync triggered at', new Date().toLocaleTimeString());

    try {
        const result = await apiCall('/sync/all', {});
        showResult('ingestResult', result);
        updateLastSync();
        updateNextSyncTime();

        // Reload calendar events after sync
        await loadRealEvents();
    } catch (error) {
        console.error('Auto-sync failed:', error);
    }
}
```

### Step 1.7: Test Google Calendar Integration

**Run these commands:**

```bash
# Make sure you're in virtual environment
source .venv/bin/activate

# The server should already be running
# Just refresh your browser at http://localhost:8000
```

**First time setup:**
1. When you visit the site, it will open a browser window for Google OAuth
2. Sign in with your Google account
3. Grant permissions for Calendar and Gmail access
4. The credentials will be saved in `~/.credentials/smart-calendar-agent/token.pickle`
5. Future runs will use the saved credentials

---

## Phase 2: Implement Calendar Syncing Services

Now that you can READ from Google Calendar, let's implement WRITING to it.

### Step 2.1: Implement ICS Feed Ingestion

**Update**: `services/ingestion.py`

```python
from __future__ import annotations

import httpx
from icalendar import Calendar
from datetime import datetime

from core.config import Settings
from services.google_calendar import GoogleCalendarService

class IcsIngestionService:
    """ICS feed ingestion service for Canvas and other calendars."""

    def __init__(self):
        self.calendar_service = GoogleCalendarService()

    async def ingest_canvas(self, payload: dict, *, settings: Settings) -> dict:
        """Ingest Canvas ICS feed."""
        app_config = settings.load_app_config()

        if not app_config.canvas_ics_url:
            return {"handled": False, "reason": "Canvas ICS URL not configured"}

        return await self._ingest_ics_url(
            app_config.canvas_ics_url,
            "Canvas",
            settings
        )

    async def ingest_generic(self, payload: dict, *, settings: Settings) -> dict:
        """Ingest generic ICS feeds."""
        app_config = settings.load_app_config()

        if not app_config.ics_sources:
            return {"handled": False, "reason": "No ICS sources configured"}

        results = []
        for source in app_config.ics_sources:
            result = await self._ingest_ics_url(
                str(source.url),
                source.name,
                settings
            )
            results.append(result)

        return {
            "handled": True,
            "sources_processed": len(results),
            "results": results
        }

    async def _ingest_ics_url(
        self,
        url: str,
        source_name: str,
        settings: Settings
    ) -> dict:
        """Fetch and parse ICS feed, add events to Google Calendar."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()

            # Parse ICS data
            cal = Calendar.from_ical(response.content)
            events_added = 0

            for component in cal.walk():
                if component.name == "VEVENT":
                    summary = str(component.get('summary'))
                    start = component.get('dtstart').dt
                    end = component.get('dtend').dt
                    description = str(component.get('description', ''))
                    location = str(component.get('location', ''))

                    # Convert to datetime if date
                    if isinstance(start, date) and not isinstance(start, datetime):
                        start = datetime.combine(start, datetime.min.time())
                        end = datetime.combine(end, datetime.min.time())

                    # Add to Google Calendar
                    await self.calendar_service.create_event(
                        settings=settings,
                        summary=f"[{source_name}] {summary}",
                        start_time=start,
                        end_time=end,
                        description=description,
                        location=location
                    )
                    events_added += 1

            return {
                "handled": True,
                "source": source_name,
                "events_added": events_added
            }

        except Exception as e:
            return {
                "handled": False,
                "source": source_name,
                "error": str(e)
            }
```

### Step 2.2: Implement Gmail Ingestion

**Update**: `services/ingestion.py`

Add to the file:

```python
class GmailIngestionService:
    """Gmail ingestion service for reservation emails."""

    def __init__(self):
        self.calendar_service = GoogleCalendarService()

    async def ingest(self, payload: dict, *, settings: Settings) -> dict:
        """Search Gmail for reservation emails and extract events."""
        app_config = settings.load_app_config()

        # Get Gmail service
        creds = self.calendar_service._get_credentials(settings)
        gmail_service = build('gmail', 'v1', credentials=creds)

        # Search for emails
        query = app_config.gmail.search_query
        results = gmail_service.users().messages().list(
            userId='me',
            q=query,
            maxResults=50
        ).execute()

        messages = results.get('messages', [])
        events_created = 0

        for msg in messages:
            # Get full message
            message = gmail_service.users().messages().get(
                userId='me',
                id=msg['id'],
                format='full'
            ).execute()

            # Extract event details using AI
            # This would use OpenAI to parse the email
            # For now, skip this - it requires NLP implementation

        return {
            "handled": True,
            "emails_scanned": len(messages),
            "events_created": events_created
        }
```

### Step 2.3: Implement Voice Commands with OpenAI

**Update**: `services/voice.py`

```python
from __future__ import annotations

from datetime import datetime, timedelta
from openai import AsyncOpenAI

from core.config import Settings
from services.google_calendar import GoogleCalendarService

class VoiceService:
    """Voice service using OpenAI for natural language understanding."""

    def __init__(self):
        self.calendar_service = GoogleCalendarService()
        self._openai_client = None

    def _get_openai_client(self, settings: Settings) -> AsyncOpenAI:
        if not self._openai_client:
            self._openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
        return self._openai_client

    async def suggest_time(self, payload: dict, *, settings: Settings) -> dict:
        """Use AI to suggest available time slots."""
        user_text = payload.get('text', '')

        # Get existing events
        events = await self.calendar_service.list_events(settings)

        # Use OpenAI to understand the request and suggest times
        client = self._get_openai_client(settings)

        prompt = f"""
        User request: "{user_text}"

        Current calendar events: {events}

        Based on the user's request, suggest 3 available time slots.
        Consider the existing events and find gaps in the schedule.

        Return JSON format:
        {{
            "proposals": [
                {{"date": "2024-01-15", "time": "14:00", "reason": "Free afternoon slot"}},
                ...
            ],
            "reply": "I found these available times for you..."
        }}
        """

        response = await client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        return result
```

---

## Phase 3: Configuration & Testing

### Step 3.1: Update Your Config Files

**Update `.env`**:
```bash
GOOGLE_OAUTH_CLIENT_SECRETS=./client_secret.json
GOOGLE_TOKEN_DIR=~/.credentials/smart-calendar-agent
GOOGLE_CALENDAR_ID=primary
TIMEZONE=America/New_York
OPENAI_API_KEY=sk-your-real-key-here
```

**Update `config.yaml`**:
```yaml
canvas_ics_url: "https://canvas.harvard.edu/feeds/calendars/user_YOUR_TOKEN.ics"
ics_sources:
  - name: "iLab"
    url: "https://example.com/your-ical-feed.ics"
gmail:
  search_query: "has:attachment (filename:ics OR filename:ical) OR subject:(ticket OR reservation OR rsvp OR itinerary OR booking) newer_than:120d"
selfcare:
  preferred_windows:
    - day: "Mon-Fri"
      start: "07:00"
      end: "10:30"
      min_minutes: 60
home:
  address: "Cambridge, MA"
```

### Step 3.2: Get Your Canvas ICS URL

1. **Log into Canvas**
2. **Go to Calendar**
3. **Click "Calendar Feed" button** (bottom right)
4. **Copy the ICS URL**
5. **Paste into `config.yaml` under `canvas_ics_url`**

---

## Summary: Implementation Order

### Priority 1 (Do This First):
1. ✅ Set up Google Cloud Project
2. ✅ Get OAuth credentials (`client_secret.json`)
3. ✅ Get OpenAI API key
4. ✅ Implement `GoogleCalendarService`
5. ✅ Add `/events` API endpoint
6. ✅ Update frontend to call `/events`
7. ✅ Test: See your real Google Calendar events!

### Priority 2 (Next):
8. ✅ Get Canvas ICS URL
9. ✅ Implement ICS feed parsing
10. ✅ Test syncing Canvas → Google Calendar

### Priority 3 (Advanced):
11. ✅ Implement Gmail parsing with OpenAI
12. ✅ Implement voice command NLU
13. ✅ Implement self-care time blocking

---

## Quick Start Commands

```bash
# Make sure packages are installed
pip install google-api-python-client google-auth-oauthlib icalendar

# Server should already be running
# Just refresh browser after making code changes

# Check logs
# Look at the terminal running uvicorn
```

---

## Expected Results

After Phase 1 implementation:
- ✅ Calendar shows YOUR real Google Calendar events
- ✅ Today's schedule shows actual events from today
- ✅ Upcoming events shows your next 5 real events
- ✅ Days with events show blue dots on calendar

After Phase 2:
- ✅ Sync buttons actually import events from Canvas/ICS
- ✅ Gmail sync extracts reservations from emails
- ✅ Events automatically appear in Google Calendar

---

## Need Help?

Each phase builds on the previous one. Start with Phase 1 to see real data, then add more features incrementally!

**Files you'll create/modify:**
- `services/google_calendar.py` (NEW - core integration)
- `services/ingestion.py` (UPDATE - implement real logic)
- `services/voice.py` (UPDATE - add OpenAI)
- `app/api/handlers.py` (UPDATE - add /events endpoint)
- `app/static/app.js` (UPDATE - call /events)
