/* ═══════════════════════════════════════════════════════════════
   tabs/weekly.js
   Weekly planner tab — add, edit, filter, complete and delete
   weekly tasks. Multi-day support, day presets, week reset.
   Depends on: core/state.js, core/utils.js, core/firebase.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  VALID_TASK_DAYS,
  /* flags */
  wtFilter,      setWtFilter,
  wtEditingId,   setWtEditingId,
  wtSelectedDays,setWtSelectedDays
} from '../core/state.js';

import {
  todayKey,
  sanitizeHTML,
  showToast,
  genId,
  getTaskEmoji,
  getWeeklyDayColor,
  validateTaskDay,
  validateTaskDays,
  MONTHS
} from '../core/utils.js';

import {
  debouncedSave
} from '../core/firebase.js';

/* ─────────────────────────────────────────────────────────────
   WEEK HELPERS
───────────────────────────────────────────────────────────────*/

/**
 * Returns a human-readable week label like "12 May – 18 May".
 */
function wtGetWeekLabel() {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const o = { day: 'numeric', month: 'short' };
  return mon.toLocaleDateString('en-GB', o) + ' – ' + sun.toLocaleDateString('en-GB', o);
}

/**
 * Returns the Monday of the current week as YYYY-MM-DD.
 */
function wtGetCurrentWeekKey() {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return mon.toISOString().slice(0, 10);
}

/* ─────────────────────────────────────────────────────────────
   WEEK RESET
───────────────────────────────────────────────────────────────*/

/**
 * Resets all weekly tasks to incomplete when the week rolls over.
 * Converts Today/Tomorrow labels to Anytime.
 * Shows toast BEFORE saving so the message is accurate.
 */
export function wtCheckWeekReset() {
  const cw = wtGetCurrentWeekKey();
  if (state.weeklyTasksResetDate === cw) return;

  const doneBefore = (state.weeklyTasks || []).filter(t => t.done).length;

  state.weeklyTasksResetDate = cw;
  state.weeklyTasks = (state.weeklyTasks || []).map(t =>
    Object.assign({}, t, { done: false })
  );

  /* Convert Today/Tomorrow labels to Anytime for the new week */
  let movedCount = 0;
  state.weeklyTasks = state.weeklyTasks.map(t => {
    if (t.day === 'Today' || t.day === 'Tomorrow') {
      movedCount++;
      return Object.assign({}, t, { day: 'Anytime' });
    }
    return t;
  });

  /* Show toasts BEFORE save */
  if (movedCount > 0)
    showToast(movedCount + ' task' + (movedCount !== 1 ? 's' : '') + ' moved to Anytime for new week', 'yt');
  if (doneBefore > 0)
    showToast('New week! ' + doneBefore + ' completed tasks reset.', 'gt');

  debouncedSave(500);
}

/* ─────────────────────────────────────────────────────────────
   DAY PICKER
───────────────────────────────────────────────────────────────*/

/**
 * Builds the day pill buttons inside the add-task form.
 * Reads wtSelectedDays to apply the .sel class.
 */
export function wtBuildDayPicker() {
  const picker = document.getElementById('wt-day-picker');
  if (!picker) return;

  /* Attach click handlers to existing pills */
  picker.querySelectorAll('.wt-day-pill[data-day]').forEach(pill => {
    /* Remove any existing listener first to avoid duplicates */
    const newPill = pill.cloneNode(true);
    pill.parentNode.replaceChild(newPill, pill);

    newPill.addEventListener('click', () => {
      const day = newPill.dataset.day;
      const current = [...wtSelectedDays];
      if (current.includes(day)) {
        setWtSelectedDays(current.filter(d => d !== day));
      } else {
        setWtSelectedDays([...current, day]);
      }
      _refreshDayPills();
    });
  });

  _refreshDayPills();
}

function _refreshDayPills() {
  document.querySelectorAll('.wt-day-pill[data-day]').forEach(p => {
    p.classList.toggle('sel', wtSelectedDays.includes(p.dataset.day));
    p.setAttribute('aria-pressed', wtSelectedDays.includes(p.dataset.day) ? 'true' : 'false');
  });
}

/**
 * Sets the selected days to a preset group.
 * preset: 'everyday' | 'weekdays' | 'weekends' | 'clear'
 */
export function wtSetDayPreset(preset) {
  const map = {
    everyday: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    weekdays: ['Mon','Tue','Wed','Thu','Fri'],
    weekends: ['Sat','Sun'],
    clear:    []
  };
  setWtSelectedDays(map[preset] || []);
  _refreshDayPills();
}

/* ─────────────────────────────────────────────────────────────
   ADD / EDIT / DELETE TASKS
───────────────────────────────────────────────────────────────*/

/**
 * Adds a new weekly task from the input fields.
 */
export function wtAddTask() {
  const inp     = document.getElementById('wt-task-input');
  const noteInp = document.getElementById('wt-task-note');
  const name    = inp ? inp.value.trim() : '';

  if (!name)             { showToast('Enter a task name');                              return; }
  if (name.length > 80)  { showToast('Task name too long (max 80 characters)', 'yt');  return; }

  if (!state.weeklyTasks) state.weeklyTasks = [];

  const rawDay = wtSelectedDays.length > 0 ? wtSelectedDays.join(',') : 'Anytime';
  const day    = validateTaskDays(rawDay);

  state.weeklyTasks.push({
    id:        genId(),
    name,
    note:      noteInp ? noteInp.value.trim() : '',
    day,
    done:      false,
    createdAt: new Date().toISOString()
  });

  if (inp)     inp.value     = '';
  if (noteInp) noteInp.value = '';

  debouncedSave();
  wtRenderTasks();

  import('../tabs/today.js').then(m => {
    if (m.renderTodayWeeklyPanel) m.renderTodayWeeklyPanel();
  });

  showToast('Task added!', 'gt');
}

/**
 * Toggles a weekly task done/undone.
 */
export function wtToggleTask(id) {
  const t = (state.weeklyTasks || []).find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;

  debouncedSave();
  wtRenderTasks();
  wtUpdateStats();

  import('../tabs/today.js').then(m => {
    if (m.renderTodayWeeklyPanel) m.renderTodayWeeklyPanel();
  });
  import('../shared/theme.js').then(m => {
    if (m.updateSummaryCards) m.updateSummaryCards();
    if (m.updateStatsBanner)  m.updateStatsBanner();
  });
  import('../shared/badges.js').then(m => {
    if (m.checkBadgesDebounced) m.checkBadgesDebounced();
  });

  if (t.done) showToast('Done!', 'gt');
}

/**
 * Deletes a weekly task after confirmation.
 */
export function wtDeleteTask(id) {
  if (!confirm('Delete this task?')) return;
  state.weeklyTasks = (state.weeklyTasks || []).filter(x => x.id !== id);
  debouncedSave();
  wtRenderTasks();
  import('../tabs/today.js').then(m => {
    if (m.renderTodayWeeklyPanel) m.renderTodayWeeklyPanel();
  });
  showToast('Deleted');
}

/**
 * Opens the edit modal for a weekly task.
 */
export function wtOpenEdit(id) {
  const t = (state.weeklyTasks || []).find(x => x.id === id);
  if (!t) return;
  setWtEditingId(id);

  const nm  = document.getElementById('wet-name');
  const nt  = document.getElementById('wet-note');
  const dy  = document.getElementById('wet-day');

  if (nm) nm.value  = t.name || '';
  if (nt) nt.value  = t.note || '';
  if (dy) dy.value  = validateTaskDay(t.day || 'Anytime');

  const modal = document.getElementById('weekly-edit-modal');
  if (modal) { modal.classList.add('open'); if (nm) nm.focus(); }
}

/**
 * Saves the currently-edited weekly task.
 */
export function saveWeeklyEdit() {
  const capturedId = wtEditingId;
  if (!capturedId) return;

  const t = (state.weeklyTasks || []).find(x => x.id === capturedId);
  if (!t) return;

  const nm = document.getElementById('wet-name');
  const nt = document.getElementById('wet-note');
  const dy = document.getElementById('wet-day');

  const newName = nm ? nm.value.trim() : '';
  if (!newName) { showToast('Task name cannot be empty', 'yt'); return; }
  if (newName.length > 80) { showToast('Task name too long (max 80 characters)', 'yt'); return; }

  t.name = newName;
  if (nt) t.note = nt.value.trim();
  if (dy) t.day  = validateTaskDay(dy.value);

  debouncedSave();
  wtRenderTasks();
  import('../tabs/today.js').then(m => {
    if (m.renderTodayWeeklyPanel) m.renderTodayWeeklyPanel();
  });
  closeWeeklyEditModal();
  showToast('Updated!');
}

export function closeWeeklyEditModal() {
  const modal = document.getElementById('weekly-edit-modal');
  if (modal) modal.classList.remove('open');
  setWtEditingId(null);
}

/* ─────────────────────────────────────────────────────────────
   FILTER
───────────────────────────────────────────────────────────────*/

/**
 * Sets the active filter and re-renders the task list.
 */
export function wtSetFilter(btn, filter) {
  document.querySelectorAll('.weekly-filter-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  setWtFilter(filter);
  wtRenderTasks();
}

/* ─────────────────────────────────────────────────────────────
   BULK ACTIONS
───────────────────────────────────────────────────────────────*/

export function wtClearDone() {
  if (!confirm('Remove all completed tasks?')) return;
  state.weeklyTasks = (state.weeklyTasks || []).filter(t => !t.done);
  debouncedSave();
  wtRenderTasks();
  import('../tabs/today.js').then(m => {
    if (m.renderTodayWeeklyPanel) m.renderTodayWeeklyPanel();
  });
  showToast('Cleared');
}

export function wtResetWeek() {
  if (!confirm('Reset all weekly tasks to incomplete?')) return;
  state.weeklyTasks = (state.weeklyTasks || []).map(t =>
    Object.assign({}, t, { done: false })
  );
  debouncedSave();
  wtRenderTasks();
  import('../tabs/today.js').then(m => {
    if (m.renderTodayWeeklyPanel) m.renderTodayWeeklyPanel();
  });
  showToast('Reset');
}

/* ─────────────────────────────────────────────────────────────
   STATS
───────────────────────────────────────────────────────────────*/
export function wtUpdateStats() {
  const tasks    = state.weeklyTasks || [];
  const total    = tasks.length;
  const done     = tasks.filter(t => t.done).length;
  const pct      = total > 0 ? Math.round((done / total) * 100) : 0;
  const active   = tasks.filter(t => !t.done).length;

  const wd  = document.getElementById('ws-done');
  const wp  = document.getElementById('ws-progress');
  const wa  = document.getElementById('ws-active');
  const wpe = document.getElementById('ws-pending');
  const wc  = document.getElementById('weekly-tasks-count');

  if (wd)  wd.textContent  = String(done);
  if (wp)  wp.textContent  = pct + '%';
  if (wa)  wa.textContent  = String(active);
  if (wpe) wpe.textContent = String(total - done);
  if (wc)  wc.textContent  = done + '/' + total + ' done';
}

/* ─────────────────────────────────────────────────────────────
   RENDER TASKS
───────────────────────────────────────────────────────────────*/
export function wtRenderTasks() {
  const container = document.getElementById('weekly-task-list');
  if (!container) return;

  const sub = document.getElementById('weekly-hero-sub');
  if (sub) sub.textContent = 'Week of ' + wtGetWeekLabel();

  const tasks    = state.weeklyTasks || [];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayName= dayNames[new Date().getDay()];

  /* Filter tasks */
  let filtered;
  if      (wtFilter === 'all')    filtered = tasks;
  else if (wtFilter === 'active') filtered = tasks.filter(t => !t.done);
  else if (wtFilter === 'done')   filtered = tasks.filter(t =>  t.done);
  else if (wtFilter === 'today')  filtered = tasks.filter(t => {
    if (!t.day) return false;
    const days = t.day.split(',');
    return days.includes(todayName) ||
           days.includes('Today')   ||
           days.includes('Anytime');
  });
  else filtered = tasks.filter(t => {
    if (!t.day) return false;
    return t.day.split(',').includes(wtFilter);
  });

  wtUpdateStats();

  if (!filtered.length) {
    container.innerHTML =
      '<div class="weekly-empty">' +
        (tasks.length === 0
          ? 'No tasks yet. Add your first weekly task above!'
          : 'No tasks match this filter.') +
      '</div>';
    return;
  }

  container.innerHTML = '';

  filtered.forEach(t => {
    const dc       = getWeeklyDayColor(t.day);
    const emoji    = getTaskEmoji(t.name);
    const safeName = sanitizeHTML(t.name || '');
    const safeNote = sanitizeHTML(t.note || '');
    const safeDays = sanitizeHTML((t.day || '').split(',').join(' · '));

    const row = document.createElement('div');
    row.className = 'weekly-task-item' + (t.done ? ' wt-done' : '');
    row.setAttribute('role', 'listitem');

    row.innerHTML =
      /* Checkbox */
      '<div class="weekly-cb' + (t.done ? ' checked' : '') + '" ' +
        'data-action="wt-toggle" data-id="' + t.id + '" ' +
        'role="checkbox" ' +
        'aria-checked="' + (t.done ? 'true' : 'false') + '" ' +
        'tabindex="0" ' +
        'aria-label="' + safeName + '" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){' +
          'event.preventDefault();wtToggleTask(\'' + t.id + '\')}' +
        '"></div>' +

      /* Emoji icon */
      '<div class="weekly-task-icon" ' +
        'style="background:' + dc.bg + ';border-color:' + dc.color + '40;" ' +
        'aria-hidden="true">' + emoji +
      '</div>' +

      /* Task body */
      '<div class="weekly-task-body">' +
        '<div class="weekly-task-name">' + safeName + '</div>' +
        (safeNote ? '<div class="weekly-task-note">' + safeNote + '</div>' : '') +
      '</div>' +

      /* Actions */
      '<div class="weekly-task-actions">' +
        '<span class="weekly-day-badge" ' +
          'style="background:' + dc.bg + ';color:' + dc.color + ';">' +
          safeDays +
        '</span>' +
        '<button class="weekly-edit-btn" ' +
          'data-action="wt-edit" data-id="' + t.id + '" ' +
          'aria-label="Edit task: ' + safeName + '">Edit</button>' +
        '<button class="weekly-del-btn" ' +
          'data-action="wt-delete" data-id="' + t.id + '" ' +
          'aria-label="Delete task: ' + safeName + '">✕</button>' +
      '</div>';

    container.appendChild(row);
  });
}

/* ─────────────────────────────────────────────────────────────
   PAGE BUILDER
───────────────────────────────────────────────────────────────*/
export function buildWeeklyPage() {
  const page = document.getElementById('page-weekly');
  if (!page || page.children.length > 0) return;

  _injectWeeklyCSS();

  page.innerHTML = `

    <!-- Hero -->
    <div class="weekly-hero" role="banner">
      <div class="weekly-hero-label">WEEKLY PLANNER</div>
      <div class="weekly-hero-title">This Week</div>
      <div class="weekly-hero-sub" id="weekly-hero-sub">All tasks for the week</div>
    </div>

    <!-- Stats row -->
    <div class="weekly-stats-row" role="region" aria-label="Weekly task statistics">
      <div class="weekly-stat-item">
        <div class="weekly-stat-num" id="ws-done"
             style="color:#22c55e;" aria-live="polite">0</div>
        <div class="weekly-stat-lbl">DONE</div>
      </div>
      <div class="weekly-stat-item">
        <div class="weekly-stat-num" id="ws-progress"
             style="color:#7c3aed;" aria-live="polite">0%</div>
        <div class="weekly-stat-lbl">PROGRESS</div>
      </div>
      <div class="weekly-stat-item">
        <div class="weekly-stat-num" id="ws-active"
             style="color:#0284c7;" aria-live="polite">0</div>
        <div class="weekly-stat-lbl">ACTIVE</div>
      </div>
      <div class="weekly-stat-item">
        <div class="weekly-stat-num" id="ws-pending"
             style="color:#f59e0b;" aria-live="polite">0</div>
        <div class="weekly-stat-lbl">PENDING</div>
      </div>
    </div>

    <!-- Tasks card -->
    <div class="weekly-tasks-card">

      <!-- Card header -->
      <div class="weekly-tasks-header">
        <div class="weekly-tasks-title">
          <span aria-hidden="true">📋</span> Weekly Tasks
        </div>
        <span class="weekly-tasks-count"
              id="weekly-tasks-count" aria-live="polite">0/0 done</span>
      </div>

      <!-- Add task form -->
      <div style="padding:12px 16px;border-bottom:1px solid rgba(139,92,246,0.05);">

        <div class="weekly-add-row">
          <input
            class="weekly-add-input"
            id="wt-task-input"
            placeholder="Add a new weekly task..."
            maxlength="80"
            aria-label="New weekly task name"
            onkeydown="if(event.key==='Enter') wtAddTask()"
          />
          <input
            class="weekly-add-note"
            id="wt-task-note"
            placeholder="Sub-note (optional)"
            maxlength="60"
            aria-label="Task sub-note"
          />

          <!-- Day picker -->
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div class="wt-day-picker" id="wt-day-picker"
                 role="group" aria-label="Select days">
              <button type="button" class="wt-day-pill sel"
                      data-day="Mon" aria-pressed="true">Mon</button>
              <button type="button" class="wt-day-pill"
                      data-day="Tue" aria-pressed="false">Tue</button>
              <button type="button" class="wt-day-pill"
                      data-day="Wed" aria-pressed="false">Wed</button>
              <button type="button" class="wt-day-pill"
                      data-day="Thu" aria-pressed="false">Thu</button>
              <button type="button" class="wt-day-pill"
                      data-day="Fri" aria-pressed="false">Fri</button>
              <button type="button" class="wt-day-pill"
                      data-day="Sat" aria-pressed="false">Sat</button>
              <button type="button" class="wt-day-pill"
                      data-day="Sun" aria-pressed="false">Sun</button>
            </div>

            <!-- Day presets -->
            <div class="wt-day-presets">
              <button type="button" class="wt-preset-chip"
                      onclick="wtSetDayPreset('everyday')">Everyday</button>
              <button type="button" class="wt-preset-chip"
                      onclick="wtSetDayPreset('weekdays')">Weekdays (Mon–Fri)</button>
              <button type="button" class="wt-preset-chip"
                      onclick="wtSetDayPreset('weekends')">Weekends (Sat–Sun)</button>
              <button type="button" class="wt-preset-chip"
                      onclick="wtSetDayPreset('clear')">Clear</button>
            </div>
          </div>

          <button class="weekly-add-btn" onclick="wtAddTask()"
                  aria-label="Add weekly task">+ Add</button>
        </div>

      </div><!-- /add form -->

      <!-- Filter row -->
      <div class="weekly-filter-row" role="group" aria-label="Task day filters">
        <button class="weekly-filter-btn active"
                data-action="wt-filter" data-filter="all"
                aria-pressed="true">All</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="active"
                aria-pressed="false">Active</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="done"
                aria-pressed="false">Done</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="today"
                aria-pressed="false">Today</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Mon"
                aria-pressed="false">Mon</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Tue"
                aria-pressed="false">Tue</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Wed"
                aria-pressed="false">Wed</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Thu"
                aria-pressed="false">Thu</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Fri"
                aria-pressed="false">Fri</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Sat"
                aria-pressed="false">Sat</button>
        <button class="weekly-filter-btn"
                data-action="wt-filter" data-filter="Sun"
                aria-pressed="false">Sun</button>
      </div>

      <!-- Task list -->
      <div id="weekly-task-list"
           style="padding:8px 0;"
           role="list"
           aria-label="Weekly tasks"
           aria-live="polite">
      </div>

    </div><!-- /weekly-tasks-card -->

    <!-- Bottom actions -->
    <div class="reset-row">
      <button class="rbtn" onclick="wtClearDone()">Clear completed tasks</button>
    </div>
    <div class="reset-row" style="padding-top:0;">
      <button class="rbtn danger" onclick="wtResetWeek()">Reset all weekly tasks</button>
    </div>
  `;

  /* Attach day picker listeners after HTML is injected */
  wtBuildDayPicker();
}

/* ─────────────────────────────────────────────────────────────
   CSS INJECTOR
───────────────────────────────────────────────────────────────*/
function _injectWeeklyCSS() {
  if (document.getElementById('weekly-css')) return;
  const s = document.createElement('style');
  s.id    = 'weekly-css';
  s.textContent = `
    .weekly-hero {
      background: linear-gradient(135deg,#064e3b 0%,#065f46 60%,#047857 100%);
      border-radius: var(--r-xl);
      padding: 20px 18px 16px;
      margin-bottom: 14px;
      position: relative;
      overflow: hidden;
    }
    .weekly-hero-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #6ee7b7;
      margin-bottom: 4px;
    }
    .weekly-hero-title {
      font-size: 26px;
      font-weight: 900;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .weekly-hero-sub {
      font-size: 12px;
      color: #a7f3d0;
      font-weight: 500;
    }
    .weekly-stats-row {
      display: grid;
      grid-template-columns: repeat(4,1fr);
      gap: 0;
      background: #fff;
      border-radius: var(--r-xl);
      overflow: hidden;
      border: 1px solid rgba(139,92,246,0.06);
      margin-bottom: 14px;
      box-shadow: var(--shadow-card);
    }
    .weekly-stat-item {
      padding: 14px 10px;
      text-align: center;
      border-right: 1px solid rgba(139,92,246,0.06);
    }
    .weekly-stat-item:last-child { border-right: none; }
    .weekly-stat-num {
      font-size: 28px;
      font-weight: 900;
      line-height: 1;
      margin-bottom: 3px;
    }
    .weekly-stat-lbl {
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .weekly-tasks-card {
      background: var(--surface-elevated);
      border-radius: var(--r-xl);
      border: 1px solid rgba(139,92,246,0.05);
      overflow: hidden;
      box-shadow: var(--shadow-card);
    }
    .weekly-tasks-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid rgba(139,92,246,0.05);
    }
    .weekly-tasks-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 900;
      color: var(--text-primary);
    }
    .weekly-tasks-count {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(139,92,246,0.06);
      border-radius: var(--r-pill);
      padding: 3px 10px;
    }
    .weekly-add-row {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
      align-items: center;
      flex-wrap: wrap;
    }
    @media(max-width:479px) {
      .weekly-add-row { flex-direction: column; }
      .weekly-add-input, .weekly-add-note, .weekly-add-btn { width: 100%; }
    }
    .weekly-add-input {
      flex: 1;
      min-width: 180px;
      font-size: 16px;
      padding: 12px 16px;
      border: 1.5px solid rgba(200,195,240,.7);
      border-radius: var(--r-pill);
      background: #fff;
      color: var(--text-primary);
      outline: none;
      font-family: var(--font);
    }
    .weekly-add-input:focus { border-color: var(--purple-500); }
    .weekly-add-note {
      flex: 1;
      min-width: 140px;
      font-size: 16px;
      padding: 12px 14px;
      border: 1.5px solid rgba(200,195,240,.7);
      border-radius: var(--r-pill);
      background: #fff;
      color: var(--text-primary);
      outline: none;
      font-family: var(--font);
    }
    .weekly-add-btn {
      padding: 12px 20px;
      background: linear-gradient(135deg,var(--purple-600),var(--purple-700));
      color: #fff;
      border: none;
      border-radius: var(--r-pill);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      font-family: var(--font);
      white-space: nowrap;
    }
    .weekly-filter-row {
      display: flex;
      gap: 6px;
      margin-bottom: 14px;
      overflow-x: auto;
      flex-wrap: nowrap;
      scrollbar-width: none;
      padding: 4px 16px 8px;
      -webkit-overflow-scrolling: touch;
    }
    .weekly-filter-row::-webkit-scrollbar { display: none; }
    .weekly-filter-btn {
      font-size: 11px;
      font-weight: 600;
      padding: 5px 14px;
      border-radius: var(--r-pill);
      border: 1.5px solid rgba(200,195,240,.7);
      background: #fff;
      color: var(--text-muted);
      cursor: pointer;
      transition: all .2s;
      font-family: var(--font);
      flex-shrink: 0;
    }
    .weekly-filter-btn.active {
      background: var(--purple-600);
      border-color: var(--purple-600);
      color: #fff;
    }
    .weekly-task-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 11px 14px;
      border-bottom: 1px solid rgba(139,92,246,0.04);
      transition: background .15s;
      min-height: 52px;
    }
    .weekly-task-item:last-child { border-bottom: none; }
    .weekly-task-item:hover      { background: rgba(139,92,246,0.02); }
    .weekly-task-item.wt-done    { background: rgba(34,197,94,0.04); }
    .weekly-task-icon {
      width: 32px;
      height: 32px;
      min-width: 32px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
      border: 1.5px solid rgba(200,195,240,.5);
    }
    .weekly-task-body { flex: 1; min-width: 0; padding-right: 4px; }
    .weekly-task-name {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1.35;
      white-space: normal;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      word-break: break-word;
    }
    .weekly-task-item.wt-done .weekly-task-name {
      text-decoration: line-through;
      color: var(--text-muted);
    }
    .weekly-task-note {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
      line-height: 1.3;
    }
    .weekly-task-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .weekly-day-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: var(--r-pill);
      flex-shrink: 0;
      white-space: nowrap;
    }
    .weekly-edit-btn {
      font-size: 10px;
      font-weight: 700;
      padding: 4px 9px;
      border-radius: var(--r-pill);
      border: 1px solid var(--purple-200);
      background: var(--purple-50);
      color: var(--purple-600);
      cursor: pointer;
      font-family: var(--font);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .weekly-edit-btn:hover {
      background: var(--purple-600);
      color: #fff;
    }
    .weekly-del-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 1px solid rgba(220,38,38,0.2);
      background: rgba(254,242,242,0.8);
      color: var(--red-400);
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all .15s;
      flex-shrink: 0;
    }
    .weekly-del-btn:hover {
      background: var(--red-500);
      color: #fff;
      border-color: var(--red-500);
    }
    .weekly-cb {
      width: 20px;
      height: 20px;
      min-width: 20px;
      border-radius: 50%;
      border: 2px solid rgba(200,195,240,.8);
      flex-shrink: 0;
      position: relative;
      cursor: pointer;
      transition: all .2s;
      background: #fff;
    }
    .weekly-cb::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 6px;
      width: 5px;
      height: 8px;
      border: 2.5px solid #fff;
      border-top: none;
      border-left: none;
      transform: rotate(45deg);
      opacity: 0;
      transition: opacity .15s;
    }
    .weekly-cb.checked {
      background: var(--green-500);
      border-color: var(--green-500);
    }
    .weekly-cb.checked::after { opacity: 1; }
    .weekly-empty {
      padding: 32px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }
    .wt-day-picker {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .wt-day-pill {
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1.5px solid rgba(200,195,240,.7);
      background: #fff;
      color: var(--text-muted);
      transition: all .18s;
      font-family: var(--font);
      min-height: 34px;
    }
    .wt-day-pill.sel {
      background: var(--purple-600);
      border-color: var(--purple-600);
      color: #fff;
    }
    .wt-day-presets {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .wt-preset-chip {
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(200,195,240,.6);
      background: rgba(255,255,255,.6);
      color: var(--text-muted);
      transition: all .2s;
      font-family: var(--font);
    }
    .wt-preset-chip:hover {
      background: var(--purple-100);
      border-color: var(--purple-200);
      color: var(--purple-600);
    }
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────────────────────
   AUTO-BUILD PAGE ON MODULE LOAD
───────────────────────────────────────────────────────────────*/
document.addEventListener('DOMContentLoaded', () => {
  buildWeeklyPage();
});
