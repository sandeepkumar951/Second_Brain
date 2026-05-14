/* ═══════════════════════════════════════════════════════════════
   tabs/reminders.js
   Reminders tab — notification permission, reminder list,
   add/edit/delete reminders, preset chips, reminder engine,
   in-app notification display, home reminders panel.
   Depends on: core/state.js, core/utils.js, core/firebase.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  DB_KEY_FIRED,
  /* flags */
  selDays,      setSelDays,
  firedToday,   setFiredToday,
  _reminderFirstCheck, setReminderFirstCheck,
  inAppTimeoutId,      setInAppTimeoutId
} from '../core/state.js';

import {
  todayKey,
  sanitizeHTML,
  showToast,
  genId,
  validateTimeString,
  formatTime12,
  DAY_NAMES,
  safeLocalStorageSave,
  saveFiredToday
} from '../core/utils.js';

import {
  debouncedSave
} from '../core/firebase.js';

/* ─────────────────────────────────────────────────────────────
   REMINDER PRESETS
───────────────────────────────────────────────────────────────*/
const REMINDER_PRESETS = [
  { title: 'Drink water',     msg: 'Stay hydrated!',               time: '10:00', icon: '💧', days: [0,1,2,3,4,5,6] },
  { title: 'Take tablets',    msg: "Don't forget!",                time: '21:00', icon: '💊', days: [0,1,2,3,4,5,6] },
  { title: 'Study time',      msg: '4 hours — no distractions!',   time: '09:00', icon: '📚', days: [1,2,3,4,5]     },
  { title: 'Morning routine', msg: 'Lemon water, almonds, amla',   time: '06:30', icon: '🌅', days: [0,1,2,3,4,5,6] },
  { title: 'Sleep reminder',  msg: 'Wind down. Sleep by 10 PM',    time: '21:30', icon: '🌙', days: [0,1,2,3,4,5,6] },
  { title: 'Lunch time',      msg: 'Dal + veggies + roti!',        time: '13:00', icon: '🥗', days: [1,2,3,4,5]     },
  { title: 'Evening walk',    msg: 'Get some steps in!',           time: '17:30', icon: '🏃', days: [0,1,2,3,4,5,6] },
  { title: 'Read English',    msg: '10-15 min reading',            time: '20:00', icon: '📚', days: [0,1,2,3,4,5,6] }
];

/* ─────────────────────────────────────────────────────────────
   NOTIFICATION PERMISSION
───────────────────────────────────────────────────────────────*/

/**
 * Updates the permission status dot and text in the UI.
 */
export function updateNotifStatusUI() {
  const dot = document.getElementById('notif-dot');
  const txt = document.getElementById('notif-status-text');
  const btn = document.getElementById('notif-enable-btn');
  if (!dot || !txt || !btn) return;

  if (!('Notification' in window)) {
    dot.className    = 'notif-status-dot denied';
    txt.textContent  = 'Not supported on this device.';
    btn.style.display= 'none';
    return;
  }

  const p = Notification.permission;
  if (p === 'granted') {
    dot.className    = 'notif-status-dot granted';
    txt.textContent  = 'Notifications enabled!';
    btn.style.display= 'none';
  } else if (p === 'denied') {
    dot.className    = 'notif-status-dot denied';
    txt.textContent  = 'Blocked — check browser settings.';
    btn.style.display= 'block';
  } else {
    dot.className    = 'notif-status-dot';
    txt.textContent  = 'Tap Enable to receive reminders.';
    btn.style.display= 'block';
  }
}

/**
 * Requests notification permission from the browser.
 */
export function requestNotifPermission() {
  if (!('Notification' in window)) { showToast('Not supported'); return; }
  Notification.requestPermission().then(p => {
    updateNotifStatusUI();
    if (p === 'granted') showToast('Notifications enabled!', 'gt');
  });
}

/* ─────────────────────────────────────────────────────────────
   FIRE NOTIFICATION
───────────────────────────────────────────────────────────────*/

/**
 * Shows an in-app notification and a browser push notification.
 * Both degrade gracefully if unavailable.
 */
export function fireNotification(title, body, icon) {
  showInAppNotif(icon || '🔔', title, body);

  import('../tabs/today.js').then(m => {
    if (m.renderHomeReminders) m.renderHomeReminders();
  });

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body || '',
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
              "viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E" +
              "%F0%9F%A7%A0%3C/text%3E%3C/svg%3E",
        tag: title + '_' + new Date().toISOString().slice(0, 16)
      });
    } catch (e) {}
  }
}

/* ─────────────────────────────────────────────────────────────
   IN-APP NOTIFICATION
───────────────────────────────────────────────────────────────*/

/**
 * Shows the in-app notification banner.
 * Auto-dismisses after 7 seconds.
 */
export function showInAppNotif(icon, title, msg) {
  const el      = document.getElementById('inapp-notif');    if (!el) return;
  const iconEl  = document.getElementById('inapp-icon');
  const titleEl = document.getElementById('inapp-title');
  const msgEl   = document.getElementById('inapp-msg');

  if (iconEl)  iconEl.textContent  = icon  || '';
  if (titleEl) titleEl.textContent = title || '';
  if (msgEl)   msgEl.textContent   = msg   || '';

  el.classList.add('show');

  const ar = document.getElementById('aria-announce');
  if (ar) ar.textContent = title + (msg ? '. ' + msg : '');

  clearTimeout(inAppTimeoutId);
  setInAppTimeoutId(setTimeout(closeInApp, 7000));
}

/**
 * Dismisses the in-app notification banner.
 */
export function closeInApp() {
  const el = document.getElementById('inapp-notif');
  if (el) el.classList.remove('show');
  clearTimeout(inAppTimeoutId);
  setInAppTimeoutId(null);
}

/* ─────────────────────────────────────────────────────────────
   REMINDER ENGINE
───────────────────────────────────────────────────────────────*/

/**
 * Checks all enabled reminders against the current time.
 * Fires any that match and have not already fired today.
 * The first check bypasses the 30-second guard.
 */
export function checkReminders() {
  const now  = new Date();
  const h    = String(now.getHours()).padStart(2, '0');
  const m    = String(now.getMinutes()).padStart(2, '0');
  const time = h + ':' + m;
  const day  = now.getDay();
  const date = todayKey();

  if (!_reminderFirstCheck) {
    if (!checkReminders._startTime) checkReminders._startTime = Date.now();
    if (Date.now() - checkReminders._startTime < 30000) return;
  }
  setReminderFirstCheck(false);
  if (!checkReminders._startTime) checkReminders._startTime = Date.now();

  const deletedIds = new Set(state.deletedReminderIds || []);

  (state.reminders || []).forEach(r => {
    if (!r.enabled)              return;
    if (!r.days.includes(day))   return;
    if (r.time !== time)         return;
    if (deletedIds.has(r.id))    return;

    const key = r.id + '_' + date + '_' + r.time;
    if (firedToday[key])         return;

    firedToday[key] = true;
    saveFiredToday();
    fireNotification(r.title, r.msg, r.icon);
  });

  _checkMissedTasksBanner();
}
checkReminders._startTime = null;

/**
 * Checks if the missed tasks banner should be shown.
 * Delegates to today.js to avoid circular imports.
 */
function _checkMissedTasksBanner() {
  import('../tabs/today.js').then(m => {
    if (m.checkMissedTasksBanner) m.checkMissedTasksBanner();
  });
}

/* ─────────────────────────────────────────────────────────────
   DAYS PICKER
───────────────────────────────────────────────────────────────*/

/**
 * Builds the day-of-week button row in the add reminder form.
 */
export function buildDaysPicker() {
  const w = document.getElementById('days-picker');
  if (!w) return;

  w.innerHTML = '';
  const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  names.forEach((d, i) => {
    const btn = document.createElement('button');
    btn.className = 'day-btn' + (selDays.includes(i) ? ' sel' : '');
    btn.textContent = d;
    btn.type = 'button';
    btn.setAttribute('aria-pressed', selDays.includes(i) ? 'true' : 'false');
    btn.setAttribute('aria-label',   d + (selDays.includes(i) ? ' selected' : ''));

    btn.onclick = () => {
      const current = [...selDays];
      if (current.includes(i)) setSelDays(current.filter(x => x !== i));
      else                     setSelDays([...current, i]);
      buildDaysPicker();
    };

    w.appendChild(btn);
  });
}

/* ─────────────────────────────────────────────────────────────
   PRESET CHIPS
───────────────────────────────────────────────────────────────*/

/**
 * Builds the quick-preset chips. Called once — guards duplicate builds.
 */
export function buildPresetChips() {
  const w = document.getElementById('preset-chips');
  if (!w || w.children.length > 0) return;

  REMINDER_PRESETS.forEach(p => {
    const c = document.createElement('div');
    c.className = 'preset-chip';
    c.textContent = p.icon + ' ' + p.title;
    c.setAttribute('role',       'button');
    c.setAttribute('tabindex',   '0');
    c.setAttribute('aria-label', 'Load preset: ' + p.title);

    c.onclick = () => {
      const rt   = document.getElementById('r-title');
      const rm   = document.getElementById('r-msg');
      const rtime= document.getElementById('r-time');
      const ri   = document.getElementById('r-icon');

      if (rt)    rt.value    = p.title;
      if (rm)    rm.value    = p.msg;
      if (rtime) rtime.value = p.time;
      if (ri)    ri.value    = p.icon;

      setSelDays(p.days.slice());
      buildDaysPicker();
      showToast('Preset loaded');
    };

    c.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
    };

    w.appendChild(c);
  });
}

/* ─────────────────────────────────────────────────────────────
   REMINDER LIST
───────────────────────────────────────────────────────────────*/

/**
 * Renders all reminders in the reminder list panel.
 */
export function renderReminderList() {
  const list = document.getElementById('reminder-list');
  if (!list) return;

  const rems = state.reminders || [];
  const tag  = document.getElementById('r-count-tag');
  if (tag)  tag.textContent = rems.filter(r => r.enabled).length + ' active';

  list.innerHTML = '';

  if (!rems.length) {
    const e = document.createElement('div');
    e.className   = 'tempty';
    e.textContent = 'No reminders yet.';
    list.appendChild(e);
    return;
  }

  rems.forEach((r, i) => {
    const allD  = r.days.length === 7;
    const isWD  = [1,2,3,4,5].every(d => r.days.includes(d)) && r.days.length === 5;
    const dL    = allD
      ? 'Every day'
      : isWD
        ? 'Weekdays'
        : r.days.slice().sort((a,b) => a-b).map(d => DAY_NAMES[d]).join(', ');

    const hh    = +r.time.split(':')[0];
    const mm    = r.time.split(':')[1];
    const tL    = ((hh % 12) || 12) + ':' + mm + ' ' + (hh < 12 ? 'AM' : 'PM');

    const row   = document.createElement('div');
    row.className = 'reminder-item';
    row.setAttribute('role', 'listitem');

    row.innerHTML =
      '<div class="reminder-icon-box" aria-hidden="true">' + r.icon + '</div>' +
      '<div class="reminder-body">' +
        '<div class="reminder-title">'    + sanitizeHTML(r.title || '') + '</div>' +
        '<div class="reminder-time-row">' + tL + ' · ' + sanitizeHTML(dL) + '</div>' +
        (r.msg
          ? '<div class="reminder-msg-row">"' + sanitizeHTML(r.msg) + '"</div>'
          : '') +
      '</div>' +
      '<label class="r-toggle" aria-label="Toggle ' + sanitizeHTML(r.title || '') + '">' +
        '<input type="checkbox"' + (r.enabled ? ' checked' : '') +
          ' data-action="toggle-reminder" data-index="' + i + '"' +
          ' aria-label="Enable ' + sanitizeHTML(r.title || '') + '"/>' +
        '<span class="r-slider"></span>' +
      '</label>' +
      '<button class="reminder-del-btn" ' +
        'data-action="delete-reminder" data-index="' + i + '"' +
        ' aria-label="Delete reminder: ' + sanitizeHTML(r.title || '') + '">×</button>';

    list.appendChild(row);
  });
}

/* ─────────────────────────────────────────────────────────────
   TOGGLE / DELETE
───────────────────────────────────────────────────────────────*/

/**
 * Toggles a reminder enabled/disabled.
 */
export function toggleReminder(i, v) {
  const r = (state.reminders || [])[i];
  if (!r) return;
  r.enabled = v;
  state.remindersUpdatedAt = Date.now();
  debouncedSave();
  renderReminderList();
  import('../tabs/today.js').then(m => {
    if (m.renderHomeReminders) m.renderHomeReminders();
  });
  showToast(v ? 'Enabled' : 'Paused');
}

/**
 * Deletes a reminder after confirmation.
 * Adds the ID to deletedReminderIds so other devices sync the deletion.
 */
export function deleteReminder(i) {
  if (!confirm('Delete this reminder?')) return;

  const reminder = (state.reminders || [])[i];
  if (reminder && reminder.id) {
    if (!state.deletedReminderIds) state.deletedReminderIds = [];
    if (!state.deletedReminderIds.includes(reminder.id)) {
      state.deletedReminderIds.push(reminder.id);
    }
    /* Hard cap */
    if (state.deletedReminderIds.length > 100)
      state.deletedReminderIds = state.deletedReminderIds.slice(-100);
  }

  state.reminders          = (state.reminders || []).filter((_, idx) => idx !== i);
  state.remindersUpdatedAt = Date.now();

  debouncedSave();
  renderReminderList();
  import('../tabs/today.js').then(m => {
    if (m.renderHomeReminders) m.renderHomeReminders();
  });
  showToast('Deleted');
}

/* ─────────────────────────────────────────────────────────────
   ADD REMINDER
───────────────────────────────────────────────────────────────*/

/**
 * Reads the add-reminder form and creates a new reminder.
 * Resets ALL form fields after adding.
 */
export function addReminder() {
  const titleEl = document.getElementById('r-title');
  const msgEl   = document.getElementById('r-msg');
  const timeEl  = document.getElementById('r-time');
  const iconEl  = document.getElementById('r-icon');

  const titleVal = titleEl ? titleEl.value.trim() : '';
  const timeVal  = timeEl  ? timeEl.value         : '';

  if (!titleVal)                    { showToast('Enter a title');             return; }
  if (titleVal.length > 60)         { showToast('Title too long (max 60 characters)', 'yt'); return; }
  if (!validateTimeString(timeVal)) { showToast('Invalid time format', 'rt'); return; }
  if (!selDays.length)              { showToast('Select at least one day');   return; }

  if (!state.reminders) state.reminders = [];

  state.reminders.push({
    id:      genId(),
    title:   titleVal,
    msg:     msgEl ? msgEl.value.trim() : '',
    time:    timeVal,
    icon:    iconEl ? iconEl.value : '🔔',
    days:    selDays.slice(),
    enabled: true
  });

  state.remindersUpdatedAt = Date.now();
  debouncedSave();
  renderReminderList();

  import('../tabs/today.js').then(m => {
    if (m.renderHomeReminders) m.renderHomeReminders();
  });

  /* Reset ALL form fields */
  if (titleEl) titleEl.value    = '';
  if (msgEl)   msgEl.value      = '';
  if (timeEl)  timeEl.value     = '08:00';
  if (iconEl)  iconEl.selectedIndex = 0;
  setSelDays([0,1,2,3,4,5,6]);
  buildDaysPicker();

  showToast('Reminder set for ' + formatTime12(timeVal) + '!', 'gt');
}

/* ─────────────────────────────────────────────────────────────
   PAGE BUILDER
───────────────────────────────────────────────────────────────*/
export function buildRemindersPage() {
  const page = document.getElementById('page-reminders');
  if (!page || page.children.length > 0) return;

  _injectRemindersCSS();

  page.innerHTML = `

    <!-- Notification permission card -->
    <div class="sc">
      <div class="sh">
        <span class="si" aria-hidden="true">🔔</span>
        <span class="st">Notification permission</span>
      </div>
      <div class="notif-status-bar" role="status" aria-live="polite">
        <div class="notif-status-dot" id="notif-dot"></div>
        <span class="notif-status-text" id="notif-status-text">Checking...</span>
        <button class="notif-enable-btn" id="notif-enable-btn"
                onclick="requestNotifPermission()">Enable</button>
      </div>
      <div class="abox blue" style="margin:8px 14px 10px;">
        Works best on Android Chrome. On iOS, add to Home Screen first then use Safari.
      </div>
    </div>

    <!-- Quick presets card -->
    <div class="sc">
      <div class="sh">
        <span class="si" aria-hidden="true">⚡</span>
        <span class="st">Quick presets</span>
      </div>
      <div class="preset-chips" id="preset-chips"
           role="group" aria-label="Quick preset reminders">
      </div>
    </div>

    <!-- My reminders card -->
    <div class="sc">
      <div class="sh">
        <span class="si" aria-hidden="true">📋</span>
        <span class="st">My reminders</span>
        <span class="r-count-tag" id="r-count-tag" aria-live="polite">0 active</span>
      </div>
      <div class="reminder-list" id="reminder-list"
           role="list"
           aria-label="My reminders"
           aria-live="polite">
      </div>
    </div>

    <!-- Add new reminder card -->
    <div class="sc">
      <div class="sh">
        <span class="si" aria-hidden="true">➕</span>
        <span class="st">Add new reminder</span>
      </div>
      <div class="add-reminder-form">

        <div>
          <label class="form-label" for="r-title">Title</label>
          <input class="form-input" id="r-title"
                 placeholder="e.g. Drink water"
                 maxlength="60"
                 aria-label="Reminder title"/>
        </div>

        <div>
          <label class="form-label" for="r-msg">Message (optional)</label>
          <input class="form-input" id="r-msg"
                 placeholder="e.g. Stay hydrated!"
                 maxlength="100"
                 aria-label="Reminder message"/>
        </div>

        <div class="form-row">
          <div style="flex:1;">
            <label class="form-label" for="r-time">Time</label>
            <input class="time-input" id="r-time"
                   type="time" value="08:00"
                   aria-label="Reminder time"/>
          </div>
          <div>
            <label class="form-label" for="r-icon">Icon</label>
            <select class="icon-select" id="r-icon" aria-label="Reminder icon">
              <option>💧</option>
              <option>🌅</option>
              <option>🍳</option>
              <option>💊</option>
              <option>📚</option>
              <option>🏃</option>
              <option>🌙</option>
              <option>🥗</option>
              <option>☕</option>
              <option>🧘</option>
              <option>💪</option>
              <option>⏰</option>
              <option>🔔</option>
              <option>❤️</option>
              <option>🍎</option>
              <option>🌿</option>
            </select>
          </div>
        </div>

        <div>
          <label class="form-label">Repeat on days</label>
          <div class="days-picker" id="days-picker"
               role="group" aria-label="Repeat days">
          </div>
        </div>

        <button class="add-reminder-btn" onclick="addReminder()">
          Set Reminder
        </button>

      </div>
    </div>
  `;

  /* Build presets and days picker after HTML is injected */
  buildPresetChips();
  buildDaysPicker();
}

/* ─────────────────────────────────────────────────────────────
   CSS INJECTOR
───────────────────────────────────────────────────────────────*/
function _injectRemindersCSS() {
  if (document.getElementById('rem-css')) return;
  const s = document.createElement('style');
  s.id    = 'rem-css';
  s.textContent = `
    .notif-status-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(139,92,246,.06);
    }
    .notif-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ccc;
      flex-shrink: 0;
    }
    .notif-status-dot.granted { background: var(--green-500); }
    .notif-status-dot.denied  { background: var(--red-500);   }
    .notif-status-text {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      flex: 1;
    }
    .notif-enable-btn {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: var(--r-pill);
      border: 1px solid var(--purple-200);
      background: var(--purple-100);
      color: var(--purple-600);
      cursor: pointer;
      font-family: var(--font);
    }
    .reminder-list { padding: 4px 0; }
    .reminder-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 14px;
      border-bottom: 1px solid rgba(139,92,246,.06);
    }
    .reminder-item:last-child { border-bottom: none; }
    .reminder-icon-box {
      font-size: 18px;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--purple-100);
      flex-shrink: 0;
    }
    .reminder-body     { flex: 1; min-width: 0; }
    .reminder-title    { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .reminder-time-row { font-size: 11px; color: var(--text-muted); margin-top: 1px; }
    .reminder-msg-row  {
      font-size: 10px;
      color: var(--text-muted);
      font-style: italic;
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .r-toggle {
      position: relative;
      width: 38px;
      height: 20px;
      flex-shrink: 0;
    }
    .r-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .r-slider {
      position: absolute;
      inset: 0;
      background: #D1D5DB;
      border-radius: 20px;
      cursor: pointer;
      transition: .3s;
    }
    .r-slider::before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      left: 3px;
      top: 3px;
      transition: .3s;
      box-shadow: 0 1px 3px rgba(0,0,0,.15);
    }
    .r-toggle input:checked + .r-slider             { background: var(--purple-600); }
    .r-toggle input:checked + .r-slider::before     { transform: translateX(18px); }
    .reminder-del-btn {
      font-size: 18px;
      color: var(--text-muted);
      cursor: pointer;
      background: none;
      border: none;
      padding: 0 2px;
      line-height: 1;
    }
    .reminder-del-btn:hover { color: var(--red-500); }
    .add-reminder-form {
      padding: 12px 14px 16px;
      border-top: 1px solid rgba(139,92,246,.06);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .form-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 2px;
      display: block;
      text-transform: uppercase;
      letter-spacing: .4px;
    }
    .form-input {
      width: 100%;
      font-size: 16px;
      padding: 9px 12px;
      border: 1.5px solid rgba(200,195,240,.7);
      border-radius: var(--r-pill);
      background: rgba(255,255,255,.7);
      color: var(--text-primary);
      outline: none;
      font-family: var(--font);
    }
    .form-row { display: flex; gap: 7px; }
    .time-input {
      flex: 1;
      font-size: 16px;
      padding: 9px 12px;
      border: 1.5px solid rgba(200,195,240,.7);
      border-radius: var(--r-pill);
      background: rgba(255,255,255,.7);
      color: var(--text-primary);
      outline: none;
      font-family: var(--font);
    }
    .icon-select {
      width: 60px;
      font-size: 16px;
      text-align: center;
      padding: 7px 4px;
      border: 1.5px solid rgba(200,195,240,.7);
      border-radius: var(--r-sm);
      background: rgba(255,255,255,.7);
      color: var(--text-primary);
      outline: none;
      cursor: pointer;
    }
    .days-picker {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }
    .day-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 1.5px solid rgba(200,195,240,.7);
      background: rgba(255,255,255,.6);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all .15s;
      font-family: var(--font);
    }
    .day-btn.sel {
      background: var(--purple-600);
      border-color: var(--purple-600);
      color: #fff;
    }
    .add-reminder-btn {
      padding: 11px;
      background: linear-gradient(135deg,var(--purple-600),var(--purple-700));
      color: #fff;
      border: none;
      border-radius: var(--r-pill);
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      font-family: var(--font);
    }
    .preset-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 14px 12px;
    }
    .preset-chip {
      font-size: 11px;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: var(--r-pill);
      border: 1px solid rgba(200,195,240,.6);
      background: rgba(255,255,255,.6);
      color: var(--text-muted);
      cursor: pointer;
      transition: all .2s;
      white-space: nowrap;
    }
    .preset-chip:hover {
      background: var(--purple-100);
      border-color: var(--purple-200);
      color: var(--purple-600);
    }
    .r-count-tag {
      font-size: 10px;
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(139,92,246,.08);
      border-radius: var(--r-pill);
      padding: 2px 8px;
      border: 1px solid rgba(139,92,246,.12);
      margin-left: auto;
    }
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────────────────────
   AUTO-BUILD PAGE ON MODULE LOAD
───────────────────────────────────────────────────────────────*/
document.addEventListener('DOMContentLoaded', () => {
  buildRemindersPage();
});
