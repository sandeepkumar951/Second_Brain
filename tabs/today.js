/**
 * ═══════════════════════════════════════════════════════════════
 * tabs/today.js — Today page: habits, checklist, daily reset
 *
 * This module owns:
 * - Habit section building & rendering
 * - Checklist toggle logic
 * - applyChecks() — syncs DOM with state.checks
 * - Daily reset (handleDailyReset)
 * - Missed tasks banner
 * - In-app notifications
 * - Home reminders panel
 * - Today weekly panel
 * - Evening section (weekend detection)
 * - showPage() — page navigation
 * - refreshUI / refreshUILightweight orchestrators
 * - resetToday()
 * ═══════════════════════════════════════════════════════════════
 */

import {
  todayKey,
  yesterdayKey,
  DAY_NAMES,
  MONTHS,
  sanitizeHTML,
  showToast,
  confetti,
  genId,
  isWeekend,
  getTaskEmoji,
  getSectionEmoji,
  getHabitIconHtml,
  getWeeklyDayColor,
  validateTimeString,
  formatTime12,
  playCompletionTick,
  DB_KEY,
  safeLocalStorageSave
} from '../core/utils.js';

import { state, flags, saveFiredToday } from '../core/state.js';

import { debouncedSave, save, detachAllListeners, startRealtimeSync } from '../core/firebase.js';

import {
  applyTheme,
  updateReward,
  updateSummaryCards,
  updateStatsBanner,
  updateFooterChips,
  checkStreakMilestone
} from '../shared/theme.js';

import { checkBadgesDebounced } from '../shared/badges.js';

import {
  buildWaterSection,
  renderWater,
  renderHydrationInsights,
  wtStartAnimation,
  wtStopAnimation,
  wtBubbles,
  wtCleanup
} from '../shared/water.js';


/* ═══════════════════════════════════════════════════════════════
   CHECKLIST TOGGLE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Toggles a habit checklist item.
 * Updates state, XP, plays audio, refreshes dependent UI.
 * @param {HTMLElement} el - The .ci element
 */
export function toggle(el) {
  const wasDone = el.classList.contains('done');
  el.classList.toggle('done');

  const k = el.dataset.key;
  const pts = +(el.dataset.pts || 0);

  // Store explicit boolean (false syncs correctly via Firebase)
  state.checks[k] = el.classList.contains('done');
  el.setAttribute('aria-checked', state.checks[k] ? 'true' : 'false');

  if (!wasDone && state.checks[k]) {
    state.pts = Math.min(99999, (state.pts || 0) + pts);
    state.totalPts = Math.min(99999, (state.totalPts || 0) + pts);
    playCompletionTick();
  } else if (wasDone && !state.checks[k]) {
    state.pts = Math.max(0, (state.pts || 0) - pts);
    // totalPts is cumulative — never decremented
  }

  updateProg();
  updateReward();
  updateFooterChips();

  // Remove missed highlight when checked
  if (state.checks[k] === true) {
    el.classList.remove('missed-highlight');
  }

  // If all done, hide missed banner
  const remaining = document.querySelectorAll('.ci[data-key]:not(.done)');
  if (remaining.length === 0) {
    const banner = document.getElementById('missed-banner');
    if (banner) banner.classList.remove('show');
    document.querySelectorAll('.ci.missed-highlight').forEach(item => item.classList.remove('missed-highlight'));
  }

  debouncedSave(300);
  checkBadgesDebounced();
}


/* ═══════════════════════════════════════════════════════════════
   applyChecks — Syncs DOM with state.checks
   ═══════════════════════════════════════════════════════════════ */

/**
 * Iterates all checklist items and applies done/undone state.
 */
export function applyChecks() {
  document.querySelectorAll('.ci[data-key]').forEach(el => {
    const isDone = state.checks[el.dataset.key] === true;
    el.classList.toggle('done', isDone);
    el.setAttribute('aria-checked', isDone ? 'true' : 'false');
  });
}


/* ═══════════════════════════════════════════════════════════════
   updateProg — Wrapper that triggers summary card updates
   ═══════════════════════════════════════════════════════════════ */

/**
 * Updates progress-related UI (summary cards, badges).
 */
export function updateProg() {
  updateSummaryCards();
}


/* ═══════════════════════════════════════════════════════════════
   BUILD HABIT ITEM
   ═══════════════════════════════════════════════════════════════ */

/**
 * Creates a single habit checklist item element.
 * @param {object} h - Habit object
 * @param {number} idx - Index within section
 * @param {number} total - Total habits in section
 * @returns {HTMLElement}
 */
export function buildHabitItem(h, idx, total) {
  const row = document.createElement('div');
  row.className = 'ci' + (state.checks[h.id] === true ? ' done' : '');
  row.dataset.key = h.id;
  row.dataset.pts = h.pts;
  row.setAttribute('role', 'checkbox');
  row.setAttribute('aria-checked', state.checks[h.id] === true ? 'true' : 'false');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', sanitizeHTML(h.name || '') + ' — ' + h.pts + ' points');

  const iconContent = getHabitIconHtml(h);
  const safeName = sanitizeHTML(h.name || '');
  const safeNote = sanitizeHTML(h.note || '');

  row.innerHTML =
    '<div class="cb" aria-hidden="true"></div>' +
    '<div class="task-emoji" data-action="open-icon-picker" data-id="' + h.id + '" ' +
      'role="button" tabindex="0" aria-label="Change icon for ' + safeName + '" ' +
      'style="cursor:pointer;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--purple-50);border:1.5px solid var(--purple-200);overflow:hidden;flex-shrink:0;">' +
      iconContent + '</div>' +
    '<div class="cit">' +
      '<div class="cil">' + safeName + '</div>' +
      (safeNote ? '<div class="cin">' + safeNote + '</div>' : '') +
    '</div>' +
    '<div class="reorder-btns" aria-label="Reorder ' + safeName + '">' +
      '<button class="reorder-btn" aria-label="Move up" data-action="move-habit-up" data-id="' + h.id + '"' + (idx === 0 ? ' disabled' : '') + '>&#9650;</button>' +
      '<button class="reorder-btn" aria-label="Move down" data-action="move-habit-down" data-id="' + h.id + '"' + (idx === total - 1 ? ' disabled' : '') + '>&#9660;</button>' +
    '</div>';

  return row;
}


/* ═══════════════════════════════════════════════════════════════
   BUILD EVENING SECTION
   ═══════════════════════════════════════════════════════════════ */

/**
 * Builds the evening section card (different on weekends).
 * @returns {HTMLElement}
 */
export function buildEveningSection() {
  const sc = document.createElement('div');
  sc.className = 'sc';
  const wknd = isWeekend();

  sc.innerHTML =
    '<div class="sh"><span class="si" aria-hidden="true">🌆</span><span class="st">Evening</span>' +
    '<span class="stag">' + (wknd ? 'Weekend' : 'before 6 pm') + '</span></div>' +
    '<div class="cl" id="eve-list" role="group" aria-label="Evening habits"></div>';

  const list = sc.querySelector('#eve-list');
  if (list) {
    list.innerHTML = wknd
      ? '<div class="ci" data-key="steps" data-pts="8" role="checkbox" aria-checked="false" tabindex="0">' +
          '<div class="cb" aria-hidden="true"></div>' +
          '<span style="font-size:22px;flex-shrink:0;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--purple-50);border:1.5px solid var(--purple-200);" aria-hidden="true">🏃</span>' +
          '<div class="cit"><div class="cil">10,000 steps today</div><div class="cin">Weekend challenge!</div></div></div>'
      : '<div class="ci" data-key="seeds" data-pts="3" role="checkbox" aria-checked="false" tabindex="0">' +
          '<div class="cb" aria-hidden="true"></div>' +
          '<span style="font-size:22px;flex-shrink:0;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--purple-50);border:1.5px solid var(--purple-200);" aria-hidden="true">🌻</span>' +
          '<div class="cit"><div class="cil">Fruit or seeds</div><div class="cin">1 spoon pumpkin / flax / chia</div></div></div>';
  }

  // Apply checks immediately
  applyChecks();
  return sc;
}

/**
 * Rebuilds evening section only if weekend status actually changed.
 */
export function rebuildEveningIfNeeded() {
  const currentlyWeekend = isWeekend();
  if (flags._lastEveningWasWeekend === currentlyWeekend) return;
  flags._lastEveningWasWeekend = currentlyWeekend;

  const existing = document.getElementById('eve-list');
  if (existing) {
    const card = existing.closest('.sc');
    if (card) card.remove();
  }

  const container = document.getElementById('today-sections');
  if (container) {
    container.appendChild(buildEveningSection());
    applyChecks();
  }
}


/* ═══════════════════════════════════════════════════════════════
   BUILD TODAY SECTIONS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Builds all habit sections inside the today-sections container.
 * Handles special sections (water, evening) and regular habit sections.
 * @param {HTMLElement|null} [preservedWaterCard] - Preserved water card element
 */
export function buildTodaySections(preservedWaterCard) {
  const container = document.getElementById('today-sections');
  if (!container) return;

  if (!state.habits || !state.habits.length) return;
  if (!state.sections || !state.sections.length) return;

  state.sections.forEach(sec => {
    if (sec.tag === 'special') {
      if (sec.id === 'water') {
        if (preservedWaterCard) {
          container.appendChild(preservedWaterCard);
          renderWater();
          const hw = document.getElementById('hydration-insights-wrap');
          if (hw) renderHydrationInsights();
          return;
        }
        const existingScene = document.getElementById('wt-scene');
        if (existingScene) {
          if (!flags.wtSceneInitialized) wtStartAnimation();
          renderWater();
          return;
        }
        container.appendChild(buildWaterSection());
        return;
      }

      if (sec.id === 'evening') {
        const existingList = document.getElementById('eve-list');
        if (!existingList) container.appendChild(buildEveningSection());
        return;
      }
      return;
    }

    // Regular section
    const habits = (state.habits || [])
      .filter(h => h.section === sec.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!habits.length) return;

    const existingSec = document.getElementById('sec-' + sec.id);
    if (existingSec) {
      const existingCount = existingSec.querySelectorAll('.ci').length;
      if (existingCount !== habits.length) rebuildSection(sec.id);
      return;
    }

    const scEl = document.createElement('div');
    scEl.className = 'sc';
    const secName = sanitizeHTML(sec.name || '');
    const secTag = sanitizeHTML(sec.tag || '');

    scEl.innerHTML =
      '<div class="sh"><span class="si" aria-hidden="true">' + getSectionEmoji(sec.id, sec.icon) + '</span>' +
      '<span class="st">' + secName + '</span>' +
      (secTag ? '<span class="stag">' + secTag + '</span>' : '') +
      '</div>' +
      '<div class="cl" id="sec-' + sec.id + '" role="group" aria-label="' + secName + ' habits"></div>';

    container.appendChild(scEl);
    const cl = scEl.querySelector('.cl');
    habits.forEach((h, idx) => cl.appendChild(buildHabitItem(h, idx, habits.length)));
  });
}

/**
 * Completely rebuilds the today sections (preserving water card if possible).
 */
export function rebuildTodaySections() {
  const container = document.getElementById('today-sections');
  if (!container) return;

  const scrollY = window.scrollY;

  // Try to preserve water card
  const waterScene = document.getElementById('wt-scene');
  let waterCard = null;
  if (waterScene) {
    const candidate = waterScene.closest('.sc');
    if (candidate && candidate.parentNode === container) {
      waterCard = candidate;
      container.removeChild(waterCard);
    }
  }

  const wasAnimating = !!flags.wtPropRAF;
  const prevWaterLevel = state.water || 0;

  // Clean timers
  if (flags.wtIdleTmr) { clearInterval(flags.wtIdleTmr); flags.wtIdleTmr = null; }

  container.innerHTML = '';
  if (!waterCard) flags.wtSceneInitialized = false;

  buildTodaySections(waterCard);

  // Restart animation if was running
  if (waterCard && wasAnimating && !flags.wtPropRAF) wtStartAnimation();

  // Restart idle bubbles
  if (!flags.wtIdleTmr && prevWaterLevel > 0 && !flags.wtDone) {
    flags.wtIdleTmr = setInterval(() => {
      if (state.water > 0 && !flags.wtDone) wtBubbles(0);
    }, 3200);
  }

  // Restore scroll
  requestAnimationFrame(() => { window.scrollTo(0, scrollY); });
}

/**
 * Rebuilds a single section by ID.
 * @param {string} sectionId
 */
export function rebuildSection(sectionId) {
  const container = document.getElementById('today-sections');
  if (!container) return;

  const existing = document.getElementById('sec-' + sectionId);
  if (existing) {
    const card = existing.closest('.sc');
    if (card) card.remove();
  }

  const sec = (state.sections || []).find(s => s.id === sectionId);
  if (!sec || sec.tag === 'special') return;

  const habits = (state.habits || [])
    .filter(h => h.section === sectionId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!habits.length) return;

  const allSectionIds = (state.sections || []).map(s => s.id);
  const secIdx = allSectionIds.indexOf(sectionId);

  const scEl = document.createElement('div');
  scEl.className = 'sc';
  const secName = sanitizeHTML(sec.name || '');
  const secTag = sanitizeHTML(sec.tag || '');

  scEl.innerHTML =
    '<div class="sh"><span class="si" aria-hidden="true">' + getSectionEmoji(sec.id, sec.icon) + '</span>' +
    '<span class="st">' + secName + '</span>' +
    (secTag ? '<span class="stag">' + secTag + '</span>' : '') +
    '</div>' +
    '<div class="cl" id="sec-' + sectionId + '" role="group" aria-label="' + secName + ' habits"></div>';

  const cl = scEl.querySelector('.cl');
  habits.forEach((h, idx) => cl.appendChild(buildHabitItem(h, idx, habits.length)));

  // Insert in correct position
  let insertBefore = null;
  for (let i = secIdx + 1; i < allSectionIds.length; i++) {
    const nextEl = document.getElementById('sec-' + allSectionIds[i]);
    if (nextEl) { insertBefore = nextEl.closest('.sc'); break; }
  }

  if (insertBefore) container.insertBefore(scEl, insertBefore);
  else container.appendChild(scEl);

  applyChecks();
}


/* ═══════════════════════════════════════════════════════════════
   DAILY RESET
   ═══════════════════════════════════════════════════════════════ */

/**
 * Handles the transition to a new day.
 * Archives yesterday's data, resets daily fields.
 */
export function handleDailyReset() {
  const today = todayKey();
  if (state.lastDate === today) return;

  // Archive study hours
  if ((state.ctStudyHrs || 0) > 0 && state.ctLastStudyDate) {
    if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
    state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
      state.ctWeeklyHours[state.ctLastStudyDate] || 0, state.ctStudyHrs
    );
  }

  // Archive day history
  if (state.lastDate) {
    if (!state.ctDayHistory) state.ctDayHistory = {};
    if (!state.ctDayHistory[state.lastDate]) {
      state.ctDayHistory[state.lastDate] = state.ctDayDone
        ? 'complete' : (state.ctStudyHrs || 0) > 0 ? 'partial' : 'rest';
    }
  }

  // Reset daily fields
  state.checks = {};
  state.water = 0;
  state.pts = 0;
  state.ctDayDone = false;
  state.ctStudyHrs = 0;
  state.ctTodayLogged = false;
  state.ctLastStudyDate = null;
  state.missedBannerDismissedDate = '';
  state.lastResetTimestamp = Date.now();

  flags.firedToday = {};

  // Convert Today/Tomorrow tasks
  _convertDayTasks();

  state.lastDate = today;
}

/**
 * @private Converts Today/Tomorrow weekly tasks to actual day names.
 */
function _convertDayTasks() {
  if (!Array.isArray(state.weeklyTasks)) return;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayName = dayNames[new Date().getDay()];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowName = dayNames[tomorrow.getDay()];

  state.weeklyTasks = state.weeklyTasks.map(t => {
    if (t.day === 'Today') return Object.assign({}, t, { day: todayName });
    if (t.day === 'Tomorrow') return Object.assign({}, t, { day: tomorrowName });
    return t;
  });
}


/* ═══════════════════════════════════════════════════════════════
   MISSED TASKS BANNER
   ═══════════════════════════════════════════════════════════════ */

/**
 * Checks if the missed tasks alert time has passed and shows the banner.
 */
export function checkMissedTasksBanner() {
  const now = new Date();
  const today = todayKey();

  let alertTime = state.missedTasksAlertTime || '21:00';
  if (!validateTimeString(alertTime)) alertTime = '21:00';
  const [ah, am] = alertTime.split(':').map(Number);

  const curMins = now.getHours() * 60 + now.getMinutes();
  const alertMins = ah * 60 + (am || 0);

  if (curMins < alertMins) return;

  // Already dismissed today
  if (state.missedBannerDismissedDate === today) return;

  const allItems = document.querySelectorAll('.ci[data-key]');
  const missed = [];
  allItems.forEach(el => {
    if (!el.classList.contains('done')) {
      const lb = el.querySelector('.cil');
      if (lb) missed.push(lb.textContent);
    }
  });

  const total = allItems.length;
  const doneCount = total - missed.length;
  const pct = total > 0 ? Math.round(doneCount / total * 100) : 100;

  const banner = document.getElementById('missed-banner');
  const list = document.getElementById('missed-task-list');
  const pb = document.getElementById('missed-pct-badge');

  if (pb) pb.textContent = pct + '% done';

  if (!missed.length) {
    if (banner) banner.classList.remove('show');
    return;
  }

  if (list) {
    list.innerHTML = '';
    missed.slice(0, 8).forEach(n => {
      const i = document.createElement('div');
      i.className = 'missed-task-item';
      i.setAttribute('role', 'listitem');
      i.textContent = n;
      list.appendChild(i);
    });
    if (missed.length > 8) {
      const mm = document.createElement('div');
      mm.className = 'missed-task-item';
      mm.textContent = '...and ' + (missed.length - 8) + ' more';
      list.appendChild(mm);
    }
  }

  if (banner) banner.classList.add('show');

  // Apply highlights
  allItems.forEach(el => {
    if (!el.classList.contains('done')) el.classList.add('missed-highlight');
    else el.classList.remove('missed-highlight');
  });
}

/**
 * Closes the missed tasks banner and saves dismissal state.
 */
export function closeMissedBanner() {
  document.querySelectorAll('.ci.missed-highlight').forEach(el => el.classList.remove('missed-highlight'));
  const banner = document.getElementById('missed-banner');
  if (banner) banner.classList.remove('show');
  state.missedBannerDismissedDate = todayKey();
  debouncedSave();
}


/* ═══════════════════════════════════════════════════════════════
   IN-APP NOTIFICATIONS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Shows an in-app notification banner.
 * @param {string} icon
 * @param {string} title
 * @param {string} msg
 */
export function showInAppNotif(icon, title, msg) {
  const el = document.getElementById('inapp-notif');
  if (!el) return;

  const iconEl = document.getElementById('inapp-icon');
  const titleEl = document.getElementById('inapp-title');
  const msgEl = document.getElementById('inapp-msg');
  if (iconEl) iconEl.textContent = icon || '';
  if (titleEl) titleEl.textContent = title || '';
  if (msgEl) msgEl.textContent = msg || '';

  el.classList.add('show');

  const ar = document.getElementById('aria-announce');
  if (ar) ar.textContent = title + (msg ? '. ' + msg : '');

  clearTimeout(flags.inAppTimeoutId);
  flags.inAppTimeoutId = setTimeout(closeInApp, 7000);
}

/**
 * Closes the in-app notification.
 */
export function closeInApp() {
  const el = document.getElementById('inapp-notif');
  if (el) el.classList.remove('show');
  clearTimeout(flags.inAppTimeoutId);
}


/* ═══════════════════════════════════════════════════════════════
   HOME REMINDERS PANEL
   ═══════════════════════════════════════════════════════════════ */

/**
 * Renders today's reminders in the home panel.
 */
export function renderHomeReminders() {
  const list = document.getElementById('home-rem-list');
  const count = document.getElementById('home-rem-count');
  if (!list) return;

  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const deleted = new Set(state.deletedReminderIds || []);
  const active = (state.reminders || []).filter(r =>
    r.enabled && r.days.includes(today) && !deleted.has(r.id)
  );

  if (count) count.textContent = String(active.length);
  list.innerHTML = '';

  if (!active.length) {
    list.innerHTML = '<div class="home-rem-empty">No reminders today.</div>';
    return;
  }

  active.slice().sort((a, b) => a.time.localeCompare(b.time)).forEach(r => {
    const [hh, mm] = r.time.split(':').map(Number);
    const remMin = hh * 60 + mm;
    const diff = remMin - curMin;
    const h12 = (hh % 12) || 12;
    const timeStr = h12 + ':' + String(mm).padStart(2, '0') + ' ' + (hh < 12 ? 'AM' : 'PM');

    let sc = 'upcoming', st = '';
    if (diff < 0) { sc = 'passed'; st = 'Passed'; }
    else if (diff === 0) { sc = 'upcoming'; st = 'Now!'; }
    else if (diff <= 60) { sc = 'upcoming'; st = 'In ' + diff + 'm'; }
    else { sc = 'upcoming'; st = timeStr; }

    const row = document.createElement('div');
    row.className = 'home-rem-item';
    row.setAttribute('role', 'listitem');
    row.innerHTML =
      '<div class="home-rem-icon" aria-hidden="true">' + r.icon + '</div>' +
      '<div class="home-rem-body"><div class="home-rem-name">' + sanitizeHTML(r.title || '') + '</div>' +
      '<div class="home-rem-time">' + timeStr + (r.msg ? ' · ' + sanitizeHTML(r.msg || '') : '') + '</div></div>' +
      '<span class="home-rem-status ' + sc + '">' + st + '</span>';
    list.appendChild(row);
  });
}


/* ═══════════════════════════════════════════════════════════════
   TODAY WEEKLY PANEL
   ═══════════════════════════════════════════════════════════════ */

/**
 * Renders today's weekly tasks in the home panel.
 */
export function renderTodayWeeklyPanel() {
  const list = document.getElementById('today-weekly-list');
  const countEl = document.getElementById('today-weekly-count');
  if (!list) return;

  const tasks = state.weeklyTasks || [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayName = dayNames[new Date().getDay()];

  const todayTasks = tasks.filter(t => {
    if (!t.day) return false;
    const days = t.day.split(',');
    return days.includes(todayName) || days.includes('Today') || days.includes('Anytime');
  });

  const relevant = todayTasks.filter(t => !t.done)
    .concat(todayTasks.filter(t => t.done))
    .slice(0, 5);

  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  if (countEl) countEl.textContent = total + ' tasks · ' + done + ' done';

  if (!relevant.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">No tasks for today. <span style="color:var(--purple-600);cursor:pointer;font-weight:700;" data-action="nav-to" data-page="weekly" data-nav-index="4">Add weekly tasks</span></div>';
    return;
  }

  list.innerHTML = '';
  relevant.forEach(t => {
    const dc = getWeeklyDayColor(t.day);
    const safeName = sanitizeHTML(t.name || '');
    const row = document.createElement('div');
    row.setAttribute('role', 'listitem');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:' +
      (t.done ? 'rgba(34,197,94,.08)' : 'rgba(255,255,255,.65)') +
      ';border-radius:var(--r-pill);border:1.5px solid ' +
      (t.done ? 'rgba(34,197,94,.3)' : 'rgba(230,225,255,.7)') +
      ';cursor:pointer;transition:all .2s;margin-bottom:4px;';
    row.setAttribute('data-action', 'wt-toggle');
    row.setAttribute('data-id', t.id);
    row.setAttribute('aria-label', safeName + (t.done ? ' — done' : ' — pending'));

    row.innerHTML =
      '<div style="width:18px;height:18px;border-radius:50%;border:2px solid ' +
      (t.done ? '#22c55e' : 'rgba(200,195,240,.8)') + ';background:' +
      (t.done ? '#22c55e' : '#fff') + ';flex-shrink:0;display:flex;align-items:center;justify-content:center;" aria-hidden="true">' +
      (t.done ? '<span style="color:#fff;font-size:8px;font-weight:900;">&#10003;</span>' : '') +
      '</div>' +
      '<span style="flex:1;font-size:12px;font-weight:600;' +
      (t.done ? 'text-decoration:line-through;color:var(--text-muted);' : 'color:var(--text-primary);') +
      '">' + safeName + '</span>' +
      '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;background:' +
      dc.bg + ';color:' + dc.color + ';">' +
      sanitizeHTML((t.day || '').split(',').join(' · ')) + '</span>';

    list.appendChild(row);
  });
}


/* ═══════════════════════════════════════════════════════════════
   RESET TODAY
   ═══════════════════════════════════════════════════════════════ */

/**
 * Resets today's checklist, water, and daily XP.
 * Propagates reset timestamp for cross-device sync.
 */
export function resetToday() {
  state.checks = {};
  state.water = 0;
  state.pts = 0;
  state.lastResetTimestamp = Date.now();
  flags.wtDone = false;

  // Reset completion UI
  const compGlow = document.getElementById('wt-comp-glow');
  const compBanner = document.getElementById('wt-comp-banner');
  if (compGlow) compGlow.classList.remove('show');
  if (compBanner) compBanner.classList.remove('show');

  // Reset water scene
  const waterScene = document.getElementById('wt-scene');
  if (waterScene) {
    renderWater();
    renderHydrationInsights();
  } else {
    flags.wtSceneInitialized = false;
    rebuildTodaySections();
  }

  applyChecks();
  updateProg();
  updateReward();
  updateSummaryCards();
  updateStatsBanner();
  updateFooterChips();

  save();
  showToast('Checklist reset');
}


/* ═══════════════════════════════════════════════════════════════
   SHOW PAGE — Navigation handler
   ═══════════════════════════════════════════════════════════════ */

/**
 * Callback registry for page-specific init functions.
 * Set by init.js to avoid circular imports.
 * @type {Object<string, Function>}
 */
let _pageInitCallbacks = {};

/**
 * Registers a page initialization callback.
 * @param {string} pageId
 * @param {Function} fn
 */
export function onPageShow(pageId, fn) {
  _pageInitCallbacks[pageId] = fn;
}

/**
 * Shows a page and handles tab switching logic.
 * @param {string} id - Page ID (today, study, english, junk, weekly, reminders, settings)
 * @param {HTMLElement} [btn] - Nav button that was clicked
 */
export function showPage(id, btn) {
  const prevPage = document.querySelector('.page.active');
  const prevId = prevPage ? prevPage.id.replace('page-', '') : '';

  // Cleanup when leaving Today
  if (prevId === 'today' && id !== 'today') {
    wtStopAnimation();
    if (flags.wtIdleTmr) { clearInterval(flags.wtIdleTmr); flags.wtIdleTmr = null; }
  }

  // Cleanup when leaving Career
  if (prevId === 'study' && id !== 'study') {
    if (flags._ctCdInterval) { clearInterval(flags._ctCdInterval); flags._ctCdInterval = null; }
  }

  // Switch pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });

  const page = document.getElementById('page-' + id);
  if (page) {
    page.classList.add('active');
    page.classList.add('page-switching');
    setTimeout(() => page.classList.remove('page-switching'), 250);
  }

  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-current', 'page');
  }

  // Page-specific init
  if (id === 'today') {
    // Restart water animation if scene exists
    if (document.getElementById('wt-scene')) {
      if (!flags.wtPropRAF) wtStartAnimation();
      if (flags.wtIdleTmr) { clearInterval(flags.wtIdleTmr); flags.wtIdleTmr = null; }
      if ((state.water || 0) > 0 && !flags.wtDone) {
        flags.wtIdleTmr = setInterval(() => {
          if (state.water > 0 && !flags.wtDone) wtBubbles(0);
        }, 3200);
      }
    }
    rebuildEveningIfNeeded();
    renderTodayWeeklyPanel();
    renderHomeReminders();
  }

  // Call registered page-specific init
  if (_pageInitCallbacks[id]) {
    _pageInitCallbacks[id]();
  }

  // Update hash
  try { window.location.hash = id; } catch (e) { /* ignore */ }
}


/* ═══════════════════════════════════════════════════════════════
   REFRESH UI — Orchestrators
   ═══════════════════════════════════════════════════════════════ */

/**
 * Callback registry for tab-specific render functions.
 * @type {Function[]}
 */
let _lightweightRefreshCallbacks = [];
let _fullRefreshCallbacks = [];

/**
 * Registers a callback for lightweight refresh (called on sync).
 * @param {Function} fn
 */
export function onLightweightRefresh(fn) {
  _lightweightRefreshCallbacks.push(fn);
}

/**
 * Registers a callback for full refresh (called on day change).
 * @param {Function} fn
 */
export function onFullRefresh(fn) {
  _fullRefreshCallbacks.push(fn);
}

/**
 * Lightweight refresh — updates existing UI without full rebuild.
 * Called after Firebase sync merges.
 */
export function refreshUILightweight() {
  applyChecks();
  updateProg();
  updateReward();
  updateSummaryCards();
  renderHomeReminders();
  renderWater();
  updateStatsBanner();
  updateFooterChips();

  // Call registered callbacks
  _lightweightRefreshCallbacks.forEach(fn => {
    try { fn(); } catch (e) { console.warn('Lightweight refresh callback error:', e); }
  });
}

/**
 * Full refresh — rebuilds all sections and re-renders everything.
 * Called on day change, factory reset, etc.
 */
export function refreshUI() {
  refreshUILightweight();
  rebuildTodaySections();
  applyChecks();
  renderTodayWeeklyPanel();

  // Call registered callbacks
  _fullRefreshCallbacks.forEach(fn => {
    try { fn(); } catch (e) { console.warn('Full refresh callback error:', e); }
  });

  applyTheme();
}
