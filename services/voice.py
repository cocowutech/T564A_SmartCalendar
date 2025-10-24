from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from core.config import Settings
from services.google_calendar import GoogleCalendarService

logger = logging.getLogger(__name__)


class VoiceService:
    """Voice service for natural language event creation with smart scheduling."""

    def __init__(self):
        self.calendar_service = GoogleCalendarService()
        self._pending_proposals = {}  # Store proposals for confirmation

    async def add_recurring(self, payload: dict, *, settings: Settings) -> dict:
        """
        Natural language event creation with smart time finding.

        Example: "I want to go for a walk for half an hour 3 times this week"

        Process:
        1. Parse user request with LLM
        2. Find free time slots
        3. Propose options
        4. Wait for user confirmation
        """
        user_input = payload.get('text', '').strip()

        if not user_input:
            return {"handled": False, "reason": "No input provided"}

        # Check if OpenAI is configured
        if not settings.openai_api_key:
            return {
                "handled": False,
                "reason": "OpenAI API key not configured. Please set OPENAI_API_KEY in .env file.",
                "reply": "Smart Add requires OpenAI API. Please configure your API key."
            }

        try:
            # Step 1: Parse the natural language request
            parsed_request = await self._parse_nl_request(user_input, settings)

            if not parsed_request.get('success'):
                return {
                    "handled": False,
                    "reason": parsed_request.get('error', 'Failed to parse request'),
                    "reply": f"I couldn't understand that. {parsed_request.get('error', 'Please try again.')}"
                }

            # Step 2: Find free time slots
            proposals = await self._find_free_slots(parsed_request, settings)

            if not proposals:
                return {
                    "handled": True,
                    "requires_confirmation": False,
                    "reply": f"Sorry, I couldn't find {parsed_request['count']} free {parsed_request['duration_minutes']}-minute slots in the requested time range. Try a different time or duration."
                }

            # Step 3: Store proposals and ask user to select
            session_id = f"session_{datetime.now().timestamp()}"
            self._pending_proposals[session_id] = {
                "parsed_request": parsed_request,
                "proposals": proposals,
                "created_at": datetime.now()
            }

            # Format response
            reply = self._format_proposal_response(parsed_request, proposals, session_id)

            return {
                "handled": True,
                "requires_confirmation": True,
                "session_id": session_id,
                "proposals": proposals,
                "reply": reply
            }

        except Exception as e:
            logger.error(f"Error in add_recurring: {e}", exc_info=True)
            return {
                "handled": False,
                "reason": str(e),
                "reply": f"Sorry, I encountered an error: {str(e)}"
            }

    async def suggest_time(self, payload: dict, *, settings: Settings) -> dict:
        """Legacy endpoint - redirects to add_recurring for consistency."""
        return await self.add_recurring(payload, settings=settings)

    async def confirm_event(self, payload: dict, *, settings: Settings) -> dict:
        """
        Confirm and create events from pending proposals.

        Payload should include:
        - session_id: ID from the proposal
        - selected_indices: list of integers indicating which proposals to create
        - adjusted_times: optional dict mapping index to adjusted time (HH:MM format)
        """
        session_id = payload.get('session_id')
        selected_indices = payload.get('selected_indices', [])
        adjusted_times = payload.get('adjusted_times', {})

        if not session_id or session_id not in self._pending_proposals:
            return {
                "handled": False,
                "reason": "Invalid or expired session ID"
            }

        session_data = self._pending_proposals[session_id]
        parsed_request = session_data['parsed_request']
        proposals = session_data['proposals']
        duration_minutes = parsed_request['duration_minutes']

        # Validate selections
        if not selected_indices or not all(0 <= i < len(proposals) for i in selected_indices):
            return {
                "handled": False,
                "reason": "Invalid selection indices"
            }

        # Create events for selected proposals
        created_events = []
        for idx in selected_indices:
            proposal = proposals[idx]
            start_time = proposal['start']

            # Apply manual time adjustment if provided
            if str(idx) in adjusted_times:
                adjusted_time_str = adjusted_times[str(idx)]  # Format: "HH:MM"
                try:
                    hours, minutes = map(int, adjusted_time_str.split(':'))
                    start_time = start_time.replace(hour=hours, minute=minutes)
                except Exception as e:
                    logger.warning(f"Failed to parse adjusted time {adjusted_time_str}: {e}")

            end_time = start_time + timedelta(minutes=duration_minutes)

            try:
                result = await self.calendar_service.create_or_update_event(
                    settings=settings,
                    summary=parsed_request['title'],
                    start_time=start_time,
                    end_time=end_time,
                    description=f"Created by Smart Add\nOriginal request: {parsed_request.get('original_text', '')}",
                    all_day=False
                )
                created_events.append({
                    "start": start_time.isoformat(),
                    "end": end_time.isoformat(),
                    "event_id": result.get('event', {}).get('id')
                })
            except Exception as e:
                logger.error(f"Failed to create event: {e}")
                return {
                    "handled": False,
                    "reason": f"Failed to create event: {str(e)}"
                }

        # Clean up session
        del self._pending_proposals[session_id]

        return {
            "handled": True,
            "created_count": len(created_events),
            "events": created_events,
            "reply": f"✓ Created {len(created_events)} event(s) successfully!"
        }

    async def daily_selfcare_summary(self, *, settings: Settings) -> dict:
        _ = settings
        return {"handled": False, "reason": "Self-care summary not implemented yet"}

    # Helper methods

    async def _parse_nl_request(self, user_input: str, settings: Settings) -> dict[str, Any]:
        """Use LLM to parse natural language request into structured data."""
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
        except ImportError:
            return {"success": False, "error": "openai package not installed"}

        system_prompt = """You are a calendar assistant. Parse the user's request into structured JSON.

Extract:
- title: what the event is (e.g., "Walk", "Study session")
- duration_minutes: how long (in minutes)
- count: how many times
- time_range: when to schedule (e.g., "this week", "next 3 days", "this afternoon")
- preferred_time: any time preference (e.g., "morning", "evening", "afternoon")

Examples:
"I want to go for a walk for half an hour 3 times this week" →
{
  "title": "Walk",
  "duration_minutes": 30,
  "count": 3,
  "time_range": "this_week",
  "preferred_time": null
}

"Schedule 2 study sessions of 2 hours each in the mornings this week" →
{
  "title": "Study session",
  "duration_minutes": 120,
  "count": 2,
  "time_range": "this_week",
  "preferred_time": "morning"
}

Return ONLY valid JSON, no explanations."""

        try:
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_input}
                ],
                temperature=0.1,
                response_format={"type": "json_object"}
            )

            parsed = json.loads(response.choices[0].message.content)
            parsed['success'] = True
            parsed['original_text'] = user_input

            # Validate required fields
            required = ['title', 'duration_minutes', 'count']
            if not all(k in parsed for k in required):
                return {"success": False, "error": f"Missing required fields: {required}"}

            return parsed

        except Exception as e:
            logger.error(f"LLM parsing failed: {e}")
            return {"success": False, "error": f"Failed to parse request: {str(e)}"}

    async def _find_free_slots(self, parsed_request: dict, settings: Settings) -> list[dict]:
        """
        Find free time slots matching the request with smart suggestion guidelines.

        Rules:
        - Prefer contiguous blocks
        - Round to 15-minute intervals
        - Enforce 10-15 min buffers
        - Respect working hours (8 AM - 8 PM Mon-Fri by default)
        - Score and rank suggestions
        - Apply proximity rule (min 45-60 min between suggestions)
        """
        duration_minutes = parsed_request['duration_minutes']
        count = parsed_request['count']
        time_range = parsed_request.get('time_range', 'this_week')
        preferred_time = parsed_request.get('preferred_time')

        # Constants
        BUFFER_MINUTES = 15  # Buffer before/after events
        ROUND_TO_MINUTES = 15  # Round start times to 15-min intervals
        MIN_PROXIMITY_MINUTES = 60  # Min gap between suggestions for same request

        # Determine search window
        now = datetime.now(ZoneInfo(settings.timezone))
        if time_range == 'this_week':
            end_date = now + timedelta(days=7)
        elif time_range == 'next_3_days':
            end_date = now + timedelta(days=3)
        elif time_range == 'today':
            end_date = now.replace(hour=23, minute=59)
        else:
            end_date = now + timedelta(days=7)

        # Get existing events
        existing_events = await self.calendar_service.list_events(
            settings=settings,
            time_min=now,
            time_max=end_date,
            max_results=500
        )

        # Determine working hours based on preferred time
        if preferred_time == 'morning':
            working_start, working_end = 8, 12
        elif preferred_time == 'afternoon':
            working_start, working_end = 12, 17
        elif preferred_time == 'evening':
            working_start, working_end = 17, 20
        else:
            working_start, working_end = 8, 20  # Default working hours

        # Find candidate slots
        candidates = []
        current = self._round_to_interval(now + timedelta(minutes=30), ROUND_TO_MINUTES)

        while current < end_date:
            # Skip if outside working hours
            if not (working_start <= current.hour < working_end):
                current = self._next_working_start(current, working_start)
                continue

            # Skip weekends for work-related tasks (optional - can be user preference)
            # if current.weekday() >= 5:
            #     current += timedelta(days=1)
            #     continue

            # Check if contiguous block is free (with buffers)
            buffered_start = current - timedelta(minutes=BUFFER_MINUTES)
            slot_end = current + timedelta(minutes=duration_minutes)
            buffered_end = slot_end + timedelta(minutes=BUFFER_MINUTES)

            if self._is_slot_free(buffered_start, buffered_end, existing_events):
                # Score this candidate
                score = self._score_slot(current, slot_end, preferred_time, existing_events)

                candidates.append({
                    "start": current,
                    "end": slot_end,
                    "day": current.strftime("%A, %B %d"),
                    "time": current.strftime("%I:%M %p"),
                    "score": score,
                    "weekday": current.weekday()
                })

            # Advance by 15 minutes for next candidate
            current += timedelta(minutes=ROUND_TO_MINUTES)

        # Sort by score (higher is better)
        candidates.sort(key=lambda x: x['score'], reverse=True)

        # Apply proximity rule: ensure min gap between selected suggestions
        selected = []
        for candidate in candidates:
            if len(selected) >= count * 2:  # Return 2x requested count
                break

            # Check proximity to already selected slots
            too_close = False
            for sel in selected:
                time_diff = abs((candidate['start'] - sel['start']).total_seconds() / 60)
                # Also check different days for spreading
                same_day = candidate['start'].date() == sel['start'].date()

                if same_day and time_diff < MIN_PROXIMITY_MINUTES:
                    too_close = True
                    break

            if not too_close:
                selected.append(candidate)

        # If we need multiple instances (count > 1), spread across different days
        if count > 1:
            selected = self._spread_across_days(selected, count)

        return selected[:count * 2]  # Return up to 2x count for options

    def _round_to_interval(self, dt: datetime, minutes: int) -> datetime:
        """Round datetime to nearest interval (e.g., 15 minutes)."""
        # Round to next interval
        minute = ((dt.minute // minutes) + 1) * minutes
        if minute >= 60:
            dt = dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        else:
            dt = dt.replace(minute=minute, second=0, microsecond=0)
        return dt

    def _next_working_start(self, dt: datetime, start_hour: int) -> datetime:
        """Move to next working day start."""
        next_day = dt.replace(hour=start_hour, minute=0, second=0, microsecond=0)
        if dt.hour >= start_hour:
            next_day += timedelta(days=1)
        return next_day

    def _score_slot(self, start: datetime, end: datetime, preferred_time: str | None, existing_events: list) -> float:
        """
        Score a time slot based on various factors.

        Higher score = better slot

        Factors:
        - Time of day match with preference
        - Earlier in day for focus work
        - Avoid lunch/dinner times
        - Context (distance from other events)
        """
        score = 100.0
        hour = start.hour

        # Preference match (high weight)
        if preferred_time == 'morning' and 8 <= hour < 12:
            score += 30
        elif preferred_time == 'afternoon' and 12 <= hour < 17:
            score += 30
        elif preferred_time == 'evening' and 17 <= hour < 20:
            score += 30
        elif not preferred_time and 9 <= hour < 17:
            score += 20  # Prefer core working hours if no preference

        # Prefer earlier for focus work (slight bias)
        score += (20 - hour) * 0.5  # Earlier = higher score

        # Soft avoids
        if 12 <= hour < 13:  # Lunch
            score -= 15
        if 18 <= hour < 19:  # Dinner
            score -= 15
        if hour >= 19:  # Late evening
            score -= 10

        # Weekday preference (Mon-Thu better than Fri)
        weekday = start.weekday()
        if weekday < 4:  # Mon-Thu
            score += 5
        elif weekday == 4:  # Fri
            score += 0
        else:  # Weekend
            score -= 5

        # Context: prefer slots with good buffer from other events
        # (already enforced in is_slot_free, but can add bonus for extra space)

        return score

    def _spread_across_days(self, slots: list[dict], count: int) -> list[dict]:
        """
        Ensure slots for recurring requests are spread across different days.

        Prioritize one slot per day before suggesting multiple on same day.
        """
        # Group by day
        by_day = {}
        for slot in slots:
            day = slot['start'].date()
            if day not in by_day:
                by_day[day] = []
            by_day[day].append(slot)

        # First pass: take best slot from each day
        spread = []
        for day in sorted(by_day.keys()):
            if len(spread) < count * 2:
                # Take the highest scored slot from this day
                best = max(by_day[day], key=lambda x: x['score'])
                spread.append(best)

        # If we still need more, add remaining slots
        if len(spread) < count * 2:
            for slot in slots:
                if slot not in spread and len(spread) < count * 2:
                    spread.append(slot)

        return spread

    def _is_slot_free(self, start: datetime, end: datetime, existing_events: list) -> bool:
        """Check if a time slot is free (no conflicts with existing events)."""
        from dateutil import parser

        for event in existing_events:
            event_start_str = event.get('start')
            event_end_str = event.get('end')

            if not event_start_str or not event_end_str:
                continue

            # Parse ISO format strings to datetime objects
            try:
                event_start = parser.isoparse(event_start_str) if isinstance(event_start_str, str) else event_start_str
                event_end = parser.isoparse(event_end_str) if isinstance(event_end_str, str) else event_end_str
            except Exception as e:
                logger.warning(f"Failed to parse event times: {e}")
                continue

            # Ensure timezone awareness for comparison
            if event_start.tzinfo is None and start.tzinfo is not None:
                # Assume event is in same timezone as start
                event_start = event_start.replace(tzinfo=start.tzinfo)
            if event_end.tzinfo is None and end.tzinfo is not None:
                event_end = event_end.replace(tzinfo=end.tzinfo)

            # Check for overlap
            if start < event_end and end > event_start:
                return False

        return True

    def _format_proposal_response(self, parsed_request: dict, proposals: list, session_id: str) -> str:
        """Format proposals into user-friendly response."""
        title = parsed_request['title']
        duration = parsed_request['duration_minutes']
        count = parsed_request['count']

        response = f"I found free time for '{title}' ({duration} min, {count}x needed):\n\n"

        for i, proposal in enumerate(proposals[:count * 2], 1):  # Show double count
            response += f"{i}. {proposal['day']} at {proposal['time']}\n"

        response += f"\nPlease select {count} option(s) by clicking on them, then confirm to add to your calendar."

        return response
