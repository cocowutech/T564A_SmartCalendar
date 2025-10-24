#!/usr/bin/env python3
"""
Cleanup script to remove duplicate Canvas events from Google Calendar.

This script identifies and removes duplicate Canvas events that were created
due to the event ID generation issue. It keeps the most recent version of
each event based on the Canvas UID.

Usage:
    python cleanup_duplicates.py [--dry-run]

Options:
    --dry-run: Show what would be deleted without actually deleting
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent))

from core.config import Settings
from services.google_calendar import GoogleCalendarService


async def find_duplicate_canvas_events(calendar_service, settings):
    """
    Find duplicate Canvas events in Google Calendar.

    Returns:
        dict: Mapping of Canvas UID to list of event dictionaries
    """
    # Get all events from the past 6 months and next year
    now = datetime.utcnow()
    time_min = now - timedelta(days=180)
    time_max = now + timedelta(days=365)

    print(f"Fetching events from {time_min.date()} to {time_max.date()}...")
    events = await calendar_service.list_events(
        settings=settings,
        time_min=time_min,
        time_max=time_max,
        max_results=2500
    )

    print(f"Found {len(events)} total events")

    # Filter Canvas events and group by title
    canvas_events = {}
    for event in events:
        title = event.get('title', '')

        # Check if this is a Canvas event
        if not any(prefix in title for prefix in ['[Harvard Canvas]', '[MIT Canvas]', '[Canvas]']):
            continue

        # Use title as the key (Canvas events with same content should have same title)
        if title not in canvas_events:
            canvas_events[title] = []

        canvas_events[title].append(event)

    # Find duplicates (titles that appear more than once with same start time)
    duplicates = {}
    for title, event_list in canvas_events.items():
        # Group by start time
        by_start = {}
        for event in event_list:
            start = event.get('start', '')
            if start not in by_start:
                by_start[start] = []
            by_start[start].append(event)

        # If any start time has multiple events, we have duplicates
        for start, events_at_time in by_start.items():
            if len(events_at_time) > 1:
                if title not in duplicates:
                    duplicates[title] = []
                duplicates[title].extend(events_at_time)

    return duplicates


async def cleanup_duplicates(dry_run=False):
    """
    Remove duplicate Canvas events from Google Calendar.

    Args:
        dry_run: If True, only show what would be deleted
    """
    settings = Settings()
    calendar_service = GoogleCalendarService()

    print("=" * 70)
    print("Canvas Event Duplicate Cleanup")
    print("=" * 70)

    duplicates = await find_duplicate_canvas_events(calendar_service, settings)

    if not duplicates:
        print("\n✓ No duplicates found! Your calendar is clean.")
        return

    print(f"\nFound duplicates for {len(duplicates)} event(s):")
    print()

    total_to_delete = 0
    for title, events in duplicates.items():
        print(f"📅 {title}")
        print(f"   Found {len(events)} copies")

        # Sort by event ID to keep the first one (most stable)
        events.sort(key=lambda e: e.get('id', ''))

        # Keep the first, delete the rest
        to_keep = events[0]
        to_delete = events[1:]

        print(f"   ✓ Keep: {to_keep.get('id')} (start: {to_keep.get('start')})")
        for event in to_delete:
            print(f"   ✗ Delete: {event.get('id')} (start: {event.get('start')})")
            total_to_delete += 1

        print()

    print("=" * 70)
    print(f"Total events to delete: {total_to_delete}")
    print("=" * 70)

    if dry_run:
        print("\n[DRY RUN] No events were deleted.")
        print("Run without --dry-run to actually delete duplicates.")
        return

    # Ask for confirmation
    response = input("\nProceed with deletion? (yes/no): ").lower().strip()
    if response != 'yes':
        print("Cancelled. No events were deleted.")
        return

    # Delete duplicates
    deleted_count = 0
    failed_count = 0

    for title, events in duplicates.items():
        events.sort(key=lambda e: e.get('id', ''))
        to_delete = events[1:]

        for event in to_delete:
            event_id = event.get('id')
            try:
                result = await calendar_service.delete_event(settings, event_id)
                if result.get('action') == 'deleted':
                    deleted_count += 1
                    print(f"✓ Deleted: {event_id}")
                else:
                    print(f"⚠ Skipped: {event_id} (not found)")
            except Exception as e:
                failed_count += 1
                print(f"✗ Failed to delete {event_id}: {e}")

    print()
    print("=" * 70)
    print(f"Cleanup complete!")
    print(f"  Deleted: {deleted_count}")
    print(f"  Failed: {failed_count}")
    print("=" * 70)


if __name__ == "__main__":
    import asyncio

    dry_run = '--dry-run' in sys.argv

    asyncio.run(cleanup_duplicates(dry_run))
