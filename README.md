# Smart Calendar Agent

Unified calendar assistant that ingests Gmail reservation emails, Canvas and other iCal feeds, and voice/text requests to keep Google Calendar organized while protecting self-care windows.

## Quickstart
1. **Python.** Install Python 3.10+ and a virtual environment manager (`python -m venv .venv`).
2. **Install deps.**
   ```bash
   source .venv/bin/activate
   pip install -e .[dev]
   ```
3. **Configure.** Copy `.env.example` to `.env` and fill in credentials. Update `config.yaml` with your feed URLs and preferences.
4. **Run API.**
   ```bash
   uvicorn app.main:app --reload
   ```

## Project Layout
- `app/` — FastAPI application, routers, services.
- `core/` — Shared models, config, utilities.
- `services/` — Integrations for Gmail, iCal feeds, Google Calendar, NLU, and planning.
- `tests/` — Pytest suite with unit tests for parsing, planning, and intent detection.
- `docs/` — Architecture notes and additional design docs.

## Scripts
| Command | Purpose |
| --- | --- |
| `uvicorn app.main:app --reload` | Run API locally. |
| `pytest` | Execute unit tests. |
| `ruff check .` | Lint code. |
| `mypy .` | Static type checks. |

## Contributing
Open an issue or submit a PR with clear description, test coverage, and manual validation notes.
