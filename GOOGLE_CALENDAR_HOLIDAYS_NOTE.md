# Google Calendar Holidays

## Issue
Holidays from Google Calendar may not appear in the Smart Calendar interface.

## Why This Happens

Google Calendar has **multiple calendars**:
1. **Primary Calendar** - Your personal calendar (default)
2. **Holidays Calendar** - "Holidays in [Country]" (separate calendar)
3. **Other subscribed calendars** - Sports, work calendars, etc.

The Smart Calendar currently only syncs from your **primary calendar** by default.

## Solution Options

### Option 1: Move Holidays to Primary Calendar (Quick Fix)
In Google Calendar web interface:
1. Go to Settings → Holidays calendar
2. Copy/import holidays to your primary calendar
3. Then they will sync to Smart Calendar

### Option 2: Configure Multiple Calendar IDs (Advanced)
To fetch from multiple Google Calendars including holidays:

1. Find your holiday calendar ID:
   - Go to Google Calendar settings
   - Click on "Holidays in [Country]" calendar
   - Scroll down to "Integrate calendar"
   - Copy the Calendar ID (looks like `en.usa#holiday@group.v.calendar.google.com`)

2. **Option A**: Add to `.env` file:
   ```bash
   GOOGLE_CALENDAR_ID=primary,en.usa#holiday@group.v.calendar.google.com
   ```

3. **Option B**: Keep only primary and holidays will show as they're typically shared to primary

### Option 3: Code Enhancement (Future)
Modify `services/google_calendar.py` to fetch from multiple calendars and merge results.

## Current Behavior

The app fetches events from the calendar specified in:
- `.env` file: `GOOGLE_CALENDAR_ID` (defaults to "primary")
- Only events in that specific calendar will appear

## Verification Steps

1. **Check what's syncing:**
   - Open browser console (F12)
   - Click "Sync All Sources" or "Google Calendar" button
   - Look for: `Loaded X events: Y timed, Z all-day`
   - Then: `Sample all-day events: [list of titles]`

2. **If holidays are missing:**
   - Check if they're in your primary Google Calendar
   - Or if they're in a separate "Holidays" calendar
   - They need to be in whichever calendar ID is configured

## Technical Details

### Current Code Location
- `services/google_calendar.py` line 102:
  ```python
  calendarId=settings.google_calendar_id
  ```

### Event Detection
- All-day events are properly detected via:
  ```python
  'allDay': 'date' in event['start']
  ```
- This works for holidays if they're in the synced calendar

### Debug Output
When events load, check browser console for:
```
Loaded 25 events: 20 timed, 5 all-day
Sample all-day events: ["Holiday Name", "Other Event", ...]
```

If holidays aren't in this list, they're not being fetched from the configured calendar.

