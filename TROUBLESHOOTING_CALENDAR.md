# Calendar Not Showing - Troubleshooting Guide

## Quick Fix Checklist

### 1. Is the Server Running?

I just started the server for you. Wait ~5 seconds, then:

**Open:** http://localhost:8000

You should see:
- "Smart Calendar" header at top
- Week view with days (Mon, Tue, Wed...)
- Empty calendar (if no events synced yet)

### 2. What Should You See?

**On First Load (No Events Yet):**
```
┌─────────────────────────────────────┐
│ Smart Calendar        [🔄] [➕ Add] │
├─────────────────────────────────────┤
│                                     │
│   Empty Week Grid                   │
│   Mon  Tue  Wed  Thu  Fri  Sat  Sun │
│   ─────────────────────────────────  │
│   6 AM  (empty time slots)          │
│   7 AM                              │
│   ...                               │
│                                     │
│ Message: "Loading events..."        │
└─────────────────────────────────────┘
```

**After Auto-Sync:**
- Events should appear in the grid
- Toast message: "✅ Calendar synced"

### 3. Check Browser Console

**Press F12** (or Cmd+Option+I on Mac) to open Developer Tools

Look for errors (red text). Common issues:

#### ✅ Good Console Output:
```
Loaded 0 events: 0 timed, 0 all-day
🔄 Auto-syncing Canvas and Google Calendar...
✅ Auto-sync complete
```

#### ❌ Bad Console Output:
```
Failed to load events: Failed to fetch
TypeError: Cannot read property...
```

### 4. Common Issues & Fixes

#### Issue A: "Failed to fetch" Error

**Problem:** Server not running or wrong port

**Fix:**
```bash
cd /Users/cocowu/Harvard-VC/vibe_coding_2/T564A_SmartCalendar
./start.sh
```

Then open: http://localhost:8000

#### Issue B: Blank White Page

**Problem:** JavaScript error preventing render

**Fix:**
1. Press F12 → Console tab
2. Take screenshot of red errors
3. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

#### Issue C: "No events" Message

**Problem:** This is actually CORRECT for first time!

**Solution:** Events will auto-sync in ~1 second. Or click "🔄 Refresh" manually.

#### Issue D: Week Grid Shows But No Time Labels

**Problem:** CSS not loading

**Fix:**
1. Check Network tab in DevTools (F12)
2. Look for failed requests (red)
3. Hard refresh: Cmd+Shift+R

### 5. Manual Steps to Debug

**Step 1: Verify Server is Running**
```bash
curl http://localhost:8000
```

You should see HTML with "Smart Calendar"

**Step 2: Check API Status**
```bash
curl http://localhost:8000/api/events
```

Should return JSON like: `{"status":"ok","events":[...]}`

**Step 3: Check Static Files**
```bash
curl http://localhost:8000/static/app.js | head -n 5
```

Should show JavaScript code

### 6. Browser Compatibility

**Supported Browsers:**
- ✅ Chrome/Edge (Latest)
- ✅ Firefox (Latest)
- ✅ Safari (Latest)
- ❌ Internet Explorer (Not supported)

**Required JavaScript Features:**
- ES6+ (arrow functions, async/await)
- localStorage
- Fetch API
- CSS Grid

### 7. Clear Cache & Reload

Sometimes cached files cause issues:

**Chrome/Edge:**
1. Press Cmd+Shift+Delete (Mac) or Ctrl+Shift+Delete (Windows)
2. Select "Cached images and files"
3. Click "Clear data"
4. Hard refresh: Cmd+Shift+R

**Or simpler:**
- Just do Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

### 8. Check File Structure

Verify these files exist:
```bash
cd /Users/cocowu/Harvard-VC/vibe_coding_2/T564A_SmartCalendar
ls app/static/
```

Should show:
- app.js
- index.html
- styles.css

### 9. What You Should See Now

Since I just started the server:

1. **Go to:** http://localhost:8000
2. **Wait 2-3 seconds** for auto-sync
3. **You should see:**
   - Week header with dates
   - Time column (6 AM - 10 PM)
   - Day columns (Mon - Sun)
   - Green highlight on today
   - Red line at current time (if during 6 AM - 10 PM)

### 10. If Still Not Working

**Take these screenshots:**
1. Browser window showing the issue
2. Console (F12) showing any errors
3. Network tab (F12) showing failed requests

**Check terminal output:**
```bash
cd /Users/cocowu/Harvard-VC/vibe_coding_2/T564A_SmartCalendar
# Look at the server logs
```

Should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Started reloader process
```

### Quick Test Commands

**Test 1: Is server responding?**
```bash
curl http://localhost:8000 | grep "Smart Calendar"
```

**Test 2: Are events loading?**
```bash
curl http://localhost:8000/api/events
```

**Test 3: Check API docs**
Open: http://localhost:8000/docs

Should show FastAPI documentation

---

## What To Do Right Now

1. **Open your browser**
2. **Go to:** http://localhost:8000
3. **Press F12** to open console
4. **Wait 5 seconds** for auto-sync
5. **Look for:**
   - Week grid with time slots
   - Toast message at bottom
   - Console logs showing "Loaded X events"

If you see the week grid with days/times = **Success!** ✅  
If you see blank white page = **Check console for errors** 🔍  
If you see "Connection refused" = **Server not running** 🔄

---

## Most Likely Issues

### 90% Chance: Server Not Running
**Fix:** I just started it for you! Open http://localhost:8000

### 5% Chance: Wrong URL
**Fix:** Make sure it's http://localhost:8000 (not 8080, not 3000)

### 5% Chance: Browser Cache
**Fix:** Hard refresh (Cmd+Shift+R or Ctrl+Shift+R)

---

Try opening http://localhost:8000 now! The server should be running. 🚀


