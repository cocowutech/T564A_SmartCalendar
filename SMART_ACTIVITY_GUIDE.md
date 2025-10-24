# Smart Activity Feature - User Guide

## Overview
The Smart Activity feature allows you to add events to your calendar using natural language and AI-powered time suggestions.

## How It Works

### 1. Enter Natural Language Request
In the "Add Smart Activity" section, type or speak your request. Examples:
- "I want to go for a walk for 30 minutes 3 times this week"
- "Schedule 2 study sessions of 2 hours each in the mornings this week"
- "Book gym time for 1 hour on Wednesdays"

### 2. Generate Suggestions
Click the **"Generate Suggestions"** button. The AI will:
- Parse your natural language request
- Extract: activity name, duration, frequency, time preferences
- Find free time slots in your calendar
- Propose multiple options (2x the requested count)

### 3. Review & Select Time Slots
You'll see a list of suggested time slots with:
- **Day and date** (e.g., "Monday, October 23")
- **Suggested time** (e.g., "9:00 AM")
- **Checkbox** to select the slot
- **Time adjustment input** (appears when selected)

### 4. Manually Adjust Times (Optional)
When you select a time slot:
- A time picker appears next to it
- You can adjust the start time manually
- The duration remains the same as your request

### 5. Confirm & Add to Calendar
- Select your preferred time slots (checkboxes)
- Review the count (shows "X selected")
- Click **"Add to Calendar"**
- Events are created in Google Calendar
- Calendar refreshes automatically to show new events

## Color Coding

Events are color-coded by source:
- **Harvard Canvas**: Crimson Red (rgba(165, 28, 48, 0.9))
- **MIT Canvas**: MIT Red (rgba(163, 31, 52, 0.9))
- **Google Calendar**: Google Blue (rgba(66, 133, 244, 0.9))
- **Gmail**: Gmail Red (rgba(234, 67, 53, 0.9))
- **ICS Feeds**: Teal (rgba(16, 185, 129, 0.9))

## Example Workflow

1. **User types**: "I want a 2 hour study session every Wednesday evening"

2. **AI parses**:
   - Title: "Study session"
   - Duration: 120 minutes
   - Count: 1 (per week)
   - Preferred time: evening
   - Time range: this week

3. **AI suggests** (finds 2 options):
   - Wednesday, October 25 at 6:00 PM
   - Wednesday, October 25 at 7:00 PM

4. **User selects** first option and adjusts time to 5:30 PM

5. **User clicks** "Add to Calendar"

6. **Event created**: "Study session" on Wednesday, Oct 25, 5:30 PM - 7:30 PM

7. **Calendar refreshes** showing the new event in blue (Google Calendar)

## Technical Details

### Frontend (`app.js`)
- `addRecurringEvent()`: Sends natural language to backend
- `displayProposalSelection()`: Shows time slot options with manual adjustment
- `toggleProposalSelection()`: Handles checkbox selection
- `confirmProposals()`: Sends confirmed selections with adjusted times

### Backend (`services/voice.py`)
- `add_recurring()`: Parses NL with GPT-4, finds free slots
- `confirm_event()`: Creates events in Google Calendar with adjusted times
- `_find_free_slots()`: Searches for available time slots
- `_is_slot_free()`: Checks for conflicts with existing events

### API Endpoints
- `POST /api/voice/add`: Submit natural language request
- `POST /api/confirm`: Confirm and create selected events

## Requirements

- **OpenAI API Key**: Required for natural language parsing (GPT-4)
- **Google Calendar API**: Required for reading/writing events
- Configure in `.env` file

## Notes

- The system finds 2x the requested count for more options
- Time slots are checked against existing events to avoid conflicts
- Manual adjustments preserve the original duration
- Events are added with description: "Created by Smart Add"
