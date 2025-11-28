const API_BASE = '/api';

// Authentication state
let isAuthenticated = false;

// Calendar configuration
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22; // Last full hour shown
const DAY_END_EXTRA_SLOTS = 0; // Don't show any slots after 10:00 PM
const HOUR_HEIGHT = 48; // px per hour (must match CSS --hour-height)
const SLOT_HEIGHT = 24; // px per 30-min slot (HOUR_HEIGHT / 2)
const SLOT_MINUTES = 30; // 30-minute grid
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Global state
let autoSyncTimer = null;
let autoSyncIntervalMinutes = 15;
let recognition = null;
let isRecording = false;
let selectedDate = new Date();
let events = [];
let suggestionsCount = 0;
let courseFilters = new Set(); // Enabled courses
let allCourses = []; // All available courses
let activeDayFilters = new Set([0, 1, 2, 3, 4, 5, 6]); // All days active by default (Mon=0, Sun=6)
let currentView = 'grid'; // 'grid' or 'simple'
let academicCalendarPresets = {
    termName: null,
    termEndDate: null,
    holidays: [],
};
let recurrenceExceptions = [];
let editingEventContext = null;
let timezoneUiInitialized = false;
let locationBannerTimer = null;

const TODO_STORAGE_PREFIX = 'smartCalendar.todo.';
const todoMemoryStore = {};
let todoUiInitialized = false;
let currentTodoDateKey = null;

const QUOTE_API_URL = 'https://motivational-spark-api.vercel.app/api/quotes/random';
const quoteCache = {};

// ---------------------------------------------------------------------------
// Authentication Functions
// ---------------------------------------------------------------------------

async function checkAuthStatus() {
    try {
        const response = await fetch(`${API_BASE}/auth/status`);
        const data = await response.json();
        isAuthenticated = data.authenticated;
        return isAuthenticated;
    } catch (error) {
        console.error('Failed to check auth status:', error);
        return false;
    }
}

function showLoginScreen() {
    const appShell = document.querySelector('.app-shell');
    if (!appShell) return;

    // Hide the main content
    const appBody = document.querySelector('.app-body');
    const appHeader = document.querySelector('.app-header');
    if (appBody) appBody.style.display = 'none';
    if (appHeader) appHeader.style.display = 'none';

    // Create login screen
    const loginScreen = document.createElement('div');
    loginScreen.id = 'loginScreen';
    loginScreen.innerHTML = `
        <div class="login-container">
            <div class="login-card">
                <div class="login-header">
                    <h1>Smart Calendar</h1>
                    <p>Your intelligent calendar assistant</p>
                </div>
                <div class="login-body">
                    <p>Connect your Google Calendar to get started.</p>
                    <p class="login-note">Your calendar data stays private - we only access events you choose to share.</p>
                    <a href="/api/auth/login" class="btn btn-primary btn-lg login-btn">
                        <svg width="20" height="20" viewBox="0 0 24 24" style="margin-right: 8px;">
                            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                        Connect Google Calendar
                    </a>
                </div>
                <div class="login-footer">
                    <p>By connecting, you agree to let Smart Calendar access your Google Calendar events.</p>
                </div>
            </div>
        </div>
    `;
    appShell.insertBefore(loginScreen, appShell.firstChild);
}

function hideLoginScreen() {
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.remove();
    }
    const appBody = document.querySelector('.app-body');
    const appHeader = document.querySelector('.app-header');
    if (appBody) appBody.style.display = '';
    if (appHeader) appHeader.style.display = '';
}

function handleAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const authSuccess = urlParams.get('auth_success');
    const authError = urlParams.get('auth_error');

    if (authSuccess === 'true') {
        // Clear URL params
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('ingestResult', 'Successfully connected to Google Calendar!', false, 3000);
        return true;
    }

    if (authError) {
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('ingestResult', `Authentication failed: ${authError}`, true, 5000);
        return false;
    }

    return null;
}

async function logout() {
    try {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
        isAuthenticated = false;
        window.location.reload();
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

// ---------------------------------------------------------------------------
// Calendar Sources Management (per-user configuration)
// ---------------------------------------------------------------------------

let userCalendarSources = { canvas_sources: [], ics_sources: [] };

async function loadUserCalendarSources() {
    try {
        const response = await fetch(`${API_BASE}/user/calendar-sources`);
        const data = await response.json();
        if (data.status === 'ok') {
            userCalendarSources = {
                canvas_sources: data.canvas_sources || [],
                ics_sources: data.ics_sources || []
            };
            updateSourcesSummary();
            updateSourcesList();
        }
    } catch (error) {
        console.error('Failed to load calendar sources:', error);
    }
}

function updateSourcesSummary() {
    const summary = document.getElementById('userSourcesSummary');
    if (!summary) return;

    const total = userCalendarSources.canvas_sources.length + userCalendarSources.ics_sources.length;
    if (total === 0) {
        summary.innerHTML = '<p class="hint">Add your Canvas, Outlook, or other calendar URLs to sync.</p>';
    } else {
        const sources = [...userCalendarSources.canvas_sources, ...userCalendarSources.ics_sources];
        const names = sources.map(s => s.name).join(', ');
        summary.innerHTML = `<p class="hint">${total} source${total > 1 ? 's' : ''}: ${names}</p>`;
    }
}

function updateSourcesList() {
    const list = document.getElementById('calendarSourcesList');
    if (!list) return;

    const allSources = [
        ...userCalendarSources.canvas_sources.map(s => ({ ...s, type: 'canvas' })),
        ...userCalendarSources.ics_sources.map(s => ({ ...s, type: s.source_type || 'ics' }))
    ];

    if (allSources.length === 0) {
        list.innerHTML = '<p class="hint">No calendar sources configured yet.</p>';
        return;
    }

    list.innerHTML = allSources.map(source => `
        <div class="source-item">
            <div class="source-info">
                <span class="source-type-badge ${source.type}">${source.type.toUpperCase()}</span>
                <span class="source-name">${escapeHtml(source.name)}</span>
            </div>
            <button class="btn btn-light btn-sm" onclick="removeCalendarSource('${escapeHtml(source.url)}')">
                Remove
            </button>
        </div>
    `).join('');
}

function showCalendarSourcesModal() {
    const modal = document.getElementById('calendarSourcesModal');
    if (modal) {
        modal.style.display = 'flex';
        loadUserCalendarSources();
    }
}

function hideCalendarSourcesModal() {
    const modal = document.getElementById('calendarSourcesModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function addCalendarSource() {
    const sourceType = document.getElementById('sourceType').value;
    const name = document.getElementById('sourceName').value.trim();
    const url = document.getElementById('sourceUrl').value.trim();

    if (!name) {
        showToast('ingestResult', 'Please enter a display name', true);
        return;
    }
    if (!url) {
        showToast('ingestResult', 'Please enter a calendar URL', true);
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/user/calendar-sources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, source_type: sourceType })
        });
        const data = await response.json();

        if (data.status === 'ok') {
            userCalendarSources = {
                canvas_sources: data.canvas_sources || [],
                ics_sources: data.ics_sources || []
            };
            updateSourcesSummary();
            updateSourcesList();
            // Clear form
            document.getElementById('sourceName').value = '';
            document.getElementById('sourceUrl').value = '';
            showToast('ingestResult', `Added ${name}!`, false, 3000);
        } else {
            showToast('ingestResult', data.error || 'Failed to add source', true);
        }
    } catch (error) {
        console.error('Failed to add calendar source:', error);
        showToast('ingestResult', 'Failed to add calendar source', true);
    }
}

async function removeCalendarSource(url) {
    if (!confirm('Remove this calendar source?')) return;

    try {
        const response = await fetch(`${API_BASE}/user/calendar-sources`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await response.json();

        if (data.status === 'ok') {
            userCalendarSources = {
                canvas_sources: data.canvas_sources || [],
                ics_sources: data.ics_sources || []
            };
            updateSourcesSummary();
            updateSourcesList();
            showToast('ingestResult', 'Source removed', false, 3000);
        } else {
            showToast('ingestResult', data.error || 'Failed to remove source', true);
        }
    } catch (error) {
        console.error('Failed to remove calendar source:', error);
        showToast('ingestResult', 'Failed to remove calendar source', true);
    }
}

async function syncUserSources() {
    showToast('ingestResult', '🔄 Syncing calendar sources...', false, 0);

    try {
        const response = await fetch(`${API_BASE}/user/sync-sources`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();

        if (data.status === 'ok') {
            const synced = data.synced || [];
            const successful = synced.filter(s => s.status === 'ok');
            const failed = synced.filter(s => s.status === 'error');

            let message = '';
            if (synced.length === 0) {
                message = 'No calendar sources to sync. Add sources in Settings.';
            } else if (failed.length === 0) {
                const totalEvents = successful.reduce((sum, s) => sum + (s.events_synced || 0), 0);
                message = `✅ Synced ${totalEvents} events from ${successful.length} source${successful.length > 1 ? 's' : ''}`;
            } else {
                message = `Synced ${successful.length} sources, ${failed.length} failed`;
            }

            showToast('ingestResult', message, failed.length > 0, 5000);

            // Refresh events
            await loadRealEvents();
        } else {
            showToast('ingestResult', data.error || 'Sync failed', true, 5000);
        }
    } catch (error) {
        console.error('Sync failed:', error);
        showToast('ingestResult', 'Failed to sync calendar sources', true, 5000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const DEFAULT_TIME_ZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Toronto',
    'America/Vancouver',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Amsterdam',
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Singapore',
    'Asia/Kuala_Lumpur',
    'Asia/Bangkok',
    'Asia/Kolkata',
    'Australia/Sydney'
];

const userTimeZone = (() => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (err) {
        console.warn('Unable to detect user timezone, defaulting to UTC', err);
        return 'UTC';
    }
})();

function getSupportedTimeZones() {
    if (typeof Intl.supportedValuesOf === 'function') {
        try {
            const zones = Intl.supportedValuesOf('timeZone');
            if (Array.isArray(zones) && zones.length) {
                return zones;
            }
        } catch (err) {
            console.warn('Intl.supportedValuesOf not supported for time zones', err);
        }
    }
    return DEFAULT_TIME_ZONES;
}

function formatTimeZoneLabel(tz) {
    if (!tz) return 'Unknown timezone';
    try {
        if (typeof Intl.DisplayNames === 'function') {
            const locale = navigator.language || 'en';
            const displayNames = new Intl.DisplayNames([locale], { type: 'timeZone' });
            const friendly = displayNames.of(tz);
            if (friendly && friendly !== tz) {
                return `${friendly} (${tz})`;
            }
        }
    } catch (err) {
        console.warn('Unable to format timezone display name', err);
    }
    const parts = tz.split('/');
    const displayName = parts[parts.length - 1].replace(/_/g, ' ');
    return `${displayName} (${tz})`;
}

function updateUserLocationBanner() {
    const banner = document.getElementById('userLocationInfo');
    if (!banner) return;

    const render = () => {
        const display = formatTimeZoneLabel(userTimeZone);
        const localTime = new Intl.DateTimeFormat([], {
            timeZone: userTimeZone,
            hour: 'numeric',
            minute: '2-digit',
        }).format(new Date());
        banner.textContent = `📍 ${display} • Local time ${localTime}`;
    };

    render();

    if (!locationBannerTimer) {
        locationBannerTimer = setInterval(render, 60000);
    }
}

function populateTimeZoneSelect() {
    const select = document.getElementById('eventTimeZone');
    if (!select) return;

    const currentValue = select.value || userTimeZone;
    select.innerHTML = '';

    const zones = getSupportedTimeZones();
    const uniqueZones = Array.from(new Set([currentValue, userTimeZone, ...zones].filter(Boolean)));
    uniqueZones.sort((a, b) => a.localeCompare(b));

    uniqueZones.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = formatTimeZoneLabel(zone);
        select.appendChild(option);
    });

    if (uniqueZones.includes(currentValue)) {
        select.value = currentValue;
    } else {
        select.value = userTimeZone;
    }
}

function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
    if (!dateStr || !timeStr) return null;
    const localIso = `${dateStr}T${timeStr}:00`;
    const localDate = new Date(localIso);
    if (Number.isNaN(localDate.getTime())) {
        return null;
    }

    try {
        const tzDate = new Date(localDate.toLocaleString('en-US', { timeZone }));
        const offsetMs = tzDate.getTime() - localDate.getTime();
        return new Date(localDate.getTime() - offsetMs);
    } catch (err) {
        console.warn(`Failed to convert ${localIso} for timezone ${timeZone}`, err);
        return null;
    }
}

function updateEventTimeConversionPreview() {
    const hint = document.getElementById('eventTimeConversion');
    const isAllDay = document.getElementById('eventAllDay').checked;
    if (!hint || isAllDay) {
        if (hint) hint.textContent = '';
        return;
    }

    const date = document.getElementById('eventDate').value;
    const startTime = document.getElementById('eventStartTime').value;
    const endTime = document.getElementById('eventEndTime').value;
    const timeZone = document.getElementById('eventTimeZone').value || userTimeZone;

    const startUtc = zonedDateTimeToUtc(date, startTime, timeZone);
    const endUtc = zonedDateTimeToUtc(date, endTime, timeZone);

    if (!startUtc || !endUtc) {
        hint.textContent = '';
        return;
    }

    const datetimeOptions = {
        timeZone: userTimeZone,
        hour: 'numeric',
        minute: '2-digit',
    };

    const userStart = startUtc.toLocaleString([], datetimeOptions);
    const userEnd = endUtc.toLocaleString([], datetimeOptions);

    const targetLabel = formatTimeZoneLabel(timeZone);
    const userLabel = formatTimeZoneLabel(userTimeZone);
    hint.textContent = `Event time in ${targetLabel} → ${userStart}–${userEnd} in ${userLabel}`;
}

function getWeekdayTokenForZone(dateStr, timeZone) {
    if (!dateStr) return null;
    const midnightUtc = zonedDateTimeToUtc(dateStr, '00:00', timeZone);
    if (!midnightUtc) return null;
    const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
    }).format(midnightUtc).toLowerCase();

    const map = {
        sun: 'sun',
        mon: 'mon',
        tue: 'tue',
        wed: 'wed',
        thu: 'thu',
        fri: 'fri',
        sat: 'sat',
    };
    return map[weekday] || null;
}

function initializeTimeZoneUI() {
    if (timezoneUiInitialized) return;

    const tzSelect = document.getElementById('eventTimeZone');
    const dateInput = document.getElementById('eventDate');
    if (!tzSelect || !dateInput) {
        // Elements not yet in the DOM; try again shortly.
        setTimeout(initializeTimeZoneUI, 50);
        return;
    }

    timezoneUiInitialized = true;
    updateUserLocationBanner();
    populateTimeZoneSelect();

    ['eventDate', 'eventStartTime', 'eventEndTime', 'eventTimeZone'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateEventTimeConversionPreview);
            el.addEventListener('input', updateEventTimeConversionPreview);
        }
    });

    updateEventTimeConversionPreview();
}

if (document.readyState !== 'loading') {
    initializeTimeZoneUI();
} else {
    document.addEventListener('DOMContentLoaded', initializeTimeZoneUI, { once: true });
}

// ---------------------------------------------------------------------------
// Fetch helpers & notifications
// ---------------------------------------------------------------------------

function showToast(elementId, message, isError = false, timeoutMs = 5000) {
    const target = document.getElementById(elementId);
    target.className = `result toast show ${isError ? 'error' : 'success'}`;
    target.textContent = message;

    if (target._toastTimer) {
        clearTimeout(target._toastTimer);
    }

    target._toastTimer = setTimeout(() => {
        target.classList.remove('show');
    }, timeoutMs);
}

async function apiCall(endpoint, payload = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        const error = detail.detail || response.statusText;
        throw new Error(`${response.status} ${error}`);
    }

    return response.json();
}

function summarizeSyncResult(label, payload) {
    if (!payload) {
        showToast('ingestResult', `${label} sync failed: no response`, true);
        return;
    }

    if (payload.status !== 'ok') {
        const message = payload.error || payload.reason || 'Unknown error';
        showToast('ingestResult', `${label} sync failed: ${message}`, true);
        return;
    }

    const summary = payload.summary ?? {};
    if (summary.handled === false) {
        const reason = summary.reason || 'Not handled';
        showToast('ingestResult', `${label} sync skipped: ${reason}`, true);
        return;
    }

    // Handle Canvas sync (which doesn't write to Google Calendar)
    if (label === 'Canvas' && summary.note) {
        const eventCount = summary.events_count ?? 0;
        showToast('ingestResult', `Canvas: ${eventCount} events fetched (not synced to Google Calendar)`, false);
        return;
    }

    const created = summary.events_created ?? summary.eventsCreated ?? 0;
    const updated = summary.events_updated ?? summary.eventsUpdated ?? 0;
    const skippedCount = Array.isArray(summary.skipped) ? summary.skipped.length : 0;

    if (skippedCount && Array.isArray(summary.skipped)) {
        console.warn(`${label} sync skipped entries:`, summary.skipped);
    }

    const parts = [];
    parts.push(`${created} new`);
    if (updated) parts.push(`${updated} updated`);
    if (!created && !updated) parts.push('no changes');
    if (skippedCount) parts.push(`${skippedCount} skipped`);

    showToast('ingestResult', `${label} sync complete — ${parts.join(', ')}`, false);
}

function summarizeMultiSync(payload) {
    if (!payload) {
        showToast('ingestResult', 'Sync failed: no response', true);
        return;
    }

    if (payload.status !== 'ok') {
        const message = payload.error || 'Unknown error';
        showToast('ingestResult', `Sync failed: ${message}`, true);
        return;
    }

    const summary = payload.summary ?? {};
    const messages = [];
    Object.entries(summary).forEach(([key, value]) => {
        if (!value) return;

        const label = key.charAt(0).toUpperCase() + key.slice(1);

        if (typeof value !== 'object' || Array.isArray(value)) {
            messages.push(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
            return;
        }

        if (value.handled === false) {
            messages.push(`${label} skipped (${value.reason || 'n/a'})`);
            return;
        }

        // Handle Canvas (which doesn't sync to Google Calendar)
        if (label === 'Canvas' && value.note) {
            const eventCount = value.events_count ?? 0;
            messages.push(`${label}: ${eventCount} events (display only)`);
            return;
        }

        const created = value.events_created ?? 0;
        const updated = value.events_updated ?? 0;
        const skippedCount = Array.isArray(value.skipped) ? value.skipped.length : 0;

        const parts = [];
        if (created) parts.push(`${created} new`);
        if (updated) parts.push(`${updated} updated`);
        if (!created && !updated) parts.push('no changes');
        if (skippedCount) parts.push(`${skippedCount} skipped`);

        if (skippedCount && Array.isArray(value.skipped)) {
            console.warn(`${label} skipped entries:`, value.skipped);
        }

        messages.push(`${label}: ${parts.join(', ')}`);
    });

    showToast('ingestResult', `Sync complete — ${messages.join('; ')}`, false);
}

// ---------------------------------------------------------------------------
// Calendar utility helpers
// ---------------------------------------------------------------------------

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day + 6) % 7; // Monday start
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diff);
    return d;
}

function getWeekDates(date) {
    const start = getWeekStart(date);
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
    });
}

function formatWeekRange(dates) {
    const options = { month: 'long', day: 'numeric' };
    const start = dates[0].toLocaleDateString(undefined, options);
    const end = dates[6].toLocaleDateString(undefined, options);
    return `${start} – ${end}`;
}

function parseEvent(raw) {
    let start;
    let end;
    let allDay = false;

    if (raw.start) {
        // Check if it's a date-only string (all-day event) like "2025-11-21"
        // Parse date-only strings as local dates to avoid timezone shift
        if (raw.start.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parts = raw.start.split('-');
            start = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else {
            start = new Date(raw.start);
        }
        if (Number.isNaN(start.getTime())) {
            start = null;
        }
    }

    if (!start && raw.date) {
        const timePart = raw.time ? raw.time : '00:00';
        start = new Date(`${raw.date}T${timePart}`);
    }

    if (raw.end) {
        // Check if it's a date-only string (all-day event)
        // Parse date-only strings as local dates to avoid timezone shift
        if (raw.end.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parts = raw.end.split('-');
            end = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else {
            end = new Date(raw.end);
        }
        if (Number.isNaN(end.getTime())) {
            end = null;
        }
    }

    if (!end && start) {
        end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    // Check if this is an all-day event
    // Method 1: Backend explicitly marks it as allDay
    if (raw.allDay === true) {
        allDay = true;
    }
    // Method 2: Date-only format (no 'T' in ISO string)
    else if (raw.start && !raw.start.includes('T')) {
        allDay = true;
    }
    // Method 3: Check if time is midnight to midnight (00:00 to 00:00 next day)
    else if (start && end) {
        const isStartMidnight = start.getHours() === 0 && start.getMinutes() === 0;
        const isEndMidnight = end.getHours() === 0 && end.getMinutes() === 0;
        const isDaySpan = (end.getTime() - start.getTime()) >= 86400000; // 24 hours
        if (isStartMidnight && isEndMidnight && isDaySpan) {
            allDay = true;
        }
    }

    if (!start || !end) {
        return null;
    }

    const sourceMatch = raw.title.match(/^\[(.+?)]\s*(.*)$/);
    let source = raw.source || 'Google';
    let title = raw.title;

    if (sourceMatch) {
        source = sourceMatch[1];
        title = sourceMatch[2] || title;
    }

    const metadata = raw.metadata || {};
    const extendedProperties = raw.extendedProperties || null;

    return {
        id: raw.id || `${start.toISOString()}-${title}`,
        title,
        source,
        description: raw.description || '',
        location: raw.location || '',
        start,
        end,
        allDay,
        metadata,
        extendedProperties,
    };
}

function getEventKey(event) {
    const year = event.start.getFullYear();
    const month = String(event.start.getMonth() + 1).padStart(2, '0');
    const day = String(event.start.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function minutesSinceStart(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return hours * 60 + minutes - DAY_START_HOUR * 60;
}

function clampMinutes(value) {
    const min = 0;
    // Max includes extra half-hour slots (e.g., to 10:30 PM)
    const max = (DAY_END_HOUR - DAY_START_HOUR) * 60 + (DAY_END_EXTRA_SLOTS * 30);
    return Math.min(Math.max(value, min), max);
}

function getEventLayout(dayEvents) {
    const timedEvents = dayEvents.filter(ev => !ev.allDay).sort((a, b) => a.start - b.start);
    const layouts = [];
    const active = [];

    timedEvents.forEach(event => {
        for (let i = active.length - 1; i >= 0; i -= 1) {
            if (active[i].event.end <= event.start) {
                active.splice(i, 1);
            }
        }

        const usedColumns = new Set(active.map(item => item.column));
        let column = 0;
        while (usedColumns.has(column)) {
            column += 1;
        }

        const layout = { event, column };
        active.push(layout);
        layouts.push(layout);
    });

    layouts.forEach(layout => {
        let overlapMax = layout.column + 1;
        layouts.forEach(other => {
            if (other === layout) return;
            const overlaps = !(other.event.end <= layout.event.start || other.event.start >= layout.event.end);
            if (overlaps) {
                overlapMax = Math.max(overlapMax, other.column + 1);
            }
        });
        layout.columns = overlapMax;
    });

    return layouts;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTimeColumn() {
    const container = document.getElementById('timeColumn');
    console.log('renderTimeColumn called, container:', container);
    container.innerHTML = '';

    // Render 30-minute slots (6 AM to 10 PM only)
    for (let hour = DAY_START_HOUR; hour < DAY_END_HOUR; hour++) {
        // Hour mark
        const hourSlot = document.createElement('div');
        hourSlot.className = 'time-slot hour-slot';
        const labelDate = new Date();
        labelDate.setHours(hour, 0, 0, 0);
        hourSlot.textContent = labelDate.toLocaleTimeString([], { hour: 'numeric' });
        container.appendChild(hourSlot);

        // Half-hour mark
        const halfSlot = document.createElement('div');
        halfSlot.className = 'time-slot half-slot';
        halfSlot.textContent = ':30';
        container.appendChild(halfSlot);
    }
}

function renderWeekView() {
    const weekDates = getWeekDates(selectedDate);
    const grid = document.getElementById('weekGrid');
    grid.innerHTML = '';

    document.getElementById('weekRange').textContent = formatWeekRange(weekDates);
    const subheading = `${weekDates[0].toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
    document.getElementById('weekSubheading').textContent = subheading;

    const filteredEvents = getFilteredEvents();

    weekDates.forEach((date, index) => {
        const dayColumn = document.createElement('div');
        dayColumn.className = 'day-column';
        const dateKey = date.toISOString().split('T')[0];
        // IMPORTANT: Only show timed events in the grid, exclude all-day/no-time events
        const dayEvents = filteredEvents.filter(ev => {
            if (getEventKey(ev) !== dateKey) return false;
            if (ev.allDay) return false; // Exclude all-day events
            return true;
        });

        const header = document.createElement('div');
        header.className = 'day-header';
        header.innerHTML = `
            <span class="day-name">${DAY_NAMES[index]}</span>
            <span class="day-date">${date.toLocaleDateString(undefined, { day: 'numeric' })}</span>
        `;
        if (sameDay(date, selectedDate)) {
            header.classList.add('active');
        }
        // Highlight today's date
        {
            const today = new Date();
            if (sameDay(date, today)) {
                header.classList.add('today');
            }
        }
        header.addEventListener('click', () => {
            selectedDate = new Date(date);
            renderWeekView();
            updateSelectedDayEvents();
        });

        // All-day events moved to separate section, removed from day columns

        const body = document.createElement('div');
        body.className = 'day-body';
        // Calculate height: full hours + extra half-hour slots
        const totalHours = DAY_END_HOUR - DAY_START_HOUR;
        const extraHeight = DAY_END_EXTRA_SLOTS * SLOT_HEIGHT;
        body.style.height = `${totalHours * HOUR_HEIGHT + extraHeight}px`;

        const layouts = getEventLayout(dayEvents);
        layouts.forEach(layout => {
            const { event, column, columns } = layout;
            
            // Calculate position in minutes from day start
            const startMinutes = minutesSinceStart(event.start);
            const endMinutes = minutesSinceStart(event.end);
            
            // Clamp to visible hours
            const clampedStart = clampMinutes(startMinutes);
            const clampedEnd = clampMinutes(endMinutes);
            
            // Convert to pixels (HOUR_HEIGHT pixels per 60 minutes)
            const top = clampedStart * (HOUR_HEIGHT / 60);
            const height = Math.max((clampedEnd - clampedStart) * (HOUR_HEIGHT / 60), 24);

            const widthPercent = 100 / columns;
            const card = document.createElement('div');
            card.className = 'event-card';
            card.dataset.source = event.source || 'Google';
            card.style.top = `${top}px`;
            card.style.height = `${height}px`;
            card.style.width = `calc(${widthPercent}% - 8px)`;
            card.style.left = `calc(${column * widthPercent}% + 4px)`;

            // Add tooltip with full event details
            const tooltipText = `${event.title}\n${formatTimeRange(event.start, event.end)}${event.location ? `\n${event.location}` : ''}`;
            card.title = tooltipText;

            // Determine if event is from Canvas (protected from deletion)
            const eventSource = event.source || 'Google';
            const isCanvasEvent = eventSource.includes('Canvas');
            const isSmartSeries = Boolean(event.metadata && event.metadata.smartSeriesParent);
            const isManualSmart = Boolean(event.metadata && event.metadata.smartSeriesOrigin === 'manual_activity');

            if (isSmartSeries) {
                card.classList.add('smart-series');
            }
            if (isManualSmart || eventSource === 'Smart Calendar') {
                card.classList.add('manual-event');
            }

            // For short events (< 40px height), only show title
            const isShort = height < 40;
            
            card.innerHTML = `
                ${isSmartSeries ? `
                    <button class="event-edit-btn"
                            data-event-id="${event.id}"
                            title="Edit recurring event"
                            aria-label="Edit recurring event">
                        ✎
                    </button>` : ''}
                <button class="event-delete-btn ${isCanvasEvent ? 'protected' : ''}"
                        data-event-id="${event.id}"
                        data-event-title="${escapeHtml(event.title)}"
                        data-event-source="${eventSource}"
                        title="${isCanvasEvent ? 'Canvas events cannot be deleted here' : 'Delete event'}">
                    ${isCanvasEvent ? '🔒' : '×'}
                </button>
                <span class="event-title">${escapeHtml(event.title)}</span>
                ${!isShort ? `<span class="event-time">${formatTimeRange(event.start, event.end)}</span>` : ''}
                ${!isShort && event.location ? `<span class="event-location">${escapeHtml(event.location)}</span>` : ''}
            `;

            // Add delete button event listener
            const deleteBtn = card.querySelector('.event-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteEvent(
                        deleteBtn.dataset.eventId,
                        deleteBtn.dataset.eventTitle,
                        deleteBtn.dataset.eventSource
                    );
                });
            }

            if (isSmartSeries) {
                const editBtn = card.querySelector('.event-edit-btn');
                if (editBtn) {
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openEditEventModal(event);
                    });
                }
            }

            card.addEventListener('click', (e) => {
                // Don't trigger if clicking delete button
                if (!e.target.classList.contains('event-delete-btn') && !e.target.classList.contains('event-edit-btn')) {
                    selectedDate = new Date(event.start);
                    updateSelectedDayEvents();
                    renderWeekView();
                }
            });
            body.appendChild(card);
        });

        dayColumn.appendChild(header);
        dayColumn.appendChild(body);
        grid.appendChild(dayColumn);

        // Add current time indicator if this is today
        {
            const today = new Date();
            if (sameDay(date, today)) {
                addCurrentTimeIndicator(body);
            }
        }
    });

    updateAllDayEvents();
    // updateWeeklySummaries(); // Hidden per requirements
}

function addCurrentTimeIndicator(dayBody) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const dayStartMinutes = DAY_START_HOUR * 60;
    const dayEndMinutes = DAY_END_HOUR * 60 + (DAY_END_EXTRA_SLOTS * 30);
    
    // Only show if current time is within visible hours
    if (currentMinutes >= dayStartMinutes && currentMinutes <= dayEndMinutes) {
        const minutesSinceStart = currentMinutes - dayStartMinutes;
        const top = minutesSinceStart * (HOUR_HEIGHT / 60);
        
        const timeLine = document.createElement('div');
        timeLine.className = 'current-time-line';
        timeLine.style.top = `${top}px`;
        dayBody.appendChild(timeLine);
        
        // Update every minute
        setTimeout(() => {
            timeLine.remove();
            addCurrentTimeIndicator(dayBody);
        }, 60000);
    }
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

function formatTimeRange(start, end) {
    return `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function updateSelectedDayEvents() {
    const container = document.getElementById('selectedDayEvents');
    container.innerHTML = '';

    const titleEl = document.getElementById('selectedDayTitle');
    titleEl.textContent = `Schedule for ${selectedDate.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    })}`;

    const dateKey = selectedDate.toISOString().split('T')[0];
    const filteredEvents = getFilteredEvents();
    const dayEvents = filteredEvents
        .filter(ev => getEventKey(ev) === dateKey && !ev.allDay) // Exclude all-day events
        .sort((a, b) => a.start - b.start);

    if (dayEvents.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = events.length === 0 ? '📭 No events synced yet. Sync your calendar sources to get started.' : 'No events scheduled for this day.';
        container.appendChild(empty);
        return;
    }

    dayEvents.forEach(event => {
        const row = document.createElement('div');
        row.className = 'event-row';
        row.innerHTML = `
            <span class="row-time">${event.allDay ? 'All day' : formatTimeRange(event.start, event.end)}</span>
            <span class="row-title">${event.title}</span>
            ${event.location ? `<span class="row-location">${event.location}</span>` : ''}
        `;
        container.appendChild(row);
    });
}

function updateUpcomingEvents() {
    const container = document.getElementById('upcomingEvents');
    container.innerHTML = '';
    const now = new Date();

    const filteredEvents = getFilteredEvents();
    const upcoming = filteredEvents
        .filter(ev => ev.start > now && !ev.allDay) // Exclude all-day events
        .sort((a, b) => a.start - b.start)
        .slice(0, 5);

    if (upcoming.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = '📭 No events yet. Click "Sync All Sources" to load your calendar.';
        container.appendChild(empty);
        return;
    }

    upcoming.forEach(event => {
        const row = document.createElement('div');
        row.className = 'event-row';
        row.innerHTML = `
            <span class="row-time">${event.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${formatTimeRange(event.start, event.end)}</span>
            <span class="row-title">${event.title}</span>
            ${event.location ? `<span class="row-location">${event.location}</span>` : ''}
        `;
        container.appendChild(row);
    });
}

function updateWeeklySummaries() {
    const weekDates = getWeekDates(selectedDate);
    const start = weekDates[0];
    const end = weekDates[6];

    const weekEvents = events.filter(ev => ev.start >= start && ev.start <= end);
    const totalMinutes = weekEvents.reduce((sum, ev) => sum + (ev.end - ev.start) / 60000, 0);
    const totalHours = Math.round(totalMinutes / 60);

    document.getElementById('hoursSummary').textContent = `${totalHours} hrs scheduled`;

    const busyBlocks = weekEvents.length;
    const totalSlots = (DAY_END_HOUR - DAY_START_HOUR) * 7;
    const freeSlots = Math.max(totalSlots - busyBlocks, 0);
    document.getElementById('freeSlotsSummary').textContent = `${freeSlots} free slots`;

    document.getElementById('metricTotalHours').textContent = totalHours;
    document.getElementById('metricFreeSlots').textContent = freeSlots;
    document.getElementById('metricSuggestions').textContent = suggestionsCount;
    const efficiency = totalSlots ? Math.min(Math.round((busyBlocks / totalSlots) * 100), 100) : 0;
    document.getElementById('metricEfficiency').textContent = `${efficiency}%`;
}

function changeWeek(delta) {
    selectedDate.setDate(selectedDate.getDate() + delta * 7);
    renderWeekView();
    updateSelectedDayEvents();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadRealEvents(showToastOnError = true) {
    try {
        const response = await fetch(`${API_BASE}/events`);
        const data = await response.json();

        if (data.status !== 'ok') {
            throw new Error(data.error || 'Failed to load events');
        }

        events = (data.events || [])
            .map(parseEvent)
            .filter(Boolean)
            .sort((a, b) => a.start - b.start);

        // Debug: Log all-day vs timed events
        const allDayCount = events.filter(ev => ev.allDay).length;
        const timedCount = events.filter(ev => !ev.allDay).length;
        console.log(`Loaded ${events.length} events: ${timedCount} timed, ${allDayCount} all-day`);
        
        // Debug: Log sample of all-day events to check if holidays are included
        const sampleAllDay = events.filter(ev => ev.allDay).slice(0, 5);
        if (sampleAllDay.length > 0) {
            console.log('Sample all-day events:', sampleAllDay.map(ev => ev.title));
        }

        // Save to localStorage for persistence across refreshes
        saveEventsToCache(data.events);

        updateCourseFilters(); // Extract and initialize course filters
        renderWeekView();
        updateSelectedDayEvents();
        updateUpcomingEvents();
        updateAllDayEvents();
        return { success: true };
    } catch (error) {
        console.error('Failed to load events:', error);
        if (showToastOnError) {
            showToast('ingestResult', `Failed to load events: ${error.message}`, true);
        }
        return { success: false, error };
    }
}

// ---------------------------------------------------------------------------
// Event Caching (localStorage for persistence)
// ---------------------------------------------------------------------------

function saveEventsToCache(rawEvents) {
    try {
        const cacheData = {
            events: rawEvents,
            timestamp: new Date().toISOString(),
            version: '1.0'
        };
        localStorage.setItem('smartcal_events_cache', JSON.stringify(cacheData));
        localStorage.setItem('smartcal_last_sync', new Date().toISOString());
        console.log('Events cached to localStorage');
    } catch (error) {
        console.warn('Failed to cache events:', error);
    }
}

function loadEventsFromCache() {
    try {
        const cached = localStorage.getItem('smartcal_events_cache');
        if (!cached) return null;

        const cacheData = JSON.parse(cached);
        const cacheAge = Date.now() - new Date(cacheData.timestamp).getTime();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        // Return cached data even if old (better than nothing)
        // Background sync will update it
        if (cacheAge < maxAge) {
            console.log(`Loaded ${cacheData.events.length} events from cache (${Math.round(cacheAge / 60000)} minutes old)`);
        } else {
            console.log(`Loaded ${cacheData.events.length} events from cache (stale, will refresh in background)`);
        }

        return cacheData.events;
    } catch (error) {
        console.warn('Failed to load cache:', error);
        return null;
    }
}

function getLastSyncTime() {
    try {
        const lastSync = localStorage.getItem('smartcal_last_sync');
        if (lastSync) {
            const syncDate = new Date(lastSync);
            const minutesAgo = Math.round((Date.now() - syncDate.getTime()) / 60000);
            return `${minutesAgo} min ago`;
        }
    } catch (error) {
        return 'Never';
    }
    return 'Never';
}

// ---------------------------------------------------------------------------
// Voice & AI actions
// ---------------------------------------------------------------------------

function initVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        document.getElementById('voiceSupport').textContent = 'Unsupported';
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isRecording = true;
        document.getElementById('micIcon').textContent = '⏺️';
        document.getElementById('voiceStatus').textContent = 'Listening...';
    };

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0])
            .map(result => result.transcript)
            .join('');
        document.getElementById('voiceInput').value = transcript;
    };

    recognition.onend = () => {
        isRecording = false;
        document.getElementById('micIcon').textContent = '🎤';
        document.getElementById('voiceStatus').textContent = 'Tap to start recording again.';
    };

    recognition.onerror = (event) => {
        isRecording = false;
        document.getElementById('micIcon').textContent = '🎤';
        document.getElementById('voiceStatus').textContent = `Error: ${event.error}`;
    };

    document.getElementById('voiceSupport').textContent = 'Supported';
}

function toggleVoiceRecognition() {
    if (!recognition) {
        initVoiceRecognition();
        if (!recognition) return;
    }

    if (isRecording) {
        recognition.stop();
    } else {
        recognition.start();
    }
}

async function addRecurringEvent() {
    const input = document.getElementById('voiceInput').value;
    if (!input.trim()) {
        showToast('voiceResult', 'Please describe the event you want to create.', true);
        return;
    }

    // Show loading state
    const resultContainer = document.getElementById('voiceResult');
    resultContainer.classList.add('show');
    resultContainer.innerHTML = `
        <div class="proposal-message" style="text-align: center; padding: 2rem;">
            <div style="font-size: 2rem; margin-bottom: 1rem;">🤖</div>
            <div>AI is analyzing your request and finding free time slots...</div>
        </div>
    `;

    try {
        const response = await apiCall('/voice/add', { text: input });

        // Extract the actual result from the API response
        const result = response.result || response;

        if (result.requires_confirmation && result.proposals) {
            // Show proposal selection UI
            displayProposalSelection(result);
            showToast('ingestResult', 'Suggestions generated! Select your preferred time slots below.', false);
        } else if (result.reply) {
            // Show direct response
            resultContainer.innerHTML = `<div class="proposal-message">${escapeHtml(result.reply)}</div>`;
            showToast('ingestResult', result.reply, !result.handled);
        } else {
            // Fallback: show JSON for debugging
            resultContainer.innerHTML = `<pre>${JSON.stringify(result, null, 2)}</pre>`;
            showToast('ingestResult', 'Request processed.', false);
        }
    } catch (error) {
        resultContainer.innerHTML = '';
        resultContainer.classList.remove('show');
        showToast('voiceResult', `Failed to submit request: ${error.message}`, true);
    }
}

function displayProposalSelection(result) {
    const container = document.getElementById('voiceResult');
    container.classList.add('show');

    let html = `<div class="proposal-selection">`;
    html += `<h3>📅 Select Time Slots</h3>`;
    html += `<p class="proposal-message">${escapeHtml(result.reply)}</p>`;
    html += `<div class="proposal-list" id="proposalList">`;

    result.proposals.forEach((proposal, index) => {
        // Parse the time to get start and end times
        const startTime = proposal.time || '9:00 AM';

        html += `
            <div class="proposal-option" id="proposal-${index}" data-index="${index}">
                <input type="checkbox" data-index="${index}" class="proposal-checkbox" onchange="toggleProposalSelection(${index})">
                <div class="proposal-time">
                    <span class="proposal-day">${escapeHtml(proposal.day)}</span>
                    <span class="proposal-time-display">${escapeHtml(startTime)}</span>
                </div>
                <div class="proposal-adjust">
                    <input type="time" class="time-input" id="time-${index}" value="${convertTo24Hour(startTime)}" title="Adjust time">
                </div>
            </div>
        `;
    });

    html += `</div>`;
    html += `<div class="proposal-actions">`;
    html += `<span class="proposal-count" id="proposalCount">0 selected</span>`;
    html += `<div class="proposal-buttons">`;
    html += `<button class="btn btn-secondary" onclick="cancelProposals()">Cancel</button>`;
    html += `<button class="btn btn-primary" onclick="confirmProposals('${result.session_id}')">Add to Calendar</button>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    container.innerHTML = html;

    // Store session data for later use
    window.currentProposalSession = {
        session_id: result.session_id,
        proposals: result.proposals
    };
}

function toggleProposalSelection(index) {
    const option = document.getElementById(`proposal-${index}`);
    const checkbox = option.querySelector('input[type="checkbox"]');

    if (checkbox.checked) {
        option.classList.add('selected');
    } else {
        option.classList.remove('selected');
    }

    updateProposalCount();
}

function updateProposalCount() {
    const checkboxes = document.querySelectorAll('.proposal-checkbox:checked');
    const count = checkboxes.length;
    const countEl = document.getElementById('proposalCount');
    if (countEl) {
        countEl.textContent = `${count} selected`;
    }
}

function convertTo24Hour(time12h) {
    // Convert "9:00 AM" to "09:00"
    const match = time12h.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return '09:00';

    let [, hours, minutes, period] = match;
    hours = parseInt(hours);

    if (period.toUpperCase() === 'PM' && hours !== 12) {
        hours += 12;
    } else if (period.toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
    }

    return `${String(hours).padStart(2, '0')}:${minutes}`;
}

async function confirmProposals(sessionId) {
    const checkboxes = document.querySelectorAll('.proposal-checkbox:checked');
    const selectedIndices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));

    if (selectedIndices.length === 0) {
        showToast('voiceResult', 'Please select at least one time slot.', true);
        return;
    }

    // Collect adjusted times if any
    const adjustedTimes = {};
    selectedIndices.forEach(index => {
        const timeInput = document.getElementById(`time-${index}`);
        if (timeInput && timeInput.value) {
            adjustedTimes[index] = timeInput.value;
        }
    });

    try {
        const result = await apiCall('/confirm', {
            session_id: sessionId,
            selected_indices: selectedIndices,
            adjusted_times: adjustedTimes
        });

        if (result.result?.handled) {
            document.getElementById('voiceResult').innerHTML = `
                <div class="confirmation-success">
                    <h3>✓ Success!</h3>
                    <p>${escapeHtml(result.result.reply)}</p>
                </div>
            `;
            showToast('ingestResult', result.result.reply, false);

            // Refresh calendar to show new events
            await loadRealEvents();

            // Clear input after a delay
            setTimeout(() => {
                document.getElementById('voiceInput').value = '';
                document.getElementById('voiceResult').innerHTML = '';
                document.getElementById('voiceResult').classList.remove('show');
            }, 3000);
        } else {
            const reason = result.result?.reason || result.reason || 'Failed to confirm events.';
            showToast('voiceResult', reason, true);
        }
    } catch (error) {
        showToast('voiceResult', `Failed to confirm: ${error.message}`, true);
    }
}

function cancelProposals() {
    document.getElementById('voiceResult').innerHTML = '';
    document.getElementById('voiceResult').classList.remove('show');
}

async function suggestTime() {
    // Redirect to addRecurringEvent for consistency
    return await addRecurringEvent();
}

// ---------------------------------------------------------------------------
// Sync flows
// ---------------------------------------------------------------------------

function updateLastSync() {
    const now = new Date();
    document.getElementById('lastSync').textContent = now.toLocaleTimeString();
    localStorage.setItem('smartcal_last_sync', now.toISOString());
}

async function ingestGmail(evt) {
    const btn = evt?.target;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await apiCall('/ingest/gmail', {});
        summarizeSyncResult('Gmail', result);
        updateLastSync();
        await loadRealEvents();
    } catch (error) {
        showToast('ingestResult', `Gmail sync failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function ingestCanvas(evt) {
    const btn = evt?.target;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await apiCall('/ingest/canvas', {});
        summarizeSyncResult('Canvas', result);
        updateLastSync();
        await loadRealEvents();
    } catch (error) {
        showToast('ingestResult', `Canvas sync failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function ingestIcs(evt) {
    const btn = evt?.target;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await apiCall('/ingest/ics', {});
        summarizeSyncResult('ICS', result);
        updateLastSync();
        await loadRealEvents();
    } catch (error) {
        showToast('ingestResult', `ICS sync failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function ingestOutlook(evt) {
    const btn = evt?.target;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await apiCall('/ingest/outlook', {});
        summarizeSyncResult('Outlook', result);
        updateLastSync();
        await loadRealEvents();
    } catch (error) {
        showToast('ingestResult', `Outlook sync failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function refreshGoogleCalendar(evt) {
    const btn = evt?.target || null;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await loadRealEvents();
        if (result?.success) {
            showToast('ingestResult', 'Google Calendar refreshed.', false);
            updateLastSync();
        } else {
            showToast('ingestResult', 'Failed to refresh Google Calendar.', true);
        }
    } catch (error) {
        showToast('ingestResult', `Google refresh failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function syncAll(evt) {
    const btn = evt?.target;
    if (btn) {
        btn.classList.add('loading');
        btn.disabled = true;
    }

    try {
        const result = await apiCall('/sync/all', {});
        summarizeMultiSync(result);
        updateLastSync();
        await loadRealEvents();
    } catch (error) {
        showToast('ingestResult', `Sync failed: ${error.message}`, true);
    } finally {
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }
}

async function autoSyncOnLoad() {
    try {
        // Silently sync Canvas and Google Calendar in the background
        console.log('Auto-syncing Canvas...');
        const canvasResult = await apiCall('/ingest/canvas', {}).catch(e => {
            console.warn('Canvas sync failed:', e);
            return null;
        });
        
        console.log('Auto-syncing Google Calendar...');
        // Just reload events (which includes Google Calendar)
        const loadResult = await loadRealEvents(false); // Don't show error toast
        
        if (loadResult.success) {
            console.log('✅ Auto-sync complete');
            showToast('ingestResult', '✅ Calendar synced with Canvas & Google', false, 3000);
            updateLastSync();
        } else {
            console.warn('Auto-sync had issues, but using cached data');
            showToast('ingestResult', '⚠️ Sync issue - showing cached data', true, 3000);
        }
    } catch (error) {
        console.error('Auto-sync failed:', error);
        // Don't show error toast - user already has cached data
        showToast('ingestResult', '⚠️ Could not refresh - using cached data', true, 3000);
    }
}

function toggleAutoSync() {
    const toggle = document.getElementById('autoSyncToggle');
    const intervalSelect = document.getElementById('syncInterval');
    autoSyncIntervalMinutes = parseInt(intervalSelect.value, 10);

    if (toggle.checked) {
        intervalSelect.disabled = false;
        startAutoSync();
        document.getElementById('autoSyncStatus').textContent = '🟢 On';
        localStorage.setItem('autoSyncEnabled', 'true');
    } else {
        stopAutoSync();
        intervalSelect.disabled = true;
        document.getElementById('autoSyncStatus').textContent = '⚫ Off';
        document.getElementById('nextSync').textContent = 'Auto-sync disabled';
        localStorage.setItem('autoSyncEnabled', 'false');
    }
}

function updateSyncInterval() {
    autoSyncIntervalMinutes = parseInt(document.getElementById('syncInterval').value, 10);
    localStorage.setItem('autoSyncInterval', autoSyncIntervalMinutes.toString());
    if (autoSyncTimer) {
        startAutoSync();
    }
}

function startAutoSync() {
    stopAutoSync();
    performAutoSync();
    autoSyncTimer = setInterval(performAutoSync, autoSyncIntervalMinutes * 60 * 1000);
    updateNextSyncTime();
}

function stopAutoSync() {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }
}

async function performAutoSync() {
    try {
        const result = await apiCall('/sync/all', {});
        summarizeMultiSync(result);
        updateLastSync();
        updateNextSyncTime();
        await loadRealEvents();
    } catch (error) {
        console.error('Auto-sync failed:', error);
    }
}

function updateNextSyncTime() {
    if (!autoSyncTimer) return;
    const next = new Date(Date.now() + autoSyncIntervalMinutes * 60 * 1000);
    document.getElementById('nextSync').textContent = `Next sync: ${next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

// ---------------------------------------------------------------------------
// Status & bootstrap
// ---------------------------------------------------------------------------

async function checkApiStatus() {
    try {
        const response = await fetch('/docs');
        document.getElementById('apiStatus').textContent = response.ok ? '🟢 Online' : '🟡 Degraded';
    } catch (error) {
        document.getElementById('apiStatus').textContent = '🔴 Offline';
    }
}

function loadSampleEvents() {
    // No sample events - start with a clean slate
    const today = new Date();
    selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    events = [];

    renderWeekView();
    updateSelectedDayEvents();
    updateUpcomingEvents();
}

document.addEventListener('DOMContentLoaded', async () => {
    // Handle OAuth callback first
    handleAuthCallback();

    // Check authentication status
    const authenticated = await checkAuthStatus();

    if (!authenticated) {
        // Show login screen if not authenticated
        showLoginScreen();
        return;
    }

    // User is authenticated - continue with normal initialization
    hideLoginScreen();

    renderTimeColumn();
    checkApiStatus();
    initVoiceRecognition();
    await loadAcademicCalendarPresets();
    initializeRepeatControls();
    initializeTimeZoneUI();
    loadUserCalendarSources();  // Load per-user calendar sources

    // Try to load cached events first (instant display)
    const cachedEvents = loadEventsFromCache();
    if (cachedEvents && cachedEvents.length > 0) {
        // Display cached events immediately
        events = cachedEvents
            .map(parseEvent)
            .filter(Boolean)
            .sort((a, b) => a.start - b.start);

        console.log(`Displaying ${events.length} cached events (syncing in background...)`);
        updateCourseFilters();
        renderWeekView();
        updateSelectedDayEvents();
        updateUpcomingEvents();
        updateAllDayEvents();

        // Show when data was last synced
        const lastSync = getLastSyncTime();
        showToast('ingestResult', `📋 Showing cached data (last sync: ${lastSync}). Refreshing...`, false, 3000);
    } else {
        // No cache, start with empty
        loadSampleEvents();
        updateSelectedDayEvents();
        updateUpcomingEvents();
        showToast('ingestResult', '🔄 Loading events for the first time...', false, 2000);
    }

    // Auto-sync in background (refresh data from server)
    setTimeout(async () => {
        console.log('🔄 Auto-syncing Canvas and Google Calendar...');
        await autoSyncOnLoad();
    }, 1000); // Wait 1 second after page load to not block initial render

    document.getElementById('voiceInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            suggestTime();
        }
    });

    const savedInterval = localStorage.getItem('autoSyncInterval');
    if (savedInterval) {
        autoSyncIntervalMinutes = parseInt(savedInterval, 10);
        document.getElementById('syncInterval').value = savedInterval;
    }

    const savedAutoSync = localStorage.getItem('autoSyncEnabled');
    if (savedAutoSync === 'true') {
        const toggle = document.getElementById('autoSyncToggle');
        toggle.checked = true;
        document.getElementById('syncInterval').disabled = false;
        startAutoSync();
        document.getElementById('autoSyncStatus').textContent = '🟢 On';
    }
});

// ---------------------------------------------------------------------------
// Course Filtering
// ---------------------------------------------------------------------------

function extractCourseCode(title) {
    // Extract course codes from various formats:
    // - "[DPI 851M]" (all-day event format) → "DPI 851M"
    // - "XXX Y111: Course Name" → "XXX Y111"
    // - "XXX 111Y: Course Name" → "XXX 111Y"
    // - "[Canvas] XXX Y111: Course Name" → "XXX Y111"
    // - "XXX Y111 - Assignment" → "XXX Y111"

    // Special pattern for all-day events: "[DPI 851M]" format
    const allDayPattern = title.match(/^\[([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?)\]$/i);
    if (allDayPattern) {
        const code = allDayPattern[1].toUpperCase();
        // Don't filter HW here - these are course names in brackets
        return code;
    }

    // Remove source prefix like [Canvas], [Harvard Canvas], etc. (but not course codes in brackets)
    let cleanTitle = title.replace(/^\[(Harvard Canvas|MIT Canvas|Canvas|[^\]]+)\]\s*/, '');

    // Pattern 1: Three letters + space + letter/number combo (e.g., "DPI 851M", "EDU H12X", "EDU T564A")
    // Matches: XXX Y111, XXX 111Y, XXX 851M, etc.
    const pattern1 = cleanTitle.match(/^([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?)/i);
    if (pattern1) {
        const code = pattern1[1].toUpperCase();
        // Filter out homework numbers like "HW 1", "HW 2", etc.
        if (!code.match(/^HW\s+\d+$/i) && !code.match(/^HOMEWORK\s+\d+$/i)) {
            return code;
        }
    }

    // Pattern 2: After removing prefix, look for course code followed by colon
    // e.g., "XXX Y111: Assignment Name"
    const pattern2 = cleanTitle.match(/^([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?):/i);
    if (pattern2) {
        const code = pattern2[1].toUpperCase();
        if (!code.match(/^HW\s+\d+$/i) && !code.match(/^HOMEWORK\s+\d+$/i)) {
            return code;
        }
    }

    // Pattern 3: Course code followed by dash or hyphen
    // e.g., "XXX Y111 - Assignment"
    const pattern3 = cleanTitle.match(/^([A-Z]{2,4}\s+[A-Z]?\d+[A-Z]?)\s*[-–—]/i);
    if (pattern3) {
        const code = pattern3[1].toUpperCase();
        if (!code.match(/^HW\s+\d+$/i) && !code.match(/^HOMEWORK\s+\d+$/i)) {
            return code;
        }
    }

    return null;
}

function updateCourseFilters() {
    // Extract unique courses from events
    const courses = new Set();
    events.forEach(event => {
        const code = extractCourseCode(event.title);
        if (code) {
            courses.add(code);
        } else {
            // Debug: log titles that don't match
            console.log('No course code found in:', event.title);
        }
    });

    console.log('All extracted course codes:', Array.from(courses));
    allCourses = Array.from(courses).sort();

    // Initialize filters - exclude DPI 851M by default per requirements
    if (courseFilters.size === 0) {
        allCourses.forEach(course => {
            if (course !== 'DPI 851M') {
                courseFilters.add(course);
            }
        });
    }

    // Render course checkboxes
    const container = document.getElementById('courseFilterList');
    if (!container) return;

    container.innerHTML = '';
    allCourses.forEach(course => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = courseFilters.has(course);
        checkbox.onchange = () => toggleCourseFilter(course);

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${course}`));
        container.appendChild(label);
    });
}

function toggleCourseFilter(course) {
    if (courseFilters.has(course)) {
        courseFilters.delete(course);
    } else {
        courseFilters.add(course);
    }
    renderWeekView();
    updateSelectedDayEvents();
    updateUpcomingEvents();
    updateAllDayEvents();
}

function selectAllCourses(selectAll) {
    if (selectAll) {
        allCourses.forEach(course => courseFilters.add(course));
    } else {
        courseFilters.clear();
    }
    updateCourseFilters();
    renderWeekView();
    updateSelectedDayEvents();
    updateUpcomingEvents();
    updateAllDayEvents();
}

function getFilteredEvents() {
    // Since course filters are hidden, always show all events
    return events;
    
    // Old logic (kept for reference if filters are re-enabled):
    // if (courseFilters.size === 0) {
    //     return events; // Show all if nothing selected
    // }
    // return events.filter(event => {
    //     const code = extractCourseCode(event.title);
    //     if (!code) return true; // Show events without course codes
    //     return courseFilters.has(code);
    // });
}

// ---------------------------------------------------------------------------
// All-Day Event Handling
// ---------------------------------------------------------------------------

function updateAllDayEvents() {
    const filteredEvents = getFilteredEvents();

    // Update right panel all-day section
    const banner = document.getElementById('allDayBanner');
    const bannerContainer = document.getElementById('allDayEvents');

    if (!banner || !bannerContainer) return;

    const weekDates = getWeekDates(selectedDate);
    const weekStart = weekDates[0];
    const weekEnd = new Date(weekDates[6]);
    weekEnd.setHours(23, 59, 59, 999);

    // Get ALL all-day events in the week (before day filtering)
    const allAllDayEventsInWeek = filteredEvents.filter(ev => {
        if (!ev.allDay) return false;
        if (ev.start < weekStart || ev.start > weekEnd) return false;
        return true;
    });

    // If there are NO all-day events at all in the week, hide the section
    if (allAllDayEventsInWeek.length === 0) {
        banner.style.display = 'none';
        return;
    }

    // Always show the section if there are any all-day events in the week
    banner.style.display = 'block';

    // Filter by selected days (Mon=0, Sun=6)
    const allDayEvents = allAllDayEventsInWeek.filter(ev => {
        const dayOfWeek = (ev.start.getDay() + 6) % 7; // Convert Sun=0 to Mon=0 format
        return activeDayFilters.has(dayOfWeek);
    });

    if (allDayEvents.length > 0) {
        // Sort by date
        const sortedEvents = allDayEvents.sort((a, b) => a.start - b.start);
        bannerContainer.innerHTML = sortedEvents.map(ev => {
            const dayOfWeek = (ev.start.getDay() + 6) % 7;
            const dayName = DAY_NAMES[dayOfWeek];
            const fullTitle = `${escapeHtml(ev.title)}\n${ev.start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
            // Show delete button for non-Canvas events
            const canDelete = !ev.source.includes('Canvas');
            const deleteBtn = canDelete
                ? `<button class="all-day-delete-btn" onclick="deleteEvent('${ev.id}', '${escapeHtml(ev.title).replace(/'/g, "\\'")}', '${ev.source}')" title="Delete event">×</button>`
                : '';
            return `
                <div class="all-day-event-card${canDelete ? ' deletable' : ''}">
                    <span class="event-date">${dayName}<br>${ev.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span class="event-title" title="${fullTitle}">${escapeHtml(ev.title)}</span>
                    ${deleteBtn}
                </div>
            `;
        }).join('');
    } else {
        // Show message when all days are filtered out
        bannerContainer.innerHTML = '<div class="empty-state">Select days above to see events</div>';
    }
}

function filterAllDayByDay(dayIndex) {
    // Toggle the day filter
    if (activeDayFilters.has(dayIndex)) {
        activeDayFilters.delete(dayIndex);
    } else {
        activeDayFilters.add(dayIndex);
    }

    // Update UI - toggle active class on the button
    const buttons = document.querySelectorAll('.day-dot');
    buttons.forEach(btn => {
        const day = parseInt(btn.dataset.day);
        if (activeDayFilters.has(day)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Refresh the all-day events display
    updateAllDayEvents();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Manual Event Creation Modal
// ---------------------------------------------------------------------------

function showAddEventModal() {
    const modal = document.getElementById('addEventModal');
    modal.style.display = 'flex';
    populateTimeZoneSelect();
    
    // Set default date to today or selected date
    const dateInput = document.getElementById('eventDate');
    const dateToUse = selectedDate || new Date();
    dateInput.value = dateToUse.toISOString().split('T')[0];
    
    // Clear previous values
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventLocation').value = '';
    document.getElementById('eventDescription').value = '';
    document.getElementById('eventAllDay').checked = false;
    document.getElementById('timeFields').style.display = 'grid';
    document.getElementById('eventTimeZone').value = userTimeZone;
    updateEventTimeConversionPreview();
    
    resetRecurrenceForm(dateToUse);
    handleRepeatFrequencyChange();
    handleRepeatUntilTypeChange();
    
    // Focus title field
    setTimeout(() => document.getElementById('eventTitle').focus(), 100);
}

function hideAddEventModal() {
    document.getElementById('addEventModal').style.display = 'none';
    resetRecurrenceForm();
}

function toggleEventTime() {
    const isAllDay = document.getElementById('eventAllDay').checked;
    document.getElementById('timeFields').style.display = isAllDay ? 'none' : 'grid';
    updateEventTimeConversionPreview();
}

async function loadAcademicCalendarPresets() {
    try {
        const response = await fetch(`${API_BASE}/calendar/presets`, {
            method: 'GET',
        });
        const data = await response.json();
        if (response.ok && data.status === 'ok') {
            academicCalendarPresets = {
                termName: data.presets.term_name || null,
                termEndDate: data.presets.term_end_date || null,
                holidays: Array.isArray(data.presets.holidays) ? data.presets.holidays : [],
            };
            populateHolidayPresets();
        } else {
            console.warn('Failed to load academic calendar presets', data);
        }
    } catch (error) {
        console.warn('Academic calendar presets unavailable', error);
    }
}

function initializeRepeatControls() {
    const dayButtons = document.querySelectorAll('.repeat-day-toggle');
    dayButtons.forEach((button) => {
        button.addEventListener('click', () => {
            button.classList.toggle('active');
        });
    });

    const frequencySelect = document.getElementById('repeatFrequency');
    if (frequencySelect) {
        frequencySelect.addEventListener('change', handleRepeatFrequencyChange);
    }

    renderExceptionChips();
    populateHolidayPresets();
    handleRepeatFrequencyChange();
    handleRepeatUntilTypeChange();
}

function toggleRepeatOptions(event) {
    const enabled = event.target.checked;
    const container = document.getElementById('repeatOptions');
    if (!container) return;
    container.style.display = enabled ? 'grid' : 'none';

    if (enabled) {
        const dateInput = document.getElementById('eventDate');
        const referenceDate = dateInput && dateInput.value ? new Date(`${dateInput.value}T00:00:00`) : new Date();
        if (!document.querySelector('.repeat-day-toggle.active')) {
            setRepeatDefaults(referenceDate);
        }
        handleRepeatFrequencyChange();
        handleRepeatUntilTypeChange();
    }
}

function handleRepeatFrequencyChange() {
    const frequency = document.getElementById('repeatFrequency')?.value || 'weekly';
    const dayRow = document.getElementById('repeatDayPickerRow');
    const intervalInput = document.getElementById('repeatInterval');
    if (!dayRow) return;

    if (intervalInput) {
        if (frequency === 'biweekly') {
            intervalInput.value = 1;
            intervalInput.disabled = true;
        } else {
            intervalInput.disabled = false;
        }
    }

    if (frequency === 'weekly' || frequency === 'biweekly') {
        dayRow.style.display = 'grid';
    } else {
        dayRow.style.display = 'none';
    }
}

function setRepeatDefaults(referenceDate) {
    const buttons = document.querySelectorAll('.repeat-day-toggle');
    buttons.forEach(btn => btn.classList.remove('active'));

    if (referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())) {
        const dayTokens = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const token = dayTokens[referenceDate.getDay()];
        const defaultButton = document.querySelector(`.repeat-day-toggle[data-day="${token}"]`);
        if (defaultButton) {
            defaultButton.classList.add('active');
        }

        const defaultUntil = new Date(referenceDate);
        defaultUntil.setMonth(defaultUntil.getMonth() + 1);
        const untilInput = document.getElementById('repeatUntilDate');
        if (untilInput && !academicCalendarPresets.termEndDate) {
            untilInput.value = toLocalISODate(defaultUntil);
        }
    }

    if (academicCalendarPresets.termEndDate) {
        const untilInput = document.getElementById('repeatUntilDate');
        if (untilInput && !untilInput.value) {
            untilInput.value = academicCalendarPresets.termEndDate;
        }
    }
}

function handleRepeatUntilTypeChange() {
    const select = document.getElementById('repeatUntilType');
    const dateInput = document.getElementById('repeatUntilDate');
    if (!select || !dateInput) return;

    if (select.value === 'end_of_semester') {
        dateInput.disabled = true;
        if (academicCalendarPresets.termEndDate) {
            dateInput.value = academicCalendarPresets.termEndDate;
        }
    } else {
        dateInput.disabled = false;
        if (!dateInput.value && academicCalendarPresets.termEndDate) {
            dateInput.value = academicCalendarPresets.termEndDate;
        }
    }
}

function populateHolidayPresets() {
    const select = document.getElementById('exceptionPresetSelect');
    if (!select) return;

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Add holiday...';
    defaultOption.selected = true;

    const fragment = document.createDocumentFragment();
    fragment.appendChild(defaultOption);

    if (Array.isArray(academicCalendarPresets.holidays)) {
        academicCalendarPresets.holidays.forEach((holiday, index) => {
            const startLabel = formatDateForLabel(holiday.start);
            const endLabel = holiday.end && holiday.end !== holiday.start ? formatDateForLabel(holiday.end) : null;
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = endLabel ? `${holiday.name} (${startLabel} – ${endLabel})` : `${holiday.name} (${startLabel})`;
            fragment.appendChild(option);
        });
    }

    select.innerHTML = '';
    select.appendChild(fragment);
}

function handleExceptionPresetChange(value) {
    if (value === '') return;
    const index = parseInt(value, 10);
    if (Number.isNaN(index)) return;
    const holiday = academicCalendarPresets.holidays[index];
    if (!holiday) return;

    addException({
        start: holiday.start,
        end: holiday.end || holiday.start,
        label: holiday.name,
        source: 'holiday',
    });

    document.getElementById('exceptionPresetSelect').value = '';
}

function addManualException() {
    const start = document.getElementById('exceptionStartDate')?.value;
    const end = document.getElementById('exceptionEndDate')?.value;

    if (!start) {
        showToast('voiceResult', 'Select a start date to skip.', true);
        return;
    }

    if (end && end < start) {
        showToast('voiceResult', 'Skip end date must be after the start date.', true);
        return;
    }

    const label = end && end !== start
        ? `${formatDateForLabel(start)} – ${formatDateForLabel(end)}`
        : `${formatDateForLabel(start)}`;

    addException({
        start,
        end: end || start,
        label,
        source: 'manual',
    });

    document.getElementById('exceptionStartDate').value = '';
    document.getElementById('exceptionEndDate').value = '';
}

function addException(exception) {
    if (!exception || !exception.start) {
        return;
    }

    const duplicate = recurrenceExceptions.some(
        existing => existing.start === exception.start && (existing.end || existing.start) === (exception.end || exception.start),
    );
    if (duplicate) {
        showToast('voiceResult', 'That skip is already listed.', true);
        return;
    }

    recurrenceExceptions.push({
        id: `exc-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        ...exception,
    });
    renderExceptionChips();
}

function removeException(id) {
    recurrenceExceptions = recurrenceExceptions.filter(exception => exception.id !== id);
    renderExceptionChips();
}

function renderExceptionChips() {
    const container = document.getElementById('exceptionList');
    if (!container) return;

    if (!recurrenceExceptions.length) {
        container.innerHTML = '<span class="exception-placeholder">No skipped weeks or days yet.</span>';
        return;
    }

    container.innerHTML = '';
    recurrenceExceptions.forEach((exception) => {
        const chip = document.createElement('span');
        chip.className = 'exception-chip';
        const label = document.createElement('span');
        label.textContent = exception.label;
        chip.appendChild(label);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'chip-remove';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', `Remove exception ${exception.label}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeException(exception.id));
        chip.appendChild(removeBtn);

        container.appendChild(chip);
    });
}

function createDateFromISODate(isoString) {
    if (!isoString || typeof isoString !== 'string') return null;
    const parts = isoString.split('-').map(part => parseInt(part, 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        return null;
    }
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
}

function toLocalISODate(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
        return '';
    }
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateForLabel(input) {
    if (!input) return '';
    const dateObj = createDateFromISODate(input);
    if (!dateObj || Number.isNaN(dateObj.getTime())) {
        return input;
    }
    return dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function resetRecurrenceForm(referenceDate = null) {
    const toggle = document.getElementById('eventRepeatToggle');
    if (toggle) {
        toggle.checked = false;
    }

    const container = document.getElementById('repeatOptions');
    if (container) {
        container.style.display = 'none';
    }

    const intervalInput = document.getElementById('repeatInterval');
    if (intervalInput) {
        intervalInput.value = 1;
        intervalInput.disabled = false;
    }

    const frequencySelect = document.getElementById('repeatFrequency');
    if (frequencySelect) {
        frequencySelect.value = 'weekly';
    }

    const untilType = document.getElementById('repeatUntilType');
    if (untilType) {
        untilType.value = 'date';
    }

    const untilDate = document.getElementById('repeatUntilDate');
    if (untilDate) {
        untilDate.disabled = false;
        untilDate.value = '';
    }

    recurrenceExceptions = [];
    renderExceptionChips();

    document.querySelectorAll('.repeat-day-toggle').forEach(btn => btn.classList.remove('active'));

    if (referenceDate) {
        setRepeatDefaults(referenceDate);
    }
}

function openEditEventModal(event) {
    if (!event) return;
    editingEventContext = {
        id: event.id,
        title: event.title,
        location: event.location || '',
        description: event.description || '',
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.allDay,
        metadata: event.metadata || {},
    };

    const modal = document.getElementById('editEventModal');
    if (!modal) return;
    modal.style.display = 'flex';

    document.getElementById('editEventTitle').value = event.title;
    document.getElementById('editEventLocation').value = event.location || '';
    document.getElementById('editEventDescription').value = event.description || '';
    document.getElementById('editEventDate').value = toLocalISODate(editingEventContext.start);
    const startInput = document.getElementById('editEventStart');
    const endInput = document.getElementById('editEventEnd');
    if (startInput) {
        startInput.value = formatTimeForInput(editingEventContext.start);
        startInput.disabled = editingEventContext.allDay;
    }
    if (endInput) {
        endInput.value = formatTimeForInput(editingEventContext.end);
        endInput.disabled = editingEventContext.allDay;
    }

    const singleScope = document.querySelector('input[name="editScope"][value="single"]');
    const futureScope = document.querySelector('input[name="editScope"][value="future"]');
    if (singleScope) {
        singleScope.checked = true;
    }
    if (futureScope) {
        const hasSeriesParent = Boolean(event.metadata && event.metadata.smartSeriesParent);
        futureScope.disabled = !hasSeriesParent;
        if (!hasSeriesParent) {
            futureScope.checked = false;
        }
    }

    const seriesInfo = document.getElementById('editSeriesContext');
    if (seriesInfo) {
        if (event.metadata && event.metadata.smartSeriesParent) {
            seriesInfo.textContent = `Series ID: ${event.metadata.smartSeriesParent}`;
            seriesInfo.style.display = 'block';
        } else {
            seriesInfo.style.display = 'none';
        }
    }

    setTimeout(() => document.getElementById('editEventTitle').focus(), 100);
}

function closeEditEventModal() {
    const modal = document.getElementById('editEventModal');
    if (modal) {
        modal.style.display = 'none';
    }
    editingEventContext = null;
}

function formatTimeForInput(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
        return '00:00';
    }
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function combineDateAndTime(dateObj, timeValue) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
        return null;
    }
    if (!timeValue || typeof timeValue !== 'string' || !timeValue.includes(':')) {
        return null;
    }
    const [hoursStr, minutesStr] = timeValue.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        return null;
    }
    const combined = new Date(dateObj);
    combined.setHours(hours, minutes, 0, 0);
    return combined;
}

async function submitEditEvent() {
    if (!editingEventContext) {
        return;
    }

    const title = document.getElementById('editEventTitle').value.trim();
    const location = document.getElementById('editEventLocation').value.trim();
    const description = document.getElementById('editEventDescription').value.trim();
    const startTimeInput = document.getElementById('editEventStart');
    const endTimeInput = document.getElementById('editEventEnd');
    const startTimeValue = startTimeInput ? startTimeInput.value : '';
    const endTimeValue = endTimeInput ? endTimeInput.value : '';
    const scope = document.querySelector('input[name="editScope"]:checked')?.value || 'single';

    if (!title) {
        showToast('ingestResult', 'Please provide a title for the event.', true);
        return;
    }

    let startDateTime = editingEventContext.start;
    let endDateTime = editingEventContext.end;

    if (!editingEventContext.allDay) {
        if (!startTimeValue || !endTimeValue) {
            showToast('ingestResult', 'Start and end times are required.', true);
            return;
        }

        startDateTime = combineDateAndTime(editingEventContext.start, startTimeValue);
        endDateTime = combineDateAndTime(editingEventContext.start, endTimeValue);

        if (!startDateTime || !endDateTime) {
            showToast('ingestResult', 'Unable to parse the provided times.', true);
            return;
        }

        if (endDateTime <= startDateTime) {
            showToast('ingestResult', 'End time must be after the start time.', true);
            return;
        }
    }

    const payload = {
        event_id: editingEventContext.id,
        scope,
        summary: title,
        location,
        description,
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        all_day: editingEventContext.allDay,
    };

    const parentId = editingEventContext.metadata?.smartSeriesParent;
    if (parentId) {
        payload.series_parent_id = parentId;
    }

    if (scope === 'future') {
        if (!parentId) {
            showToast('ingestResult', 'This event is not part of a recurring series.', true);
            return;
        }
        const futureEvents = events
            .filter(ev => ev.metadata && ev.metadata.smartSeriesParent === parentId && ev.start >= editingEventContext.start)
            .sort((a, b) => a.start - b.start);

        if (!futureEvents.length) {
            showToast('ingestResult', 'No future events found for this series.', true);
            return;
        }

        payload.updates = futureEvents.map(ev => {
            if (editingEventContext.allDay) {
                return {
                    event_id: ev.id,
                    start_time: ev.start.toISOString(),
                    end_time: ev.end.toISOString(),
                };
            }
            const start = combineDateAndTime(ev.start, startTimeValue);
            const end = combineDateAndTime(ev.start, endTimeValue);
            return {
                event_id: ev.id,
                start_time: start ? start.toISOString() : null,
                end_time: end ? end.toISOString() : null,
            };
        }).filter(update => update.start_time && update.end_time);

        if (!payload.updates.length) {
            showToast('ingestResult', 'Unable to build updates for future events.', true);
            return;
        }
    }

    try {
        const response = await fetch(`${API_BASE}/events/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (response.ok && result.status === 'ok') {
            const count = result.updated_count || 1;
            showToast('ingestResult', `✅ Updated ${count} event${count > 1 ? 's' : ''}`, false);
            closeEditEventModal();
            await loadRealEvents();
        } else {
            throw new Error(result.error || 'Failed to update event');
        }
    } catch (error) {
        console.error('Failed to update event', error);
        showToast('ingestResult', `Failed to update event: ${error.message}`, true);
    }
}

function getEventsForCurrentWeek() {
    const weekDates = getWeekDates(selectedDate);
    const weekStart = new Date(weekDates[0]);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekDates[6]);
    weekEnd.setHours(23, 59, 59, 999);

    return getFilteredEvents()
        .filter(event => event.start >= weekStart && event.start <= weekEnd)
        .sort((a, b) => a.start - b.start);
}

function printWeeklyCalendar() {
    document.body.classList.add('print-week');

    const finishPrint = () => {
        document.body.classList.remove('print-week');
        window.removeEventListener('afterprint', finishPrint);
    };

    window.addEventListener('afterprint', finishPrint);

    requestAnimationFrame(() => {
        window.print();
        setTimeout(finishPrint, 1000);
    });
}

function downloadWeekAsCSV() {
    try {
        const weekDates = getWeekDates(selectedDate);
        const weekEvents = getEventsForCurrentWeek();

        if (!weekEvents.length) {
            showToast('ingestResult', 'No events scheduled this week to export.', true);
            return;
        }

        const header = ['Day', 'Date', 'Start Time', 'End Time', 'Title', 'Location', 'Source', 'All Day'];
        const rows = [header.join(',')];

        weekEvents.forEach(event => {
            const dayName = event.start.toLocaleDateString(undefined, { weekday: 'long' });
            const dateStr = event.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const startTime = event.allDay ? 'All Day' : event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const endTime = event.allDay ? '' : event.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            const location = event.location ? `"${event.location.replace(/"/g, '""')}"` : '';

            const csvRow = [
                dayName,
                dateStr,
                startTime,
                endTime,
                `"${event.title.replace(/"/g, '""')}"`,
                location,
                event.source || (event.metadata && event.metadata.smartSeriesOrigin === 'manual_activity' ? 'Smart Calendar' : ''),
                event.allDay ? 'Yes' : 'No',
            ];

            rows.push(csvRow.join(','));
        });

        const csvContent = '\ufeff' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const weekRange = `${weekDates[0].toISOString().split('T')[0]}_to_${weekDates[6].toISOString().split('T')[0]}`;

        const grid = document.querySelector('.week-grid');
        const cleanup = () => {
            if (grid) grid.classList.remove('exporting');
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        };

        if (grid) grid.classList.add('exporting');

        const link = document.createElement('a');
        link.href = url;
        link.download = `smart_calendar_week_${weekRange}.csv`;
        document.body.appendChild(link);
        link.click();

        setTimeout(cleanup, 1000);

        showToast('ingestResult', 'Weekly schedule exported to CSV (open in Excel).', false);
    } catch (error) {
        console.error('Failed to export week:', error);
        showToast('ingestResult', `Failed to export: ${error.message}`, true);
    }
}
async function submitManualEvent() {
    const title = document.getElementById('eventTitle').value.trim();
    const date = document.getElementById('eventDate').value;
    const isAllDay = document.getElementById('eventAllDay').checked;
    const startTime = document.getElementById('eventStartTime').value;
    const endTime = document.getElementById('eventEndTime').value;
    const location = document.getElementById('eventLocation').value.trim();
    const description = document.getElementById('eventDescription').value.trim();
    const eventTimeZoneSelect = document.getElementById('eventTimeZone');
    const eventTimeZone = (eventTimeZoneSelect && eventTimeZoneSelect.value) || userTimeZone;
    
    // Validation
    if (!title) {
        showToast('voiceResult', 'Please enter an event title', true);
        return;
    }
    
    if (!date) {
        showToast('voiceResult', 'Please select a date', true);
        return;
    }
    
    if (!isAllDay && (!startTime || !endTime)) {
        showToast('voiceResult', 'Please enter start and end times', true);
        return;
    }
    
    if (!isAllDay && startTime >= endTime) {
        showToast('voiceResult', 'End time must be after start time', true);
        return;
    }
    
    try {
        // Build datetime strings
        let startDateTime, endDateTime;
        
        if (isAllDay) {
            // All-day event: send date strings directly to avoid timezone issues
            // We'll use a special format that the backend can recognize
            startDateTime = date;  // Just the date string like "2025-11-26"
            // Calculate next day for end date
            const [year, month, day] = date.split('-').map(Number);
            const nextDay = new Date(year, month - 1, day + 1);
            endDateTime = nextDay.toISOString().split('T')[0];  // "2025-11-27"
        } else {
            // Timed event: combine date and time
            const startUtc = zonedDateTimeToUtc(date, startTime, eventTimeZone);
            const endUtc = zonedDateTimeToUtc(date, endTime, eventTimeZone);

            if (!startUtc || !endUtc) {
                showToast('voiceResult', 'Unable to interpret the selected time. Please double-check your entries.', true);
                return;
            }

            if (startUtc >= endUtc) {
                showToast('voiceResult', 'End time must be after start time for the selected timezone.', true);
                return;
            }

            startDateTime = startUtc;
            endDateTime = endUtc;
        }
        
        let recurrencePayload = null;
        const repeatToggle = document.getElementById('eventRepeatToggle');
        if (repeatToggle && repeatToggle.checked) {
            const frequency = document.getElementById('repeatFrequency').value || 'weekly';
            const intervalValue = parseInt(document.getElementById('repeatInterval').value, 10);
            const interval = Number.isNaN(intervalValue) || intervalValue < 1 ? 1 : intervalValue;
            const untilType = document.getElementById('repeatUntilType').value || 'date';
            const untilDateValue = document.getElementById('repeatUntilDate').value;
            const dayButtons = document.querySelectorAll('.repeat-day-toggle.active');
            const daysOfWeek = Array.from(dayButtons).map(btn => btn.dataset.day);

            if ((frequency === 'weekly' || frequency === 'biweekly') && daysOfWeek.length === 0) {
                const defaultToken = getWeekdayTokenForZone(date, eventTimeZone) || 'mon';
                daysOfWeek.push(defaultToken);
            }

            if (untilType === 'date' && !untilDateValue) {
                showToast('voiceResult', 'Please select a date to end the recurrence.', true);
                return;
            }

            if (untilType === 'end_of_semester' && !academicCalendarPresets.termEndDate) {
                showToast('voiceResult', 'Term end date is not configured. Choose a specific date instead.', true);
                return;
            }

            recurrencePayload = {
                enabled: true,
                frequency,
                interval,
                daysOfWeek,
                repeatUntilType: untilType,
                repeatUntilDate: untilType === 'date' ? untilDateValue : (academicCalendarPresets.termEndDate || null),
                repeat_until: untilType === 'date' ? untilDateValue : (academicCalendarPresets.termEndDate || null),
                exceptions: recurrenceExceptions.map(exc => ({
                    start: exc.start,
                    end: exc.end,
                    label: exc.label,
                    source: exc.source,
                })),
            };
        }
        
        // Call Google Calendar API via backend
        const response = await fetch(`${API_BASE}/events/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary: title,
                start_time: typeof startDateTime === 'string' ? startDateTime : startDateTime.toISOString(),
                end_time: typeof endDateTime === 'string' ? endDateTime : endDateTime.toISOString(),
                location: location || null,
                description: description || null,
                all_day: isAllDay,
                recurrence: recurrencePayload,
                event_timezone: eventTimeZone
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.status === 'ok') {
            if (result.created_count) {
                showToast('ingestResult', `✅ Created ${result.created_count} "${title}" sessions`, false);
            } else {
                showToast('ingestResult', `✅ Event "${title}" created!`, false);
            }
            hideAddEventModal();
            
            // Refresh calendar to show new event
            await loadRealEvents();
        } else {
            throw new Error(result.error || 'Failed to create event');
        }
    } catch (error) {
        console.error('Failed to create event:', error);
        showToast('voiceResult', `Failed to create event: ${error.message}`, true);
    }
}

// ---------------------------------------------------------------------------
// Event Deletion
// ---------------------------------------------------------------------------

async function deleteEvent(eventId, eventTitle, eventSource) {
    // Check if event is from Canvas (protected)
    if (eventSource.includes('Canvas')) {
        showToast('ingestResult', 'Canvas events cannot be deleted from this interface. Please delete from Canvas directly.', true);
        return;
    }

    // Confirmation dialog
    if (!confirm(`Delete "${eventTitle}"?\n\nThis will permanently remove the event from your Google Calendar.`)) {
        return;
    }

    try {
        const result = await apiCall('/events/delete', {
            event_id: eventId,
            title: eventTitle,
            source: eventSource
        });

        if (result.status === 'ok') {
            showToast('ingestResult', `Deleted "${eventTitle}"`, false);
            // Refresh calendar to show updated state
            await loadRealEvents();
        } else if (result.protected) {
            showToast('ingestResult', result.error, true);
        } else {
            showToast('ingestResult', `Failed to delete: ${result.error}`, true);
        }
    } catch (error) {
        showToast('ingestResult', `Failed to delete event: ${error.message}`, true);
    }
}

// ---------------------------------------------------------------------------
// Batch Event Import
// ---------------------------------------------------------------------------

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        document.getElementById('batchEventsInput').value = text;
        showToast('batchImportResult', `File "${file.name}" loaded. Click "Import Events" to proceed.`, false, 3000);
    };
    reader.readAsText(file);
}

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const events = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (doesn't handle quoted commas)
        const values = line.split(',').map(v => v.trim());
        const event = {};

        headers.forEach((header, index) => {
            const value = values[index] || '';
            if (header === 'all_day') {
                event[header] = value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
            } else {
                event[header] = value;
            }
        });

        events.push(event);
    }

    return events;
}

async function importBatchEvents() {
    const csvText = document.getElementById('batchEventsInput').value.trim();

    if (!csvText) {
        showToast('batchImportResult', 'Please upload a file or paste CSV data', true);
        return;
    }

    try {
        // Parse CSV
        const events = parseCSV(csvText);

        if (events.length === 0) {
            showToast('batchImportResult', 'No events found in CSV data', true);
            return;
        }

        // Show loading state
        showToast('batchImportResult', `Importing ${events.length} event(s)...`, false, 30000);

        // Send to backend
        const result = await apiCall('/events/batch_import', { events });

        if (result.status === 'ok') {
            const message = `Successfully imported ${result.created_count} event(s)` +
                           (result.error_count > 0 ? ` (${result.error_count} errors)` : '');

            showToast('batchImportResult', message, result.error_count > 0, 5000);

            if (result.errors && result.errors.length > 0) {
                console.error('Import errors:', result.errors);
            }

            // Clear the input
            document.getElementById('batchEventsInput').value = '';
            document.getElementById('csvFileInput').value = '';

            // Refresh calendar to show new events
            await loadRealEvents();
        } else {
            showToast('batchImportResult', `Import failed: ${result.error}`, true);
        }
    } catch (error) {
        console.error('Batch import error:', error);
        showToast('batchImportResult', `Import failed: ${error.message}`, true);
    }
}

// ---------------------------------------------------------------------------
// Simple View To-Do List
// ---------------------------------------------------------------------------

function getSimpleTodoElements() {
    return {
        container: document.getElementById('simpleTodo'),
        form: document.getElementById('todoForm'),
        input: document.getElementById('todoInput'),
        list: document.getElementById('todoList'),
        clearButton: document.getElementById('clearCompletedTodos'),
    };
}

function getTodoStorageKey(dateKey) {
    return `${TODO_STORAGE_PREFIX}${dateKey}`;
}

function loadTodosForDate(dateKey) {
    if (!dateKey) return [];

    let stored = [];
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(getTodoStorageKey(dateKey));
            stored = raw ? JSON.parse(raw) : [];
        } else {
            stored = todoMemoryStore[dateKey] || [];
        }
    } catch (err) {
        console.warn('Unable to read todo list, falling back to memory store.', err);
        stored = todoMemoryStore[dateKey] || [];
    }

    if (!Array.isArray(stored)) {
        return [];
    }

    const normalized = stored
        .filter(item => item && typeof item.text === 'string')
        .map(item => ({
            id: typeof item.id === 'string' ? item.id : `todo-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            text: item.text,
            completed: Boolean(item.completed),
            createdAt: item.createdAt || Date.now(),
        }));

    todoMemoryStore[dateKey] = normalized;

    return normalized;
}

function saveTodosForDate(dateKey, todos) {
    if (!dateKey) return;
    const safeTodos = Array.isArray(todos) ? todos : [];

    todoMemoryStore[dateKey] = safeTodos;

    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(getTodoStorageKey(dateKey), JSON.stringify(safeTodos));
        }
    } catch (err) {
        console.warn('Unable to persist todo list to localStorage, using in-memory fallback.', err);
    }
}

function createTodoItem(text) {
    let id = `todo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            id = crypto.randomUUID();
        } catch (err) {
            // Ignore and use fallback id
        }
    }
    return {
        id,
        text,
        completed: false,
        createdAt: Date.now(),
    };
}

function renderSimpleTodoList(dateKey) {
    const { list, clearButton } = getSimpleTodoElements();
    if (!list) return;

    currentTodoDateKey = dateKey;
    const todos = loadTodosForDate(dateKey);

    list.innerHTML = '';

    if (!todos.length) {
        const emptyState = document.createElement('li');
        emptyState.className = 'simple-todo-empty';
        emptyState.textContent = 'Nothing on your to-do list yet. Add a task to get started.';
        list.appendChild(emptyState);
        if (clearButton) {
            clearButton.disabled = true;
        }
        return;
    }

    todos.forEach(todo => {
        const li = document.createElement('li');
        li.className = 'simple-todo-item';
        li.dataset.todoId = todo.id;
        if (todo.completed) {
            li.classList.add('completed');
        }

        const label = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'simple-todo-toggle';
        checkbox.checked = todo.completed;
        checkbox.setAttribute('aria-label', `Mark "${todo.text}" as ${todo.completed ? 'not done' : 'done'}`);

        const textSpan = document.createElement('span');
        textSpan.textContent = todo.text;

        label.appendChild(checkbox);
        label.appendChild(textSpan);

        const actions = document.createElement('div');
        actions.className = 'simple-todo-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'simple-todo-edit';
        editBtn.title = 'Edit task';
        editBtn.setAttribute('aria-label', `Edit "${todo.text}"`);
        editBtn.textContent = 'Edit';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'simple-todo-delete';
        deleteBtn.title = 'Remove task';
        deleteBtn.setAttribute('aria-label', `Remove "${todo.text}"`);
        deleteBtn.textContent = '×';

        li.appendChild(label);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        li.appendChild(actions);
        list.appendChild(li);
    });

    if (clearButton) {
        const completedCount = todos.filter(todo => todo.completed).length;
        clearButton.disabled = completedCount === 0;
    }
}

function initializeSimpleTodoUi() {
    if (todoUiInitialized) return;
    const { form, input, list, clearButton } = getSimpleTodoElements();
    if (!form || !input || !list || !clearButton) return;

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;

        const dateKey = currentTodoDateKey || new Date().toISOString().split('T')[0];
        const todos = loadTodosForDate(dateKey);
        todos.push(createTodoItem(value));
        saveTodosForDate(dateKey, todos);
        input.value = '';
        renderSimpleTodoList(dateKey);
    });

    list.addEventListener('change', (event) => {
        const checkbox = event.target;
        if (!(checkbox instanceof HTMLInputElement) || !checkbox.classList.contains('simple-todo-toggle')) {
            return;
        }
        const li = checkbox.closest('.simple-todo-item');
        if (!li) return;

        const todoId = li.dataset.todoId;
        const dateKey = currentTodoDateKey || new Date().toISOString().split('T')[0];
        const todos = loadTodosForDate(dateKey).map(todo => {
            if (todo.id === todoId) {
                return { ...todo, completed: checkbox.checked };
            }
            return todo;
        });
        saveTodosForDate(dateKey, todos);
        renderSimpleTodoList(dateKey);
    });

    list.addEventListener('click', (event) => {
        const targetEl = event.target instanceof HTMLElement ? event.target : null;
        if (!targetEl) return;

        const editButton = targetEl.closest('.simple-todo-edit');
        if (editButton) {
            const li = editButton.closest('.simple-todo-item');
            if (!li) return;

            const todoId = li.dataset.todoId;
            const dateKey = currentTodoDateKey || new Date().toISOString().split('T')[0];
            const todos = loadTodosForDate(dateKey);
            const index = todos.findIndex(todo => todo.id === todoId);
            if (index === -1) return;

            const currentText = todos[index].text;
            const updatedText = prompt('Edit task', currentText);
            if (updatedText === null) {
                return;
            }
            const trimmed = updatedText.trim();
            if (!trimmed) {
                return;
            }

            todos[index] = { ...todos[index], text: trimmed };
            saveTodosForDate(dateKey, todos);
            renderSimpleTodoList(dateKey);
            return;
        }

        const deleteButton = targetEl.closest('.simple-todo-delete');
        if (!deleteButton) return;
        const li = deleteButton.closest('.simple-todo-item');
        if (!li) return;

        const todoId = li.dataset.todoId;
        const dateKey = currentTodoDateKey || new Date().toISOString().split('T')[0];
        const todos = loadTodosForDate(dateKey).filter(todo => todo.id !== todoId);
        saveTodosForDate(dateKey, todos);
        renderSimpleTodoList(dateKey);
    });

    clearButton.addEventListener('click', () => {
        const dateKey = currentTodoDateKey || new Date().toISOString().split('T')[0];
        const todos = loadTodosForDate(dateKey).filter(todo => !todo.completed);
        saveTodosForDate(dateKey, todos);
        renderSimpleTodoList(dateKey);
    });

    todoUiInitialized = true;
}

// ---------------------------------------------------------------------------
// Motivational Quote
// ---------------------------------------------------------------------------

function setSimpleQuoteContent(quote) {
    const quoteEl = document.getElementById('simpleQuote');
    if (!quoteEl) return;

    if (!quote || !quote.text) {
        quoteEl.textContent = 'Stay focused and keep moving forward!';
        return;
    }

    const safeQuote = escapeHtml(quote.text);
    const safeAuthor = quote.author ? escapeHtml(quote.author) : null;
    quoteEl.innerHTML = safeAuthor ? `“${safeQuote}” — ${safeAuthor}` : `“${safeQuote}”`;
}

async function fetchMotivationalQuote() {
    const response = await fetch(QUOTE_API_URL, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error(`Quote request failed (${response.status})`);
    }

    const data = await response.json();
    const quoteText =
        data.quote ||
        data.text ||
        data.message ||
        (data.data && (data.data.quote || data.data.text)) ||
        null;
    const author =
        data.author ||
        data.writer ||
        (data.data && (data.data.author || data.data.writer)) ||
        null;

    if (!quoteText) {
        throw new Error('Quote response missing text');
    }

    return {
        text: String(quoteText),
        author: author ? String(author) : null,
    };
}

async function updateSimpleQuote(dateKey) {
    const normalizedKey = dateKey || new Date().toISOString().split('T')[0];

    if (quoteCache[normalizedKey]) {
        setSimpleQuoteContent(quoteCache[normalizedKey]);
        return;
    }

    const quoteEl = document.getElementById('simpleQuote');
    if (quoteEl) {
        quoteEl.textContent = 'Loading inspiration...';
    }

    try {
        const quote = await fetchMotivationalQuote();
        quoteCache[normalizedKey] = quote;
        setSimpleQuoteContent(quote);
    } catch (err) {
        console.warn('Unable to load motivational quote.', err);
        setSimpleQuoteContent(null);
    }
}

// ---------------------------------------------------------------------------
// View Switching (Grid vs Simple)
// ---------------------------------------------------------------------------

function switchView(view) {
    currentView = view;

    const gridCalendar = document.getElementById('gridCalendar');
    const simpleCalendar = document.getElementById('simpleCalendar');
    const gridViewBtn = document.getElementById('gridViewBtn');
    const simpleViewBtn = document.getElementById('simpleViewBtn');

    if (view === 'grid') {
        gridCalendar.style.display = 'flex';
        simpleCalendar.style.display = 'none';
        gridViewBtn.classList.add('active');
        simpleViewBtn.classList.remove('active');
    } else {
        gridCalendar.style.display = 'none';
        simpleCalendar.style.display = 'flex';
        gridViewBtn.classList.remove('active');
        simpleViewBtn.classList.add('active');
        renderSimpleView();
    }
}

function renderSimpleView() {
    const referenceDate = selectedDate ? new Date(selectedDate) : new Date();
    const normalizedDate = new Date(
        referenceDate.getFullYear(),
        referenceDate.getMonth(),
        referenceDate.getDate()
    );
    const todayKey = [
        normalizedDate.getFullYear(),
        String(normalizedDate.getMonth() + 1).padStart(2, '0'),
        String(normalizedDate.getDate()).padStart(2, '0')
    ].join('-');

    // Update date display so header matches the selected day
    const dateOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    document.getElementById('simpleDate').textContent =
        normalizedDate.toLocaleDateString(undefined, dateOptions);

    // Get events for the selected day
    const todayEvents = events
        .filter(ev => {
            if (ev.allDay) {
                const eventDate = new Date(ev.start);
                return (
                    eventDate.getFullYear() === normalizedDate.getFullYear() &&
                    eventDate.getMonth() === normalizedDate.getMonth() &&
                    eventDate.getDate() === normalizedDate.getDate()
                );
            }
            return getEventKey(ev) === todayKey;
        })
        .sort((a, b) => a.start - b.start);

    // Generate natural language summary
    const summary = generateNaturalLanguageSummary(todayEvents);
    document.getElementById('simpleSummary').innerHTML = `<p>${summary}</p>`;

    updateSimpleQuote(todayKey);
    initializeSimpleTodoUi();
    renderSimpleTodoList(todayKey);

    // Hide event cards - they're not needed in simple view
    document.getElementById('simpleEventsList').style.display = 'none';
}

function generateNaturalLanguageSummary(todayEvents) {
    if (todayEvents.length === 0) {
        return "Your plan today is to relax and recharge.<br>You have a completely free schedule!";
    }

    const greetings = [
        "Here's what your day looks like:",
        "Your plan for today:",
        "Here's your schedule for today:",
        "Today you have:"
    ];

    const greeting = greetings[Math.floor(Math.random() * greetings.length)];

    // Separate all-day and timed events
    const allDayEvents = todayEvents.filter(ev => ev.allDay);
    const timedEvents = todayEvents.filter(ev => !ev.allDay);

    let lines = [greeting];

    // Add summary sentence
    if (allDayEvents.length > 0 && timedEvents.length > 0) {
        lines.push(`You have ${allDayEvents.length} all-day event${allDayEvents.length > 1 ? 's' : ''} and ${timedEvents.length} scheduled activit${timedEvents.length > 1 ? 'ies' : 'y'}.`);
    } else if (allDayEvents.length > 0) {
        lines.push(`You have ${allDayEvents.length} all-day event${allDayEvents.length > 1 ? 's' : ''}.`);
    } else if (timedEvents.length > 0) {
        const firstEvent = timedEvents[0];
        const lastEvent = timedEvents[timedEvents.length - 1];
        const startTime = firstEvent.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const endTime = lastEvent.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        lines.push(`You have ${timedEvents.length} scheduled activit${timedEvents.length > 1 ? 'ies' : 'y'} from ${startTime} to ${endTime}.`);
    }

    lines.push(''); // Blank line before event list

    // List all-day events
    if (allDayEvents.length > 0) {
        lines.push('<strong>All-Day Events:</strong>');
        allDayEvents.forEach(ev => {
            lines.push(`• ${escapeHtml(ev.title)}`);
        });
        if (timedEvents.length > 0) {
            lines.push(''); // Blank line between sections
        }
    }

    // List timed events
    if (timedEvents.length > 0) {
        if (allDayEvents.length === 0) {
            lines.push('<strong>Your Schedule:</strong>');
        } else {
            lines.push('<strong>Timed Events:</strong>');
        }

        timedEvents.forEach(ev => {
            const timeStr = formatTimeRange(ev.start, ev.end);
            const location = ev.location ? ` (${escapeHtml(ev.location)})` : '';
            lines.push(`• ${timeStr} - ${escapeHtml(ev.title)}${location}`);
        });
    }

    // Calculate total busy time
    const totalMinutes = timedEvents.reduce((sum, ev) => {
        return sum + (new Date(ev.end) - new Date(ev.start)) / 60000;
    }, 0);

    if (totalMinutes > 0) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.round(totalMinutes % 60);
        lines.push(''); // Blank line before total
        if (hours > 0) {
            lines.push(`<strong>Total scheduled time:</strong> ${hours} hour${hours > 1 ? 's' : ''}${minutes > 0 ? ` and ${minutes} minutes` : ''}.`);
        } else if (minutes > 0) {
            lines.push(`<strong>Total scheduled time:</strong> ${minutes} minutes.`);
        }
    }

    // Join with line breaks
    return lines.join('<br>');
}
