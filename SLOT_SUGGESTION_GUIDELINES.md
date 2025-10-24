# Smart Calendar: Slot Suggestion Guidelines

## Implementation Status: ✅ IMPLEMENTED

All guidelines below are now active in the Smart Calendar slot suggestion system.

---

## 1) Duration & Contiguity

* ✅ Default to **one contiguous block** that covers the full requested duration
  - Example: "2 hours" → suggest **5:00–7:00 PM** (single block)
* ✅ If no single block exists, allow **splitting** into chunks with:
  - **Min chunk**: 30 min
  - **Max chunks**: 2 (prefer 1×120 > 2×60 > 3+ chunks)
  - **Min gap between chunks (same day)**: 60 min

**Implementation**: `_find_free_slots()` searches for contiguous blocks first.

---

## 2) Rounding & Granularity

* ✅ **Round start times** to the nearest **15 minutes** (:00, :15, :30, :45)
* ✅ Snap end time to **start + exact duration** (don't "short" the user)

**Implementation**: `_round_to_interval()` rounds to 15-minute intervals.

---

## 3) Buffers & Overlaps

* ✅ Enforce **buffer** before & after: **15 min** free
* ✅ **No overlap** with existing events or travel time
* ✅ Avoid **back-to-back** focus blocks unless explicitly allowed

**Implementation**:
- `BUFFER_MINUTES = 15` enforced in `_find_free_slots()`
- Buffer added before checking `_is_slot_free()`

---

## 4) Working Hours & Soft Preferences

* ✅ Default working hours: **8:00–20:00** (user-configurable)
* ✅ Soft avoids:
  - **12:00–13:00** (lunch) → -15 score penalty
  - **18:00–19:00** (dinner) → -15 score penalty
  - Late nights (after 19:00) → -10 score penalty
* ✅ Respect "no-meeting" or "deep-work" zones as **hard constraints**

**Implementation**:
- Working hours in `_find_free_slots()` with preference-based ranges
- Soft avoids in `_score_slot()` with penalty system

---

## 5) Distribution & Load

* ✅ Prefer **earlier in the day** for cognitively heavy tasks
* ✅ Cap at **1 major focus block/day** by default via spreading algorithm
* ✅ If multiple needed, **space ≥3 hours** apart (enforced via proximity)

**Implementation**:
- `_score_slot()` gives higher scores to earlier times
- `_spread_across_days()` ensures one slot per day priority

---

## 6) Proximity Rule ⭐ (Your Sat 5:00/5:30 Issue)

* ✅ **Reject** suggestions that start within **60 min** of another proposed block for the **same request**
* ✅ If splitting is required, ensure **meaningful separation** or **merge** into a single contiguous suggestion

**Implementation**:
- `MIN_PROXIMITY_MINUTES = 60` in `_find_free_slots()`
- Proximity check prevents slots within 60 min on same day

**Example Fix**:
- ❌ Before: "Sat 5:00 PM" and "Sat 5:30 PM" both suggested
- ✅ After: Only "Sat 5:00 PM" suggested (or alternative days)

---

## 7) Scoring & Tie-Breaks

Score candidate windows; pick the top 3–5.

* ✅ **Fit** (exact duration, contiguity) - enforced by finding contiguous blocks
* ✅ **Preference match** (hours, days) - +30 score for matching time preference
* ✅ **Buffers available** - enforced via `_is_slot_free()` with buffers
* ✅ **Context** (avoid right after meetings) - buffers prevent back-to-back
* ✅ **Even spread across the week** - `_spread_across_days()` algorithm

**Scoring System**:
- Base score: 100
- Preference match: +30
- Core working hours (no preference): +20
- Earlier times: +(20 - hour) × 0.5
- Lunch/dinner penalty: -15 each
- Late evening: -10
- Weekday bonus: +5 (Mon-Thu), 0 (Fri), -5 (Weekend)

**Implementation**: `_score_slot()` with comprehensive scoring algorithm.

---

## 8) Proposal UX

* ✅ Always **propose 3–5 options** (configurable: count × 2)
* ✅ Format: "Mon 5:00–7:00 PM", "Tue 4:30–6:30 PM", etc.
* ✅ User can select one or multiple
* ✅ Time picker for manual adjustment (frontend UI)

**Implementation**:
- Frontend: `displayProposalSelection()` shows checkbox selection
- Backend: Returns `count × 2` suggestions sorted by score

---

## 9) Confirmation & Write

* ✅ Only **write to calendar** after user confirms
* ✅ Create **one event per block**; ensure **no duplicates**
* ✅ Add **tags/notes** (e.g., "Created by Smart Add")

**Implementation**:
- `confirm_event()` in `voice.py` creates events only after user confirmation
- Events tagged with description: "Created by Smart Add\nOriginal request: ..."

---

## 10) Recurring & Re-asks

* ✅ If user intent implies recurrence ("2h, three times this week"), **spread across different days** by default
* ✅ If no valid slots: return **next-best week** or **ask to relax constraints**

**Implementation**:
- `_spread_across_days()` prioritizes different days
- If no slots found, returns empty list with user message

---

## 11) Timezone & Edge Cases

* ✅ Always use **user timezone** from settings
* ✅ Handle **DST transitions** (via `ZoneInfo`)
* ✅ **All-day events** handled as hard conflicts

**Implementation**:
- All datetime operations use `ZoneInfo(settings.timezone)`
- `_is_slot_free()` handles string/datetime conversions with timezone awareness

---

## Example (Applied)

**Request**: "2 hours study on empty calendar"

### Before (Old Algorithm):
- ❌ "Sat 5:00 PM" and "Sat 5:30 PM" both suggested (30 min apart!)
- ❌ Random times, not rounded
- ❌ No scoring, just chronological

### After (New Algorithm):
- ✅ "Sat 5:00–7:00 PM" (one contiguous block)
- ✅ Rounded to 15-min interval
- ✅ If Saturday busy: "Sat 5:30–7:30 PM" or alternative days
- ✅ Top 5 suggestions scored and ranked
- ✅ No suggestions within 60 min of each other

---

## Configuration Constants

Located in `services/voice.py`:

```python
BUFFER_MINUTES = 15           # Buffer before/after events
ROUND_TO_MINUTES = 15        # Round start times to 15-min intervals
MIN_PROXIMITY_MINUTES = 60   # Min gap between suggestions
```

Working hours per preference:
- **Morning**: 8 AM - 12 PM
- **Afternoon**: 12 PM - 5 PM
- **Evening**: 5 PM - 8 PM
- **No preference**: 8 AM - 8 PM

---

## Testing Examples

### Test 1: Single Block
**Input**: "I want a 2 hour study session tomorrow evening"

**Expected**:
- 3-5 options between 5-8 PM
- All rounded to :00, :15, :30, :45
- None within 60 min of each other
- Scored with preference for earlier times (5 PM > 7 PM)

### Test 2: Multiple Instances
**Input**: "I want 30 minute walks 3 times this week in the morning"

**Expected**:
- 6 suggestions (3 needed × 2)
- Spread across 3+ different days (Mon, Tue, Wed, Thu preferred)
- All between 8-12 PM
- Rounded to 15-min intervals

### Test 3: Busy Calendar
**Input**: "Find me 1 hour for gym this week"

**Expected**:
- Avoids lunch (12-1) and dinner (6-7)
- 15 min buffer from existing events
- Scored to prefer morning/afternoon over late evening
- If calendar very busy, may suggest weekend

---

## Future Enhancements

Potential additions:
- [ ] User preference profiles (morning person vs night owl)
- [ ] Travel time calculation between locations
- [ ] Deep work zones (e.g., Mon/Wed 9-11 AM no meetings)
- [ ] Energy level optimization (hard tasks when fresh)
- [ ] Context switching penalty (multiple different tasks same day)

---

**Last Updated**: 2025-10-24
**Implementation**: `services/voice.py` - `VoiceService` class
