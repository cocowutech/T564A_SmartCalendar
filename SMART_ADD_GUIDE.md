# Smart Add & Bug Fixes - Complete Guide

## Summary of All Fixes

### ✅ 1. Canvas Sync Idempotency - FIXED

**Problem**: Clicking "Sync Canvas" multiple times created duplicate events because each sync generated different event IDs.

**Root Cause**: Source name was changing (`Canvas-Canvas Main`, `Canvas-MIT Canvas`), causing different event IDs for the same event.

**Solution**:
```python
# services/ingestion.py - Line 91
source_name="Canvas"  # Fixed: always "Canvas" for consistent event IDs
```

**How It Works Now**:
1. Event ID is deterministically generated from: `source_name + event_uid`
2. Same Canvas event always produces same ID: `canvasevent123abc`
3. `create_or_update_event` checks if event exists before inserting
4. If exists → UPDATE, if not → CREATE
5. Result: **Idempotent sync - no duplicates ever**

**Test It**:
```bash
# Click "Sync Canvas" multiple times
# Each sync will update existing events, not create duplicates
```

---

### ✅ 2. MIT Canvas Configuration - ADDED

**File to Edit**: `config.yaml`

**Current Configuration**:
```yaml
canvas_sources:
  - name: "Harvard Canvas"
    url: "https://canvas.harvard.edu/feeds/calendars/user_OtFYRvlM3UBCrdIXqkntOJerw5Jibi5UZ5IGhyYV.ics"
  - name: "MIT Canvas"
    url: "REPLACE_WITH_YOUR_MIT_CANVAS_ICS_URL"
```

**To Add Your MIT Canvas**:

1. Go to MIT Canvas → Calendar
2. Click "Calendar Feed" button
3. Copy the ICS URL (looks like: `https://canvas.mit.edu/feeds/calendars/user_XXXX.ics`)
4. Replace `REPLACE_WITH_YOUR_MIT_CANVAS_ICS_URL` in `config.yaml`
5. Restart server and click "Sync Canvas"

**Both calendars will sync together** with no duplicates!

---

### ✅ 3. Smart Add Natural Language Agent - IMPLEMENTED

**Feature**: Natural language event creation with AI-powered time finding.

**Example Usage**:
```
User: "I want to go for a walk for half an hour 3 times this week"

Agent:
1. Parses request with OpenAI GPT-4
2. Finds 6 free 30-minute slots this week
3. Shows interactive selection UI
4. User selects 3 preferred times
5. Creates events (no duplicates!)
```

**How It Works**:

#### Step 1: Natural Language Parsing
```javascript
// User types in the "Add Smart Activity" box
"Schedule 2 study sessions of 2 hours each in the mornings this week"
```

```python
# Backend uses OpenAI to parse into structured data
{
  "title": "Study session",
  "duration_minutes": 120,
  "count": 2,
  "time_range": "this_week",
  "preferred_time": "morning"
}
```

#### Step 2: Smart Time Finding
```python
# services/voice.py - _find_free_slots()
# Searches calendar for free time slots:
# - Checks existing events for conflicts
# - Respects preferred time (morning/afternoon/evening)
# - Finds 2x requested slots for options
# - Returns proposals sorted by time
```

#### Step 3: Interactive Selection
```html
<!-- User sees checkbox list -->
☐ Monday, October 28 at 09:00 AM
☐ Monday, October 28 at 09:30 AM
☐ Tuesday, October 29 at 08:00 AM
☐ Wednesday, October 30 at 09:00 AM

[Confirm Selection] [Cancel]
```

#### Step 4: Event Creation
```python
# After user confirms, creates events with:
# - Unique event IDs (no duplicates)
# - Smart description with original request
# - Proper timezone handling
# - Auto-refresh calendar
```

**Configuration Required**:

Add to `.env`:
```bash
OPENAI_API_KEY=your_openai_api_key_here
```

**Supported Patterns**:

| User Says | Agent Understands |
|-----------|-------------------|
| "Walk for 30 minutes 3 times this week" | 30-min × 3, this week, any time |
| "2 study sessions of 2 hours in the mornings" | 120-min × 2, this week, morning |
| "Exercise 1 hour tomorrow afternoon" | 60-min × 1, tomorrow, afternoon |
| "Meeting prep next 3 days evening" | duration extracted, 3 days, evening |

**Time Preferences**:
- `morning`: 6 AM - 12 PM
- `afternoon`: 12 PM - 5 PM
- `evening`: 5 PM - 10 PM
- `none`: 6 AM - 10 PM (all day)

---

## Technical Implementation Details

### Event ID Generation (Idempotency)

```python
# services/ingestion.py - _generate_event_id()
def _generate_event_id(source_name: str, uid: str) -> str:
    # Combine source + UID, remove all non-alphanumeric
    base = f"{source_name}{uid}".lower()
    base = re.sub(r'[^a-z0-9]', '', base)

    # Google Calendar requires alphanumeric IDs
    # Same source event always produces same ID
    return base[:1024]  # Max length
```

**Example**:
```python
source_name = "Canvas"
uid = "assignment-992478"
event_id = "canvasassignment992478"  # Always the same!
```

### Smart Add Architecture

```
┌─────────────────┐
│  User Input     │
│  (Natural Lang) │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  OpenAI GPT-4   │
│  Parse Request  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Find Free      │
│  Slots in Cal   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Show Proposals │
│  (Frontend UI)  │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  User Confirms  │
│  Selection      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Create Events  │
│  (Idempotent)   │
└─────────────────┘
```

### Conflict Detection

```python
def _is_slot_free(start, end, existing_events):
    for event in existing_events:
        # Check for overlap
        if start < event.end and end > event.start:
            return False  # Conflict found!
    return True  # Free slot
```

---

## API Endpoints

### POST /api/voice/add
**Request**:
```json
{
  "text": "I want to go for a walk for 30 minutes 3 times this week"
}
```

**Response (Requires Confirmation)**:
```json
{
  "handled": true,
  "requires_confirmation": true,
  "session_id": "session_1729123456.789",
  "proposals": [
    {
      "start": "2025-10-28T09:00:00-04:00",
      "end": "2025-10-28T09:30:00-04:00",
      "day": "Monday, October 28",
      "time": "09:00 AM"
    },
    // ... more proposals
  ],
  "reply": "I found free time for 'Walk' (30 min, 3x needed):\n\n1. Monday, October 28 at 09:00 AM\n..."
}
```

### POST /api/confirm
**Request**:
```json
{
  "session_id": "session_1729123456.789",
  "selected_indices": [0, 2, 4]
}
```

**Response**:
```json
{
  "handled": true,
  "created_count": 3,
  "events": [
    {
      "start": "2025-10-28T09:00:00-04:00",
      "end": "2025-10-28T09:30:00-04:00",
      "event_id": "smartadd20251028090000"
    },
    // ... created events
  ],
  "reply": "✓ Created 3 event(s) successfully!"
}
```

---

## Testing Guide

### Test 1: Canvas Sync Idempotency
```bash
# 1. Click "Sync Canvas" - note event count
# 2. Click "Sync Canvas" again
# 3. Event count should stay the same (no duplicates)
# 4. Check logs: should see "Event already exists, updating"
```

### Test 2: Multiple Canvas Sources
```bash
# 1. Add MIT Canvas URL to config.yaml
# 2. Restart server
# 3. Click "Sync Canvas"
# 4. Both Harvard + MIT events appear
# 5. All tagged as "[Canvas]" in calendar
```

### Test 3: Smart Add
```bash
# 1. Ensure OPENAI_API_KEY is in .env
# 2. Type: "I want to study for 2 hours tomorrow morning"
# 3. Click "Create Request"
# 4. See proposals with morning time slots
# 5. Select 1 slot, click "Confirm Selection"
# 6. Event appears in calendar immediately
# 7. Try syncing again - no duplicate created
```

---

## Troubleshooting

### Smart Add Says "OpenAI API key not configured"
**Solution**: Add to `.env`:
```bash
OPENAI_API_KEY=sk-your-key-here
```

### Canvas Events Still Duplicating
**Solution**:
1. Run `python delete_duplicates.py --confirm` to clean up
2. Restart server to load new code
3. Try syncing again

### Smart Add Can't Find Free Time
**Reasons**:
- Calendar very busy in requested time range
- Try different time preference (morning/afternoon/evening)
- Try longer time range ("this week" vs "next 3 days")

### "Invalid session ID" Error
**Reason**: Session expired (automatic after confirmation)
**Solution**: Start a new Smart Add request

---

## Files Modified

1. ✅ `services/ingestion.py` - Fixed source_name for idempotency
2. ✅ `services/voice.py` - Complete Smart Add implementation
3. ✅ `services/google_calendar.py` - Added existence check before insert
4. ✅ `app/static/app.js` - Proposal selection UI
5. ✅ `app/static/styles.css` - Proposal selection styling
6. ✅ `config.yaml` - MIT Canvas configuration template
7. ✅ `core/config.py` - Multiple Canvas sources support

---

## Next Steps

1. **Configure MIT Canvas**:
   - Edit `config.yaml` with your MIT ICS URL
   - Restart server
   - Click "Sync Canvas"

2. **Try Smart Add**:
   - Add OpenAI API key to `.env`
   - Describe event in natural language
   - Select preferred time slots
   - Confirm to create

3. **Verify No Duplicates**:
   - Sync multiple times
   - Use Smart Add multiple times
   - Run `python delete_duplicates.py` to verify 0 duplicates found

Enjoy your smart, duplicate-free calendar! 🎉
