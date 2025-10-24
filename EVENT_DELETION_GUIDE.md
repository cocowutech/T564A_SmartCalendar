# Event Deletion Feature - User Guide

## Overview
You can now delete events directly from the Smart Calendar interface. Deletions sync with Google Calendar, but Canvas events are protected from deletion.

## How It Works

### 1. Delete Button
- **Hover over any event** in the calendar to reveal a delete button
- **Google Calendar events**: Show an "×" (delete icon)
- **Canvas events**: Show a "🔒" (lock icon) - these cannot be deleted

### 2. Deletion Process

#### For Google Calendar Events:
1. Hover over the event card
2. Click the "×" button in the top-right corner
3. Confirm the deletion in the dialog
4. Event is **permanently deleted** from Google Calendar
5. Calendar refreshes automatically to show the change

#### For Canvas Events:
1. Hover over the event card
2. See the "🔒" lock icon (grayed out)
3. Tooltip shows: "Canvas events cannot be deleted here"
4. Clicking the lock shows a message: "Canvas events cannot be deleted from this interface. Please delete from Canvas directly."

## Protected Sources

The following event sources are **protected** from deletion:
- ✅ Canvas
- ✅ Harvard Canvas
- ✅ MIT Canvas

**Why?** Canvas events are synced from your course management system. Deleting them here wouldn't remove them from Canvas, and they would just re-sync next time. To remove Canvas events, delete them in Canvas directly.

## Event Source Identification

Events are color-coded by source:
- **Harvard Canvas**: Crimson Red (rgba(165, 28, 48, 0.9))
- **MIT Canvas**: MIT Red (rgba(163, 31, 52, 0.9))
- **Google Calendar**: Google Blue (rgba(66, 133, 244, 0.9))
- **Gmail**: Gmail Red (rgba(234, 67, 53, 0.9))
- **ICS Feeds**: Teal (rgba(16, 185, 129, 0.9))

## Technical Implementation

### Frontend (`app.js`)

**Delete Button Rendering:**
```javascript
// Determine if event is from Canvas (protected from deletion)
const isCanvasEvent = event.source.includes('Canvas');

card.innerHTML = `
    <button class="event-delete-btn ${isCanvasEvent ? 'protected' : ''}"
            onclick="deleteEvent('${event.id}', '${escapeHtml(event.title)}', '${event.source}', event)"
            title="${isCanvasEvent ? 'Canvas events cannot be deleted here' : 'Delete event'}">
        ${isCanvasEvent ? '🔒' : '×'}
    </button>
    ...
`;
```

**Delete Function:**
```javascript
async function deleteEvent(eventId, eventTitle, eventSource, clickEvent) {
    clickEvent.stopPropagation(); // Prevent card click event

    // Check if event is from Canvas (protected)
    if (eventSource.includes('Canvas')) {
        showToast('ingestResult', 'Canvas events cannot be deleted...', true);
        return;
    }

    // Confirmation dialog
    if (!confirm(`Delete "${eventTitle}"?...`)) {
        return;
    }

    // Call API
    const result = await apiCall('/events/delete', {
        event_id: eventId,
        title: eventTitle,
        source: eventSource
    });

    // Refresh calendar
    await loadRealEvents();
}
```

### Backend (`app/api/handlers.py`)

**API Endpoint:**
```python
@router.post("/events/delete")
async def delete_event(payload: dict, ...) -> dict:
    """
    Delete an event from Google Calendar.

    Prevents deletion of Canvas-sourced events.
    """
    event_id = payload.get('event_id')
    event_source = payload.get('source', '')

    # Prevent deletion of Canvas events
    if event_source in ['Canvas', 'Harvard Canvas', 'MIT Canvas']:
        return {
            "status": "error",
            "error": "Cannot delete Canvas events...",
            "protected": True
        }

    # Delete from Google Calendar
    result = await calendar_service.delete_event(settings, event_id)
    return {"status": "ok", "result": result}
```

### Google Calendar Service (`services/google_calendar.py`)

**Delete Method:**
```python
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
            return {"action": "not_found", "event_id": event_id}
        raise
```

## UI/UX Features

### Visual Feedback
- **Hover state**: Delete button appears on hover
- **Protected state**: Lock icon for Canvas events (grayed out)
- **Hover effect**: Delete button changes to red on hover (deletable events)
- **No hover effect**: Lock button stays gray (protected events)

### CSS Styling
```css
.event-delete-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.3);
    display: none; /* Hidden by default */
}

.event-card:hover .event-delete-btn {
    display: flex; /* Show on hover */
}

.event-delete-btn:hover {
    background: rgba(239, 68, 68, 0.9); /* Red on hover */
    transform: scale(1.1);
}

.event-delete-btn.protected {
    cursor: not-allowed;
    background: rgba(100, 100, 100, 0.5); /* Gray for protected */
}
```

## User Confirmation

Before deletion, users see a confirmation dialog:

```
Delete "Event Title"?

This will permanently remove the event from your Google Calendar.

[Cancel] [OK]
```

## Error Handling

### Protected Event Attempt
**Message:** "Canvas events cannot be deleted from this interface. Please delete from Canvas directly."

### API Error
**Message:** "Failed to delete: [error details]"

### Network Error
**Message:** "Failed to delete event: [error message]"

## Testing Checklist

- [ ] Hover over Google Calendar event → Delete button (×) appears
- [ ] Click delete button → Confirmation dialog appears
- [ ] Confirm deletion → Event deleted from Google Calendar
- [ ] Calendar refreshes automatically after deletion
- [ ] Hover over Canvas event → Lock icon (🔒) appears
- [ ] Click lock icon → Error message about Canvas protection
- [ ] Try to delete Harvard Canvas event → Blocked
- [ ] Try to delete MIT Canvas event → Blocked
- [ ] Delete button doesn't interfere with event click (selecting day)

## API Endpoints

### Delete Event
**Endpoint:** `POST /api/events/delete`

**Request:**
```json
{
  "event_id": "abc123xyz",
  "title": "Meeting with Team",
  "source": "Google"
}
```

**Success Response:**
```json
{
  "status": "ok",
  "result": {
    "action": "deleted",
    "event_id": "abc123xyz"
  }
}
```

**Protected Event Response:**
```json
{
  "status": "error",
  "error": "Cannot delete Canvas events from this interface...",
  "protected": true
}
```

## Future Enhancements

Potential additions:
- [ ] Undo deletion (restore within X minutes)
- [ ] Batch delete (select multiple events)
- [ ] Archive instead of delete
- [ ] Delete confirmation with event details preview
- [ ] Keyboard shortcut (e.g., Delete key when event selected)

---

**Last Updated**: 2025-10-24
**Version**: 1.0
