# Smart Calendar Agent - Quick Start Guide

## Your Web App is Running!

**URL:** http://localhost:8000

The server is currently running and serving your Smart Calendar Agent web interface.

---

## New Features Added

### 1. Voice Input (Speech-to-Text)
- **Click the microphone button** (🎤) next to the text input
- **Speak your command** - the app will transcribe it automatically
- Works in Chrome, Edge, and Safari (uses Web Speech API)
- The button turns red (🔴) when listening

**Example voice commands:**
- "Add yoga class every Monday at 7am"
- "When can I schedule a 1 hour meeting?"
- "Book gym time on Wednesdays"

### 2. Auto-Sync Calendar Data
- **Toggle switch** to enable/disable automatic syncing
- **Choose interval:** 5 min, 15 min, 30 min, or 1 hour
- **See next sync time** displayed in the UI
- **Runs in background** - syncs all calendar sources automatically
- **Settings saved** - your preferences persist across browser sessions

---

## How to Use the Interface

### Voice/Text Commands
1. Type or speak your request
2. Click "Add Recurring Event" to add calendar items
3. Click "Suggest Time" to get time slot recommendations

### Manual Sync
- Click individual sync buttons for Gmail, Canvas, or ICS feeds
- Or click "Sync All Sources" for one-click full sync

### Auto-Sync (NEW!)
1. Enable the Auto-Sync toggle
2. Select your preferred sync interval
3. The app will automatically sync in the background
4. Status shows when the next sync will occur

### System Status
- **API Server:** Shows connection status
- **Last Sync:** Time of most recent sync
- **Auto-Sync:** Current auto-sync status
- **Voice Recognition:** Browser support status

---

## Real APIs You Need to Set Up

To make the app fully functional, you need these API credentials:

### Required:

1. **Google OAuth Client Secrets**
   - Go to: https://console.cloud.google.com/
   - Create a project → Enable Google Calendar API
   - Create OAuth 2.0 credentials (Desktop app)
   - Download as `client_secret.json`
   - Update `.env` file with the path

2. **OpenAI API Key**
   - Get from: https://platform.openai.com/api-keys
   - Add to `.env` file: `OPENAI_API_KEY=sk-...`

3. **Canvas ICS URL**
   - Get your Canvas calendar feed URL
   - Update in `config.yaml` under `canvas_ics_url`

### Optional:
- **Google Maps API Key** - For travel time calculations
- **Other ICS Feeds** - Any other calendar sources

---

## Current Implementation Status

### Working:
- ✅ Web UI with beautiful design
- ✅ Voice recognition (speech-to-text)
- ✅ Auto-sync with configurable intervals
- ✅ Manual sync buttons
- ✅ Settings persistence (localStorage)
- ✅ API status monitoring
- ✅ FastAPI backend with API docs

### Not Yet Implemented (Stubs):
- ⏳ Gmail ingestion logic
- ⏳ Canvas ICS parsing
- ⏳ Generic ICS feed parsing
- ⏳ Voice command NLU (natural language understanding)
- ⏳ Time slot suggestions
- ⏳ Self-care time blocking
- ⏳ Event confirmation flow

All API endpoints return "not implemented yet" responses but are ready for implementation.

---

## Files Updated

### New Files:
- `app/static/index.html` - Main web interface
- `app/static/styles.css` - Styling and animations
- `app/static/app.js` - JavaScript functionality

### Modified Files:
- `app/main.py` - Added static file serving
- `.env` - Environment variables (needs your API keys)
- `config.yaml` - Calendar source configuration

---

## Tips

1. **Voice Recognition:**
   - Only works in HTTPS or localhost
   - Requires microphone permissions
   - Best in Chrome/Edge browsers

2. **Auto-Sync:**
   - Runs immediately when enabled
   - Settings saved automatically
   - Check browser console for sync logs

3. **Development:**
   - Server auto-reloads on file changes
   - Check API docs at `/docs`
   - Use browser DevTools to debug

4. **Testing:**
   - All buttons work (show placeholder responses)
   - Voice input works with real speech recognition
   - Auto-sync timer works (just calls stub APIs)

---

## Next Steps

1. **Add Real API Keys** - Set up Google OAuth and OpenAI
2. **Implement Services** - Fill in the actual calendar logic
3. **Test with Real Data** - Connect to your actual calendars
4. **Deploy** - Host on a server when ready

---

## Need Help?

- **API Documentation:** http://localhost:8000/docs
- **Check Server Logs:** Look at the terminal where server is running
- **Browser Console:** Open DevTools to see JavaScript logs
- **README:** See main `README.md` for architecture details

Enjoy your Smart Calendar Agent! 🎉
