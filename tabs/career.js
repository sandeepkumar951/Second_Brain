/* ═══════════════════════════════════════════════════════════════
   tabs/career.js
   Career tracker tab — daily study goal, skill meter, streak,
   weekly chart, tasks, activity log, live countdown.
   Depends on: core/state.js, core/utils.js, core/firebase.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  CT_HOUR_GOAL,
  CT_WEEK_GOAL,
  CT_TARGET_DATE,
  CT_LOG_LIMIT,
  CT_XP_PER_HOUR,
  CT_SKILL_KEYS,
  DAY_NAMES,
  /* flags */
  ctPageBuilt,          setCtPageBuilt,
  ctActiveTag,          setCtActiveTag,
  _ctCdInterval,        setCtCdInterval,
  _ctDayCompletedThisSession, setCtDayCompletedThisSession
} from '../core/state.js';

import {
  todayKey,
  yesterdayKey,
  formatDateShort,
  sanitizeHTML,
  showToast,
  confetti,
  genId
} from '../core/utils.js';

import {
  debouncedSave,
  save
} from '../core/firebase.js';

/* ─────────────────────────────────────────────────────────────
   MOTIVATIONAL QUOTES
───────────────────────────────────────────────────────────────*/
const CT_QUOTES = [
  '1% better every day = 37x better in a year.',
  'Every SQL query you write is a step closer to your offer letter.',
  'Consistency beats talent when talent does not show up.',
  'You are not behind — you are building. Keep going, Sandeep!',
  'Data tells stories. Learn to speak the language.',
  'The analyst role is not a dream — it is a plan. Execute it.',
  'Small daily progress creates unbeatable momentum.',
  'Excel, PBI, Python — master the tools, master the job.',
  'Day 0 is today. Day 100 is your job offer.',
  'Zero to hero — one percent at a time.'
];

/* ─────────────────────────────────────────────────────────────
   STREAK LOGIC
───────────────────────────────────────────────────────────────*/

/**
 * Records today's outcome in ctDayHistory.
 * Uses priority: complete(3) > partial(2) > rest(1).
 */
export function ctRecordDayOutcome(outcome) {
  if (!state.ctDayHistory) state.ctDayHistory = {};
  const today    = todayKey();
  const priority = { complete: 3, partial: 2, rest: 1 };
  const existing = priority[state.ctDayHistory[today]] || 0;
  const incoming = priority[outcome]                   || 0;
  if (incoming > existing) state.ctDayHistory[today] = outcome;
}

/**
 * Re-evaluates ctStreakDays from ctDayHistory.
 * One rest day is allowed without breaking streak.
 * Two consecutive rest days resets it.
 */
export function ctEvaluateStreak() {
  if (!state.ctDayHistory) state.ctDayHistory = {};
  const days = Object.keys(state.ctDayHistory).sort().reverse();
  if (!days.length) {
    state.ctStreakDays          = 0;
    state.ctConsecutiveRestDays = 0;
    return;
  }

  let streak  = 0;
  let restRun = 0;

  for (let i = 0; i < days.length; i++) {
    const outcome = state.ctDayHistory[days[i]];
    if (outcome === 'complete') {
      streak++;
      restRun = 0;
    } else if (outcome === 'rest') {
      restRun++;
      if (restRun >= 2) break;
    } else if (outcome === 'partial') {
      break;
    } else {
      restRun++;
      if (restRun >= 2) break;
    }
  }

  state.ctStreakDays          = streak;
  state.ctConsecutiveRestDays = restRun;

  const lastComplete = days.find(d => state.ctDayHistory[d] === 'complete');
  if (lastComplete) state.ctStreakLastDate = lastComplete;
}

/**
 * Bumps the streak when the user logs study hours.
 * Guards against double-counting with ctTodayLogged.
 */
export function ctBumpStreak() {
  if (state.ctTodayLogged) return;
  state.ctTodayLogged = true;
  const isComplete    = state.ctStudyHrs >= CT_HOUR_GOAL;
  ctRecordDayOutcome(isComplete ? 'complete' : 'partial');
  ctEvaluateStreak();
  state.ctLastDate = todayKey();
  if (isComplete) state.ctStreakLastDate = todayKey();
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────*/

/**
 * Returns study hours for today only.
 * Returns 0 if ctLastStudyDate is not today.
 */
export function ctGetTodayHrs() {
  const today = todayKey();
  if (state.ctLastStudyDate === today) return Math.max(0, state.ctStudyHrs || 0);
  if (state.lastDate !== today && state.lastDate) return 0;
  return Math.max(0, state.ctStudyHrs || 0);
}

/**
 * Returns overall career readiness percentage (average of 4 skills).
 */
export function ctOverallPct(s) {
  const skills = (s || state).ctSkills || {};
  return Math.round(
    ((skills.sql   || 0) +
     (skills.tools || 0) +
     (skills.proj  || 0) +
     (skills.intv  || 0)) / 4
  );
}

/**
 * Ensures ctSkills is valid and all values are 0–100.
 */
export function ctSafeSkills() {
  if (!state.ctSkills || typeof state.ctSkills !== 'object')
    state.ctSkills = { sql: 0, tools: 0, proj: 0, intv: 0 };
  CT_SKILL_KEYS.forEach(k => {
    if (typeof state.ctSkills[k] !== 'number' || isNaN(state.ctSkills[k]))
      state.ctSkills[k] = 0;
    state.ctSkills[k] = Math.max(0, Math.min(100, state.ctSkills[k]));
  });
  return state.ctSkills;
}

/**
 * Returns total study hours logged in the current week (Mon–Sun).
 */
export function ctGetWeeklyHrs() {
  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  const todayK = todayKey();
  const now    = new Date();
  let total    = 0;
  for (let i = 0; i < 7; i++) {
    const d   = new Date(now); d.setDate(now.getDate() - i);
    const key = d.getFullYear() + '-' +
                String(d.getMonth()+1).padStart(2,'0') + '-' +
                String(d.getDate()).padStart(2,'0');
    if (key === todayK)
      total += Math.max(ctGetTodayHrs(), state.ctWeeklyHours[key] || 0);
    else
      total += (state.ctWeeklyHours[key] || 0);
  }
  return total;
}

/* ─────────────────────────────────────────────────────────────
   ACTIVITY LOG
───────────────────────────────────────────────────────────────*/
export function ctLog(msg) {
  if (!Array.isArray(state.ctLog)) state.ctLog = [];
  const now  = new Date();
  const time = String(now.getHours()).padStart(2,'0') + ':' +
               String(now.getMinutes()).padStart(2,'0');
  state.ctLog.unshift({ msg, time, date: todayKey() });
  state.ctLogUpdatedAt = Date.now();
  if (state.ctLog.length > CT_LOG_LIMIT)
    state.ctLog = state.ctLog.slice(0, CT_LOG_LIMIT);
}

export function ctNewQuote() {
  const el = document.getElementById('ct-quote-text');
  if (el) el.textContent = CT_QUOTES[Math.floor(Math.random() * CT_QUOTES.length)];
}

/* ─────────────────────────────────────────────────────────────
   DAILY RESET (called early in init so streak shows)
───────────────────────────────────────────────────────────────*/
export function ctDailyReset() {
  const today = todayKey();
  if (state.ctLastDate === today || state.lastDate === today) return;

  if ((state.ctStudyHrs || 0) > 0 && state.ctLastStudyDate) {
    if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
    state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
      state.ctWeeklyHours[state.ctLastStudyDate] || 0,
      state.ctStudyHrs
    );
  }

  _ctProactiveMidnightStreak();

  state.ctStudyHrs    = 0;
  state.ctDayDone     = false;
  state.ctTodayLogged = false;
  state.ctLastStudyDate = null;
}

function _ctProactiveMidnightStreak() {
  const yesterday = yesterdayKey();
  if (!state.ctDayHistory) state.ctDayHistory = {};
  if (!state.ctDayHistory[yesterday]) {
    state.ctDayHistory[yesterday] =
      state.ctDayDone              ? 'complete' :
      (state.ctStudyHrs || 0) > 0  ? 'partial'  : 'rest';
    ctEvaluateStreak();
  }
}

/* ─────────────────────────────────────────────────────────────
   RENDER FUNCTIONS
───────────────────────────────────────────────────────────────*/
export function ctRenderAll() {
  ctRenderHero();
  ctRenderStreak();
  ctRenderDailyGoal();
  ctRenderMeter();
  ctRenderWeekChart();
  ctRenderTasks();
  ctRenderLog();
  ctRenderStreakHistory();

  import('../shared/theme.js').then(m => {
    if (m.updateStatsBanner)    m.updateStatsBanner();
    if (m._updateFooterChips)   m._updateFooterChips();
    if (m.updateSummaryCards)   m.updateSummaryCards();
    if (m.checkStreakMilestone) m.checkStreakMilestone();
  });

  import('../shared/badges.js').then(m => {
    if (m.checkBadgesDebounced) m.checkBadgesDebounced();
  });
}

export function ctRenderHero() {
  const el = document.getElementById('ct-hero-countdown');
  if (!el) return;

  const today  = new Date(); today.setHours(0,0,0,0);
  const target = new Date(CT_TARGET_DATE); target.setHours(0,0,0,0);
  const diff   = Math.ceil((target - today) / 86400000);

  if      (diff > 0)  { el.textContent = diff + ' days to target · Aug 30 2026'; el.className = 'ct-hero-countdown' + (diff < 30 ? ' urgent' : ''); }
  else if (diff === 0){ el.textContent = 'Target Day is TODAY!';                  el.className = 'ct-hero-countdown urgent'; }
  else                { el.textContent = 'Overdue by ' + Math.abs(diff) + ' days';el.className = 'ct-hero-countdown urgent'; }

  const xpEl  = document.getElementById('ct-hero-xp');
  const dayEl = document.getElementById('ct-hero-days');
  const stkEl = document.getElementById('ct-hero-streak');
  if (xpEl)  xpEl.textContent  = (state.totalPts   || 0) + ' XP';
  if (dayEl) dayEl.textContent  = 'Day ' + (state.ctTotalDays || 0);
  if (stkEl) stkEl.textContent  = (state.ctStreakDays || 0) + ' streak';
}

export function ctRenderStreak() {
  const numEl  = document.getElementById('ct-streak-num-val');
  const msgEl  = document.getElementById('ct-streak-msg-val');
  const datEl  = document.getElementById('ct-streak-date-val');
  const dcEl   = document.getElementById('ct-day-count');
  const s      = state.ctStreakDays || 0;

  if (numEl) numEl.textContent = s;
  if (dcEl)  dcEl.textContent  = 'Day ' + (state.ctTotalDays || 0);

  if (msgEl) {
    if      (s === 0) msgEl.textContent = 'No streak yet — start today!';
    else if (s === 1) msgEl.textContent = 'Day 1! Come back tomorrow';
    else if (s < 7)   msgEl.textContent = s + ' days in a row! Keep going';
    else if (s < 30)  msgEl.textContent = s + ' day streak! Incredible';
    else              msgEl.textContent = s + ' days! Unstoppable!';
  }

  if (datEl) datEl.textContent = state.ctStreakLastDate
    ? 'Last studied: ' + formatDateShort(state.ctStreakLastDate)
    : 'Log study time to begin';

  const statusEl = document.getElementById('ct-streak-status');
  if (statusEl) {
    const rest = state.ctConsecutiveRestDays || 0;
    if      (s > 0 && rest === 1) { statusEl.textContent = 'One rest day taken — ONE more rest will reset your streak!'; statusEl.className = 'ct-streak-status warn'; statusEl.style.display = 'flex'; }
    else if (s > 0 && rest === 0) { statusEl.textContent = 'Streak safe — keep going!'; statusEl.className = 'ct-streak-status'; statusEl.style.display = 'flex'; }
    else                          { statusEl.style.display = 'none'; }
  }
}

export function ctRenderDailyGoal() {
  const hrs = ctGetTodayHrs();
  const pct = Math.min(100, Math.round((hrs / CT_HOUR_GOAL) * 100));

  const pie = document.getElementById('ct-pie-ring');
  const txt = document.getElementById('ct-pie-text');
  if (pie) pie.style.setProperty('--ct-p', pct + '%');
  if (txt) txt.textContent = hrs + '/' + CT_HOUR_GOAL;

  const sta = document.getElementById('ct-daily-status');
  if (sta) {
    if      (hrs === 0)             { sta.className = 'ct-daily-status red';    sta.textContent = 'Not started — add study hours below'; }
    else if (hrs >= CT_HOUR_GOAL)   { sta.className = 'ct-daily-status green';  sta.textContent = hrs + ' hrs done! Tap Complete Day'; }
    else if (hrs === 3)             { sta.className = 'ct-daily-status yellow'; sta.textContent = '3/4 hrs — almost there!'; }
    else                            { sta.className = 'ct-daily-status yellow'; sta.textContent = hrs + '/' + CT_HOUR_GOAL + ' hrs — push harder!'; }
  }

  const btn = document.getElementById('ct-complete-btn');
  if (btn) {
    if      (state.ctDayDone)         { btn.className = 'ct-hour-btn complete done';   btn.textContent = 'Completed!'; btn.onclick = null; btn.setAttribute('aria-disabled','true'); }
    else if (hrs >= CT_HOUR_GOAL)     { btn.className = 'ct-hour-btn complete';        btn.textContent = 'Complete Day'; btn.onclick = ctCompleteDay; btn.removeAttribute('aria-disabled'); }
    else                              { btn.className = 'ct-hour-btn complete locked'; btn.textContent = 'Complete Day'; btn.onclick = null; btn.setAttribute('aria-disabled','true'); }
  }

  const minusBtn = document.getElementById('ct-minus-btn');
  if (minusBtn) {
    const disabled = hrs <= 0 || !!state.ctDayDone;
    minusBtn.disabled = disabled;
    minusBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }

  const plusBtn = document.getElementById('ct-plus-btn');
  if (plusBtn) {
    plusBtn.disabled = !!state.ctDayDone;
    plusBtn.setAttribute('aria-disabled', state.ctDayDone ? 'true' : 'false');
  }

  const todayBanner   = document.getElementById('ct-today-banner');
  const completeBanner= document.getElementById('ct-complete-banner');
  if (todayBanner)    todayBanner.style.display    = state.ctTodayLogged ? 'block' : 'none';
  if (completeBanner) completeBanner.style.display = state.ctDayDone     ? 'block' : 'none';

  const ri = document.getElementById('ct-daily-reset-info');
  if (ri)  ri.textContent = todayKey() + ' · Resets at midnight';
}

export function ctRenderMeter() {
  const skills = ctSafeSkills();
  const cfg    = [
    { key: 'sql',   label: 'SQL Skills',              color: 'linear-gradient(90deg,#7c3aed,#a78bfa)' },
    { key: 'tools', label: 'Tools (Excel/PBI/Python)', color: 'linear-gradient(90deg,#2563eb,#60a5fa)' },
    { key: 'proj',  label: 'Projects',                 color: 'linear-gradient(90deg,#059669,#34d399)' },
    { key: 'intv',  label: 'Interview Skills',         color: 'linear-gradient(90deg,#d97706,#fbbf24)' }
  ];

  cfg.forEach(c => {
    const val  = skills[c.key] || 0;
    const bar  = document.getElementById('ct-bar-'  + c.key);
    const pct  = document.getElementById('ct-pct-'  + c.key);
    const warn = document.getElementById('ct-warn-' + c.key);
    if (bar)  { bar.style.width = val + '%'; bar.style.background = c.color; }
    if (pct)  pct.textContent   = val + '%';
    if (warn) warn.classList.toggle('show', val >= 100);
  });

  const avg    = ctOverallPct(state);
  const ovBar  = document.getElementById('ct-bar-overall');
  const ovPct  = document.getElementById('ct-pct-overall');
  if (ovBar)   ovBar.style.width  = avg + '%';
  if (ovPct)   ovPct.textContent  = avg + '%';

  const ovTrack = ovBar ? ovBar.parentElement : null;
  if (ovTrack)  ovTrack.setAttribute('aria-valuenow', avg);

  document.querySelectorAll('.ct-ms-box').forEach(el => {
    const m = parseInt(el.dataset.m || '0');
    el.classList.toggle('reached', avg >= m);
    el.setAttribute('aria-label', m + '% — ' + (avg >= m ? 'reached' : 'locked'));
  });

  const today  = new Date(); today.setHours(0,0,0,0);
  const target = new Date(CT_TARGET_DATE); target.setHours(0,0,0,0);
  const diff   = Math.ceil((target - today) / 86400000);
  const cntEl  = document.getElementById('ct-target-countdown-inline');
  if (cntEl)   { cntEl.textContent = diff > 0 ? diff + ' days left' : diff === 0 ? 'Today!' : 'Overdue'; cntEl.style.color = diff < 30 ? '#ef4444' : '#7c3aed'; }
}

export function ctRenderWeekChart() {
  const barsEl   = document.getElementById('ct-chart-bars');
  const labelsEl = document.getElementById('ct-chart-labels');
  if (!barsEl || !labelsEl) return;

  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  const now    = new Date();
  const todayK = todayKey();
  const days   = [];
  let totalHrs = 0;

  for (let i = 6; i >= 0; i--) {
    const d   = new Date(now); d.setDate(now.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const isToday    = (key === todayK);
    const stored     = state.ctWeeklyHours[key] || 0;
    const dayOutcome = (state.ctDayHistory || {})[key];
    let hrs;
    if      (isToday)                                    hrs = Math.max(ctGetTodayHrs(), stored);
    else if (dayOutcome === 'rest' || (!dayOutcome && key < todayK)) hrs = 0;
    else                                                 hrs = stored;
    days.push({ label: DAY_NAMES[d.getDay()], hrs, isToday });
    totalHrs += hrs;
  }

  /* Build bar columns if not yet built */
  if (barsEl.children.length !== days.length) {
    barsEl.innerHTML   = '';
    labelsEl.innerHTML = '';
    days.forEach((_, i) => {
      const col = document.createElement('div');
      col.className = 'ct-chart-col';
      col.innerHTML =
        '<div class="ct-chart-hrs" id="ct-chr-h' + i + '"></div>' +
        '<div class="ct-chart-bar-outer" id="ct-chr-o' + i + '">' +
          '<div class="ct-chart-bar-inner" id="ct-chr-b' + i + '"></div>' +
        '</div>';
      barsEl.appendChild(col);

      const lbl = document.createElement('div');
      lbl.id    = 'ct-chr-l' + i;
      lbl.className = 'ct-chart-day';
      labelsEl.appendChild(lbl);
    });
  }

  days.forEach((d, i) => {
    const pct      = Math.min(100, (d.hrs / CT_HOUR_GOAL) * 100);
    const barColor = d.hrs >= CT_HOUR_GOAL ? '#059669' : d.hrs >= 1 ? '#3b82f6' : '#e5e7eb';
    const hEl = document.getElementById('ct-chr-h' + i);
    const oEl = document.getElementById('ct-chr-o' + i);
    const bEl = document.getElementById('ct-chr-b' + i);
    const lEl = document.getElementById('ct-chr-l' + i);
    if (hEl) hEl.textContent   = d.hrs > 0 ? d.hrs + 'h' : '';
    if (oEl) oEl.className     = 'ct-chart-bar-outer' + (d.isToday ? ' today' : '');
    if (bEl) { bEl.style.height = pct + '%'; bEl.style.background = barColor; }
    if (lEl) { lEl.textContent  = d.isToday ? 'Today' : d.label; lEl.className = 'ct-chart-day' + (d.isToday ? ' today' : ''); }
  });

  const studied  = days.filter(d => d.hrs > 0).length;
  const avg      = studied > 0 ? (totalHrs / studied).toFixed(1) : '0';
  const totEl    = document.getElementById('ct-week-total');
  const avgEl    = document.getElementById('ct-week-avg');
  if (totEl) totEl.innerHTML = 'Weekly Total: <strong>' + totalHrs + ' hrs</strong>';
  if (avgEl) avgEl.innerHTML = 'Daily Avg: <strong>'    + avg      + ' hrs</strong>';
}

export function ctRenderStreakHistory() {
  const container = document.getElementById('ct-history-row');
  if (!container) return;
  if (!state.ctDayHistory) { container.innerHTML = ''; return; }

  const now   = new Date();
  const today = todayKey();
  container.innerHTML = '';

  for (let i = 13; i >= 0; i--) {
    const d   = new Date(now); d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const outcome    = state.ctDayHistory[key] || null;
    const isTodayDot = (key === today);

    const el = document.createElement('div');
    el.className = 'ct-history-dot ' + (outcome || 'rest') + (isTodayDot ? ' today' : '');
    el.setAttribute('role',       'listitem');
    el.setAttribute('aria-label', formatDateShort(key) + ': ' + (outcome || 'no data'));
    el.setAttribute('title',      formatDateShort(key) + ': ' + (outcome || 'no data'));
    el.textContent = outcome === 'complete' ? '✓' : outcome === 'partial' ? '~' : '';
    container.appendChild(el);
  }
}

export function ctRenderLog() {
  const ul  = document.getElementById('ct-log-list');
  if (!ul) return;

  const log        = Array.isArray(state.ctLog) ? state.ctLog : [];
  const contentKey = log.slice(0, 10).map(e => (e.msg || '') + (e.time || '')).join('|');
  if (ul._lastContentKey === contentKey) return;
  ul._lastContentKey = contentKey;

  if (!log.length) {
    ul.innerHTML = '<li class="ct-log-item" style="justify-content:center;color:#9c87d4;">No activity yet.</li>';
    return;
  }

  ul.innerHTML = log.map(e =>
    '<li class="ct-log-item" role="listitem">' +
      '<span>' + sanitizeHTML(e.msg || '') + '</span>' +
      '<span class="ct-log-time">' +
        ((e.date && e.date !== todayKey() ? e.date.slice(5) + ' ' : '') + (e.time || '')) +
      '</span>' +
    '</li>'
  ).join('');
}

export function ctRenderTasks() {
  const ul = document.getElementById('ct-task-list');
  if (!ul) return;
  if (!Array.isArray(state.ctTasks)) state.ctTasks = [];

  const filtered = (ctActiveTag === 'All' || !ctActiveTag)
    ? state.ctTasks
    : state.ctTasks.filter(t => t.cat === ctActiveTag);

  if (!filtered.length) {
    ul.innerHTML = '<li style="font-size:11px;color:#9c87d4;text-align:center;padding:12px 0;">No tasks yet. Add one above!</li>';
    return;
  }

  ul.innerHTML = filtered.map(t =>
    '<li class="ct-task-item" role="listitem">' +
      '<input type="checkbox"' + (t.done ? ' checked' : '') +
        ' data-action="toggle-ct-task" data-id="' + t.id + '"' +
        ' aria-label="' + sanitizeHTML(t.text || '') + '"' +
        ' style="accent-color:#7c3aed;width:15px;height:15px;cursor:pointer;flex-shrink:0;"/>' +
      '<span class="ct-task-text' + (t.done ? ' done' : '') + '">' + sanitizeHTML(t.text || '') + '</span>' +
      '<span class="ct-task-cat">' + sanitizeHTML(t.cat || '') + '</span>' +
      '<button class="ct-task-del" data-action="delete-ct-task" data-id="' + t.id + '"' +
        ' aria-label="Delete task: ' + sanitizeHTML(t.text || '') + '">✕</button>' +
    '</li>'
  ).join('');
}

/* ─────────────────────────────────────────────────────────────
   ACTION HANDLERS
───────────────────────────────────────────────────────────────*/

export function ctAddHourAndSkill(skill, label) {
  if (state.ctDayDone) { showToast('Day already completed!'); return; }
  const skills = ctSafeSkills();
  if ((skills[skill] || 0) >= 100) {
    showToast(label + ' is already at 100%! Switch to another skill.', 'yt');
    return;
  }

  skills[skill]       = Math.min(100, (skills[skill] || 0) + 1);
  state.ctStudyHrs    = ctGetTodayHrs() + 1;
  state.ctLastStudyDate = todayKey();

  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  state.ctWeeklyHours[todayKey()] = Math.max(
    state.ctWeeklyHours[todayKey()] || 0,
    state.ctStudyHrs
  );

  state.pts      = Math.min(99999, (state.pts      || 0) + CT_XP_PER_HOUR);
  state.totalPts = Math.min(99999, (state.totalPts || 0) + CT_XP_PER_HOUR);

  ctBumpStreak();
  ctLog('+1h · ' + label + ' +1% → ' + skills[skill] + '% · +' + CT_XP_PER_HOUR + ' XP');

  ctRenderAll();
  import('../shared/theme.js').then(m => {
    if (m.updateReward)       m.updateReward();
    if (m._updateFooterChips) m._updateFooterChips();
  });
  debouncedSave();
}

export function ctRemoveHourAndSkill(skill) {
  if (state.ctDayDone)       { showToast('Day already completed — cannot remove hours.'); return; }
  if (ctGetTodayHrs() <= 0)  { showToast('Already at 0 hours'); return; }

  const skills        = ctSafeSkills();
  skills[skill]       = Math.max(0, (skills[skill] || 0) - 1);
  state.ctStudyHrs    = ctGetTodayHrs() - 1;

  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  state.ctWeeklyHours[todayKey()] = state.ctStudyHrs;
  if (state.ctStudyHrs === 0) state.ctLastStudyDate = null;

  state.pts = Math.max(0, (state.pts || 0) - CT_XP_PER_HOUR);

  ctLog('-1h · ' + skill.toUpperCase() + ' -1% → ' + skills[skill] + '%');
  ctRenderAll();
  import('../shared/theme.js').then(m => { if (m.updateReward) m.updateReward(); });
  debouncedSave();
}

export function ctAddHour() {
  if (state.ctDayDone) { showToast('Day already completed!'); return; }

  state.ctStudyHrs      = ctGetTodayHrs() + 1;
  state.ctLastStudyDate = todayKey();

  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  state.ctWeeklyHours[todayKey()] = Math.max(
    state.ctWeeklyHours[todayKey()] || 0,
    state.ctStudyHrs
  );

  state.pts      = Math.min(99999, (state.pts      || 0) + CT_XP_PER_HOUR);
  state.totalPts = Math.min(99999, (state.totalPts || 0) + CT_XP_PER_HOUR);

  ctBumpStreak();
  ctLog('+1h studied (' + state.ctStudyHrs + '/' + CT_HOUR_GOAL + ' hrs)');

  ctRenderAll();
  import('../shared/theme.js').then(m => {
    if (m.updateReward)       m.updateReward();
    if (m._updateFooterChips) m._updateFooterChips();
  });
  debouncedSave();
}

export function ctRemoveHour() {
  if (state.ctDayDone)      { showToast('Day already completed — cannot remove hours.'); return; }
  if (ctGetTodayHrs() <= 0) { showToast('Already at 0 hours'); return; }

  state.ctStudyHrs = ctGetTodayHrs() - 1;

  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  state.ctWeeklyHours[todayKey()] = state.ctStudyHrs;
  if (state.ctStudyHrs === 0) state.ctLastStudyDate = null;

  state.pts = Math.max(0, (state.pts || 0) - CT_XP_PER_HOUR);

  ctLog('-1h removed (' + state.ctStudyHrs + '/' + CT_HOUR_GOAL + ' hrs)');
  ctRenderAll();
  import('../shared/theme.js').then(m => { if (m.updateReward) m.updateReward(); });
  debouncedSave();
}

export function ctCompleteDay() {
  if (ctGetTodayHrs() < CT_HOUR_GOAL || state.ctDayDone) return;
  if (state.ctTodayLogged) return;

  setCtDayCompletedThisSession(true);
  state.ctDayDone = true;

  if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
  state.ctWeeklyHours[todayKey()] = Math.max(
    state.ctWeeklyHours[todayKey()] || 0,
    state.ctStudyHrs
  );

  state.ctTotalDays    = (state.ctTotalDays || 0) + 1;
  state.ctTodayLogged  = true;

  ctRecordDayOutcome('complete');
  ctEvaluateStreak();
  state.ctStreakLastDate = todayKey();

  ctLog('Day COMPLETE — ' + state.ctStudyHrs + ' hrs!');
  confetti();
  showToast('Day complete! Keep the streak going!', 'gt');
  ctRenderAll();
  import('../shared/theme.js').then(m => { if (m.updateReward) m.updateReward(); });
  debouncedSave();
}

export function ctSelectTag(el, tag) {
  document.querySelectorAll('.ct-tag').forEach(t => {
    t.classList.remove('active');
    t.setAttribute('aria-pressed', 'false');
  });
  el.classList.add('active');
  el.setAttribute('aria-pressed', 'true');
  setCtActiveTag(tag);
  ctRenderTasks();
}

export function ctAddTask() {
  const inp = document.getElementById('ct-task-input');
  const val = inp ? inp.value.trim() : '';
  if (!val)          { showToast('Enter a task name'); return; }
  if (val.length > 80){ showToast('Task name too long (max 80 characters)', 'yt'); return; }

  if (!Array.isArray(state.ctTasks)) state.ctTasks = [];
  const cat = (ctActiveTag === 'All' || !ctActiveTag) ? 'General' : ctActiveTag;
  state.ctTasks.push({ id: genId(), text: val, cat, done: false });
  state.ctTasksUpdatedAt = Date.now();

  if (inp) inp.value = '';
  ctLog('Task added: ' + val);
  ctRenderTasks();
  debouncedSave();
}

export function ctToggleTask(id) {
  if (!Array.isArray(state.ctTasks)) return;
  const t = state.ctTasks.find(x => x.id === id); if (!t) return;
  t.done = !t.done;
  state.ctTasksUpdatedAt = Date.now();
  ctLog((t.done ? 'Done' : 'Undone') + ': ' + t.text);
  ctRenderTasks();
  debouncedSave();
}

export function ctRemoveTask(id) {
  if (!Array.isArray(state.ctTasks)) return;
  const t = state.ctTasks.find(x => x.id === id);
  if (t) ctLog('Removed: ' + t.text);
  state.ctTasks          = state.ctTasks.filter(x => x.id !== id);
  state.ctTasksUpdatedAt = Date.now();
  ctRenderTasks();
  debouncedSave();
}

export async function ctClearLog() {
  state.ctLog          = [];
  state.ctLogUpdatedAt = Date.now();
  ctRenderAll();
  await save();
  showToast('Log cleared');
}

export function ctResetAll() {
  if (!confirm('Reset ALL career progress — skills, streak, hours, log and tasks?')) return;

  state.ctSkills               = { sql: 0, tools: 0, proj: 0, intv: 0 };
  state.ctStreakDays            = 0;
  state.ctLastDate              = null;
  state.ctStreakLastDate         = null;
  state.ctTodayLogged           = false;
  state.ctTotalDays             = 0;
  state.ctStudyHrs              = 0;
  state.ctDayDone               = false;
  state.ctWeeklyHours           = {};
  state.ctLastStudyDate         = null;
  state.ctLog                   = [];
  state.ctTasks                 = [];
  state.ctDayHistory            = {};
  state.ctConsecutiveRestDays   = 0;
  state.ctLogUpdatedAt          = Date.now();
  state.ctTasksUpdatedAt        = Date.now();
  setCtDayCompletedThisSession(false);

  ctRenderAll();
  save();
  showToast('Career fully reset!', 'gt');
}

/* ─────────────────────────────────────────────────────────────
   LIVE COUNTDOWN ENGINE
───────────────────────────────────────────────────────────────*/
export function ctStartCountdown() {
  if (_ctCdInterval) { clearInterval(_ctCdInterval); setCtCdInterval(null); }

  const TARGET          = new Date('2026-08-30T00:00:00');
  const JOURNEY_START   = new Date('2026-01-01T00:00:00');
  const TOTAL_JOURNEY_MS= TARGET - JOURNEY_START;
  const CIRCUMFERENCE   = 2 * Math.PI * 60;

  function getStatus(daysLeft) {
    if (daysLeft > 150) return { text: '🚀 Launch Phase',      cls: 'safe',   badge: '🟢 Plenty of Time' };
    if (daysLeft > 90)  return { text: '🔥 Momentum Phase',    cls: 'safe',   badge: '🟢 On Track'       };
    if (daysLeft > 60)  return { text: '⚡ Acceleration Phase',cls: 'warn',   badge: '🟠 Stay Focused'   };
    if (daysLeft > 30)  return { text: '🎯 Final Push Phase',  cls: 'warn',   badge: '🟠 Pick Up Pace'  };
    if (daysLeft > 14)  return { text: '🏃 Sprint Phase',      cls: 'danger', badge: '🔴 Urgent'         };
    return               { text: '🏁 Final Countdown!',        cls: 'danger', badge: '🔴 Critical'       };
  }

  function pad(n) { return String(Math.max(0, n)).padStart(2, '0'); }

  function tick() {
    const now       = new Date();
    const diff      = TARGET - now;
    if (diff <= 0) {
      const dEl  = document.getElementById('ct-cd-days');
      const stEl = document.getElementById('ct-cd-status-text');
      if (dEl)  dEl.textContent = '0';
      if (stEl) stEl.innerHTML  = '🎉 Goal Date Reached!';
      if (_ctCdInterval) { clearInterval(_ctCdInterval); setCtCdInterval(null); }
      return;
    }

    const totalSecs = Math.floor(diff / 1000);
    const days  = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const mins  = Math.floor((totalSecs % 3600) / 60);
    const secs  = totalSecs % 60;

    const dEl = document.getElementById('ct-cd-days');
    const hEl = document.getElementById('ct-cd-hours');
    const mEl = document.getElementById('ct-cd-mins');
    const sEl = document.getElementById('ct-cd-secs');
    if (dEl) dEl.textContent = days;
    if (hEl) hEl.textContent = pad(hours);
    if (mEl) mEl.textContent = pad(mins);
    if (sEl) sEl.textContent = pad(secs);

    /* Progress ring */
    const totalJourneyDays = Math.ceil(TOTAL_JOURNEY_MS / 86400000);
    const daysElapsed      = totalJourneyDays - days;
    const ringPct          = Math.min(100, Math.max(0, (daysElapsed / totalJourneyDays) * 100));
    const ringOffset       = CIRCUMFERENCE - (ringPct / 100) * CIRCUMFERENCE;
    const ringEl           = document.getElementById('ct-cd-ring');
    if (ringEl) {
      ringEl.style.strokeDasharray  = CIRCUMFERENCE.toFixed(2);
      ringEl.style.strokeDashoffset = ringOffset.toFixed(2);
    }

    /* Timeline progress */
    const overallPct = ctOverallPct(state);
    const tlFill     = document.getElementById('ct-cd-tl-fill');
    const tlPctEl    = document.getElementById('ct-cd-tl-pct');
    if (tlFill)  tlFill.style.width  = overallPct + '%';
    if (tlPctEl) tlPctEl.textContent = overallPct + '% career readiness';

    /* Status */
    const status = getStatus(days);
    const stEl   = document.getElementById('ct-cd-status-text');
    const urgEl  = document.getElementById('ct-cd-urgency');
    if (stEl)  stEl.innerHTML  = status.text;
    if (urgEl) { urgEl.className = 'ct-cd-urgency ' + status.cls; urgEl.innerHTML = status.badge; }

    /* Pace */
    const studiedHrs = (state.ctTotalDays || 0) * CT_HOUR_GOAL;
    const remaining  = Math.max(0, 400 - studiedHrs);
    const hrsPerDay  = days > 0 ? (remaining / days).toFixed(1) : CT_HOUR_GOAL.toFixed(1);
    const paceEl     = document.getElementById('ct-cd-pace-text');
    if (paceEl) paceEl.textContent = hrsPerDay + ' hrs/day to achieve your goal';
  }

  tick();
  setCtCdInterval(setInterval(tick, 1000));
}

/* ─────────────────────────────────────────────────────────────
   PAGE BUILDER
───────────────────────────────────────────────────────────────*/
export function ctInit() {
  ctDailyReset();
  if (state.ctDayDone) setCtDayCompletedThisSession(true);
  else                 setCtDayCompletedThisSession(false);

  if (!ctPageBuilt) { ctBuildPage(); setCtPageBuilt(true); }

  if (_ctCdInterval) { clearInterval(_ctCdInterval); setCtCdInterval(null); }

  ctRenderAll();
  ctNewQuote();
  requestAnimationFrame(() => ctStartCountdown());
}

export function ctBuildPage() {
  const container = document.getElementById('page-study');
  if (!container) return;

  const existing = document.getElementById('ct-root');
  if (existing) existing.remove();
  container.innerHTML = '';

  const root    = document.createElement('div');
  root.className= 'ct-page';
  root.id       = 'ct-root';

  const skills = [
    { key: 'sql',   label: 'SQL Skills',              color: '#7c3aed' },
    { key: 'tools', label: 'Tools (Excel/PBI/Python)', color: '#2563eb' },
    { key: 'proj',  label: 'Projects',                 color: '#059669' },
    { key: 'intv',  label: 'Interview Skills',         color: '#d97706' }
  ];

  let skillHTML = '';
  skills.forEach(sk => {
    skillHTML +=
      '<div style="margin-bottom:14px;">' +
        '<div class="ct-meter-row">' +
          '<span class="ct-meter-label">' + sk.label + '</span>' +
          '<div class="ct-meter-ctrl">' +
            '<button class="ct-skill-btn minus" data-action="ct-skill-minus" ' +
              'data-skill="' + sk.key + '" data-label="' + sk.label + '" ' +
              'aria-label="Decrease ' + sk.label + '">-</button>' +
            '<span id="ct-pct-' + sk.key + '" class="ct-meter-pct" style="color:' + sk.color + '">0%</span>' +
            '<button class="ct-skill-btn plus" data-action="ct-skill-plus" ' +
              'data-skill="' + sk.key + '" data-label="' + sk.label + '" ' +
              'aria-label="Increase ' + sk.label + '">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="ct-bar-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
          '<div class="ct-bar-fill" id="ct-bar-' + sk.key + '" style="width:0%"></div>' +
        '</div>' +
        '<div class="ct-skill-100-warning" id="ct-warn-' + sk.key + '">Max reached!</div>' +
      '</div>';
  });

  root.innerHTML = [
    /* ── Hero ── */
    '<div class="ct-hero" role="banner">',
      '<div class="ct-hero-label">DATA ANALYST JOURNEY</div>',
      '<div class="ct-hero-title">Career Tracker</div>',
      '<div class="ct-hero-sub">Tracking your path to a Data Analyst role</div>',
      '<div class="ct-hero-chips">',
        '<span class="ct-hero-chip gold" id="ct-hero-xp">0 XP</span>',
        '<span class="ct-hero-chip" id="ct-hero-days">Day 0</span>',
        '<span class="ct-hero-chip" id="ct-hero-streak">0 streak</span>',
      '</div>',
      '<div id="ct-hero-countdown" class="ct-hero-countdown"></div>',
    '</div>',

    /* ── Countdown ── */
    '<div class="ct-countdown-wrap">',
      '<svg width="0" height="0" style="position:absolute;"><defs>',
        '<linearGradient id="cdGrad2" x1="0%" y1="0%" x2="100%" y2="100%">',
          '<stop offset="0%"   style="stop-color:#6366f1;stop-opacity:1"/>',
          '<stop offset="50%"  style="stop-color:#8b5cf6;stop-opacity:1"/>',
          '<stop offset="100%" style="stop-color:#a78bfa;stop-opacity:1"/>',
        '</linearGradient></defs></svg>',
      '<div class="ct-cd-top">',
        '<div><div class="ct-cd-label">Target — August 30, 2026</div></div>',
        '<div class="ct-cd-status-pill">',
          '<div class="ct-cd-status-dot"></div>',
          '<span id="ct-cd-status-text">Loading...</span>',
        '</div>',
      '</div>',
      '<div class="ct-cd-main">',
        '<div class="ct-cd-ring-wrap">',
          '<svg class="ct-cd-ring-svg" width="140" height="140" viewBox="0 0 140 140">',
            '<circle class="ct-cd-ring-bg" cx="70" cy="70" r="60"/>',
            '<circle class="ct-cd-ring-fill" id="ct-cd-ring" cx="70" cy="70" r="60" stroke-dasharray="377" stroke-dashoffset="377"/>',
          '</svg>',
          '<div class="ct-cd-ring-center">',
            '<div class="ct-cd-days-num" id="ct-cd-days">--</div>',
            '<div class="ct-cd-days-lbl">DAYS LEFT</div>',
          '</div>',
        '</div>',
        '<div class="ct-cd-units">',
          '<div class="ct-cd-unit-row">',
            '<div class="ct-cd-unit"><div class="ct-cd-unit-num" id="ct-cd-hours">--</div><div class="ct-cd-unit-lbl">Hours</div></div>',
            '<div class="ct-cd-unit"><div class="ct-cd-unit-num" id="ct-cd-mins">--</div><div class="ct-cd-unit-lbl">Mins</div></div>',
            '<div class="ct-cd-unit"><div class="ct-cd-unit-num" id="ct-cd-secs">--</div><div class="ct-cd-unit-lbl">Secs</div></div>',
          '</div>',
          '<div class="ct-cd-timeline">',
            '<div class="ct-cd-tl-header">',
              '<span class="ct-cd-tl-label">Journey Progress</span>',
              '<span class="ct-cd-tl-pct" id="ct-cd-tl-pct">0%</span>',
            '</div>',
            '<div class="ct-cd-tl-track"><div class="ct-cd-tl-fill" id="ct-cd-tl-fill" style="width:0%"></div></div>',
            '<div class="ct-cd-tl-markers">',
              '<span class="ct-cd-tl-marker">Start</span>',
              '<span class="ct-cd-tl-marker">25%</span>',
              '<span class="ct-cd-tl-marker">50%</span>',
              '<span class="ct-cd-tl-marker">75%</span>',
              '<span class="ct-cd-tl-marker">Target</span>',
            '</div>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="ct-cd-footer">',
        '<div class="ct-cd-pace">',
          '<div class="ct-cd-pace-icon">⚡</div>',
          '<div>',
            '<div class="ct-cd-pace-text" id="ct-cd-pace-text">Calculating...</div>',
            '<div class="ct-cd-pace-sub">Recommended daily study pace</div>',
          '</div>',
        '</div>',
        '<div class="ct-cd-urgency safe" id="ct-cd-urgency">🟢 On Track</div>',
      '</div>',
    '</div>',

    /* ── Top grid: streak + quote ── */
    '<div class="ct-top-grid">',
      '<div class="ct-card">',
        '<div class="ct-card-head">',
          '<span class="ct-card-head-icon">🔥</span>',
          '<span class="ct-card-head-title">Study Streak</span>',
          '<span class="ct-card-head-tag" id="ct-day-count">Day 0</span>',
        '</div>',
        '<div class="ct-card-body">',
          '<div class="ct-streak-inner">',
            '<div class="ct-streak-num" id="ct-streak-num-val">0</div>',
            '<div>',
              '<div class="ct-streak-msg"  id="ct-streak-msg-val">No streak yet</div>',
              '<div class="ct-streak-date" id="ct-streak-date-val">Log study time to begin</div>',
            '</div>',
          '</div>',
          '<div class="ct-streak-status" id="ct-streak-status" style="display:none;"></div>',
          '<div class="ct-history-row" id="ct-history-row" role="list"></div>',
          '<div class="ct-hint-box" style="margin-top:10px;">',
            '<strong>Streak rules:</strong> Complete 4h = streak +1 | 1 rest = pause | 2 rest = reset',
          '</div>',
        '</div>',
      '</div>',
      '<div class="ct-card">',
        '<div class="ct-card-head">',
          '<span class="ct-card-head-icon">💡</span>',
          '<span class="ct-card-head-title">Daily Motivation</span>',
        '</div>',
        '<div class="ct-card-body">',
          '<div class="ct-quote-box" id="ct-quote-text">Loading...</div>',
          '<button class="ct-new-quote-btn" onclick="ctNewQuote()">New Quote</button>',
        '</div>',
      '</div>',
    '</div>',

    /* ── Daily study goal ── */
    '<div class="ct-card">',
      '<div class="ct-card-head">',
        '<span class="ct-card-head-icon">📘</span>',
        '<span class="ct-card-head-title">Daily Study Goal</span>',
        '<span class="ct-card-head-tag" style="background:#fef2f2;color:#dc2626;">NON-NEGOTIABLE</span>',
      '</div>',
      '<div class="ct-card-body">',
        '<div class="ct-daily-wrap">',
          '<div class="ct-pie-wrap">',
            '<div class="ct-pie-ring" id="ct-pie-ring"></div>',
            '<div class="ct-pie-inner">',
              '<div class="ct-pie-text" id="ct-pie-text">0/4</div>',
              '<div class="ct-pie-unit">hours</div>',
            '</div>',
          '</div>',
          '<div class="ct-daily-right">',
            '<div class="ct-daily-title">4 Hours Study Daily</div>',
            '<div class="ct-daily-warning">Non-Negotiable</div>',
            '<div class="ct-daily-status red" id="ct-daily-status">Not started</div>',
            '<div class="ct-hour-btns">',
              '<button class="ct-hour-btn minus" id="ct-minus-btn" onclick="ctRemoveHour()">-1 Hour</button>',
              '<button class="ct-hour-btn plus"  id="ct-plus-btn"  onclick="ctAddHour()">+1 Hour Studied</button>',
              '<button class="ct-hour-btn complete locked" id="ct-complete-btn">Complete Day</button>',
            '</div>',
            '<div class="ct-today-banner"   id="ct-today-banner"   style="display:none;">Today counted!</div>',
            '<div class="ct-complete-banner" id="ct-complete-banner" style="display:none;">Day Complete!</div>',
            '<div class="ct-reset-info"     id="ct-daily-reset-info">Resets at midnight</div>',
          '</div>',
        '</div>',
      '</div>',
    '</div>',

    /* ── Career meter ── */
    '<div class="ct-card">',
      '<div class="ct-card-head">',
        '<span class="ct-card-head-icon">📈</span>',
        '<span class="ct-card-head-title">Career Meter</span>',
        '<span class="ct-card-head-tag" id="ct-day-count2">Day 0</span>',
      '</div>',
      '<div class="ct-card-body">',
        '<div class="ct-meter-wrap" id="ct-meter-wrap-inner" style="margin-top:14px;">',
          skillHTML,
          '<div class="ct-overall-section">',
            '<div class="ct-overall-label">',
              '<span>Overall Career Readiness</span>',
              '<span id="ct-pct-overall">0%</span>',
            '</div>',
            '<div class="ct-overall-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">',
              '<div class="ct-overall-fill" id="ct-bar-overall" style="width:0%"></div>',
            '</div>',
          '</div>',
          '<div class="ct-milestones">',
            '<div class="ct-ms-box" data-m="10">🌱<br>10%<br>Started</div>',
            '<div class="ct-ms-box" data-m="25">⚡<br>25%<br>Building</div>',
            '<div class="ct-ms-box" data-m="50">🔥<br>50%<br>Halfway</div>',
            '<div class="ct-ms-box" data-m="75">🚀<br>75%<br>Almost</div>',
            '<div class="ct-ms-box" data-m="100">🏆<br>100%<br>Job Ready!</div>',
          '</div>',
          '<div style="padding-top:6px;">',
            '<button class="ct-danger-btn" onclick="ctResetAll()">Reset All Progress</button>',
          '</div>',
        '</div>',
      '</div>',
    '</div>',

    /* ── Weekly chart ── */
    '<div class="ct-card">',
      '<div class="ct-card-head">',
        '<span class="ct-card-head-icon">📊</span>',
        '<span class="ct-card-head-title">Weekly Study Hours</span>',
        '<span class="ct-card-head-tag">This Week</span>',
      '</div>',
      '<div class="ct-card-body">',
        '<div class="ct-chart-wrap">',
          '<div class="ct-chart-bars"   id="ct-chart-bars"></div>',
          '<div class="ct-chart-labels" id="ct-chart-labels"></div>',
          '<div class="ct-chart-meta">',
            '<span id="ct-week-total">Weekly Total: <strong>0 hrs</strong></span>',
            '<span id="ct-week-avg">Daily Avg: <strong>0 hrs</strong></span>',
            '<span>Goal: <strong style="color:#0284c7;">' + CT_WEEK_GOAL + ' hrs/week</strong></span>',
          '</div>',
        '</div>',
      '</div>',
    '</div>',

    /* ── Career tasks ── */
    '<div class="ct-card">',
      '<div class="ct-card-head">',
        '<span class="ct-card-head-icon">🎯</span>',
        '<span class="ct-card-head-title">Career Tasks</span>',
      '</div>',
      '<div class="ct-tag-row" id="ct-tag-row">',
        '<span class="ct-tag active" data-action="ct-select-tag" data-tag="All" role="button" tabindex="0" aria-pressed="true">All</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Resume/CV"      role="button" tabindex="0" aria-pressed="false">Resume/CV</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Skills"         role="button" tabindex="0" aria-pressed="false">Skills</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Interview prep" role="button" tabindex="0" aria-pressed="false">Interview prep</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Networking"     role="button" tabindex="0" aria-pressed="false">Networking</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Job search"     role="button" tabindex="0" aria-pressed="false">Job search</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Online course"  role="button" tabindex="0" aria-pressed="false">Online course</span>',
        '<span class="ct-tag" data-action="ct-select-tag" data-tag="Portfolio"      role="button" tabindex="0" aria-pressed="false">Portfolio</span>',
      '</div>',
      '<div class="ct-task-add-row">',
        '<input class="ct-task-input" id="ct-task-input" ' +
          'placeholder="Add a career task..." maxlength="80" ' +
          'onkeydown="if(event.key===\'Enter\')ctAddTask()"/>',
        '<button class="ct-task-add-btn" onclick="ctAddTask()">Add</button>',
      '</div>',
      '<ul class="ct-task-list" id="ct-task-list"></ul>',
    '</div>',

    /* ── Activity log ── */
    '<div class="ct-card">',
      '<div class="ct-card-head">',
        '<span class="ct-card-head-icon">📝</span>',
        '<span class="ct-card-head-title">Activity Log</span>',
      '</div>',
      '<ul class="ct-log-list" id="ct-log-list"></ul>',
      '<button class="ct-log-clear-btn" onclick="ctClearLog()">Clear Log</button>',
    '</div>'
  ].join('');

  container.appendChild(root);
}
