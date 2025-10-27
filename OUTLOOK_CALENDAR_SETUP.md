# Outlook Calendar Integration Guide

There are **two ways** to integrate Outlook Calendar with your Smart Calendar app:

1. **ICS URL Export** (Simple, Read-Only) - Recommended to start
2. **Microsoft Graph API** (Advanced, Two-Way Sync)

---

## Method 1: ICS URL Export (Simple - Recommended)

This is the easiest way to get your Outlook calendar events into the Smart Calendar. It's read-only, meaning you can view Outlook events but can't edit them from the Smart Calendar.

### Step-by-Step Instructions:

#### 1. Get Your Outlook Calendar ICS URL

**For Outlook.com / Hotmail:**

1. Go to [outlook.live.com/calendar](https://outlook.live.com/calendar)
2. Sign in with your Microsoft account
3. Click the **Settings** gear icon (top right)
4. Click **View all Outlook settings**
5. Go to **Calendar** > **Shared calendars**
6. Under "Publish a calendar", select the calendar you want to share
7. Click **Publish**
8. Choose permissions: **Can view all details** (recommended) or **Can view when I'm busy**
9. Copy the **ICS link** (should look like: `https://outlook.live.com/owa/calendar/...`)

**For Work/School Outlook (Microsoft 365):**

1. Go to [outlook.office.com/calendar](https://outlook.office.com/calendar)
2. Right-click on the calendar you want to sync
3. Click **Sharing and permissions**
4. Under "Publish this calendar", click **Publish**
5. Copy the **ICS link**

#### 2. Add ICS URL to Your Smart Calendar Config

Edit your `app_config.yaml` file:

```yaml
ics_sources:
  - name: "Outlook"
    url: "https://outlook.live.com/owa/calendar/YOUR_UNIQUE_URL_HERE.ics"
```

If you already have other ICS sources (like other calendars), just add the Outlook one to the list:

```yaml
ics_sources:
  - name: "Outlook"
    url: "https://outlook.live.com/owa/calendar/YOUR_UNIQUE_URL_HERE.ics"
  - name: "Another Calendar"
    url: "https://example.com/other-calendar.ics"
```

#### 3. Sync Your Calendar

1. Start your Smart Calendar app:
   ```bash
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. Open http://localhost:8000 in your browser

3. Click the **"Outlook Calendar"** button in the Sync Sources panel

4. Your Outlook events will now appear in your Smart Calendar! 🎉

---

## Method 2: Microsoft Graph API (Advanced - Two-Way Sync)

This method allows **full two-way sync**: you can create, edit, and delete Outlook events directly from the Smart Calendar. It requires more setup but provides complete integration.

### Prerequisites:

- A Microsoft account (personal, work, or school)
- Access to Azure Portal (free)

### Step-by-Step Instructions:

#### 1. Create an Azure App Registration

1. Go to [Azure Portal](https://portal.azure.com/)
2. Sign in with your Microsoft account
3. Search for **"Azure Active Directory"** or **"Microsoft Entra ID"**
4. Click **App registrations** in the left menu
5. Click **+ New registration**
6. Fill in the details:
   - **Name**: `Smart Calendar App`
   - **Supported account types**: Choose one:
     - **Personal Microsoft accounts only** (for Outlook.com/Hotmail)
     - **Accounts in this organizational directory only** (for work/school)
     - **Accounts in any organizational directory and personal Microsoft accounts** (both)
   - **Redirect URI**: Select `Web` and enter: `http://localhost:8000/auth/callback`
7. Click **Register**

#### 2. Get Your Application Credentials

After registration, you'll see the app overview page:

1. **Copy the Application (client) ID** - You'll need this
2. **Copy the Directory (tenant) ID** - You'll need this too

Now create a client secret:

1. Click **Certificates & secrets** in the left menu
2. Click **+ New client secret**
3. Add a description: `Smart Calendar Secret`
4. Choose expiration: **24 months** (or as needed)
5. Click **Add**
6. **Copy the Secret Value immediately** - It won't be shown again!

#### 3. Configure API Permissions

1. Click **API permissions** in the left menu
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Add these permissions:
   - `Calendars.ReadWrite` - Read and write calendars
   - `User.Read` - Sign in and read user profile
6. Click **Add permissions**
7. Click **Grant admin consent** (if you're an admin) or ask your admin to approve

#### 4. Add Credentials to Your `.env` File

Edit or create `.env` in your project root:

```env
# Existing Google Calendar settings...
GOOGLE_CLIENT_SECRETS=path/to/client_secret.json
GOOGLE_TOKEN_DIR=~/.calendar/google
GOOGLE_CALENDAR_ID=primary

# Add Outlook/Microsoft Graph settings
OUTLOOK_CLIENT_ID=your-application-client-id-here
OUTLOOK_CLIENT_SECRET=your-client-secret-value-here
OUTLOOK_TENANT_ID=your-tenant-id-here
OUTLOOK_REDIRECT_URI=http://localhost:8000/auth/callback
```

#### 5. Update `core/config.py`

Add Outlook settings to your Settings class:

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Outlook Calendar (Microsoft Graph API)
    outlook_client_id: str | None = None
    outlook_client_secret: str | None = None
    outlook_tenant_id: str | None = None
    outlook_redirect_uri: str = "http://localhost:8000/auth/callback"
```

#### 6. Install Microsoft Graph Library

```bash
pip install msgraph-sdk msal
```

#### 7. Implement Microsoft Graph Integration

Create a new file `services/outlook_calendar.py`:

```python
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from msal import ConfidentialClientApplication
from msgraph import GraphServiceClient
from msgraph.generated.users.item.calendar.events.events_request_builder import EventsRequestBuilder
from azure.identity import ClientSecretCredential

from core.config import Settings
from services.google_calendar import GoogleCalendarService

logger = logging.getLogger(__name__)


class OutlookCalendarService:
    """Service for syncing with Outlook Calendar via Microsoft Graph API."""

    def __init__(self):
        self.calendar_service = GoogleCalendarService()
        self._access_token = None

    def _get_graph_client(self, settings: Settings) -> GraphServiceClient:
        """Create authenticated Microsoft Graph client."""
        credential = ClientSecretCredential(
            tenant_id=settings.outlook_tenant_id,
            client_id=settings.outlook_client_id,
            client_secret=settings.outlook_client_secret,
        )

        scopes = ['https://graph.microsoft.com/.default']
        client = GraphServiceClient(credentials=credential, scopes=scopes)
        return client

    async def sync_outlook_to_google(self, settings: Settings) -> dict:
        """Fetch Outlook events and sync them to Google Calendar."""
        try:
            graph_client = self._get_graph_client(settings)

            # Get events from the last 30 days and next 365 days
            start_date = datetime.utcnow() - timedelta(days=30)
            end_date = datetime.utcnow() + timedelta(days=365)

            # Query Outlook events
            query_params = EventsRequestBuilder.EventsRequestBuilderGetQueryParameters(
                select=['subject', 'start', 'end', 'location', 'body'],
                top=100,
            )

            events = await graph_client.me.calendar.events.get(query_parameters=query_params)

            created = 0
            updated = 0

            for event in events.value:
                # Sync to Google Calendar
                event_id = self._generate_event_id(event.id)

                start_dt = datetime.fromisoformat(event.start.date_time)
                end_dt = datetime.fromisoformat(event.end.date_time)

                result = await self.calendar_service.create_or_update_event(
                    settings=settings,
                    summary=f"[Outlook] {event.subject}",
                    start_time=start_dt,
                    end_time=end_dt,
                    description=event.body.content if event.body else None,
                    location=event.location.display_name if event.location else None,
                    event_id=event_id,
                )

                if result.get('action') == 'created':
                    created += 1
                elif result.get('action') == 'updated':
                    updated += 1

            return {
                "handled": True,
                "events_created": created,
                "events_updated": updated,
                "total_processed": created + updated,
            }

        except Exception as e:
            logger.error(f"Outlook sync failed: {e}")
            return {"handled": False, "error": str(e)}

    @staticmethod
    def _generate_event_id(outlook_id: str) -> str:
        """Generate a stable Google Calendar event ID from Outlook event ID."""
        import hashlib
        # Google Calendar event IDs must be 5-1024 characters, lowercase alphanumeric
        hash_digest = hashlib.sha256(outlook_id.encode()).hexdigest()[:32]
        return f"outlook{hash_digest}"
```

#### 8. Update the API Handler

Edit `app/api/handlers.py`:

```python
from services.outlook_calendar import OutlookCalendarService

@router.post("/ingest/outlook")
async def ingest_outlook(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: OutlookCalendarService = Depends(OutlookCalendarService),
) -> dict:
    """Sync Outlook Calendar via Microsoft Graph API."""
    result = await service.sync_outlook_to_google(settings)
    return {"status": "ok", "summary": result}
```

#### 9. Test the Integration

1. Restart your Smart Calendar app
2. Click the **"Outlook Calendar"** button
3. Your Outlook events should sync to Google Calendar and appear in the Smart Calendar!

---

## Which Method Should You Use?

| Feature | ICS URL (Method 1) | Graph API (Method 2) |
|---------|-------------------|---------------------|
| **Setup Difficulty** | ⭐ Easy (5 minutes) | ⭐⭐⭐ Advanced (30 minutes) |
| **Read Outlook Events** | ✅ Yes | ✅ Yes |
| **Create/Edit Events** | ❌ No | ✅ Yes |
| **Real-time Sync** | ❌ Polling only | ✅ Better |
| **Requires Azure** | ❌ No | ✅ Yes |
| **Best For** | Quick setup, read-only | Full integration |

**Recommendation**: Start with **Method 1 (ICS URL)** to get up and running quickly. Upgrade to **Method 2 (Graph API)** later if you need two-way sync.

---

## Troubleshooting

### ICS URL Method:

**Problem**: Events not showing up
- Solution: Make sure you published the calendar with "Can view all details" permission
- Check that the ICS URL is correct in `app_config.yaml`
- Try opening the ICS URL in a browser - you should see calendar data

**Problem**: Events are outdated
- Solution: Outlook ICS feeds update every few hours. Click "Sync All Sources" to manually refresh

### Graph API Method:

**Problem**: Authentication error
- Solution: Verify your Client ID, Client Secret, and Tenant ID are correct in `.env`
- Make sure API permissions are granted (including admin consent if required)

**Problem**: Permission error
- Solution: Ensure you added `Calendars.ReadWrite` and `User.Read` permissions in Azure
- Click "Grant admin consent" in the API permissions page

---

## Summary

You've now integrated Outlook Calendar with your Smart Calendar! 🎉

**Quick Reference**:
- ICS URL goes in: `app_config.yaml` under `ics_sources`
- Graph API credentials go in: `.env` file
- Sync button: Click "Outlook Calendar" in the UI

For more help, check the [Microsoft Graph Calendar API documentation](https://learn.microsoft.com/en-us/graph/api/resources/calendar).
