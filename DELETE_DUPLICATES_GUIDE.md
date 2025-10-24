# Duplicate Event Deletion Guide

## Overview

The `delete_duplicates.py` script helps you find and remove duplicate events from your Google Calendar. Duplicates are identified by having identical:
- Event title (summary)
- Start time
- End time

## What Was Done

### Issue Fixed
- **Problem**: Events were being synced twice, creating duplicates in Google Calendar
- **Root Cause**: Event creation logic didn't check if event already existed before inserting
- **Solution**: Updated `services/google_calendar.py` to check for existing events before creating new ones

### Cleanup Completed
✅ Successfully deleted **2 duplicate events**:
1. "Beyond the Pitch 1#: Marketing 101 for Startups - by 8200EISP & Fusion"
2. "The Future of Sales in the age of AI"

Your calendar now has **89 events** (down from 91), all unique!

## How to Use the Script

### 1. Dry Run (Preview Only)
First, see what duplicates exist WITHOUT deleting them:

```bash
source .venv/bin/activate
python delete_duplicates.py
```

This will show you:
- How many duplicate sets were found
- Details of each duplicate (title, time, event IDs)
- Which events will be kept vs. deleted
- Total count of events to delete

### 2. Confirm Deletion
After reviewing the dry run output, delete the duplicates:

```bash
python delete_duplicates.py --confirm
```

This will:
- Find all duplicates
- Keep the **first** occurrence (earliest created)
- Delete all subsequent duplicates
- Show success/failure for each deletion

### 3. Verify Cleanup
Run the dry run again to confirm no duplicates remain:

```bash
python delete_duplicates.py
```

You should see: `✓ No duplicates found! Your calendar is clean.`

## How the Script Works

1. **Fetches Events**: Retrieves all events from 6 months in the past to 6 months in the future
2. **Groups by Key**: Groups events by (summary, start_time, end_time)
3. **Identifies Duplicates**: Any group with 2+ events is considered duplicates
4. **Keeps Oldest**: The event with the earliest creation timestamp is kept
5. **Deletes Rest**: All other events in the duplicate group are deleted

## Prevention

The duplicate issue has been **permanently fixed** in the codebase:

### What Changed in `services/google_calendar.py`:
```python
# Before inserting a new event, check if it already exists
if event_id:
    try:
        existing = service.events().get(eventId=event_id).execute()
        # Event exists, update instead of creating duplicate
        return update_event()
    except HttpError as get_exc:
        if get_exc.resp.status == 404:
            # Event doesn't exist, proceed with insert
            pass
```

### Result:
- ✅ Syncing the same source multiple times won't create duplicates
- ✅ Existing events will be updated instead of duplicated
- ✅ Event IDs are deterministic (same source event = same ID)
- ✅ Detailed logging to track create vs. update operations

## Safety Features

The script includes several safety measures:

1. **Dry Run by Default**: Never deletes without `--confirm` flag
2. **Detailed Preview**: Shows exactly what will be deleted before you confirm
3. **Keeps First Created**: Uses creation timestamp to determine which to keep
4. **Error Handling**: Continues even if some deletions fail
5. **Summary Report**: Shows success/failure counts at the end

## Example Output

```
Found 2 sets of duplicate events:
================================================================================

📅 'Event Name'
   Start: 2025-05-21T02:00:00-04:00
   End: 2025-05-21T05:30:00-04:00
   Found 2 copies:
      ✓ KEEP - ID: abc123 (created: 2025-04-25T18:58:43.000Z)
      ✗ DELETE - ID: xyz789 (created: 2025-04-25T18:59:16.000Z)

Summary:
  Total duplicate sets: 2
  Total events to delete: 2
```

## Future Use

You can run this script anytime to clean up duplicates:

```bash
# Check for duplicates (safe, read-only)
python delete_duplicates.py

# Delete duplicates (requires confirmation)
python delete_duplicates.py --confirm
```

The script is now part of your project and can be used whenever needed!
