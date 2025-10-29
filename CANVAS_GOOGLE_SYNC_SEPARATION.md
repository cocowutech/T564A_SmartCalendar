# Canvas and Google Calendar Sync Separation

## Summary of Changes

This document describes the changes made to separate Canvas events from Google Calendar while still displaying them in the UI.

## Problem Statement

Previously, Canvas events were being synced to Google Calendar, which meant:
1. Canvas events cluttered the user's Google Calendar
2. Canvas events could be modified in Google Calendar, causing sync issues
3. Canvas events couldn't be easily distinguished from user-created Google Calendar events
4. MIT Canvas and Harvard Canvas had nearly identical colors (both dark red)

## Solution

### 1. Architecture Change: Canvas Events Separate from Google Calendar

**Backend Changes (`services/ingestion.py`):**
- Modified `ingest_canvas()` to **NOT** sync Canvas events to Google Calendar
- Added new method `fetch_canvas_events_for_display()` that fetches Canvas events directly from ICS feeds
- Added `_fetch_canvas_events()` helper to verify Canvas source accessibility without syncing

**API Changes (`app/api/handlers.py`):**
- Modified `/events` endpoint to fetch both Google Calendar events AND Canvas events
- Canvas events are fetched directly from ICS feeds in real-time
- Events are merged in the response but kept separate (different sources)

**Frontend Changes (`app/static/app.js`):**
- Updated sync result messages to indicate Canvas events are "display only"
- Added special handling for Canvas sync feedback showing event count without "created/updated" language

### 2. Visual Distinction: Different Colors for Canvas Sources

**UI Changes (`app/static/styles.css`):**
- **Harvard Canvas**: Remains crimson red `rgba(165, 28, 48, 0.9)`
- **MIT Canvas**: Changed to purple `rgba(138, 43, 226, 0.9)` - distinctly different from Harvard
- This makes it easy to visually distinguish between the two Canvas sources

## Data Flow

### Before (Canvas events synced to Google Calendar):
```
Canvas ICS → Fetch → Parse → Write to Google Calendar → Fetch from Google Calendar → Display in UI
```

### After (Canvas events separate):
```
Google Calendar → Fetch → Display in UI
              +
Canvas ICS → Fetch → Parse → Display in UI (not written to Google Calendar)
```

## Benefits

1. **Cleaner Google Calendar**: Canvas events don't clutter your Google Calendar
2. **True Read-Only**: Canvas events in the UI are truly read-only (can't be accidentally modified)
3. **Clear Separation**: Users can see Canvas events in the smart calendar UI without them affecting their actual Google Calendar
4. **Visual Distinction**: MIT and Harvard Canvas events are now easily distinguishable by color
5. **Protected Deletion**: Canvas events continue to be protected from deletion in the UI

## Event Protection

Canvas events remain protected from deletion:
- Delete button shows lock icon (🔒) for Canvas events
- Attempts to delete Canvas events show error message
- Backend prevents deletion of Canvas-sourced events

## Testing Recommendations

1. **Canvas Sync**: Click "Sync Canvas" and verify events appear in UI but NOT in Google Calendar
2. **Google Calendar**: Verify Google Calendar events still sync and display correctly
3. **Color Coding**: Verify Harvard Canvas events are red and MIT Canvas events are purple
4. **Event Refresh**: Verify Canvas events update when you refresh/reload
5. **Deletion Protection**: Verify Canvas events cannot be deleted from the UI

## Technical Details

### Canvas Event Format
Canvas events are returned with the following structure:
```json
{
  "id": "canvas-harvard-canvas-{uid}",
  "title": "Course Assignment",
  "source": "Harvard Canvas",
  "description": "...",
  "location": "...",
  "start": "2025-10-24T10:00:00-04:00",
  "end": "2025-10-24T11:00:00-04:00",
  "allDay": false
}
```

Note: Canvas events are NOT prefixed with `[Harvard Canvas]` or `[MIT Canvas]` in the title anymore since they're not stored in Google Calendar. The source field is used for identification.

## Configuration

Canvas sources are configured in `config.yaml`:
```yaml
canvas_sources:
  - name: "Harvard Canvas"
    url: "https://canvas.harvard.edu/feeds/..."
  - name: "MIT Canvas"
    url: "https://canvas.mit.edu/feeds/..."
```

## Migration Notes

If you previously had Canvas events synced to Google Calendar:
1. Those old Canvas events will remain in Google Calendar (they're not automatically deleted)
2. Going forward, new Canvas events will only appear in the smart calendar UI
3. You may want to manually clean up old Canvas events from Google Calendar using the cleanup script

## Files Modified

1. `services/ingestion.py` - Canvas sync logic
2. `app/api/handlers.py` - Events endpoint
3. `app/static/app.js` - Sync feedback messages
4. `app/static/styles.css` - Canvas event colors


