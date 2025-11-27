# Smart Calendar Agent

A unified calendar assistant that syncs Canvas assignments, iCal feeds, and Google Calendar events. Features smart activity scheduling with natural language input, voice commands, and automatic conflict detection.

## Features

- **Multi-Source Sync**: Import events from Canvas, iCal feeds, Outlook, and Google Calendar
- **Smart Activity Creation**: Use natural language to create recurring events (e.g., "Study session every Wednesday at 6pm")
- **Voice Input**: Speak your scheduling requests
- **All-Day Event Support**: Manage all-day events with proper timezone handling
- **Academic Calendar Integration**: Skip holidays and breaks automatically
- **Weekly Grid View**: Visual calendar with time slots
- **Export Options**: Print to PDF or export to Excel/CSV

## Quick Start

### Prerequisites

- Python 3.10 or higher
- Google Cloud account (for Google Calendar API)
- OpenAI API key (for smart features)

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/smart-calendar.git
cd smart-calendar
```

### 2. Set Up Python Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate it
source .venv/bin/activate  # On Mac/Linux
# or
.venv\Scripts\activate  # On Windows

# Install dependencies
pip install -e .
```

### 3. Set Up Google Calendar API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Calendar API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Desktop app" as the application type
   - Download the JSON file
   - Rename it to `client_secret.json` and place it in the project root

### 4. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your settings
```

Edit `.env` and fill in:
- `OPENAI_API_KEY`: Your OpenAI API key from [platform.openai.com](https://platform.openai.com/api-keys)
- `TIMEZONE`: Your timezone (e.g., `America/New_York`, `America/Los_Angeles`)

### 5. Configure Calendar Sources (Optional)

```bash
# Copy the example config
cp config.example.yaml config.yaml

# Edit config.yaml with your calendar URLs
```

Add your Canvas iCal URL, other calendar feeds, and academic calendar settings.

### 6. Run the Application

```bash
# Start the server
./start.sh

# Or manually:
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 7. Open in Browser

Visit [http://localhost:8000](http://localhost:8000)

On first run, you'll be prompted to authorize Google Calendar access. Follow the link and sign in with your Google account.

## Configuration

### Environment Variables (.env)

| Variable | Description | Required |
|----------|-------------|----------|
| `GOOGLE_OAUTH_CLIENT_SECRETS` | Path to your Google OAuth client secrets file | Yes |
| `GOOGLE_TOKEN_DIR` | Directory to store OAuth tokens | Yes |
| `GOOGLE_CALENDAR_ID` | Calendar ID to use (default: `primary`) | No |
| `TIMEZONE` | Your timezone | Yes |
| `OPENAI_API_KEY` | OpenAI API key for smart features | Yes |
| `MAPS_API_KEY` | Google Maps API key (optional) | No |

### Calendar Configuration (config.yaml)

```yaml
# Canvas calendar feed
canvas_ics_url: "https://canvas.yourschool.edu/feeds/calendars/user_XXXX.ics"

# Additional iCal sources
ics_sources:
  - name: "Work Calendar"
    url: "https://example.com/calendar.ics"

# Academic calendar for holiday detection
academic_calendar:
  term_name: "Fall 2025"
  term_start_date: "2025-09-01"
  term_end_date: "2025-12-15"
  holidays:
    - name: "Thanksgiving Break"
      start: "2025-11-25"
      end: "2025-11-29"
```

## Project Structure

```
smart-calendar/
├── app/                 # FastAPI application
│   ├── api/            # API routes and handlers
│   ├── static/         # Frontend (HTML, CSS, JS)
│   └── main.py         # Application entry point
├── core/               # Shared models and config
├── services/           # Calendar integrations
├── tests/              # Test suite
├── .env.example        # Example environment config
├── config.example.yaml # Example calendar config
└── start.sh           # Startup script
```

## Usage

### Adding Events

1. **Quick Add**: Use the "Add Activity" button for manual event creation
2. **Smart Add**: Type natural language in the "Add Smart Activity" panel
   - Example: "Gym every Monday and Wednesday at 7am for 1 hour"
3. **Voice Input**: Click the microphone icon to speak your request

### Syncing Calendars

- Click "Sync All Sources" to refresh all connected calendars
- Individual sync buttons available for Google Calendar, Canvas, and Outlook

### Managing All-Day Events

All-day events appear in the "All-Day & No-Time Events" section. You can:
- Filter by day of week using the M/T/W/T/F/S/S buttons
- Delete events by hovering and clicking the × button

## Troubleshooting

### Google OAuth Issues

If you see "Token has been expired or revoked":
1. Delete the token file: `rm -rf ~/.credentials/smart-calendar-agent`
2. Restart the app: `./start.sh`
3. Re-authorize when prompted

### Canvas Sync Not Working

Ensure your Canvas iCal URL is correct:
1. Go to Canvas > Calendar > Calendar Feed
2. Copy the URL and paste it in `config.yaml`

### Port Already in Use

If port 8000 is busy:
```bash
python -m uvicorn app.main:app --reload --port 8001
```

## Development

```bash
# Run tests
pytest

# Lint code
ruff check .

# Type checking
mypy .
```

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## Support

Open an issue on GitHub for bugs or feature requests.
