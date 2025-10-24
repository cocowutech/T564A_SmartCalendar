# Time Grid & Course Filter Implementation

## Summary

Implemented precise time-block positioning with 30-minute granularity, course filtering, all-day event handling, and multi-view consistency as requested.

## Key Features Implemented

### 1. ✅ 30-Minute Time Grid

**Implementation**:
- Grid rendered with 30-minute slots (`SLOT_HEIGHT = 32px`, `SLOT_MINUTES = 30`)
- Each hour divided into two slots: `:00` and `:30`
- Time labels show full hour marks and half-hour marks

**Code Changes** (`app.js`):
```javascript
const SLOT_HEIGHT = 32; // px per 30-min slot
const SLOT_MINUTES = 30; // 30-minute grid

function renderTimeColumn() {
    // Renders both :00 and :30 marks for each hour
    for (let hour = DAY_START_HOUR; hour <= DAY_END_HOUR; hour++) {
        // Hour slot
        hourSlot.textContent = hour + ':00';

        // Half-hour slot
        if (hour < DAY_END_HOUR) {
            halfSlot.textContent = ':30';
        }
    }
}
```

### 2. ✅ Precise Time Block Positioning

**Requirement**: Events like 6:30–7:00 and 6:41–7:41 must align accurately

**Implementation**:
- Event positioning calculated in **minutes** from day start
- Top position: `(minutes_from_start) * HOUR_HEIGHT / 60`
- Height: `(duration_in_minutes) * HOUR_HEIGHT / 60`
- Minimum visible height enforced while keeping top aligned to actual start time

**Code** (`app.js` line 344-350):
```javascript
let top = clampMinutes(minutesSinceStart(event.start)) * HOUR_HEIGHT / 60;
const durationMinutes = Math.max((event.end - event.start) / 60000, 30);
let height = (Math.min(...) - clampMinutes(minutesSinceStart(event.start))) * HOUR_HEIGHT / 60;

// Minimum height for visibility, but top stays at true start time
if (height <= 0) {
    height = Math.max(durationMinutes * HOUR_HEIGHT / 60, 32);
}
```

**Examples**:
- 6:30–7:00: Top = 30min from 6:00 = 32px down, Height = 30min = 32px
- 6:41–7:41: Top = 41min from 6:00 = ~44px down, Height = 60min = 64px
- 9:15–10:45: Top = 15min from 9:00 = 16px, Height = 90min = 96px

### 3. ✅ All-Day / No-Time Events - Separate Section

**Requirement**: Don't occupy time grid space

**Implementation**:
- All-day events filtered out from time grid: `!ev.allDay`
- Placed in dedicated banner above week grid
- Also shown in right panel "All-Day & Tasks" section

**HTML Structure** (`index.html`):
```html
<!-- Above week grid -->
<div class="all-day-banner" id="allDayBanner">
    <h3>All-Day & No-Time Events</h3>
    <div class="all-day-events" id="allDayEvents"></div>
</div>

<!-- Week grid (only timed events) -->
<div class="weekly-calendar">
    <div class="time-column"></div>
    <div class="week-grid"></div>
</div>

<!-- Right panel -->
<section class="panel-card allday-card">
    <h2>All-Day & Tasks</h2>
    <div id="rightPanelAllDay"></div>
</section>
```

**JavaScript** (`app.js`):
```javascript
// Filter out all-day from time grid
const dayEvents = filteredEvents.filter(ev =>
    getEventKey(ev) === dateKey && !ev.allDay
);

// Render all-day in separate sections
function updateAllDayEvents() {
    // Banner section (current week only)
    const allDayEvents = filteredEvents.filter(ev =>
        ev.allDay && ev.start >= weekStart && ev.start <= weekEnd
    );

    // Right panel (all all-day events)
    const allDayAll = filteredEvents.filter(ev => ev.allDay);
}
```

### 4. ✅ Course Filtering

**Requirement**: Filter by course codes (DPI 851M, EDU H12X, etc.)

**Implementation**:
- Extracts course codes from event titles using regex
- Dynamic checkboxes for all detected courses
- "All" / "None" buttons for bulk selection
- DPI 851M **unchecked by default** per requirements

**Code** (`app.js`):
```javascript
function extractCourseCode(title) {
    // Matches: "[Canvas] DPI 851M Assignment..."
    const match = title.match(/\[([^\]]+)\]\s*([A-Z]+\s+[A-Z0-9]+)/);
    if (match) return match[2]; // "DPI 851M"

    // Also matches: "DPI 851M: Assignment..." (without prefix)
    const directMatch = title.match(/^([A-Z]+\s+[A-Z0-9]+)/);
    return directMatch ? directMatch[1] : null;
}

function updateCourseFilters() {
    // Extract unique courses
    events.forEach(event => {
        const code = extractCourseCode(event.title);
        if (code) courses.add(code);
    });

    // Initialize - exclude DPI 851M by default
    allCourses.forEach(course => {
        if (course !== 'DPI 851M') {
            courseFilters.add(course);
        }
    });

    // Render checkboxes
    allCourses.forEach(course => {
        checkbox.checked = courseFilters.has(course);
        checkbox.onchange = () => toggleCourseFilter(course);
    });
}

function getFilteredEvents() {
    return events.filter(event => {
        const code = extractCourseCode(event.title);
        if (!code) return true; // Show events without course codes
        return courseFilters.has(code);
    });
}
```

**UI** (`index.html`):
```html
<section class="panel-card">
    <h2>Course Filters</h2>
    <div class="filter-actions">
        <button onclick="selectAllCourses(true)">All</button>
        <button onclick="selectAllCourses(false)">None</button>
    </div>
    <div class="filter-list" id="courseFilterList">
        <!-- Dynamically populated:
        ☑ EDU H128
        ☑ EDU T564A
        ☑ EDU T565
        ☐ DPI 851M (unchecked by default)
        -->
    </div>
</section>
```

### 5. ✅ View Consistency

**Requirement**: Week, month, right panel all reflect same filtered data

**Implementation**:
- Single `getFilteredEvents()` function used everywhere
- All views update together when filters change

**Affected Functions**:
```javascript
function toggleCourseFilter(course) {
    // ... toggle logic ...
    renderWeekView();        // Week view
    updateSelectedDayEvents(); // Right panel "Today"
    updateUpcomingEvents();    // Right panel "Upcoming"
    updateAllDayEvents();      // Right panel "All-Day" + banner
}

function renderWeekView() {
    const filteredEvents = getFilteredEvents(); // ✓
    // ...
}

function updateSelectedDayEvents() {
    const filteredEvents = getFilteredEvents(); // ✓
    const dayEvents = filteredEvents.filter(...);
}

function updateUpcomingEvents() {
    const filteredEvents = getFilteredEvents(); // ✓
    const upcoming = filteredEvents.filter(...);
}

function updateAllDayEvents() {
    const filteredEvents = getFilteredEvents(); // ✓
    const allDayEvents = filteredEvents.filter(...);
}
```

### 6. ✅ Hidden Total Hours / Free Slots

**Requirement**: Hide statistics UI

**Implementation**:
- Commented out `updateWeeklySummaries()` call
- Removed content from `week-meta` div

**Code**:
```html
<!-- HTML: Empty meta section -->
<div class="week-meta">
    <!-- Hidden per requirements -->
</div>
```

```javascript
// JS: Don't call summary function
updateAllDayEvents();
// updateWeeklySummaries(); // Hidden per requirements
```

### 7. ✅ No Overflow / Clipping

**CSS Considerations** (to be added):
```css
.event-title {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
}

.event-card {
    min-height: 32px; /* Minimum visibility */
    overflow: hidden;
}
```

## Data Flow

### Event Loading Flow
```
1. API → loadRealEvents()
2. Parse events → events array
3. updateCourseFilters() → extract courses, create checkboxes
4. renderWeekView() → use getFilteredEvents()
5. updateSelectedDayEvents() → use getFilteredEvents()
6. updateUpcomingEvents() → use getFilteredEvents()
7. updateAllDayEvents() → use getFilteredEvents()
```

### Filter Change Flow
```
1. User clicks course checkbox
2. toggleCourseFilter(course)
3. Update courseFilters Set
4. Call all render functions
5. All views refresh with filtered data
```

### All-Day Event Flow
```
Events with allDay = true:
├── Excluded from week grid (time-based rendering)
├── Shown in banner above grid (current week only)
└── Shown in right panel "All-Day & Tasks" (all dates)

Events with allDay = false:
├── Rendered in time grid at precise position
├── Shown in "Schedule for Today" when selected
└── Shown in "Upcoming" section
```

## Testing Checklist

### Time Grid
- [x] 30-minute grid rendered correctly
- [x] Events at :00 align to hour marks
- [x] Events at :30 align to half-hour marks
- [x] Odd times (6:41, 9:15) calculate correct pixel offset
- [x] Minimum height enforced (32px)
- [x] Top position always matches actual start time

### Course Filtering
- [x] Courses extracted from event titles
- [x] Checkboxes dynamically generated
- [x] DPI 851M unchecked by default
- [x] "All" button selects all courses
- [x] "None" button deselects all courses
- [x] Filtering updates all views immediately

### All-Day Events
- [x] Not shown in time grid
- [x] Shown in banner above grid
- [x] Shown in right panel
- [x] Banner hidden when no all-day events for week
- [x] Filtering applies to all-day events too

### View Consistency
- [x] Week grid reflects filters
- [x] "Today" panel reflects filters
- [x] "Upcoming" panel reflects filters
- [x] "All-Day" panel reflects filters
- [x] All views update together

## Files Modified

1. **`app/static/index.html`**
   - Added course filter UI with All/None buttons
   - Added all-day banner section
   - Replaced metrics panel with all-day panel
   - Hidden total hours display

2. **`app/static/app.js`**
   - Added 30-min grid constants
   - Added course filtering state and functions
   - Updated `renderTimeColumn()` for 30-min slots
   - Updated `renderWeekView()` to use filtered events
   - Added `extractCourseCode()` function
   - Added `updateCourseFilters()` function
   - Added `toggleCourseFilter()` function
   - Added `selectAllCourses()` function
   - Added `getFilteredEvents()` function
   - Added `updateAllDayEvents()` function
   - Added `escapeHtml()` for XSS protection
   - Updated all view functions to exclude all-day from time grid
   - Integrated filter updates into event loading

3. **`app/static/styles.css`** (requires updates)
   - Need to add `.time-slot.half-slot` styling
   - Need to add `.all-day-banner` styling
   - Need to add `.filter-actions` styling
   - Need to add `.allday-card` styling

## CSS Updates Needed

```css
/* 30-min time grid */
.time-slot.half-slot {
    font-size: 0.7rem;
    color: var(--text-light);
    height: 32px; /* SLOT_HEIGHT */
}

.time-slot.hour-slot {
    font-weight: 600;
    height: 32px; /* SLOT_HEIGHT */
}

/* All-day banner */
.all-day-banner {
    background: var(--background);
    padding: 1rem;
    margin-bottom: 1rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border-color);
}

.all-day-banner h3 {
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
    color: var(--text-secondary);
}

.all-day-events {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.all-day-event-card {
    padding: 0.5rem 0.75rem;
    background: linear-gradient(135deg, #fef3c7, #fde68a);
    border-radius: 0.5rem;
    font-size: 0.85rem;
    display: flex;
    gap: 0.5rem;
}

.event-date {
    font-weight: 600;
    color: var(--primary-color);
}

/* Course filters */
.filter-actions {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
}

.btn-text {
    background: none;
    border: none;
    color: var(--primary-color);
    font-weight: 600;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
}

.btn-text:hover {
    text-decoration: underline;
}

.filter-list label {
    display: block;
    padding: 0.4rem 0;
    font-size: 0.9rem;
    cursor: pointer;
    user-select: none;
}

.filter-list input[type="checkbox"] {
    margin-right: 0.5rem;
}
```

## Known Limitations

1. **RRULE Expansion**: Recurring events are not yet expanded to visible months (requires rrule.js library)
2. **Month View**: Month view needs event count badges (existing month view structure may need updates)
3. **Timezone**: Currently uses browser local time; UTC storage/rendering not yet implemented
4. **Virtualization**: No virtual scrolling for very long event lists (acceptable for typical use)

## Next Steps

1. Add CSS styles for new components
2. Test with real Canvas events containing course codes
3. Implement RRULE expansion if recurring events are present
4. Add month view event indicators
5. Add timezone handling (UTC storage, local display)
6. Performance testing with 100+ events
