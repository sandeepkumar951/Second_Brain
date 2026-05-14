/**
 * core/init.js
 * Boot sequence — runs on DOMContentLoaded.
 * Imports all other modules to ensure they're initialized.
 */

import { state, defaultState, ensureDefaults, DB_KEY_MIDNIGHT } from './state.js';
import { todayKey, safeLocalStorageSave, showToast } from './utils.js';
import { load, save, debouncedSave, startRealtimeSync, _detachAllListeners, loadFiredToday, saveFiredToday, firedToday } from './firebase.js';
import { applyTheme } from '../shared/theme.js';

'use strict';

// ─── Module-level flags (shared across the app via window) ───────────────────

export let _lastThemeKey          = '';
export let _reminderFirstCheck    = true;
export let _settingsNeedRebuild   = true;
export let _lastStreakMilestone    = 0;
export let _lastEveningWasWeekend = null;
export let _ctDayCompletedThisSession = false;
export let _wtAppOpenTime         = Date.now();

// Master timer handle
let masterTimerId   = null;
let masterTickCount = 0;

// ─── Daily reset ──────────────────────────────────────────────────────────────

export function handleDailyReset() {
  const today = todayKey();
  if (state.lastDate===today) return;

  // Archive study hours
  if ((state.ctStudyHrs||0)>0 && state.ctLastStudyDate) {
    if (!state.ctWeeklyHours) state.ctWeeklyHours={};
    state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
      state.ctWeeklyHours[state.ctLastStudyDate]||0, state.ctStudyHrs);
  }

  // Record yesterday's outcome
  if (state.lastDate) {
    if (!state.ctDayHistory) state.ctDayHistory={};
    if (!state.ctDayHistory[state.lastDate]) {
      state.ctDayHistory[state.lastDate] = state.ctDayDone
        ? 'complete' : (state.ctStudyHrs||0)>0 ? 'partial' : 'rest';
    }
  }

  if (typeof window.ctEvaluateStreak==='function') window.ctEvaluateStreak();

  state.checks={};
  state.water=0;
  state.pts=0;
  state.ctDayDone=false;
  state.ctStudyHrs=0;
  state.ctTodayLogged=false;
  state.ctLastStudyDate=null;
  state.missedBannerDismissedDate='';
  state.lastResetTimestamp=Date.now();

  window.firedToday={};
  _convertDayTasks();

  if (typeof window.resetDailyLangFlags==='function') window.resetDailyLangFlags();
  try { if (typeof window.jCheckWeekReset==='function') window.jCheckWeekReset(); } catch(e){}
  try { if (typeof window.wtCheckWeekReset==='function') window.wtCheckWeekReset(); } catch(e){}

  state.lastDate = today;
}

// ─── Convert day tasks ────────────────────────────────────────────────────────

export function _convertDayTasks() {
  if (!Array.isArray(state.weeklyTasks)) return;
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayName = dayNames[new Date().getDay()];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowName = dayNames[tomorrow.getDay()];
  state.weeklyTasks = state.weeklyTasks.map(t=>{
    if (t.day==='Today')    return Object.assign({},t,{day:todayName});
    if (t.day==='Tomorrow') return Object.assign({},t,{day:tomorrowName});
    return t;
  });
}

// ─── Midnight reset scheduler ─────────────────────────────────────────────────

export function scheduleMidnightReset() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 2, 0);
  const msUntil = Math.max(0, nextMidnight-now);

  clearTimeout(scheduleMidnightReset._timer);
  scheduleMidnightReset._timer = setTimeout(async()=>{
    const resetKey = todayKey();
    const storedKey = localStorage.getItem(DB_KEY_MIDNIGHT+'lastFired')||'';
    if (storedKey===resetKey) { scheduleMidnightReset(); return; }

    safeLocalStorageSave(DB_KEY_MIDNIGHT+'lastFired', resetKey);

    // Archive before reset
    if ((state.ctStudyHrs||0)>0 && state.ctLastStudyDate) {
      if (!state.ctWeeklyHours) state.ctWeeklyHours={};
      state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
        state.ctWeeklyHours[state.ctLastStudyDate]||0, state.ctStudyHrs);
    }
    if (state.lastDate) {
      if (!state.ctDayHistory) state.ctDayHistory={};
      if (!state.ctDayHistory[state.lastDate]) {
        state.ctDayHistory[state.lastDate] = state.ctDayDone
          ? 'complete' : (state.ctStudyHrs||0)>0 ? 'partial' : 'rest';
      }
    }
    if (typeof window.ctEvaluateStreak==='function') window.ctEvaluateStreak();

    state.checks={};  state.water=0;  state.pts=0;
    state.ctDayDone=false;  state.ctStudyHrs=0;
    state.ctTodayLogged=false;  state.ctLastStudyDate=null;
    state.missedBannerDismissedDate='';
    state.lastResetTimestamp=Date.now();

    window.firedToday={};
    window._wtFilter='all';
    window.wtSceneInitialized=false;
    window.jnkSelected={};
    window.jnkGridBuilt=false;
    window.ctPageBuilt=false;
    _lastThemeKey='';
    _reminderFirstCheck=true;
    _ctDayCompletedThisSession=false;
    _convertDayTasks();

    if (typeof window.resetDailyLangFlags==='function') window.resetDailyLangFlags();
    try { if (typeof window.jCheckWeekReset==='function') window.jCheckWeekReset(); } catch(e){}
    try { if (typeof window.wtCheckWeekReset==='function') window.wtCheckWeekReset(); } catch(e){}

    state.lastDate = resetKey;
    saveFiredToday();
    await save();

    if (typeof window.refreshUI==='function') window.refreshUI();
    const b = document.getElementById('banner');
    if(b){ b.classList.add('show'); setTimeout(()=>b.classList.remove('show'),4000); }
    showToast('New day started! Checklist reset.','gt');

    // Reattach listeners for new day's Firebase path
    _detachAllListeners();
    startRealtimeSync();
    scheduleMidnightReset();

  }, msUntil);
}

// ─── Master timer ─────────────────────────────────────────────────────────────

/**
 * Single 30-second interval that drives all periodic background work.
 * Called ONCE from init(), again only after factory reset.
 */
export function startMasterTimer() {
  if (masterTimerId) { clearInterval(masterTimerId); masterTimerId=null; }
  masterTickCount = 0;

  masterTimerId = setInterval(()=>{
    if (document.hidden) return;
    masterTickCount++;

    // Every tick (30s): check reminders
    if (typeof window.checkReminders==='function') window.checkReminders();

    // Every 2 ticks (60s): update theme + reminders panel + career hero
    if (masterTickCount%2===0) {
      if (typeof applyTheme==='function') applyTheme();
      if (typeof window.renderHomeReminders==='function') window.renderHomeReminders();
      if (typeof window.ctRenderHero==='function') window.ctRenderHero();
    }

    // Every 10 ticks (5min): stats + streak + cleanup
    if (masterTickCount%10===0) {
      if (typeof window.updateStatsBanner==='function') window.updateStatsBanner();
      if (typeof window.checkStreakMilestone==='function') window.checkStreakMilestone();
      if (typeof window.ctCleanWeeklyHours==='function') window.ctCleanWeeklyHours();
      try { if (typeof window.jCheckWeekReset==='function') window.jCheckWeekReset(); } catch(e){}

      // Rebuild settings only when needed AND settings page is active
      if (_settingsNeedRebuild) {
        const sp = document.getElementById('page-settings');
        if (sp&&sp.classList.contains('active')&&typeof window.buildSettingsPage==='function')
          window.buildSettingsPage();
      }
    }

    if (masterTickCount>100000) masterTickCount=0;
  }, 30000);
}

// ─── Visibility change handler ────────────────────────────────────────────────

document.addEventListener('visibilitychange', async()=>{
  if (document.hidden) {
    // Flush any pending saves on hide
    try { safeLocalStorageSave(DB_KEY, JSON.stringify(state)); } catch(e){}
    if (window.saveDebounceTimer) {
      clearTimeout(window.saveDebounceTimer);
      window.saveDebounceTimer=null;
      save();
    }
    // Archive in-progress study hours
    if ((state.ctStudyHrs||0)>0 && state.ctLastStudyDate && state.ctLastStudyDate===todayKey()) {
      if (!state.ctWeeklyHours) state.ctWeeklyHours={};
      const key = state.ctLastStudyDate;
      if (state.ctStudyHrs>(state.ctWeeklyHours[key]||0)) {
        state.ctWeeklyHours[key] = state.ctStudyHrs;
        debouncedSave(200);
      }
    }
    return;
  }

  // App became visible
  _wtAppOpenTime = Date.now();
  if (typeof applyTheme==='function') applyTheme();

  // Re-establish realtime sync if it gave up
  if (window.realtimeRetryCount>=10) {
    window.realtimeRetryCount = 0;
    _detachAllListeners();
    startRealtimeSync();
  }

  const today = todayKey();
  if (state.lastDate!==today) {
    const storedKey = localStorage.getItem(DB_KEY_MIDNIGHT+'lastFired')||'';
    if (storedKey===today) {
      if(typeof window.refreshUI==='function') window.refreshUI();
      return;
    }

    // New day detected — perform reset
    if ((state.ctStudyHrs||0)>0 && state.ctLastStudyDate) {
      if (!state.ctWeeklyHours) state.ctWeeklyHours={};
      state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
        state.ctWeeklyHours[state.ctLastStudyDate]||0, state.ctStudyHrs);
    }
    if (state.lastDate && state.ctDayHistory && !state.ctDayHistory[state.lastDate]) {
      state.ctDayHistory[state.lastDate] = state.ctDayDone
        ? 'complete' : (state.ctStudyHrs||0)>0 ? 'partial' : 'rest';
    }
    if (typeof window.ctEvaluateStreak==='function') window.ctEvaluateStreak();

    state.checks={};  state.water=0;  state.pts=0;
    state.ctDayDone=false;  state.ctStudyHrs=0;
    state.ctTodayLogged=false;  state.ctLastStudyDate=null;
    state.missedBannerDismissedDate='';
    state.lastResetTimestamp=Date.now();

    window.firedToday={};
    window.wtSceneInitialized=false;
    window.jnkSelected={};
    window.jnkGridBuilt=false;
    window.ctPageBuilt=false;
    _reminderFirstCheck=true;
    _convertDayTasks();

    if (typeof window.resetDailyLangFlags==='function') window.resetDailyLangFlags();
    try { if (typeof window.jCheckWeekReset==='function') window.jCheckWeekReset(); } catch(e){}
    try { if (typeof window.wtCheckWeekReset==='function') window.wtCheckWeekReset(); } catch(e){}

    safeLocalStorageSave(DB_KEY_MIDNIGHT+'lastFired', today);
    state.lastDate = today;
    await save();
    if(typeof window.refreshUI==='function') window.refreshUI();
    _detachAllListeners();
    startRealtimeSync();
    const b = document.getElementById('banner');
    if(b){ b.classList.add('show'); setTimeout(()=>b.classList.remove('show'),4000); }
    showToast('New day! Checklist reset.','gt');
    return;
  }

  // Same day — just refresh reminders and UI
  if (state.wtReminderEnabled && typeof window.wtRemScheduleNext==='function')
    window.wtRemScheduleNext();
  if (typeof window.renderHomeReminders==='function') window.renderHomeReminders();
  if (typeof window.checkReminders==='function') window.checkReminders();
  if (typeof window.updateStatsBanner==='function') window.updateStatsBanner();
});

// ─── Network status ────────────────────────────────────────────────────────────

window.addEventListener('online', ()=>{
  updateFbStatus('syncing');
  showToast('Back online — syncing...','gt');
  window.saveFailCount=0;
  window.realtimeRetryCount=0;
  setTimeout(()=>{ debouncedSave(500); _detachAllListeners(); startRealtimeSync(); }, 1000);
});

window.addEventListener('offline', ()=>{
  updateFbStatus('offline');
  showToast('Offline — changes saved locally','yt');
});

// Import updateFbStatus for network handlers
import { updateFbStatus } from './firebase.js';

// ─── Main init function ───────────────────────────────────────────────────────

async function init() {
  loadFiredToday();
  Object.assign(state, defaultState());
  window.currentUID = 'sandy_shared';

  await load();
  ensureDefaults();
  handleDailyReset();

  // Run career daily reset early so streak displays correctly
  if (typeof window.ctDailyReset==='function') window.ctDailyReset();

  // Session flags
  _ctDayCompletedThisSession = !!state.ctDayDone;
  window._ctDayCompletedThisSession = _ctDayCompletedThisSession;

  // Deferred cleanup
  if (typeof window.cleanOrphanEntries==='function') window.cleanOrphanEntries();
  if (typeof window.ctCleanWeeklyHours==='function') window.ctCleanWeeklyHours();

  // Theme (force full rewrite on first load)
  _lastThemeKey = '';
  window._lastThemeKey = _lastThemeKey;
  applyTheme();

  _settingsNeedRebuild = true;
  window._settingsNeedRebuild = _settingsNeedRebuild;

  // Build Today page
  if (typeof window.rebuildTodaySections==='function') window.rebuildTodaySections();
  if (typeof window.applyChecks==='function') window.applyChecks();
  if (typeof window.renderHomeReminders==='function') window.renderHomeReminders();
  if (typeof window.updateSummaryCards==='function') window.updateSummaryCards();
  if (typeof window.updateStatsBanner==='function') window.updateStatsBanner();
  if (typeof window.renderLangUI==='function') window.renderLangUI();
  if (typeof window.updateProg==='function') window.updateProg();
  if (typeof window.updateReward==='function') window.updateReward();
  if (typeof window._updateFooterChips==='function') window._updateFooterChips();
  if (typeof window.renderTodayWeeklyPanel==='function') window.renderTodayWeeklyPanel();

  // Junk page init
  if (typeof window.jnkBuildCatGrid==='function') window.jnkBuildCatGrid();
  if (typeof window.jnkRenderChips==='function') window.jnkRenderChips();
  if (typeof window.jnkRenderAll==='function') window.jnkRenderAll();
  if (typeof window.jRenderSugar==='function') window.jRenderSugar();
  if (typeof window.jRenderBiryani==='function') window.jRenderBiryani();
  if (typeof window.jRenderLogs==='function') window.jRenderLogs();

  // Week resets (after load so toasts are accurate)
  try { if (typeof window.jCheckWeekReset==='function') window.jCheckWeekReset(); } catch(e){}
  try { if (typeof window.wtCheckWeekReset==='function') window.wtCheckWeekReset(); } catch(e){}

  // Reminders
  if (typeof window.buildDaysPicker==='function') window.buildDaysPicker();
  if (typeof window.buildPresetChips==='function') window.buildPresetChips();
  if (typeof window.updateNotifStatusUI==='function') window.updateNotifStatusUI();
  if (typeof window.renderReminderList==='function') window.renderReminderList();

  // Career
  if (typeof window.ctInit==='function') window.ctInit();

  // Weekly
  if (typeof window.wtRenderTasks==='function') window.wtRenderTasks();
  if (typeof window.renderTodayWeeklyPanel==='function') window.renderTodayWeeklyPanel();

  // Settings
  if (typeof window.updateMissedAlertDisplay==='function') window.updateMissedAlertDisplay();

  // Start background systems
  startMasterTimer();
  _wtAppOpenTime = Date.now();
  window._wtAppOpenTime = _wtAppOpenTime;

  startRealtimeSync();
  scheduleMidnightReset();

  _reminderFirstCheck = true;
  window._reminderFirstCheck = _reminderFirstCheck;
  if (typeof window.checkReminders==='function') window.checkReminders();

  // Service worker & PWA
  if (typeof window.registerInlineServiceWorker==='function')
    window.registerInlineServiceWorker();

  // Deep link navigation
  const hash = window.location.hash.replace('#','').trim();
  if (hash) {
    const pageMap = {today:0,study:1,english:2,junk:3,weekly:4,reminders:5,settings:6};
    if (pageMap[hash]!==undefined) {
      setTimeout(()=>{
        const navBtns = document.querySelectorAll('.nb');
        const btn = navBtns[pageMap[hash]];
        if (btn) window.showPage(hash, btn);
      }, 300);
    }
  }

  // Delayed streak milestone check
  setTimeout(()=>{
    if (typeof window.checkStreakMilestone==='function') window.checkStreakMilestone();
  }, 2000);

  console.log('%cSandy Brain initialized','color:#7C3AED;font-weight:900;font-family:system-ui;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', ()=>{
  requestAnimationFrame(()=>{
    init().catch(err=>{
      console.error('Sandy Brain: init failed:', err);
      try {
        ensureDefaults();
        if (typeof window.rebuildTodaySections==='function') window.rebuildTodaySections();
        if (typeof window.applyChecks==='function') window.applyChecks();
        applyTheme();
      } catch(e) {}
    });
  });
});

// ─── Loading screen ────────────────────────────────────────────────────────────

(function runLoadingScreen() {
  const bar    = document.getElementById('loading-bar');
  const screen = document.getElementById('app-loading-screen');
  if (!bar||!screen) return;

  let dismissed = false, progress = 0;

  function dismiss() {
    if (dismissed) return; dismissed = true;
    clearInterval(progressTimer);
    bar.style.width = '100%';
    setTimeout(()=>{
      screen.style.opacity = '0';
      setTimeout(()=>{ if(screen.parentNode) screen.parentNode.removeChild(screen); }, 400);
    }, 200);
  }

  const checkTimer = setInterval(()=>{
    if (dismissed) { clearInterval(checkTimer); return; }
    const sections = document.getElementById('today-sections');
    const hasContent = sections && sections.children.length>0;
    const stateReady = typeof state!=='undefined' && state!==null && state.lastDate!==undefined;
    if (hasContent && stateReady) { clearInterval(checkTimer); dismiss(); }
  }, 100);

  setTimeout(()=>{ clearInterval(checkTimer); if(!dismissed) dismiss(); }, 3000);

  const progressTimer = setInterval(()=>{
    if (dismissed) return;
    progress = Math.min(95, progress+(95-progress)*0.08);
    bar.style.width = progress+'%';
  }, 100);
})();

// ─── Window exports ────────────────────────────────────────────────────────────

Object.assign(window, {
  handleDailyReset, _convertDayTasks, scheduleMidnightReset,
  startMasterTimer,
  get _lastThemeKey(){ return _lastThemeKey; },
  set _lastThemeKey(v){ _lastThemeKey=v; },
  get _reminderFirstCheck(){ return _reminderFirstCheck; },
  set _reminderFirstCheck(v){ _reminderFirstCheck=v; },
  get _settingsNeedRebuild(){ return _settingsNeedRebuild; },
  set _settingsNeedRebuild(v){ _settingsNeedRebuild=v; },
  get _lastStreakMilestone(){ return _lastStreakMilestone; },
  set _lastStreakMilestone(v){ _lastStreakMilestone=v; },
  get _lastEveningWasWeekend(){ return _lastEveningWasWeekend; },
  set _lastEveningWasWeekend(v){ _lastEveningWasWeekend=v; },
  get _ctDayCompletedThisSession(){ return _ctDayCompletedThisSession; },
  set _ctDayCompletedThisSession(v){ _ctDayCompletedThisSession=v; },
  get _wtAppOpenTime(){ return _wtAppOpenTime; },
  set _wtAppOpenTime(v){ _wtAppOpenTime=v; }
});
