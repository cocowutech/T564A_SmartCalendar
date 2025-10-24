# Apple Calendar (iCal) Integration Guide

## Where to Add Apple Calendar API

Apple Calendar doesn't have a traditional API like Google Calendar. Instead, you can integrate it using:

### Option 1: CalDAV Protocol (Recommended)

Apple Calendar supports the CalDAV protocol, which allows two-way sync with calendar applications.

**Add the integration in**: `services/ingestion.py`

**Steps**:

1. Install CalDAV library:
```bash
pip install caldav
```

2. Create a new class in `services/ingestion.py`:

```python
import caldav

class AppleCalendarService:
    """Service for syncing with Apple Calendar via CalDAV."""

    def __init__(self):
        self.calendar_service = GoogleCalendarService()

    async def ingest_apple_calendar(self, payload: dict, *, settings: Settings) -> dict:
        """
        Fetch events from Apple Calendar via CalDAV.

        CalDAV URL for iCloud: https://caldav.icloud.com/
        """
        # Get credentials from settings
        apple_username = settings.apple_calendar_username  # iCloud email
        apple_password = settings.apple_calendar_app_password  # App-specific password

        if not apple_username or not apple_password:
            return {
                "handled": False,
                "reason": "Apple Calendar credentials not configured"
            }

        try:
            # Connect to CalDAV server
            client = caldav.DAVClient(
                url="https://caldav.icloud.com/",
                username=apple_username,
                password=apple_password
            )

            principal = client.principal()
            calendars = principal.calendars()

            created = 0
            updated = 0

            for calendar in calendars:
                # Get events from the last 30 days and next 365 days
                events = calendar.events()

                for event in events:
                    # Parse iCal event and sync to Google Calendar
                    # (Implementation similar to ICS ingestion)
                    pass

            return {
                "handled": True,
                "events_created": created,
                "events_updated": updated
            }

        except Exception as e:
            logger.error(f"Apple Calendar sync failed: {e}")
            return {"handled": False, "error": str(e)}
```

3. Add credentials to `.env`:
```env
APPLE_CALENDAR_USERNAME=your-icloud-email@icloud.com
APPLE_CALENDAR_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

4. Update `core/config.py` to add these settings:
```python
class Settings(BaseSettings):
    # ... existing settings ...

    apple_calendar_username: str | None = None
    apple_calendar_app_password: str | None = None
```

5. Add API endpoint in `app/api/handlers.py`:
```python
@router.post("/ingest/apple")
async def ingest_apple_calendar(
    payload: dict,
    settings: Settings = Depends(get_settings),
    service: AppleCalendarService = Depends(AppleCalendarService),
) -> dict:
    """Ingest Apple Calendar events via CalDAV."""
    result = await service.ingest_apple_calendar(payload, settings=settings)
    return {"status": "ok", "summary": result}
```

6. Add button in `app/static/index.html`:
```html
<button class="btn btn-light" onclick="ingestAppleCalendar(event)">Apple Calendar</button>
```

7. Add JavaScript function in `app/static/app.js`:
```javascript
async function ingestAppleCalendar(evt) {
    const btn = evt?.target;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await apiCall('/ingest/apple', {});
        summarizeSyncResult('Apple Calendar', result);
        updateLastSync();
        await loadRealEvents();
    } catch (error) {
        showToast('ingestResult', `Apple Calendar sync failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}
```

### Option 2: ICS Export (Simpler, Read-Only)

If you just want to read events from Apple Calendar without two-way sync:

1. Export your Apple Calendar as an ICS file
2. Host it on iCloud or another server
3. Use the existing `IcsIngestionService` in `services/ingestion.py`
4. Add the ICS URL to your config

**Example in `app_config.yaml`**:
```yaml
ics_sources:
  - name: "Apple Calendar"
    url: "https://your-ics-url.ics"
```

This will use the existing ICS ingestion flow at `services/ingestion.py:180-276`.

## Getting Apple Calendar App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com/)
2. Sign in with your Apple ID
3. Navigate to "Security" section
4. Click "Generate Password" under "App-Specific Passwords"
5. Name it "Smart Calendar" and copy the generated password
6. Use this password (not your regular Apple ID password) in the `.env` file

## Summary

- **For two-way sync**: Use CalDAV (Option 1) - Add code to `services/ingestion.py`
- **For read-only access**: Use ICS export (Option 2) - Already implemented, just add URL to config
- **Configuration**: Add credentials to `.env` and `core/config.py`
- **UI**: Add sync button to `app/static/index.html` (line 83-86)
- **Backend**: Add endpoint to `app/api/handlers.py` (after line 84)
