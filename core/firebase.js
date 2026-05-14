/* ═══════════════════════════════════════════════════════════════
   core/firebase.js
   Firebase initialization, save/load engine, realtime sync,
   payload builders, remote document merging, and daily reset.
   Depends on: core/state.js, core/utils.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  DB_KEY,
  DB_KEY_MIDNIGHT,
  CT_SKILL_KEYS,
  MAX_JUNK_LOG,
  MAX_SUGAR_LOG,
  CT_LOG_LIMIT,
  REALTIME_MAX_RETRIES,
  REALTIME_BASE_DELAY,
  SAVE_MAX_FAILS,
  SAVE_RETRY_BASE,
  /* flags */
  isSaving,           setIsSaving,
  saveVersion,        setSaveVersion,
  lastSavedVersion,   setLastSavedVersion,
  saveFailCount,      setSaveFailCount,
  saveDebounceTimer,  setSaveDebounceTimer,
  realtimeRetryCount, setRealtimeRetryCount,
  _dailyListenerRef,  setDailyListenerRef,
  _dailyListenerCb,   setDailyListenerCb,
  _configListenerRef, setConfigListenerRef,
  _configListenerCb,  setConfigListenerCb,
  _connectedListenerCb, setConnectedListenerCb,
  _syncMergeInProgress, setSyncMergeInProgress,
  _lastSaveTimestamp,   setLastSaveTimestamp,
  _lastRemoteSavedAt,   setLastRemoteSavedAt,
  _settingsNeedRebuild, setSettingsNeedRebuild,
  _configSyncTimer,     setConfigSyncTimer,
  _reminderFirstCheck,  setReminderFirstCheck,
  firedToday,           setFiredToday,
  wtFilter,             setWtFilter,
  wtSceneInitialized,   setWtSceneInitialized,
  jnkSelected,          setJnkSelected,
  jnkGridBuilt,         setJnkGridBuilt,
  ctPageBuilt,          setCtPageBuilt,
  cachedSceneHeight,    setCachedSceneHeight,
  _lastThemeKey,        setLastThemeKey,
  _lastStreakMilestone, setLastStreakMilestone,
  _ctDayCompletedThisSession, setCtDayCompletedThisSession,
  ensureDefaults,
  defaultState,
  resetAllFlags
} from './state.js';

import {
  todayKey,
  yesterdayKey,
  currentMonthKey,
  sugarWeekStartOf,
  sanitizeRemoteString,
  sanitizeRemoteNumber,
  sanitizeRemoteBool,
  validateTimeString,
  safeLocalStorageSave,
  saveFiredToday,
  showToast,
  showSync,
  updateFbStatus,
  getDeviceId
} from './utils.js';

/* ─────────────────────────────────────────────────────────────
   FIREBASE INITIALISATION
───────────────────────────────────────────────────────────────*/

const firebaseConfig = {
  apiKey:            'AIzaSyDf6c55kjHOhJcRN3GbRB6wQTM_OcZgzxE',
  authDomain:        'sandyhealthtracker.firebaseapp.com',
  databaseURL:       'https://sandyhealthtracker-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'sandyhealthtracker',
  storageBucket:     'sandyhealthtracker.firebasestorage.app',
  messagingSenderId: '742150727652',
  appId:             '1:742150727652:web:8c55ee8fb1327e02df09f1'
};

firebase.initializeApp(firebaseConfig);
export const rtdb = firebase.database();

/* ─────────────────────────────────────────────────────────────
   USER REF HELPER
───────────────────────────────────────────────────────────────*/

/**
 * Returns a Firebase DatabaseReference under the shared user path.
 */
export function userRef(path) {
  return rtdb.ref('sandy_shared/' + path);
}

/* ─────────────────────────────────────────────────────────────
   DEBOUNCED SAVE
───────────────────────────────────────────────────────────────*/

/**
 * Schedules a save() call after a short delay.
 * Cancels any pending save before scheduling a new one.
 * delay defaults to 500 ms.
 */
export function debouncedSave(delay) {
  setSaveVersion(saveVersion + 1);
  clearTimeout(saveDebounceTimer);
  setSaveDebounceTimer(
    setTimeout(() => save(), delay !== undefined ? delay : 500)
  );
}

/* ─────────────────────────────────────────────────────────────
   PAYLOAD BUILDERS
───────────────────────────────────────────────────────────────*/

/**
 * Builds the daily payload object that is written to Firebase.
 * Trims oversized arrays if the serialised size is > 900 KB.
 */
function buildDailyPayload() {

  /* Explicit boolean map — false must be stored so unchecks sync */
  const checksPayload = {};
  if (state.checks && typeof state.checks === 'object') {
    Object.keys(state.checks).forEach(k => {
      checksPayload[k] = state.checks[k] === true;
    });
  }

  const payload = {
    date:                       todayKey(),
    savedAt:                    new Date().toISOString(),
    savedBy:                    getDeviceId(),
    lastResetTimestamp:         state.lastResetTimestamp  || 0,
    checks:                     checksPayload,
    water:                      state.water               || 0,
    pts:                        state.pts                 || 0,
    totalPts:                   state.totalPts            || 0,
    earnedBadges:               state.earnedBadges        || [],
    lastDate:                   state.lastDate            || '',
    missedBannerDismissedDate:  state.missedBannerDismissedDate || '',
    missedTasksAlertTime:       state.missedTasksAlertTime || '21:00',

    /* Language: English */
    engStreak:        state.engStreak        || 0,
    lastEngDate:      state.lastEngDate      || '',
    engReadDone:      !!state.engReadDone,
    engSpeakDone:     !!state.engSpeakDone,
    engSpeakStreak:   state.engSpeakStreak   || 0,
    engSpeakLastDate: state.engSpeakLastDate || '',
    engLearnDone:     !!state.engLearnDone,
    engLearnStreak:   state.engLearnStreak   || 0,
    engLearnLastDate: state.engLearnLastDate || '',

    /* Language: Hindi */
    hiReadDone:      !!state.hiReadDone,
    hiReadStreak:    state.hiReadStreak    || 0,
    hiReadLastDate:  state.hiReadLastDate  || '',
    hiSpeakDone:     !!state.hiSpeakDone,
    hiSpeakStreak:   state.hiSpeakStreak   || 0,
    hiSpeakLastDate: state.hiSpeakLastDate || '',
    hiLearnDone:     !!state.hiLearnDone,
    hiLearnStreak:   state.hiLearnStreak   || 0,
    hiLearnLastDate: state.hiLearnLastDate || '',

    /* Career */
    ctSkills:              state.ctSkills              || { sql: 0, tools: 0, proj: 0, intv: 0 },
    ctStudyHrs:            state.ctStudyHrs            || 0,
    ctDayDone:             !!state.ctDayDone,
    ctStreakDays:          state.ctStreakDays           || 0,
    ctLastDate:            state.ctLastDate            || null,
    ctStreakLastDate:       state.ctStreakLastDate      || null,
    ctTodayLogged:         !!state.ctTodayLogged,
    ctTotalDays:           state.ctTotalDays           || 0,
    ctTasks:               state.ctTasks               || [],
    ctTasksUpdatedAt:      state.ctTasksUpdatedAt      || 0,
    ctLog:                 state.ctLog                 || [],
    ctLogUpdatedAt:        state.ctLogUpdatedAt        || 0,
    ctWeeklyHours:         state.ctWeeklyHours         || {},
    ctLastStudyDate:       state.ctLastStudyDate       || null,
    ctDayHistory:          state.ctDayHistory          || {},
    ctConsecutiveRestDays: state.ctConsecutiveRestDays || 0,

    /* Junk / Sugar / Biryani */
    junkLog:       state.junkLog       || [],
    sugarLog:      state.sugarLog      || [],
    biryLog:       state.biryLog       || [],
    weeklyGrams:   state.weeklyGrams   || 0,
    sugarWeekStart:state.sugarWeekStart|| '',

    /* Weekly tasks */
    weeklyTasks:          state.weeklyTasks          || [],
    weeklyTasksResetDate: state.weeklyTasksResetDate || '',

    /* Water */
    waterLog:            state.waterLog            || {},
    wtReminderInterval:  state.wtReminderInterval  || 60,
    wtReminderTime:      state.wtReminderTime      || null,
    wtReminderEnabled:   !!state.wtReminderEnabled,
    wtLastReminderFired: state.wtLastReminderFired || null
  };

  /* Trim if payload is too large for Firebase (1 MB limit) */
  const serialized = JSON.stringify(payload);
  if (serialized.length > 900000) {
    console.warn('Sandy Brain: payload too large — trimming arrays');
    if (payload.junkLog.length  > 200) payload.junkLog  = payload.junkLog.slice(-200);
    if (payload.sugarLog.length > 200) payload.sugarLog = payload.sugarLog.slice(-200);
    if (payload.ctLog.length    > 30)  payload.ctLog    = payload.ctLog.slice(0, 30);
  }

  return payload;
}

/**
 * Builds the config payload (habits / sections / reminders).
 * Base64 images are stripped to a placeholder before sending
 * because they exceed Firebase value-size limits.
 */
function buildConfigPayload() {
  const safeHabits = (state.habits || []).map(h => {
    if (
      h.customIconType === 'image' &&
      h.customIcon &&
      h.customIcon.startsWith('data:image/')
    ) {
      return Object.assign({}, h, {
        customIcon:     '__needs_upload__',
        customIconType: 'image_local'
      });
    }
    return h;
  });

  return {
    habits:             safeHabits,
    sections:           state.sections            || [],
    reminders:          state.reminders           || [],
    updatedAt:          new Date().toISOString(),
    habitsUpdatedAt:    state.habitsUpdatedAt     || 0,
    sectionsUpdatedAt:  state.sectionsUpdatedAt   || 0,
    remindersUpdatedAt: state.remindersUpdatedAt  || 0,
    deletedReminderIds: (state.deletedReminderIds || []).slice(-100)
  };
}

/* ─────────────────────────────────────────────────────────────
   APPLY REMOTE DAILY DOCUMENT
   Merges an incoming Firebase daily snapshot into local state.
───────────────────────────────────────────────────────────────*/

export function applyDailyDoc(d) {
  if (!d || typeof d !== 'object') return;

  const remoteSavedAt  = d.savedAt ? new Date(d.savedAt).getTime() : 0;
  const remoteResetAt  = sanitizeRemoteNumber(d.lastResetTimestamp, 0, Infinity, 0);
  const localResetAt   = state.lastResetTimestamp || 0;

  /* Skip entirely if the remote document is from a different day */
  if (d.date && d.date !== todayKey()) return;

  /* If remote carries a newer reset signal, apply it first */
  if (remoteResetAt > localResetAt) {
    state.lastResetTimestamp = remoteResetAt;
    state.checks = {};
    state.water  = 0;
    state.pts    = 0;
    /* do NOT reset totalPts — it is cumulative */
  }

  /* Only merge check / water / pts if the remote save is not stale */
  const mergeChecks = !(
    remoteSavedAt > 0 &&
    remoteSavedAt < state.lastResetTimestamp
  );

  /* totalPts: always take max (cumulative across all time) */
  state.totalPts = Math.max(state.totalPts || 0, d.totalPts || 0);

  if (mergeChecks) {
    /* pts: only take remote if its reset is same or newer */
    if (remoteResetAt >= localResetAt)
      state.pts = Math.max(state.pts || 0, d.pts || 0);

    /* Water: always take the higher value */
    state.water = Math.max(state.water || 0, d.water || 0);
    if (!state.waterLog) state.waterLog = {};
    state.waterLog[todayKey()] = Math.max(
      state.waterLog[todayKey()] || 0,
      state.water
    );

    /* Checks: explicit boolean merge */
    if (d.checks && typeof d.checks === 'object') {
      state.checks = state.checks || {};
      Object.keys(d.checks).forEach(k => {
        const remoteVal = d.checks[k] === true;
        const localVal  = state.checks[k] === true;

        if (remoteVal) {
          /* true always wins */
          state.checks[k] = true;
        } else if (!remoteVal && remoteSavedAt > _lastSaveTimestamp) {
          /* explicit uncheck from a newer remote save wins */
          state.checks[k] = false;
        }
        /* otherwise keep local value */
      });
    }
  }

  /* Earned badges: union merge */
  if (Array.isArray(d.earnedBadges)) {
    state.earnedBadges = state.earnedBadges || [];
    d.earnedBadges.forEach(b => {
      if (!state.earnedBadges.includes(b)) state.earnedBadges.push(b);
    });
  }

  /* String fields: take the newer / later value */
  const stringFieldsLatest = [
    'lastDate', 'missedTasksAlertTime', 'missedBannerDismissedDate',
    'lastEngDate', 'engSpeakLastDate', 'engLearnLastDate',
    'hiReadLastDate', 'hiSpeakLastDate', 'hiLearnLastDate',
    'ctLastDate', 'ctStreakLastDate', 'sugarWeekStart',
    'weeklyTasksResetDate', 'wtReminderTime'
  ];
  stringFieldsLatest.forEach(f => {
    if (d[f] !== undefined) {
      const sanitized = sanitizeRemoteString(d[f], 40);
      if (!state[f])                                         state[f] = sanitized;
      else if (typeof d[f] === 'string' &&
               typeof state[f] === 'string' &&
               sanitized > state[f])                         state[f] = sanitized;
    }
  });

  /* Water reminder interval: take max */
  if (d.wtReminderInterval !== undefined)
    state.wtReminderInterval = Math.max(
      state.wtReminderInterval || 0,
      sanitizeRemoteNumber(d.wtReminderInterval, 15, 240, 60)
    );

  /* Boolean OR merge */
  [
    'ctTodayLogged', 'ctDayDone', 'wtReminderEnabled',
    'engReadDone', 'engSpeakDone', 'engLearnDone',
    'hiReadDone',  'hiSpeakDone', 'hiLearnDone'
  ].forEach(f => { if (d[f]) state[f] = true; });

  /* Streaks / counts: take max */
  [
    'engStreak', 'engSpeakStreak', 'engLearnStreak',
    'hiReadStreak', 'hiSpeakStreak', 'hiLearnStreak',
    'ctStreakDays', 'ctConsecutiveRestDays'
  ].forEach(f => {
    state[f] = Math.max(
      state[f] || 0,
      sanitizeRemoteNumber(d[f], 0, Infinity, 0)
    );
  });

  /* ctTotalDays: only accept remote value >= local */
  state.ctTotalDays = Math.max(
    state.ctTotalDays || 0,
    sanitizeRemoteNumber(d.ctTotalDays, 0, Infinity, 0)
  );

  /* Career skills: take max per skill */
  if (d.ctSkills && typeof d.ctSkills === 'object') {
    state.ctSkills = state.ctSkills || { sql: 0, tools: 0, proj: 0, intv: 0 };
    CT_SKILL_KEYS.forEach(k => {
      state.ctSkills[k] = Math.max(
        state.ctSkills[k] || 0,
        sanitizeRemoteNumber(d.ctSkills[k], 0, 100, 0)
      );
    });
  }

  /* Study hours today: take max */
  if (mergeChecks)
    state.ctStudyHrs = Math.max(
      state.ctStudyHrs || 0,
      sanitizeRemoteNumber(d.ctStudyHrs, 0, 24, 0)
    );

  if (
    d.ctLastStudyDate &&
    (!state.ctLastStudyDate || d.ctLastStudyDate > state.ctLastStudyDate)
  ) state.ctLastStudyDate = sanitizeRemoteString(d.ctLastStudyDate, 10);

  /* Tasks & log: timestamp-based winner */
  if (
    Array.isArray(d.ctTasks) &&
    (d.ctTasksUpdatedAt || 0) > (state.ctTasksUpdatedAt || 0)
  ) {
    state.ctTasks          = d.ctTasks;
    state.ctTasksUpdatedAt = d.ctTasksUpdatedAt;
  }
  if (
    Array.isArray(d.ctLog) &&
    (d.ctLogUpdatedAt || 0) > (state.ctLogUpdatedAt || 0)
  ) {
    state.ctLog          = d.ctLog;
    state.ctLogUpdatedAt = d.ctLogUpdatedAt;
  }

  /* Weekly hours: max per day */
  if (d.ctWeeklyHours && typeof d.ctWeeklyHours === 'object') {
    state.ctWeeklyHours = state.ctWeeklyHours || {};
    Object.keys(d.ctWeeklyHours).forEach(k => {
      state.ctWeeklyHours[k] = Math.max(
        state.ctWeeklyHours[k] || 0,
        sanitizeRemoteNumber(d.ctWeeklyHours[k], 0, 24, 0)
      );
    });
  }

  /* Day history: priority merge (complete > partial > rest) */
  if (d.ctDayHistory && typeof d.ctDayHistory === 'object') {
    state.ctDayHistory = state.ctDayHistory || {};
    const priority     = { complete: 3, partial: 2, rest: 1 };
    const validDateRe  = /^\d{4}-\d{2}-\d{2}$/;
    const validValues  = new Set(['complete', 'partial', 'rest']);
    Object.keys(d.ctDayHistory).forEach(k => {
      if (!validDateRe.test(k) || !validValues.has(d.ctDayHistory[k])) return;
      const existing = priority[state.ctDayHistory[k]] || 0;
      const incoming = priority[d.ctDayHistory[k]]     || 0;
      if (incoming > existing) state.ctDayHistory[k] = d.ctDayHistory[k];
    });
  }

  /* Junk / sugar log: merge by ID */
  _mergeLogArray('junkLog',  d);
  _mergeLogArray('sugarLog', d);

  /* Biryani: merge by monthKey and entry ID */
  if (Array.isArray(d.biryLog)) {
    state.biryLog = state.biryLog || [];
    d.biryLog.forEach(remoteMonth => {
      if (!remoteMonth.monthKey) return;
      let localMonth = state.biryLog.find(x => x.monthKey === remoteMonth.monthKey);
      if (!localMonth) {
        state.biryLog.push(JSON.parse(JSON.stringify(remoteMonth)));
        return;
      }
      const localIds = new Set((localMonth.entries || []).map(e => e.id));
      (remoteMonth.entries || []).forEach(re => {
        if (re.id && !localIds.has(re.id)) localMonth.entries.push(re);
      });
      localMonth.count = localMonth.entries.length;
    });
  }

  if ((d.weeklyGrams || 0) > (state.weeklyGrams || 0))
    state.weeklyGrams = d.weeklyGrams;

  /* Weekly tasks: merge by ID, OR-merge done state */
  if (Array.isArray(d.weeklyTasks) && d.weeklyTasks.length > 0) {
    state.weeklyTasks = state.weeklyTasks || [];
    const localMap = new Map(state.weeklyTasks.map(t => [t.id, t]));
    d.weeklyTasks.forEach(rt => {
      if (!rt.id) return;
      const existing = localMap.get(rt.id);
      if (!existing) {
        state.weeklyTasks.push(rt);
        localMap.set(rt.id, rt);
      } else {
        if (rt.done && !existing.done) existing.done = true;
      }
    });
  }

  /* Water log: max per day */
  if (d.waterLog && typeof d.waterLog === 'object') {
    state.waterLog = state.waterLog || {};
    Object.keys(d.waterLog).forEach(k => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      const val = d.waterLog[k];
      if (typeof val !== 'number' || val < 0 || val > 50) return;
      state.waterLog[k] = Math.max(state.waterLog[k] || 0, val);
    });
  }
}

/* ─────────────────────────────────────────────────────────────
   APPLY REMOTE CONFIG DOCUMENT
   Merges an incoming Firebase config snapshot (habits /
   sections / reminders) into local state using timestamps.
───────────────────────────────────────────────────────────────*/

export function applyConfigDoc(d) {
  if (!d || typeof d !== 'object') return;

  /* Habits: timestamp-based winner */
  if (
    Array.isArray(d.habits) &&
    (d.habitsUpdatedAt || 0) > (state.habitsUpdatedAt || 0)
  ) {
    state.habits = d.habits.map(h => ({
      id:             sanitizeRemoteString(h.id, 40),
      section:        sanitizeRemoteString(h.section, 40),
      name:           sanitizeRemoteString(h.name, 80),
      note:           sanitizeRemoteString(h.note, 100),
      pts:            sanitizeRemoteNumber(h.pts, 1, 20, 3),
      order:          sanitizeRemoteNumber(h.order, 0, 9999, 0),
      /* Preserve local base64 image if remote only has the placeholder */
      customIcon:
        h.customIconType === 'image_local'
          ? (state.habits || []).find(x => x.id === h.id)?.customIcon ||
            sanitizeRemoteString(h.customIcon, 200)
          : sanitizeRemoteString(h.customIcon, 200),
      customIconType: sanitizeRemoteString(h.customIconType, 20)
    }));
    state.habitsUpdatedAt    = d.habitsUpdatedAt;
    setSettingsNeedRebuild(true);
  }

  /* Sections: timestamp-based winner */
  if (
    Array.isArray(d.sections) &&
    (d.sectionsUpdatedAt || 0) > (state.sectionsUpdatedAt || 0)
  ) {
    state.sections = d.sections.map(s => ({
      id:   sanitizeRemoteString(s.id,   40),
      icon: sanitizeRemoteString(s.icon, 10),
      name: sanitizeRemoteString(s.name, 40),
      tag:  sanitizeRemoteString(s.tag,  20)
    }));
    state.sectionsUpdatedAt  = d.sectionsUpdatedAt;
    setSettingsNeedRebuild(true);
  }

  /* Reminders: timestamp-based winner */
  if (
    Array.isArray(d.reminders) &&
    (d.remindersUpdatedAt || 0) > (state.remindersUpdatedAt || 0)
  ) {
    state.reminders = d.reminders.map(r => ({
      id:      sanitizeRemoteString(r.id,    40),
      title:   sanitizeRemoteString(r.title, 60),
      msg:     sanitizeRemoteString(r.msg,   100),
      time:    validateTimeString(r.time) ? r.time : '08:00',
      icon:    sanitizeRemoteString(r.icon,  10),
      days:    Array.isArray(r.days)
                 ? r.days.filter(x => typeof x === 'number' && x >= 0 && x <= 6)
                 : [],
      enabled: sanitizeRemoteBool(r.enabled)
    }));
    state.remindersUpdatedAt = d.remindersUpdatedAt;
  }

  /* deletedReminderIds: union merge, cap at 100 */
  if (Array.isArray(d.deletedReminderIds)) {
    state.deletedReminderIds = state.deletedReminderIds || [];
    const localSet = new Set(state.deletedReminderIds);
    d.deletedReminderIds.forEach(id => {
      if (typeof id === 'string') localSet.add(id);
    });
    state.deletedReminderIds = Array.from(localSet).slice(-100);
  }
}

/* ─────────────────────────────────────────────────────────────
   SAVE ENGINE
───────────────────────────────────────────────────────────────*/

/**
 * Saves current state to localStorage immediately, then
 * writes to Firebase. Retries on failure with exponential
 * backoff up to SAVE_MAX_FAILS attempts.
 */
export async function save() {
  /* Always persist locally first — never loses data */
  try { safeLocalStorageSave(DB_KEY, JSON.stringify(state)); } catch (e) {}

  if (isSaving) return;
  setIsSaving(true);

  const thisVersion = saveVersion;

  try {
    updateFbStatus('syncing');

    const now            = new Date().toISOString();
    setLastSaveTimestamp(Date.now());
    setLastRemoteSavedAt(now);

    const dailyPath    = 'sandy_shared/daily_' + todayKey();
    const configPath   = 'sandy_shared/config';

    const dailyPayload = buildDailyPayload();
    dailyPayload.savedAt  = now;
    dailyPayload.savedBy  = getDeviceId();

    const configPayload = buildConfigPayload();
    configPayload.updatedAt = now;

    /* Build atomic update map */
    const updates = {};
    Object.keys(dailyPayload).forEach(key => {
      updates[dailyPath + '/' + key] = dailyPayload[key];
    });
    updates[configPath] = configPayload;

    await rtdb.ref().update(updates);

    updateFbStatus('online');
    showSync('success', 'Synced');
    setSaveFailCount(0);
    setLastSavedVersion(thisVersion);

  } catch (err) {
    console.warn('Firebase RTDB save error:', err);
    updateFbStatus('offline');
    showSync('error', 'Saved locally');

    const newFail = saveFailCount + 1;
    setSaveFailCount(newFail);

    if (newFail < SAVE_MAX_FAILS) {
      const delay = Math.min(
        SAVE_RETRY_BASE * Math.pow(2, newFail),
        15000
      );
      setTimeout(() => { if (!isSaving) save(); }, delay);
    } else {
      setSaveFailCount(0);
    }

  } finally {
    setIsSaving(false);
    /* If new saves queued while this one ran, fire another */
    if (saveVersion !== lastSavedVersion && saveFailCount < SAVE_MAX_FAILS) {
      setTimeout(() => save(), 150);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   LOAD ENGINE
───────────────────────────────────────────────────────────────*/

/**
 * Loads state from localStorage first (instant),
 * then fetches today's daily doc + config from Firebase
 * and merges both into local state.
 */
export async function load() {
  try {
    const r = localStorage.getItem(DB_KEY);
    if (r) state = Object.assign(defaultState(), JSON.parse(r));
  } catch (e) {
    state = defaultState();
  }

  try {
    showSync('syncing', 'Loading...');
    updateFbStatus('syncing');

    const [dailySnap, configSnap] = await Promise.all([
      userRef('daily_' + todayKey()).once('value'),
      userRef('config').once('value')
    ]);

    if (dailySnap.exists())  applyDailyDoc(dailySnap.val());
    if (configSnap.exists()) applyConfigDoc(configSnap.val());

    updateFbStatus('online');
    showSync('success', 'Loaded');

  } catch (err) {
    console.warn('Firebase RTDB load error:', err);
    updateFbStatus('offline');
  }
}

/* ─────────────────────────────────────────────────────────────
   FORCE SYNC ALL
   Read-before-write: fetches remote, merges, then saves merged.
───────────────────────────────────────────────────────────────*/

export async function forceSyncAll() {
  showToast('Force syncing...');
  setSaveFailCount(0);
  setLastRemoteSavedAt('');

  try {
    const [dailySnap, configSnap] = await Promise.all([
      userRef('daily_' + todayKey()).once('value'),
      userRef('config').once('value')
    ]);

    if (dailySnap.exists())  applyDailyDoc(dailySnap.val());
    if (configSnap.exists()) applyConfigDoc(configSnap.val());

    try { safeLocalStorageSave(DB_KEY, JSON.stringify(state)); } catch (e) {}

    /* Trigger a lightweight UI refresh */
    _dispatchRefresh();

    await save();
  } catch (e) {
    console.warn('Force sync read failed:', e);
  }

  detachAllListeners();
  startRealtimeSync();
  showToast('All data synced across devices!', 'gt');
}

/* ─────────────────────────────────────────────────────────────
   REALTIME SYNC
───────────────────────────────────────────────────────────────*/

/**
 * Detaches all active Firebase listeners using the exact
 * ref + callback pairs that were registered.
 */
export function detachAllListeners() {
  if (_dailyListenerRef && _dailyListenerCb) {
    try { _dailyListenerRef.off('value', _dailyListenerCb); } catch (e) {}
  }
  setDailyListenerRef(null);
  setDailyListenerCb(null);

  if (_configListenerRef && _configListenerCb) {
    try { _configListenerRef.off('value', _configListenerCb); } catch (e) {}
  }
  setConfigListenerRef(null);
  setConfigListenerCb(null);

  if (_connectedListenerCb) {
    try {
      rtdb.ref('.info/connected').off('value', _connectedListenerCb);
    } catch (e) {}
    setConnectedListenerCb(null);
  }
}

/**
 * Attaches realtime listeners for today's daily doc and config.
 * Always calls detachAllListeners() first to prevent duplicates.
 */
export function startRealtimeSync() {
  detachAllListeners();

  const myDeviceId = getDeviceId();
  const dailyRef   = userRef('daily_' + todayKey());
  const configRef  = userRef('config');

  /* ── Daily listener ── */
  const dailyCb = dailyRef.on('value', snap => {
    setRealtimeRetryCount(0);
    if (!snap.exists()) return;

    const remote = snap.val();
    if (!remote) return;

    /* Echo detection — same device AND within 3 s window */
    if (
      remote.savedBy === myDeviceId &&
      remote.savedAt === _lastRemoteSavedAt
    ) return;

    /* Oscillation guard */
    if (_syncMergeInProgress) return;
    setSyncMergeInProgress(true);

    /* Snapshot pre-merge values */
    const beforeWater    = state.water    || 0;
    const beforePts      = state.pts      || 0;
    const beforeTotal    = state.totalPts || 0;
    const beforeChecks   = JSON.stringify(state.checks || {});
    const beforeStudyHrs = state.ctStudyHrs || 0;
    const beforeStreak   = state.ctStreakDays || 0;
    const beforeResetTs  = state.lastResetTimestamp || 0;

    applyDailyDoc(remote);

    try { safeLocalStorageSave(DB_KEY, JSON.stringify(state)); } catch (e) {}

    /* Check if local has genuinely newer data */
    const localHasMore =
      (state.water       || 0) > (remote.water       || 0) ||
      (state.pts         || 0) > (remote.pts         || 0) ||
      (state.totalPts    || 0) > (remote.totalPts    || 0) ||
      (state.ctStudyHrs  || 0) > (remote.ctStudyHrs  || 0) ||
      (state.ctStreakDays|| 0) > (remote.ctStreakDays || 0) ||
      (state.lastResetTimestamp || 0) > (remote.lastResetTimestamp || 0);

    const localChecksNewer = (() => {
      const rc = remote.checks || {};
      const lc = state.checks  || {};
      return Object.keys(lc).some(k => lc[k] !== rc[k]);
    })();

    _dispatchRefresh();

    if (localHasMore || localChecksNewer) {
      debouncedSave(1200);
      setTimeout(() => setSyncMergeInProgress(false), 1800);
    } else {
      setSyncMergeInProgress(false);
    }

    const changed =
      beforeWater    !== (state.water       || 0) ||
      beforePts      !== (state.pts         || 0) ||
      beforeTotal    !== (state.totalPts    || 0) ||
      beforeChecks   !== JSON.stringify(state.checks || {}) ||
      beforeStudyHrs !== (state.ctStudyHrs  || 0) ||
      beforeStreak   !== (state.ctStreakDays || 0) ||
      beforeResetTs  !== (state.lastResetTimestamp || 0);

    if (changed) showSync('success', 'Updated from other device');

  }, err => {
    console.warn('Daily listener error:', err);
    updateFbStatus('offline');
    setSyncMergeInProgress(false);

    const newCount = realtimeRetryCount + 1;
    setRealtimeRetryCount(newCount);

    if (newCount <= REALTIME_MAX_RETRIES) {
      const delay = Math.min(
        REALTIME_BASE_DELAY * Math.pow(1.5, newCount),
        60000
      );
      setTimeout(startRealtimeSync, delay);
    }
  });

  setDailyListenerRef(dailyRef);
  setDailyListenerCb(dailyCb);

  /* ── Config listener ── */
  const configCb = configRef.on('value', snap => {
    if (!snap.exists()) return;
    const remote = snap.val();
    if (!remote) return;

    /* Echo detection */
    if (remote.updatedAt === _lastRemoteSavedAt) return;

    applyConfigDoc(remote);
    try { safeLocalStorageSave(DB_KEY, JSON.stringify(state)); } catch (e) {}

    /* Debounce the settings rebuild */
    if (_configSyncTimer) clearTimeout(_configSyncTimer);
    setConfigSyncTimer(setTimeout(() => {
      setConfigSyncTimer(null);
      setSettingsNeedRebuild(true);
      _dispatchConfigRebuild();
    }, 500));

    showSync('success', 'Config synced');

  }, err => { console.warn('Config listener error:', err); });

  setConfigListenerRef(configRef);
  setConfigListenerCb(configCb);

  /* ── Connection state listener ── */
  const connectedCb = snap => {
    if (snap.val() === true) {
      updateFbStatus('online');
      debouncedSave(500);
    } else {
      updateFbStatus('offline');
    }
  };

  rtdb.ref('.info/connected').on('value', connectedCb);
  setConnectedListenerCb(connectedCb);
}

/* ─────────────────────────────────────────────────────────────
   DAILY RESET
───────────────────────────────────────────────────────────────*/

/**
 * Checks if the date has changed since last run.
 * If so, archives study hours, evaluates streak, resets
 * all daily counters, and converts Today/Tomorrow tasks.
 */
export function handleDailyReset() {
  const today = todayKey();
  if (state.lastDate === today) return;

  /* Archive yesterday's study hours */
  if ((state.ctStudyHrs || 0) > 0 && state.ctLastStudyDate) {
    if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
    state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
      state.ctWeeklyHours[state.ctLastStudyDate] || 0,
      state.ctStudyHrs
    );
  }

  /* Record yesterday's outcome in day history */
  if (state.lastDate) {
    if (!state.ctDayHistory) state.ctDayHistory = {};
    if (!state.ctDayHistory[state.lastDate]) {
      state.ctDayHistory[state.lastDate] =
        state.ctDayDone           ? 'complete' :
        (state.ctStudyHrs || 0) > 0 ? 'partial' : 'rest';
    }
  }

  /* Dispatch streak evaluation to career module */
  _dispatchStreakEval();

  /* Reset daily counters */
  state.checks                  = {};
  state.water                   = 0;
  state.pts                     = 0;
  state.ctDayDone               = false;
  state.ctStudyHrs              = 0;
  state.ctTodayLogged           = false;
  state.ctLastStudyDate         = null;
  state.missedBannerDismissedDate = '';
  state.lastResetTimestamp      = Date.now();

  setFiredToday({});
  convertDayTasks();

  /* Dispatch language + junk resets */
  _dispatchLangReset();
  _dispatchJunkWeekReset();
  _dispatchWeeklyTasksReset();

  state.lastDate = today;
}

/**
 * Converts Today/Tomorrow task day labels to actual day names
 * when the date rolls over at midnight.
 */
export function convertDayTasks() {
  if (!Array.isArray(state.weeklyTasks)) return;

  const tomorrow     = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayNames     = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayName    = dayNames[new Date().getDay()];
  const tomorrowName = dayNames[tomorrow.getDay()];

  state.weeklyTasks = state.weeklyTasks.map(t => {
    if (t.day === 'Today')    return Object.assign({}, t, { day: todayName    });
    if (t.day === 'Tomorrow') return Object.assign({}, t, { day: tomorrowName });
    return t;
  });
}

/* ─────────────────────────────────────────────────────────────
   MIDNIGHT RESET SCHEDULER
───────────────────────────────────────────────────────────────*/

/**
 * Schedules a timer that fires just after the next midnight.
 * On firing it runs the full daily reset, saves, re-attaches
 * the Firebase listener for the new day, then reschedules.
 */
export function scheduleMidnightReset() {
  const now         = new Date();
  const nextMidnight= new Date(
    now.getFullYear(), now.getMonth(), now.getDate() + 1,
    0, 0, 2, 0
  );
  const msUntil     = Math.max(0, nextMidnight - now);

  clearTimeout(scheduleMidnightReset._timer);
  scheduleMidnightReset._timer = setTimeout(async () => {

    const resetKey  = todayKey();
    const storedKey = localStorage.getItem(DB_KEY_MIDNIGHT + 'lastFired') || '';
    if (storedKey === resetKey) { scheduleMidnightReset(); return; }

    safeLocalStorageSave(DB_KEY_MIDNIGHT + 'lastFired', resetKey);

    /* Archive and streak */
    if ((state.ctStudyHrs || 0) > 0 && state.ctLastStudyDate) {
      if (!state.ctWeeklyHours) state.ctWeeklyHours = {};
      state.ctWeeklyHours[state.ctLastStudyDate] = Math.max(
        state.ctWeeklyHours[state.ctLastStudyDate] || 0,
        state.ctStudyHrs
      );
    }
    if (state.lastDate) {
      if (!state.ctDayHistory) state.ctDayHistory = {};
      if (!state.ctDayHistory[state.lastDate]) {
        state.ctDayHistory[state.lastDate] =
          state.ctDayDone             ? 'complete' :
          (state.ctStudyHrs || 0) > 0 ? 'partial'  : 'rest';
      }
    }

    _dispatchStreakEval();

    /* Reset everything */
    state.checks                  = {};
    state.water                   = 0;
    state.pts                     = 0;
    state.ctDayDone               = false;
    state.ctStudyHrs              = 0;
    state.ctTodayLogged           = false;
    state.ctLastStudyDate         = null;
    state.missedBannerDismissedDate = '';
    state.lastResetTimestamp      = Date.now();

    setFiredToday({});
    setWtFilter('all');
    setWtSceneInitialized(false);
    setJnkSelected({});
    setJnkGridBuilt(false);
    setSaveFailCount(0);
    setCtPageBuilt(false);
    setCachedSceneHeight(0);
    setLastThemeKey('');
    setReminderFirstCheck(true);

    convertDayTasks();
    _dispatchLangReset();
    _dispatchJunkWeekReset();
    _dispatchWeeklyTasksReset();

    state.lastDate = resetKey;
    saveFiredToday();

    await save();

    _dispatchFullRefresh();

    const b = document.getElementById('banner');
    if (b) { b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 4000); }
    showToast('New day started! Checklist reset.', 'gt');

    /* Re-attach listener for the new day path */
    detachAllListeners();
    startRealtimeSync();
    scheduleMidnightReset();

  }, msUntil);
}
scheduleMidnightReset._timer = null;

/* ─────────────────────────────────────────────────────────────
   CLEAN UP DATA
───────────────────────────────────────────────────────────────*/

/**
 * Cleans ctWeeklyHours — removes entries marked as 'rest'
 * in ctDayHistory, since rest days should have 0 hours.
 */
export function ctCleanWeeklyHours() {
  if (!state.ctWeeklyHours || !state.ctDayHistory) return;

  let changed = false;
  const today = todayKey();

  Object.keys(state.ctWeeklyHours).forEach(dateKey => {
    if (dateKey === today) return;
    const history = state.ctDayHistory[dateKey];
    if (history === 'rest' || (!history && dateKey < today)) {
      delete state.ctWeeklyHours[dateKey];
      changed = true;
    }
  });

  if (changed) debouncedSave();
}

/**
 * Fixes orphan sugar/junk entries that are missing dateKey.
 * Runs once 3 seconds after init.
 */
export function cleanOrphanEntries() {
  setTimeout(() => {
    let changed = false;

    if (Array.isArray(state.sugarLog)) {
      const before = state.sugarLog.length;
      state.sugarLog = state.sugarLog.filter(e => {
        if (e.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey)) return true;
        if (e.weekStart && e.weekStart === state.sugarWeekStart && e.date) {
          try {
            const d = new Date(e.date);
            if (!isNaN(d.getTime())) {
              e.dateKey =
                d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
              changed = true;
              return true;
            }
          } catch (_) {}
        }
        return false;
      });
      if (state.sugarLog.length !== before) changed = true;
    }

    if (Array.isArray(state.junkLog)) {
      state.junkLog = state.junkLog.map(e => {
        if (e.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey)) return e;
        if (e.date) {
          try {
            const d = new Date(e.date);
            if (!isNaN(d.getTime())) {
              e.dateKey =
                d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
              changed = true;
              return e;
            }
          } catch (_) {}
        }
        return null;
      }).filter(Boolean);
    }

    if (changed) {
      try { safeLocalStorageSave(DB_KEY, JSON.stringify(state)); } catch (e) {}
      _dispatchStatsBannerUpdate();
    }
  }, 3000);
}

/* ─────────────────────────────────────────────────────────────
   PRIVATE HELPERS
───────────────────────────────────────────────────────────────*/

function _mergeLogArray(field, remoteDoc) {
  if (!Array.isArray(remoteDoc[field]) || !remoteDoc[field].length) return;
  state[field] = state[field] || [];
  const localIds = new Set(state[field].map(e => e.id).filter(Boolean));
  remoteDoc[field].forEach(re => {
    if (re.id && !localIds.has(re.id)) {
      state[field].push(re);
      localIds.add(re.id);
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   CROSS-MODULE DISPATCH HELPERS
   These fire CustomEvents so other modules can react without
   creating circular imports.
───────────────────────────────────────────────────────────────*/

function _dispatchRefresh() {
  window.dispatchEvent(new CustomEvent('sandy:refreshLightweight'));
}

function _dispatchFullRefresh() {
  window.dispatchEvent(new CustomEvent('sandy:refreshFull'));
}

function _dispatchConfigRebuild() {
  window.dispatchEvent(new CustomEvent('sandy:configRebuild'));
}

function _dispatchStreakEval() {
  window.dispatchEvent(new CustomEvent('sandy:evaluateStreak'));
}

function _dispatchLangReset() {
  window.dispatchEvent(new CustomEvent('sandy:resetLangFlags'));
}

function _dispatchJunkWeekReset() {
  window.dispatchEvent(new CustomEvent('sandy:junkWeekReset'));
}

function _dispatchWeeklyTasksReset() {
  window.dispatchEvent(new CustomEvent('sandy:weeklyTasksReset'));
}

function _dispatchStatsBannerUpdate() {
  window.dispatchEvent(new CustomEvent('sandy:updateStatsBanner'));
}
