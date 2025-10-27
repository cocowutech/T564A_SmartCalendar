"""
Script to delete all synced events from Google Calendar.
This will delete events with these prefixes in the title:
- [Canvas]
- [Harvard Canvas]
- [MIT Canvas]
- [Outlook]
- Any other ICS source events
"""
import pickle
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from datetime import datetime, timedelta

# Load credentials
token_file = Path('/Users/cocowu/.credentials/smart-calendar-agent/token.pickle')

if not token_file.exists():
    print("❌ No Google Calendar credentials found.")
    exit(1)

print("🔑 Loading Google Calendar credentials...")
with open(token_file, 'rb') as token:
    creds = pickle.load(token)

if not creds.valid:
    if creds.expired and creds.refresh_token:
        print("🔄 Refreshing expired credentials...")
        creds.refresh(Request())

service = build('calendar', 'v3', credentials=creds)

# Get all events from the past year
now = datetime.utcnow()
time_min = (now - timedelta(days=365)).isoformat() + 'Z'
time_max = (now + timedelta(days=365)).isoformat() + 'Z'

print("🔍 Fetching events from Google Calendar...")
events_result = service.events().list(
    calendarId='primary',
    timeMin=time_min,
    timeMax=time_max,
    maxResults=2500,
    singleEvents=True,
    orderBy='startTime'
).execute()

events = events_result.get('items', [])
print(f"📊 Found {len(events)} total events in your Google Calendar")

# Find synced events (those with source prefixes)
synced_prefixes = ['[Canvas]', '[Harvard Canvas]', '[MIT Canvas]', '[Outlook]', '[Canvas-Canvas Main]']
synced_events = []

for event in events:
    title = event.get('summary', '')
    if any(title.startswith(prefix) for prefix in synced_prefixes):
        synced_events.append(event)

print(f"🎯 Found {len(synced_events)} synced events to delete")

if len(synced_events) == 0:
    print("✅ No synced events found. Your Google Calendar is already clean!")
    exit(0)

# Show breakdown
print("\n📋 Events to be deleted:")
for prefix in synced_prefixes:
    count = sum(1 for e in synced_events if e.get('summary', '').startswith(prefix))
    if count > 0:
        print(f"  • {count} events starting with '{prefix}'")

print(f"\n⚠️  WARNING: This will permanently delete {len(synced_events)} events from your Google Calendar!")
print("These events will still show in the Smart Calendar UI (fetched directly from Canvas/Outlook)")
response = input("\n❓ Type 'yes' to proceed with deletion: ")

if response.lower() != 'yes':
    print("❌ Cancelled. No events were deleted.")
    exit(0)

# Delete events
deleted_count = 0
failed_count = 0

print(f"\n🗑️  Deleting {len(synced_events)} events...")
for i, event in enumerate(synced_events, 1):
    try:
        service.events().delete(
            calendarId='primary',
            eventId=event['id']
        ).execute()
        deleted_count += 1
        if i % 20 == 0:
            print(f"  Progress: {i}/{len(synced_events)} events processed...")
    except Exception as e:
        failed_count += 1

print(f"\n✅ Cleanup complete!")
print(f"  ✓ Successfully deleted: {deleted_count} events")
if failed_count > 0:
    print(f"  ⚠️  Failed to delete: {failed_count} events")

print("\n💡 Your Google Calendar is now clean!")
print("   Canvas and Outlook events will only show in Smart Calendar UI")
