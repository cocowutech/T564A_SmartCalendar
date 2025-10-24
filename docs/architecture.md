# Smart Calendar Agent — Architecture Snapshot

## High-Level Components
- **FastAPI application** exposing ingestion and voice endpoints described in the PRD.
- **Ingestion services** for Gmail (`gmail_reader`), Canvas (`canvas_ingestor`), and generic iCal feeds (`ics_ingestor`), each returning normalized `EventItem` objects.
- **Calendar writer** (`calendar_writer`) handling dedupe and upsert into Google Calendar using extended properties to track source metadata.
- **Voice/NLU layer** (`voice_nlu`) calling OpenAI for intent classification and slot filling, returning structured payloads for downstream flows.
- **Planner/self-care suggester** (`planner`) combining scheduled events and configuration to produce protected time proposals.
- **Config & secrets management** via `.env` and `config.yaml`, with strongly-typed settings objects.

## Data Model
- `EventItem` and `Proposal` implemented with Pydantic for validation and serialization.
- Additional supporting models for Gmail payload metadata and NLU intent outputs.

## Execution Flow
1. Ingestion endpoints pull raw sources → normalized events.
2. Calendar writer upserts events, tagging with source metadata.
3. Planner reads busy blocks from Google Calendar, applies buffers and preferences, and surfaces candidate self-care slots.
4. Voice endpoints orchestrate NLU, planning, and optional confirmation writes.

## Next Steps
- Scaffold Python package structure with the modules above.
- Implement shared utilities for timezones, dedupe helpers, and Google API clients.
- Establish test harness with pytest covering parsing, NLU, and planning logic.
