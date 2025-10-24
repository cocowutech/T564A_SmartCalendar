const API_BASE = '/api';

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
        start = new Date(raw.start);
        if (Number.isNaN(start.getTime())) {
            start = null;
        }
    }

    if (!start && raw.date) {
        const timePart = raw.time ? raw.time : '00:00';
        start = new Date(`${raw.date}T${timePart}`);
    }

    if (raw.end) {
        end = new Date(raw.end);
        if (Number.isNaN(end.getTime())) {
            end = null;
        }
    }

    if (!end && start) {
        end = new Date(start.getTime() + 60 * 60 * 1000);
    }

    if (raw.start && !raw.start.includes('T')) {
        allDay = true;
    }

    if (!start || !end) {
        return null;
    }

    const sourceMatch = raw.title.match(/^\[(.+?)]\s*(.*)$/);
    let source = 'Google';
    let title = raw.title;

    if (sourceMatch) {
        source = sourceMatch[1];
        title = sourceMatch[2] || title;
    }

    return {
        id: raw.id || `${start.toISOString()}-${title}`,
        title,
        source,
        description: raw.description || '',
        location: raw.location || '',
        start,
        end,
        allDay,
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
        const dayEvents = filteredEvents.filter(ev => getEventKey(ev) === dateKey && !ev.allDay); // Exclude all-day events

        const header = document.createElement('div');
        header.className = 'day-header';
        header.innerHTML = `
            <span class="day-name">${DAY_NAMES[index]}</span>
            <span class="day-date">${date.toLocaleDateString(undefined, { day: 'numeric' })}</span>
        `;
        if (sameDay(date, selectedDate)) {
            header.classList.add('active');
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
            let top = clampMinutes(minutesSinceStart(event.start)) * HOUR_HEIGHT / 60;
            const durationMinutes = Math.max((event.end - event.start) / 60000, 30);
            let height = (Math.min(clampMinutes(minutesSinceStart(event.end)), (DAY_END_HOUR - DAY_START_HOUR) * 60) - clampMinutes(minutesSinceStart(event.start))) * HOUR_HEIGHT / 60;

            if (height <= 0) {
                height = Math.max(durationMinutes * HOUR_HEIGHT / 60, 32);
            }

            const widthPercent = 100 / columns;
            const card = document.createElement('div');
            card.className = 'event-card';
            card.dataset.source = event.source;
            card.style.top = `${top}px`;
            card.style.height = `${height}px`;
            card.style.width = `calc(${widthPercent}% - 8px)`;
            card.style.left = `calc(${column * widthPercent}% + 4px)`;

            // Add tooltip with full event details
            const tooltipText = `${event.title}\n${formatTimeRange(event.start, event.end)}${event.location ? `\n${event.location}` : ''}`;
            card.title = tooltipText;

            card.innerHTML = `
                <span class="event-title">${escapeHtml(event.title)}</span>
                <span class="event-time">${formatTimeRange(event.start, event.end)}</span>
                ${event.location ? `<span class="event-location">${escapeHtml(event.location)}</span>` : ''}
            `;
            card.addEventListener('click', () => {
                selectedDate = new Date(event.start);
                updateSelectedDayEvents();
                renderWeekView();
            });
            body.appendChild(card);
        });

        dayColumn.appendChild(header);
        dayColumn.appendChild(body);
        grid.appendChild(dayColumn);
    });

    updateAllDayEvents();
    // updateWeeklySummaries(); // Hidden per requirements
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
        empty.textContent = 'No events scheduled for this day.';
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
        empty.textContent = 'No upcoming events.';
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

async function loadRealEvents() {
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

        updateCourseFilters(); // Extract and initialize course filters
        renderWeekView();
        updateSelectedDayEvents();
        updateUpcomingEvents();
        updateAllDayEvents();
        return { success: true };
    } catch (error) {
        console.error('Failed to load events:', error);
        showToast('ingestResult', `Failed to load events: ${error.message}`, true);
        return { success: false, error };
    }
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
    const today = new Date();
    selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const makeDate = (base, hours, minutes) => {
        const d = new Date(base);
        d.setHours(hours, minutes, 0, 0);
        return d;
    };

    const samples = [
        { title: 'Morning Yoga', start: makeDate(selectedDate, 7, 0), end: makeDate(selectedDate, 8, 0), location: 'Studio', source: 'Google', allDay: false },
        { title: 'Product Sync', start: makeDate(selectedDate, 10, 30), end: makeDate(selectedDate, 11, 30), location: 'Zoom', source: 'Google', allDay: false },
        { title: 'Dinner with Alex', start: makeDate(selectedDate, 18, 0), end: makeDate(selectedDate, 19, 30), location: 'Downtown', source: 'Google', allDay: false },
    ];

    events = samples.map((event, idx) => ({
        ...event,
        id: `sample-${idx}`,
    }));

    renderWeekView();
    updateSelectedDayEvents();
    updateUpcomingEvents();
}

document.addEventListener('DOMContentLoaded', () => {
    renderTimeColumn();
    checkApiStatus();
    initVoiceRecognition();
    loadRealEvents().then(result => {
        if (!result?.success) {
            loadSampleEvents();
        }
    });

    updateSelectedDayEvents();
    updateUpcomingEvents();

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
    // Extract course codes like "DPI 851M", "EDU H12X", "EDU T564A" from [Source] prefix
    const match = title.match(/\[([^\]]+)\]\s*([A-Z]+\s+[A-Z0-9]+)/);
    if (match) {
        return match[2]; // Return "DPI 851M" part
    }
    // Try without prefix
    const directMatch = title.match(/^([A-Z]+\s+[A-Z0-9]+)/);
    return directMatch ? directMatch[1] : null;
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
    if (courseFilters.size === 0) {
        return events; // Show all if nothing selected
    }

    return events.filter(event => {
        const code = extractCourseCode(event.title);
        if (!code) return true; // Show events without course codes
        return courseFilters.has(code);
    });
}

// ---------------------------------------------------------------------------
// All-Day Event Handling
// ---------------------------------------------------------------------------

function updateAllDayEvents() {
    const filteredEvents = getFilteredEvents();

    // Update banner (now BELOW week grid)
    const banner = document.getElementById('allDayBanner');
    const bannerContainer = document.getElementById('allDayEvents');

    if (!banner || !bannerContainer) return;

    const weekDates = getWeekDates(selectedDate);
    const weekStart = weekDates[0];
    const weekEnd = new Date(weekDates[6]);
    weekEnd.setHours(23, 59, 59, 999);

    // Filter by selected days (Mon=0, Sun=6)
    const allDayEvents = filteredEvents.filter(ev => {
        if (!ev.allDay) return false;
        if (ev.start < weekStart || ev.start > weekEnd) return false;

        // Check if this event's day of week is in active filters
        const dayOfWeek = (ev.start.getDay() + 6) % 7; // Convert Sun=0 to Mon=0 format
        return activeDayFilters.has(dayOfWeek);
    });

    // Always show banner (keep day filter buttons visible)
    banner.style.display = 'block';

    if (allDayEvents.length > 0) {
        bannerContainer.innerHTML = allDayEvents.map(ev => {
            const dayOfWeek = (ev.start.getDay() + 6) % 7;
            const dayName = DAY_NAMES[dayOfWeek];
            return `
                <div class="all-day-event-card" title="${escapeHtml(ev.title)}\n${ev.start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}">
                    <span class="event-date">${dayName} ${ev.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span class="event-title">${escapeHtml(ev.title)}</span>
                </div>
            `;
        }).join('');
    } else {
        // Show message when no events match filter
        bannerContainer.innerHTML = '<div class="empty-state">No events for selected days</div>';
    }

    // Update right panel all-day section
    const rightPanel = document.getElementById('rightPanelAllDay');
    if (!rightPanel) return;

    const allDayAll = filteredEvents.filter(ev => ev.allDay);

    if (allDayAll.length === 0) {
        rightPanel.innerHTML = '<div class="empty-state">No all-day events</div>';
        return;
    }

    rightPanel.innerHTML = allDayAll.slice(0, 10).map(ev => `
        <div class="event-row">
            <span class="row-time">${ev.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span class="row-title">${escapeHtml(ev.title)}</span>
        </div>
    `).join('');
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
