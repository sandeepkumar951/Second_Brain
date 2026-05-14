/* ═══════════════════════════════════════════════════════════════
   tabs/today.js
   Today tab — habit checklist, sections, water scene,
   summary cards, missed tasks banner, badges, icon picker,
   habit/section management (add/edit/delete/reorder).
   Depends on: core/state.js, core/utils.js, core/firebase.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  DEFAULT_HABITS,
  DEFAULT_SECTIONS,
  /* flags */
  editingHabitId,     setEditingHabitId,
  settingsFilter,     setSettingsFilter,
  iconPickerHabitId,  setIconPickerHabitId,
  iconPickerMode,     setIconPickerMode,
  selectedEmoji,      setSelectedEmoji,
  uploadedImageData,  setUploadedImageData,
  _settingsNeedRebuild, setSettingsNeedRebuild,
  badgeCheckTimer,    setBadgeCheckTimer,
  wtDone,             setWtDone,
  wtSceneInitialized, setWtSceneInitialized,
  wtIdleTmr,          setWtIdleTmr,
  wtPropRAF,          setWtPropRAF,
  cachedSceneHeight,  setCachedSceneHeight,
  _lastEveningWasWeekend, setLastEveningWasWeekend,
  LEVELS
} from '../core/state.js';

import {
  todayKey,
  sanitizeHTML,
  sanitizeRemoteString,
  showToast,
  confetti,
  genId,
  getTaskEmoji,
  getSectionEmoji,
  getHabitIconHtml,
  getLevel,
  validateHabitName,
  formatTime12,
  validateTimeString,
  isWeekend,
  safeLocalStorageSave,
  updateFbStatus,
  getWeeklyDayColor
} from '../core/utils.js';

import {
  debouncedSave,
  save,
  userRef
} from '../core/firebase.js';

import { playCompletionTick } from '../core/utils.js';

/* ─────────────────────────────────────────────────────────────
   BADGE DEFINITIONS
   (Imported lazily to avoid circular deps)
───────────────────────────────────────────────────────────────*/
let _BADGES = null;
async function getBadges() {
  if (!_BADGES) {
    const m = await import('../shared/badges.js');
    _BADGES = m.BADGES;
  }
  return _BADGES;
}

/* ─────────────────────────────────────────────────────────────
   TOGGLE HABIT CHECKLIST ITEM
───────────────────────────────────────────────────────────────*/

/**
 * Toggles a habit checklist item done/undone.
 * Stores explicit boolean so false propagates to Firebase.
 */
export function toggle(el) {
  const wasDone = el.classList.contains('done');
  el.classList.toggle('done');

  const k   = el.dataset.key;
  const pts = +(el.dataset.pts || 0);

  /* Explicit boolean — false must sync to remote */
  state.checks[k] = el.classList.contains('done');
  el.setAttribute('aria-checked', state.checks[k] ? 'true' : 'false');

  if (!wasDone && state.checks[k]) {
    state.pts      = Math.min(99999, (state.pts      || 0) + pts);
    state.totalPts = Math.min(99999, (state.totalPts || 0) + pts);
    playCompletionTick();
  } else if (wasDone && !state.checks[k]) {
    state.pts = Math.max(0, (state.pts || 0) - pts);
    /* totalPts is cumulative — never decremented */
  }

  updateProg();

  /* Lazy import to avoid circular */
  import('../shared/theme.js').then(m => {
    if (m.updateReward)        m.updateReward();
    if (m._updateFooterChips)  m._updateFooterChips();
  });

  /* Remove missed-highlight when checked */
  if (state.checks[k] === true) {
    el.classList.remove('missed-highlight');
  }

  /* Hide missed banner if all tasks done */
  const remaining = document.querySelectorAll('.ci[data-key]:not(.done)');
  if (remaining.length === 0) {
    const banner = document.getElementById('missed-banner');
    if (banner) banner.classList.remove('show');
    document.querySelectorAll('.ci.missed-highlight')
            .forEach(item => item.classList.remove('missed-highlight'));
  }

  debouncedSave(300);
}

/* ─────────────────────────────────────────────────────────────
   APPLY CHECKS
   Reads state.checks and applies done/undone to all CI items.
───────────────────────────────────────────────────────────────*/
export function applyChecks() {
  document.querySelectorAll('.ci[data-key]').forEach(el => {
    const isDone = state.checks[el.dataset.key] === true;
    el.classList.toggle('done', isDone);
    el.setAttribute('aria-checked', isDone ? 'true' : 'false');
  });
}

/* ─────────────────────────────────────────────────────────────
   updateProg
   Delegates to updateSummaryCards in theme.js
───────────────────────────────────────────────────────────────*/
export function updateProg() {
  import('../shared/theme.js').then(m => {
    if (m.updateSummaryCards) m.updateSummaryCards();
  });
}

/* ─────────────────────────────────────────────────────────────
   BUILD HABIT CHECKLIST ITEM
───────────────────────────────────────────────────────────────*/
export function buildHabitItem(h, idx, total) {
  const row = document.createElement('div');

  row.className   = 'ci' + (state.checks[h.id] === true ? ' done' : '');
  row.dataset.key = h.id;
  row.dataset.pts = h.pts;

  row.setAttribute('role',         'checkbox');
  row.setAttribute('aria-checked', state.checks[h.id] === true ? 'true' : 'false');
  row.setAttribute('tabindex',     '0');
  row.setAttribute('aria-label',   sanitizeHTML(h.name || '') + ' — ' + h.pts + ' points');

  const iconContent = getHabitIconHtml(h);
  const safeName    = sanitizeHTML(h.name || '');
  const safeNote    = sanitizeHTML(h.note || '');

  row.innerHTML =
    '<div class="cb" aria-hidden="true"></div>' +

    '<div class="task-emoji" ' +
      'data-action="open-icon-picker" data-id="' + h.id + '" ' +
      'role="button" tabindex="0" ' +
      'aria-label="Change icon for ' + safeName + '" ' +
      'style="cursor:pointer;width:38px;height:38px;border-radius:50%;' +
             'display:flex;align-items:center;justify-content:center;' +
             'background:var(--purple-50);border:1.5px solid var(--purple-200);' +
             'overflow:hidden;flex-shrink:0;">' +
      iconContent +
    '</div>' +

    '<div class="cit">' +
      '<div class="cil">' + safeName + '</div>' +
      (safeNote ? '<div class="cin">' + safeNote + '</div>' : '') +
    '</div>' +

    '<div class="reorder-btns" aria-label="Reorder ' + safeName + '">' +
      '<button class="reorder-btn" aria-label="Move up" ' +
        'data-action="move-habit-up" data-id="' + h.id + '" ' +
        (idx === 0 ? 'disabled' : '') + '>▲</button>' +
      '<button class="reorder-btn" aria-label="Move down" ' +
        'data-action="move-habit-down" data-id="' + h.id + '" ' +
        (idx === total - 1 ? 'disabled' : '') + '>▼</button>' +
    '</div>';

  return row;
}

/* ─────────────────────────────────────────────────────────────
   BUILD TODAY SECTIONS
───────────────────────────────────────────────────────────────*/
export function buildTodaySections(preservedWaterCard) {
  const container = document.getElementById('today-sections');
  if (!container) return;

  if (!state.habits   || !state.habits.length)   ensureDefaultsLocal();
  if (!state.sections || !state.sections.length)  ensureDefaultsLocal();

  (state.sections || []).forEach(sec => {

    /* Special sections */
    if (sec.tag === 'special') {
      if (sec.id === 'water') {
        if (preservedWaterCard) {
          container.appendChild(preservedWaterCard);
          import('../shared/water.js').then(m => {
            if (m.renderWater) m.renderWater();
            const hw = document.getElementById('hydration-insights-wrap');
            if (hw && m.renderHydrationInsights) m.renderHydrationInsights();
          });
          return;
        }
        const existingScene = document.getElementById('wt-scene');
        if (existingScene) {
          import('../shared/water.js').then(m => {
            if (!wtSceneInitialized && m._wtStartAnimation) m._wtStartAnimation();
            if (m.renderWater) m.renderWater();
          });
          return;
        }
        import('../shared/water.js').then(m => {
          if (m.buildWaterSection) {
            container.appendChild(m.buildWaterSection());
          }
        });
        return;
      }

      if (sec.id === 'evening') {
        const existingList = document.getElementById('eve-list');
        if (!existingList) container.appendChild(buildEveningSection());
        return;
      }
      return;
    }

    /* Regular sections */
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

    const sc      = document.createElement('div');
    sc.className  = 'sc';
    const secName = sanitizeHTML(sec.name || '');
    const secTag  = sanitizeHTML(sec.tag  || '');

    sc.innerHTML =
      '<div class="sh">' +
        '<span class="si" aria-hidden="true">' + getSectionEmoji(sec.id, sec.icon) + '</span>' +
        '<span class="st">' + secName + '</span>' +
        (secTag ? '<span class="stag">' + secTag + '</span>' : '') +
      '</div>' +
      '<div class="cl" id="sec-' + sec.id + '" role="group" aria-label="' + secName + ' habits"></div>';

    container.appendChild(sc);

    const cl = sc.querySelector('.cl');
    habits.forEach((h, idx) => cl.appendChild(buildHabitItem(h, idx, habits.length)));
  });
}

/* ─────────────────────────────────────────────────────────────
   REBUILD TODAY SECTIONS
   Preserves scroll position and water card.
───────────────────────────────────────────────────────────────*/
export function rebuildTodaySections() {
  const container = document.getElementById('today-sections');
  if (!container) return;

  /* Save scroll position */
  const scrollY = window.scrollY;

  /* Preserve water card if it exists */
  const waterScene = document.getElementById('wt-scene');
  let   waterCard  = null;
  if (waterScene) {
    const candidate = waterScene.closest('.sc');
    if (candidate && candidate.parentNode === container) {
      waterCard = candidate;
      container.removeChild(waterCard);
    }
  }

  const wasAnimating   = !!wtPropRAF;
  const prevWaterLevel = state.water || 0;

  /* Clear idle timer before rebuild */
  if (wtIdleTmr) { clearInterval(wtIdleTmr); setWtIdleTmr(null); }

  container.innerHTML = '';
  if (!waterCard) setWtSceneInitialized(false);

  ensureDefaultsLocal();
  buildTodaySections(waterCard);

  /* Restart animation if it was running */
  if (waterCard && wasAnimating && !wtPropRAF) {
    import('../shared/water.js').then(m => {
      if (m._wtStartAnimation) m._wtStartAnimation();
    });
  }

  /* Restart idle bubbles */
  if (!wtIdleTmr && prevWaterLevel > 0 && !wtDone) {
    const tmr = setInterval(() => {
      import('../shared/water.js').then(m => {
        if (state.water > 0 && !wtDone && m.wtBubbles) m.wtBubbles(0);
      });
    }, 3200);
    setWtIdleTmr(tmr);
  }

  /* Restore scroll position */
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

/* ─────────────────────────────────────────────────────────────
   REBUILD SINGLE SECTION
───────────────────────────────────────────────────────────────*/
export function rebuildSection(sectionId) {
  const container = document.getElementById('today-sections');
  if (!container) return;

  /* Remove existing */
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
  const secIdx        = allSectionIds.indexOf(sectionId);

  const sc      = document.createElement('div');
  sc.className  = 'sc';
  const secName = sanitizeHTML(sec.name || '');
  const secTag  = sanitizeHTML(sec.tag  || '');

  sc.innerHTML =
    '<div class="sh">' +
      '<span class="si" aria-hidden="true">' + getSectionEmoji(sec.id, sec.icon) + '</span>' +
      '<span class="st">' + secName + '</span>' +
      (secTag ? '<span class="stag">' + secTag + '</span>' : '') +
    '</div>' +
    '<div class="cl" id="sec-' + sectionId + '" role="group" aria-label="' + secName + ' habits"></div>';

  const cl = sc.querySelector('.cl');
  habits.forEach((h, idx) => cl.appendChild(buildHabitItem(h, idx, habits.length)));

  /* Insert in correct position */
  let insertBefore = null;
  for (let i = secIdx + 1; i < allSectionIds.length; i++) {
    const nextEl = document.getElementById('sec-' + allSectionIds[i]);
    if (nextEl) { insertBefore = nextEl.closest('.sc'); break; }
  }

  if (insertBefore) container.insertBefore(sc, insertBefore);
  else              container.appendChild(sc);

  applyChecks();
}

/* ─────────────────────────────────────────────────────────────
   BUILD EVENING SECTION
───────────────────────────────────────────────────────────────*/
export function buildEveningSection() {
  const sc       = document.createElement('div');
  sc.className   = 'sc';
  const wknd     = isWeekend();

  sc.innerHTML =
    '<div class="sh">' +
      '<span class="si" aria-hidden="true">🌆</span>' +
      '<span class="st">Evening</span>' +
      '<span class="stag">' + (wknd ? 'Weekend' : 'before 6 pm') + '</span>' +
    '</div>' +
    '<div class="cl" id="eve-list" role="group" aria-label="Evening habits"></div>';

  const list = sc.querySelector('#eve-list');
  if (list) {
    list.innerHTML = wknd
      ? '<div class="ci" data-key="steps" data-pts="8" ' +
          'role="checkbox" aria-checked="false" tabindex="0">' +
          '<div class="cb" aria-hidden="true"></div>' +
          '<span style="font-size:22px;flex-shrink:0;width:38px;height:38px;' +
                'border-radius:50%;display:flex;align-items:center;' +
                'justify-content:center;background:var(--purple-50);' +
                'border:1.5px solid var(--purple-200);" aria-hidden="true">🏃</span>' +
          '<div class="cit"><div class="cil">10,000 steps today</div>' +
          '<div class="cin">Weekend challenge!</div></div></div>'

      : '<div class="ci" data-key="seeds" data-pts="3" ' +
          'role="checkbox" aria-checked="false" tabindex="0">' +
          '<div class="cb" aria-hidden="true"></div>' +
          '<span style="font-size:22px;flex-shrink:0;width:38px;height:38px;' +
                'border-radius:50%;display:flex;align-items:center;' +
                'justify-content:center;background:var(--purple-50);' +
                'border:1.5px solid var(--purple-200);" aria-hidden="true">🌻</span>' +
          '<div class="cit"><div class="cil">Fruit or seeds</div>' +
          '<div class="cin">1 spoon pumpkin / flax / chia</div></div></div>';
  }

  applyChecks();
  return sc;
}

/* ─────────────────────────────────────────────────────────────
   RESET TODAY
───────────────────────────────────────────────────────────────*/
export function resetToday() {
  state.checks              = {};
  state.water               = 0;
  state.pts                 = 0;
  state.lastResetTimestamp  = Date.now();

  setWtDone(false);

  const compGlow   = document.getElementById('wt-comp-glow');
  const compBanner = document.getElementById('wt-comp-banner');
  if (compGlow)   compGlow.classList.remove('show');
  if (compBanner) compBanner.classList.remove('show');

  import('../tabs/english.js').then(m => {
    if (m.resetDailyLangFlags) m.resetDailyLangFlags();
  });

  const waterScene = document.getElementById('wt-scene');
  if (waterScene) {
    import('../shared/water.js').then(m => {
      if (m.renderWater)             m.renderWater();
      if (m.renderHydrationInsights) m.renderHydrationInsights();
    });
  } else {
    setWtSceneInitialized(false);
    rebuildTodaySections();
  }

  applyChecks();
  updateProg();

  import('../shared/theme.js').then(m => {
    if (m.updateReward)        m.updateReward();
    if (m.updateSummaryCards)  m.updateSummaryCards();
    if (m.updateStatsBanner)   m.updateStatsBanner();
    if (m._updateFooterChips)  m._updateFooterChips();
  });

  import('../tabs/english.js').then(m => {
    if (m.renderLangUI) m.renderLangUI();
  });

  /* Push reset signal to Firebase immediately */
  save();
  showToast('Checklist reset');
}

/* ─────────────────────────────────────────────────────────────
   TODAY WEEKLY PANEL
───────────────────────────────────────────────────────────────*/
export function renderTodayWeeklyPanel() {
  const list    = document.getElementById('today-weekly-list');
  const countEl = document.getElementById('today-weekly-count');
  if (!list) return;

  const tasks    = state.weeklyTasks || [];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayName= dayNames[new Date().getDay()];

  const todayTasks = tasks.filter(t => {
    if (!t.day) return false;
    const days = t.day.split(',');
    return days.includes(todayName) ||
           days.includes('Today')   ||
           days.includes('Anytime');
  });

  const relevant = todayTasks
    .filter(t => !t.done)
    .concat(todayTasks.filter(t => t.done))
    .slice(0, 5);

  const total = tasks.length;
  const done  = tasks.filter(t => t.done).length;

  if (countEl) countEl.textContent = total + ' tasks · ' + done + ' done';

  if (!relevant.length) {
    list.innerHTML =
      '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">' +
      'No tasks for today. ' +
      '<span style="color:var(--purple-600);cursor:pointer;font-weight:700;" ' +
        'data-action="nav-to" data-page="weekly" data-nav-index="4">' +
      'Add weekly tasks</span></div>';
    return;
  }

  list.innerHTML = '';
  relevant.forEach(t => {
    const dc       = getWeeklyDayColor(t.day);
    const safeName = sanitizeHTML(t.name || '');

    const row = document.createElement('div');
    row.setAttribute('role', 'listitem');
    row.style.cssText =
      'display:flex;align-items:center;gap:10px;padding:8px 12px;' +
      'background:' + (t.done ? 'rgba(34,197,94,.08)' : 'rgba(255,255,255,.65)') + ';' +
      'border-radius:var(--r-pill);' +
      'border:1.5px solid ' + (t.done ? 'rgba(34,197,94,.3)' : 'rgba(230,225,255,.7)') + ';' +
      'cursor:pointer;transition:all .2s;margin-bottom:4px;';

    row.setAttribute('data-action', 'wt-toggle');
    row.setAttribute('data-id',     t.id);
    row.setAttribute('aria-label',  safeName + (t.done ? ' — done' : ' — pending'));

    row.innerHTML =
      '<div style="width:18px;height:18px;border-radius:50%;' +
           'border:2px solid ' + (t.done ? '#22c55e' : 'rgba(200,195,240,.8)') + ';' +
           'background:' + (t.done ? '#22c55e' : '#fff') + ';' +
           'flex-shrink:0;display:flex;align-items:center;justify-content:center;" ' +
           'aria-hidden="true">' +
        (t.done ? '<span style="color:#fff;font-size:8px;font-weight:900;">✓</span>' : '') +
      '</div>' +
      '<span style="flex:1;font-size:12px;font-weight:600;' +
        (t.done ? 'text-decoration:line-through;color:var(--text-muted);' : 'color:var(--text-primary);') +
        '">' + safeName + '</span>' +
      '<span style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:99px;' +
           'background:' + dc.bg + ';color:' + dc.color + ';">' +
        sanitizeHTML((t.day || '').split(',').join(' · ')) +
      '</span>';

    list.appendChild(row);
  });
}

/* ─────────────────────────────────────────────────────────────
   HOME REMINDERS
───────────────────────────────────────────────────────────────*/
export function renderHomeReminders() {
  const list  = document.getElementById('home-rem-list');
  const count = document.getElementById('home-rem-count');
  if (!list) return;

  const now     = new Date();
  const curMin  = now.getHours() * 60 + now.getMinutes();
  const today   = now.getDay();
  const deleted = new Set(state.deletedReminderIds || []);

  const active = (state.reminders || [])
    .filter(r => r.enabled && r.days.includes(today) && !deleted.has(r.id));

  if (count) count.textContent = String(active.length);

  list.innerHTML = '';

  if (!active.length) {
    list.innerHTML = '<div class="home-rem-empty">No reminders today.</div>';
    return;
  }

  active
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .forEach(r => {
      const [hh, mm] = r.time.split(':').map(Number);
      const remMin   = hh * 60 + mm;
      const diff     = remMin - curMin;
      const h12      = (hh % 12) || 12;
      const timeStr  = h12 + ':' + String(mm).padStart(2,'0') + ' ' + (hh < 12 ? 'AM' : 'PM');

      let sc = 'upcoming';
      let st = '';
      if      (diff < 0)   { sc = 'passed';   st = 'Passed';   }
      else if (diff === 0) { sc = 'upcoming';  st = 'Now!';     }
      else if (diff <= 60) { sc = 'upcoming';  st = 'In ' + diff + 'm'; }
      else                 { sc = 'upcoming';  st = timeStr;    }

      const row = document.createElement('div');
      row.className = 'home-rem-item';
      row.setAttribute('role', 'listitem');

      row.innerHTML =
        '<div class="home-rem-icon" aria-hidden="true">' + r.icon + '</div>' +
        '<div class="home-rem-body">' +
          '<div class="home-rem-name">'  + sanitizeHTML(r.title || '') + '</div>' +
          '<div class="home-rem-time">'  + timeStr +
            (r.msg ? ' · ' + sanitizeHTML(r.msg || '') : '') +
          '</div>' +
        '</div>' +
        '<span class="home-rem-status ' + sc + '">' + st + '</span>';

      list.appendChild(row);
    });
}

/* ─────────────────────────────────────────────────────────────
   MISSED TASKS BANNER
───────────────────────────────────────────────────────────────*/
export function checkMissedTasksBanner() {
  const now   = new Date();
  const today = todayKey();

  let alertTime = state.missedTasksAlertTime || '21:00';
  if (!validateTimeString(alertTime)) alertTime = '21:00';

  const [ah, am]   = alertTime.split(':').map(Number);
  const curMins    = now.getHours() * 60 + now.getMinutes();
  const alertMins  = ah * 60 + (am || 0);

  if (curMins < alertMins) return;
  if (state.missedBannerDismissedDate === today) return;

  const allItems = document.querySelectorAll('.ci[data-key]');
  const missed   = [];

  allItems.forEach(el => {
    if (!el.classList.contains('done')) {
      const lb = el.querySelector('.cil');
      if (lb) missed.push(lb.textContent);
    }
  });

  const total    = allItems.length;
  const doneCount= total - missed.length;
  const pct      = total > 0 ? Math.round(doneCount / total * 100) : 100;

  const banner = document.getElementById('missed-banner');
  const list   = document.getElementById('missed-task-list');
  const pb     = document.getElementById('missed-pct-badge');

  if (pb)   pb.textContent = pct + '% done';

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
      mm.className  = 'missed-task-item';
      mm.textContent= '...and ' + (missed.length - 8) + ' more';
      list.appendChild(mm);
    }
  }

  if (banner) banner.classList.add('show');

  allItems.forEach(el => {
    if (!el.classList.contains('done')) el.classList.add('missed-highlight');
    else                                el.classList.remove('missed-highlight');
  });
}

export function closeMissedBanner() {
  document.querySelectorAll('.ci.missed-highlight')
          .forEach(el => el.classList.remove('missed-highlight'));
  const banner = document.getElementById('missed-banner');
  if (banner) banner.classList.remove('show');
  state.missedBannerDismissedDate = todayKey();
  debouncedSave();
}

/* ─────────────────────────────────────────────────────────────
   BADGES
───────────────────────────────────────────────────────────────*/
export function checkBadgesDebounced() {
  if (badgeCheckTimer) clearTimeout(badgeCheckTimer);
  setBadgeCheckTimer(setTimeout(async () => {
    setBadgeCheckTimer(null);
    const BADGES = await getBadges();
    let newBadge = false;

    for (const b of BADGES) {
      if (!(state.earnedBadges || []).includes(b.id)) {
        try {
          if (b.condition(state)) {
            if (!state.earnedBadges) state.earnedBadges = [];
            state.earnedBadges.push(b.id);
            showToast('New badge: ' + b.name + ' ' + b.icon);
            confetti();
            newBadge = true;
          }
        } catch (e) {}
      }
    }

    if (newBadge) {
      try { safeLocalStorageSave('htrack_v20', JSON.stringify(state)); } catch (e) {}
      try {
        await userRef('daily_' + todayKey() + '/earnedBadges')
          .set(state.earnedBadges);
      } catch (e) {}
    }
  }, 150));
}

export async function openBadges() {
  const grid = document.getElementById('badge-grid');
  if (!grid) return;

  const BADGES = await getBadges();
  grid.innerHTML = '';

  BADGES.forEach(b => {
    const earned = (state.earnedBadges || []).includes(b.id);
    const d      = document.createElement('div');
    d.className  = 'badge-card' + (earned ? ' earned' : '');
    d.setAttribute('role', 'listitem');
    d.setAttribute('aria-label', sanitizeHTML(b.name) + (earned ? ' — earned' : ' — locked'));
    d.innerHTML  =
      '<div class="badge-icon" aria-hidden="true">' + b.icon + '</div>' +
      '<div class="badge-name">' + sanitizeHTML(b.name) + '</div>' +
      '<div class="badge-desc">' + sanitizeHTML(b.desc) + '</div>';
    grid.appendChild(d);
  });

  const modal = document.getElementById('badges-modal');
  if (modal) {
    modal.classList.add('open');
    const btn = modal.querySelector('button');
    if (btn) btn.focus();
  }
}

export function closeBadges() {
  const m = document.getElementById('badges-modal');
  if (m) m.classList.remove('open');
}

/* ─────────────────────────────────────────────────────────────
   HABIT MANAGEMENT — ADD / EDIT / DELETE / REORDER
───────────────────────────────────────────────────────────────*/
export function addNewHabit() {
  const nameEl    = document.getElementById('new-habit-name');
  const noteEl    = document.getElementById('new-habit-note');
  const sectionEl = document.getElementById('new-habit-section');
  const ptsEl     = document.getElementById('new-habit-pts');

  const nameVal = nameEl ? nameEl.value.trim() : '';
  if (!validateHabitName(nameVal)) {
    showToast('Enter a valid habit name (1–80 characters)', 'yt');
    return;
  }

  const secVal  = sectionEl ? sectionEl.value : '';
  const ptsVal  = Math.max(1, Math.min(20, +(ptsEl ? ptsEl.value : 3) || 3));
  const orders  = (state.habits || [])
    .filter(h => h.section === secVal)
    .map(h => h.order || 0);
  const maxOrder= orders.length ? Math.max(...orders) : 0;

  if (!state.habits) state.habits = [];
  state.habits.push({
    id:      genId(),
    section: secVal,
    name:    nameVal,
    note:    noteEl ? noteEl.value.trim() : '',
    pts:     ptsVal,
    order:   maxOrder + 1
  });

  state.habitsUpdatedAt = Date.now();
  setSettingsNeedRebuild(true);

  debouncedSave();
  rebuildSection(secVal);
  applyChecks();
  updateProg();

  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });

  if (nameEl) nameEl.value = '';
  if (noteEl) noteEl.value = '';
  showToast('Habit added!', 'gt');
}

export function openEditModal(id) {
  setEditingHabitId(id);
  const h = (state.habits || []).find(x => x.id === id);
  if (!h) return;

  const editSel = document.getElementById('edit-habit-section');
  if (editSel) {
    editSel.innerHTML = '';
    (state.sections || []).forEach(sec => {
      if (sec.tag === 'special') return;
      const opt     = document.createElement('option');
      opt.value     = sec.id;
      opt.textContent = getSectionEmoji(sec.id, sec.icon) + ' ' + sec.name;
      editSel.appendChild(opt);
    });
  }

  const nm  = document.getElementById('edit-habit-name');
  const nt  = document.getElementById('edit-habit-note');
  const sec = document.getElementById('edit-habit-section');
  const p   = document.getElementById('edit-habit-pts');

  if (nm)  nm.value  = h.name    || '';
  if (nt)  nt.value  = h.note    || '';
  if (sec) sec.value = h.section || '';
  if (p)   p.value   = h.pts;

  const modal = document.getElementById('edit-modal');
  if (modal) { modal.classList.add('open'); if (nm) nm.focus(); }
}

export function saveEditHabit() {
  const capturedId = editingHabitId;
  if (!capturedId) return;

  const h = (state.habits || []).find(x => x.id === capturedId);
  if (!h) return;

  const nm  = document.getElementById('edit-habit-name');
  const nt  = document.getElementById('edit-habit-note');
  const sec = document.getElementById('edit-habit-section');
  const p   = document.getElementById('edit-habit-pts');

  const newName = nm ? nm.value.trim() : '';
  if (!validateHabitName(newName)) {
    showToast('Enter a valid habit name (1–80 characters)', 'yt');
    return;
  }

  const oldSection = h.section;
  h.name    = newName;
  if (nt)  h.note    = nt.value.trim();
  if (sec) h.section = sec.value;
  if (p)   h.pts     = Math.max(1, Math.min(20, +(p.value) || h.pts));

  state.habitsUpdatedAt = Date.now();
  setSettingsNeedRebuild(true);

  debouncedSave();

  if (oldSection !== h.section) {
    rebuildSection(oldSection);
    rebuildSection(h.section);
  } else {
    rebuildSection(h.section);
  }

  applyChecks();
  updateProg();
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  closeEditModal();
  showToast('Updated!');
}

export function closeEditModal() {
  const m = document.getElementById('edit-modal');
  if (m) m.classList.remove('open');
  setEditingHabitId(null);
}

export function deleteHabit(id) {
  if (!confirm('Delete this habit?')) return;
  const habit     = (state.habits || []).find(h => h.id === id);
  const sectionId = habit ? habit.section : null;

  state.habits = (state.habits || []).filter(h => h.id !== id);
  if (state.checks) delete state.checks[id];
  state.habitsUpdatedAt = Date.now();
  setSettingsNeedRebuild(true);

  debouncedSave();
  if (sectionId) rebuildSection(sectionId);
  applyChecks();
  updateProg();
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  showToast('Deleted');
}

export function moveHabitUp(id) {
  const h   = (state.habits || []).find(x => x.id === id); if (!h) return;
  const sib = state.habits
    .filter(x => x.section === h.section)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sib.indexOf(h); if (idx <= 0) return;
  const tmp = h.order; h.order = sib[idx-1].order; sib[idx-1].order = tmp;
  state.habitsUpdatedAt = Date.now();
  debouncedSave();
  rebuildSection(h.section);
  setSettingsNeedRebuild(true);
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  showToast('Moved up');
}

export function moveHabitDown(id) {
  const h   = (state.habits || []).find(x => x.id === id); if (!h) return;
  const sib = state.habits
    .filter(x => x.section === h.section)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sib.indexOf(h); if (idx >= sib.length - 1) return;
  const tmp = h.order; h.order = sib[idx+1].order; sib[idx+1].order = tmp;
  state.habitsUpdatedAt = Date.now();
  debouncedSave();
  rebuildSection(h.section);
  setSettingsNeedRebuild(true);
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  showToast('Moved down');
}

export function addNewSection() {
  const nameEl = document.getElementById('new-section-name');
  const iconEl = document.getElementById('new-section-icon');
  const nameVal= nameEl ? nameEl.value.trim() : '';
  if (!nameVal) { showToast('Enter a name'); return; }
  const iconVal= iconEl ? (iconEl.value.trim() || '📌') : '📌';

  if (!state.sections) state.sections = [];
  state.sections.push({ id: genId(), icon: iconVal, name: nameVal, tag: '' });
  state.sectionsUpdatedAt = Date.now();
  setSettingsNeedRebuild(true);

  debouncedSave();
  rebuildTodaySections();
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  if (nameEl) nameEl.value = '';
  if (iconEl) iconEl.value = '';
  showToast('Section added!', 'gt');
}

export function deleteSection(id) {
  const habits = (state.habits || []).filter(h => h.section === id);
  if (habits.length && !confirm('Delete section and its ' + habits.length + ' habit(s)?')) return;

  if (settingsFilter === id) setSettingsFilter('all');

  state.sections = (state.sections || []).filter(s => s.id !== id);
  habits.forEach(h => {
    state.habits = state.habits.filter(x => x.id !== h.id);
    if (state.checks) delete state.checks[h.id];
  });

  state.sectionsUpdatedAt = Date.now();
  state.habitsUpdatedAt   = Date.now();
  setSettingsNeedRebuild(true);

  debouncedSave();
  rebuildTodaySections();
  applyChecks();
  updateProg();
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  showToast('Deleted');
}

export function scrollToAddHabit() {
  const el = document.getElementById('add-habit-form-wrap');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* ─────────────────────────────────────────────────────────────
   ICON PICKER
───────────────────────────────────────────────────────────────*/
const ICON_EMOJIS = [
  '🙏','💧','🌰','🥜','🍈','🥚','🍎','🥦','🥛','🌻',
  '📚','📰','🧴','💆','☀️','💊','🚿','😴','🛢️','🏃',
  '🍛','🌙','🍳','🌊','📦','🔔','🧹','✅','🍋','💪',
  '⚡','🎯','🔥','🌿','🧘','🍃','🎵','🎨','🏋️','🧠','❤️'
];

export function openIconPicker(habitId) {
  setIconPickerHabitId(habitId);
  setSelectedEmoji(null);
  setUploadedImageData(null);

  _buildIconEmojiGrid();

  /* Clear previous selection */
  document.querySelectorAll('.icon-emoji-btn').forEach(b => {
    b.classList.remove('sel');
    b.setAttribute('aria-selected', 'false');
  });

  /* Reset upload preview */
  const preview   = document.getElementById('icon-upload-preview');
  if (preview)    preview.innerHTML = '📤';
  const fileInput = document.getElementById('icon-file-input');
  if (fileInput)  fileInput.value   = '';

  switchIconMode('emoji');

  const overlay = document.getElementById('icon-picker-overlay');
  if (overlay) {
    overlay.classList.add('open');
    const first = overlay.querySelector('button,[tabindex="0"]');
    if (first) first.focus();
  }
}

function _buildIconEmojiGrid() {
  const grid = document.getElementById('icon-emoji-grid');
  if (!grid || grid.children.length > 0) return; /* build once */

  ICON_EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'icon-emoji-btn';
    btn.textContent = e;
    btn.type = 'button';
    btn.setAttribute('aria-label', e + ' emoji');
    btn.setAttribute('role', 'option');
    btn.onclick = () => {
      document.querySelectorAll('.icon-emoji-btn').forEach(b => {
        b.classList.remove('sel');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('sel');
      btn.setAttribute('aria-selected', 'true');
      setSelectedEmoji(e);
    };
    grid.appendChild(btn);
  });
}

export function switchIconMode(mode) {
  setIconPickerMode(mode);
  const emPanel = document.getElementById('icon-emoji-panel');
  const upPanel = document.getElementById('icon-upload-panel');
  const emMode  = document.getElementById('ipm-emoji');
  const upMode  = document.getElementById('ipm-upload');

  if (emMode) emMode.classList.toggle('active', mode === 'emoji');
  if (upMode) upMode.classList.toggle('active', mode === 'upload');
  if (emPanel) emPanel.classList.toggle('active', mode === 'emoji');
  if (upPanel) upPanel.classList.toggle('active', mode === 'upload');
}

export function handleIconUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const ALLOWED = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
  if (!ALLOWED.includes(file.type)) {
    showToast('Please upload a JPG, PNG, GIF, or WebP image', 'rt');
    input.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image too large. Please use an image under 5MB', 'rt');
    input.value = '';
    return;
  }

  const MAX_SIZE  = 64;
  const MAX_BYTES = 50 * 1024;
  const img       = new Image();

  img.onerror = () => { showToast('Could not read image file', 'rt'); input.value = ''; };
  img.onload  = () => {
    URL.revokeObjectURL(img.src);
    const canvas = document.createElement('canvas');
    canvas.width = MAX_SIZE; canvas.height = MAX_SIZE;
    const ctx    = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(MAX_SIZE/2, MAX_SIZE/2, MAX_SIZE/2, 0, Math.PI*2);
    ctx.closePath(); ctx.clip();
    const scale = Math.max(MAX_SIZE/img.width, MAX_SIZE/img.height);
    const w     = img.width  * scale;
    const h     = img.height * scale;
    ctx.drawImage(img, (MAX_SIZE-w)/2, (MAX_SIZE-h)/2, w, h);
    let dataUrl = canvas.toDataURL('image/webp', 0.7);
    if (!dataUrl.startsWith('data:image/webp'))
      dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    if (dataUrl.length > MAX_BYTES * 1.37) {
      showToast('Image too large even after compression', 'yt');
      return;
    }
    setUploadedImageData(dataUrl);
    const preview = document.getElementById('icon-upload-preview');
    if (preview) preview.innerHTML = '<img src="' + dataUrl + '" alt="Selected icon"/>';
  };

  img.src = URL.createObjectURL(file);
}

export function confirmIconPick() {
  if (!iconPickerHabitId) return;
  const habit = (state.habits || []).find(h => h.id === iconPickerHabitId);
  if (!habit) return;

  if (iconPickerMode === 'emoji' && selectedEmoji) {
    habit.customIcon     = selectedEmoji;
    habit.customIconType = 'emoji';
    showToast('Icon updated!', 'gt');
  } else if (iconPickerMode === 'upload' && uploadedImageData) {
    habit.customIcon     = uploadedImageData;
    habit.customIconType = 'image';
    showToast('Image set! Stored locally.', 'gt');
  } else {
    showToast('Select an emoji or upload an image first', 'yt');
    return;
  }

  state.habitsUpdatedAt = Date.now();
  setSettingsNeedRebuild(true);
  setSelectedEmoji(null);
  setUploadedImageData(null);

  debouncedSave();
  rebuildSection(habit.section);
  applyChecks();
  import('../tabs/settings.js').then(m => { if (m.buildSettingsPage) m.buildSettingsPage(); });
  closeIconPicker();
}

export function closeIconPicker() {
  const m = document.getElementById('icon-picker-overlay');
  if (m) m.classList.remove('open');
  setIconPickerHabitId(null);
}

/* ─────────────────────────────────────────────────────────────
   PRIVATE — ensure defaults without importing from firebase.js
   (avoids circular imports)
───────────────────────────────────────────────────────────────*/
function ensureDefaultsLocal() {
  if (!state.habits   || !state.habits.length)
    state.habits   = JSON.parse(JSON.stringify(DEFAULT_HABITS));
  if (!state.sections || !state.sections.length)
    state.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
}
