#!/usr/bin/env python3
"""
Script to find and delete duplicate events in Google Calendar.

Duplicates are identified by having the same summary, start time, and end time.
This script will keep the first occurrence and delete subsequent duplicates.
"""

import sys
from collections import defaultdict
from datetime import datetime, timedelta

from core.config import get_settings
from services.google_calendar import GoogleCalendarService


def find_duplicates():
    """Find duplicate events in Google Calendar."""
    settings = get_settings()
    service = GoogleCalendarService()
    gcal_service = service._get_calendar_service(settings)

    # Fetch events from the past 6 months to future 6 months
    from datetime import timezone
    now = datetime.now(timezone.utc)
    time_min = (now - timedelta(days=180)).isoformat().replace('+00:00', 'Z')
    time_max = (now + timedelta(days=180)).isoformat().replace('+00:00', 'Z')

    print(f"Fetching events from Google Calendar...")
    print(f"Time range: {time_min} to {time_max}")

    events_result = gcal_service.events().list(
        calendarId=settings.google_calendar_id,
        timeMin=time_min,
        timeMax=time_max,
        maxResults=2500,
        singleEvents=True,
        orderBy='startTime'
    ).execute()

    events = events_result.get('items', [])
    print(f"Found {len(events)} total events")

    # Group events by (summary, start, end)
    event_groups = defaultdict(list)

    for event in events:
        summary = event.get('summary', 'No Title')
        start = event.get('start', {}).get('dateTime') or event.get('start', {}).get('date')
        end = event.get('end', {}).get('dateTime') or event.get('end', {}).get('date')

        if start and end:
            key = (summary, start, end)
            event_groups[key].append(event)

    # Find duplicates
    duplicates = {}
    for key, group in event_groups.items():
        if len(group) > 1:
            duplicates[key] = group

    print(f"\nFound {len(duplicates)} sets of duplicate events:")
    print("=" * 80)

    total_to_delete = 0
    for (summary, start, end), group in duplicates.items():
        print(f"\n📅 '{summary}'")
        print(f"   Start: {start}")
        print(f"   End: {end}")
        print(f"   Found {len(group)} copies:")

        for i, event in enumerate(group):
            event_id = event.get('id')
            created = event.get('created', 'Unknown')
            marker = "✓ KEEP" if i == 0 else "✗ DELETE"
            print(f"      {marker} - ID: {event_id} (created: {created})")

        total_to_delete += len(group) - 1

    print("\n" + "=" * 80)
    print(f"\nSummary:")
    print(f"  Total duplicate sets: {len(duplicates)}")
    print(f"  Total events to delete: {total_to_delete}")

    return duplicates, gcal_service, settings


def delete_duplicates(duplicates, gcal_service, settings, dry_run=True):
    """Delete duplicate events (keeping the first one in each group)."""

    if dry_run:
        print("\n" + "=" * 80)
        print("DRY RUN MODE - No events will be deleted")
        print("Run with --confirm to actually delete duplicates")
        print("=" * 80)
        return

    print("\n" + "=" * 80)
    print("DELETING DUPLICATE EVENTS...")
    print("=" * 80)

    deleted_count = 0
    failed_count = 0

    for (summary, start, end), group in duplicates.items():
        # Keep the first event, delete the rest
        to_delete = group[1:]

        print(f"\n📅 Processing: '{summary}'")

        for event in to_delete:
            event_id = event.get('id')
            try:
                gcal_service.events().delete(
                    calendarId=settings.google_calendar_id,
                    eventId=event_id
                ).execute()
                print(f"   ✓ Deleted: {event_id}")
                deleted_count += 1
            except Exception as e:
                print(f"   ✗ Failed to delete {event_id}: {e}")
                failed_count += 1

    print("\n" + "=" * 80)
    print(f"Deletion complete!")
    print(f"  Successfully deleted: {deleted_count}")
    print(f"  Failed: {failed_count}")
    print("=" * 80)


def main():
    """Main function."""
    print("=" * 80)
    print("Google Calendar Duplicate Event Finder & Remover")
    print("=" * 80)

    duplicates, gcal_service, settings = find_duplicates()

    if not duplicates:
        print("\n✓ No duplicates found! Your calendar is clean.")
        return

    # Check if user wants to delete
    dry_run = '--confirm' not in sys.argv

    delete_duplicates(duplicates, gcal_service, settings, dry_run=dry_run)

    if dry_run:
        print("\nTo delete these duplicates, run:")
        print("  python delete_duplicates.py --confirm")


if __name__ == '__main__':
    main()
