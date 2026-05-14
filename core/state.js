/**
 * ═══════════════════════════════════════════════════════════════
 * core/state.js — Single source of truth for application state
 *
 * This module owns:
 * - The global `state` object
 * - Default data definitions
 * - State initialization & validation
 * - Module-level flags/timers shared across modules
 *
 * Other modules import `state` and mutate it directly.
 * Only firebase.js persists it.
 * ═══════════════════════════════════════════════════════════════
 */

import {
  CT_SKILL_KEYS,
  MAX_JUNK_LOG,
  MAX_SUGAR_LOG,
  MAX_CT_TASKS,
  MAX_WEEKLY_TASKS,
  MAX_DAY_HISTORY,
  DB_KEY_FIRED,
  DB_KEY_MIDNIGHT,
  sugarWeekStartOf,
  todayKey,
  yesterdayKey,
  validateTimeString,
  safeLocalStorageSave
} from './utils.js';


/* ═══════════════════════════════════════════════════════════════
   DEFAULT DATA DEFINITIONS
   ═══════════════════════════════════════════════════════════════ */

export const DEFAULT_SECTIONS = [
  { id: 'morning',   icon: '☀️', name: 'Morning',          tag: 'on waking' },
  { id: 'skin_am',   icon: '🧴', name: 'Morning skin',     tag: '' },
  { id: 'breakfast', icon: '🍳', name: 'Breakfast',         tag: '' },
  { id: 'lunch',     icon: '🍛', name: 'Lunch',            tag: '' },
  { id: 'water',     icon: '💧', name: 'Water',            tag: 'special' },
  { id: 'evening',   icon: '🌆', name: 'Evening',          tag: 'special' },
  { id: 'dinner',    icon: '🌙', name: 'Dinner',           tag: '' },
  { id: 'night',     icon: '🌃', name: 'Night routine',    tag: '' },
  { id: 'prep',      icon: '📦', name: 'Prep for tomorrow', tag: '' }
];

export const DEFAULT_HABITS = [
  { id: 'lemon',       section: 'morning',   name: 'Warm lemon water',         note: '1 glass, first thing',       pts: 3, order: 0 },
  { id: 'almonds',     section: 'morning',   name: 'Soaked almonds — 5 pieces', note: 'Soak tonight',              pts: 3, order: 1 },
  { id: 'walnuts',     section: 'morning',   name: 'Walnuts — 2 pieces',       note: '',                           pts: 2, order: 2 },
  { id: 'amla',        section: 'morning',   name: 'Amla — 1 piece or juice',  note: 'Vitamin C',                  pts: 3, order: 3 },
  { id: 'facewash_am', section: 'skin_am',   name: 'Face wash',                note: '',                           pts: 2, order: 0 },
  { id: 'moisturizer', section: 'skin_am',   name: 'Moisturizer',              note: '',                           pts: 2, order: 1 },
  { id: 'sunscreen',   section: 'skin_am',   name: 'Sunscreen',                note: 'If going outside',           pts: 2, order: 2 },
  { id: 'eggs',        section: 'breakfast',  name: '2 eggs',                   note: 'Protein for hair + skin',    pts: 4, order: 0 },
  { id: 'fruit_am',    section: 'breakfast',  name: '1 fruit',                  note: 'Banana / apple / papaya',    pts: 3, order: 1 },
  { id: 'dal_lunch',   section: 'lunch',      name: 'Dal + vegetables + 1-2 roti', note: '',                        pts: 4, order: 0 },
  { id: 'curd',        section: 'lunch',      name: '1 bowl curd',              note: 'Gut health',                 pts: 3, order: 1 },
  { id: 'dinner',      section: 'dinner',     name: 'Roti + vegetables only',   note: 'No fried food at night',     pts: 3, order: 0 },
  { id: 'facewash_pm', section: 'night',      name: 'Face wash + moisturizer',  note: '',                           pts: 2, order: 0 },
  { id: 'hair_tablets',section: 'night',      name: 'Take hair tablets',        note: 'With water after dinner',    pts: 4, order: 1 },
  { id: 'keto',        section: 'night',      name: 'Ketoconazole shampoo',     note: '2x per week — leave 5 min',  pts: 3, order: 2 },
  { id: 'revision',    section: 'night',      name: 'Revision in bed',          note: 'Read notes before sleeping', pts: 6, order: 3 },
  { id: 'sleep',       section: 'night',      name: 'Sleep by 9:30-10 PM',     note: '',                           pts: 4, order: 4 },
  { id: 'soak',        section: 'prep',       name: 'Soak 5 almonds overnight', note: '',                           pts: 2, order: 0 },
  { id: 'prep_seeds',  section: 'prep',       name: 'Keep chia / flax seeds ready', note: '',                       pts: 2, order: 1 }
];

export const DEFAULT_REMINDERS = [
  { id: 'r1', title: 'Good morning!',      msg: 'Lemon water, almonds & amla!', time: '06:30', icon: '🌅', days: [0,1,2,3,4,5,6], enabled: true },
  { id: 'r2', title: 'Study time',         msg: '4 hours — no phone!',          time: '10:00', icon: '📚', days: [1,2,3,4,5],     enabled: true },
  { id: 'r3', title: 'Drink water',        msg: 'Have you had enough water?',   time: '14:00', icon: '💧', days: [0,1,2,3,4,5,6], enabled: true },
  { id: 'r4', title: 'Evening snack',      msg: 'Fruit or seeds before 6 PM',   time: '17:00', icon: '🍎', days: [0,1,2,3,4,5,6], enabled: true },
  { id: 'r5', title: 'Take hair tablets',  msg: "Don't forget after dinner!",   time: '21:00', icon: '💊', days: [0,1,2,3,4,5,6], enabled: true },
  { id: 'r6', title: 'Sleep time',         msg: 'Wind down. Revise & sleep by 10', time: '21:30', icon: '🌙', days: [0,1,2,3,4,5,6], enabled: true }
];


/* ═══════════════════════════════════════════════════════════════
   GLOBAL STATE OBJECT
   ═══════════════════════════════════════════════════════════════ */

/**
 * The single mutable state object for the entire app.
 * Modules import this and mutate properties directly.
 * Firebase.js serializes/deserializes it.
 */
export let state = {};

/**
 * Replaces the state object entirely (used during load/reset).
 * @param {object} newState
 */
export function replaceState(newState) {
  // Clear all existing keys
  Object.keys(state).forEach(k => delete state[k]);
  // Assign new keys
  Object.assign(state, newState);
}


/* ═══════════════════════════════════════════════════════════════
   MODULE-LEVEL FLAGS & TIMERS
   Shared mutable references that multiple modules read/write.
   Grouped here to avoid scattered globals.
   ═══════════════════════════════════════════════════════════════ */

export const flags = {
  // Firebase sync
  isSaving: false,
  saveDebounceTimer: null,
  saveFailCount: 0,
  saveVersion: 0,
  lastSavedVersion: 0,
  realtimeRetryCount: 0,
  _lastSaveTimestamp: 0,
  _lastRemoteSavedAt: '',
  _syncMergeInProgress: false,

  // Listener handles (for clean detach)
  _dailyListenerRef: null,
  _dailyListenerCb: null,
  _configListenerRef: null,
  _configListenerCb: null,
  _connectedListenerCb: null,

  // Water tracker
  wtSceneInitialized: false,
  wtDone: false,
  wtPropRAF: null,
  wtIdleTmr: null,
  wtRemTimer: null,
  wtRemNextTimeout: null,
  _wtAppOpenTime: Date.now(),
  cachedSceneHeight: 0,

  // Junk tracker
  jnkSelected: {},
  jnkGridBuilt: false,
  jActiveLog: 'sugar',
  biryaniLogInFlight: false,

  // Career tracker
  ctPageBuilt: false,
  ctActiveTag: 'All',
  _ctCdInterval: null,
  _ctDayCompletedThisSession: false,

  // Weekly tracker
  wtEditingId: null,
  wtFilter: 'all',
  wtSelectedDays: ['Mon'],

  // Settings
  settingsFilter: 'all',
  editingHabitId: null,
  _settingsNeedRebuild: false,

  // Icon picker
  iconPickerHabitId: null,
  iconPickerMode: 'emoji',
  selectedEmoji: null,
  uploadedImageData: null,

  // Reminders
  selDays: [0,1,2,3,4,5,6],
  firedToday: {},
  inAppTimeoutId: null,
  _reminderFirstCheck: true,

  // Theme
  _lastThemeKey: '',

  // Master timer
  masterTimerId: null,
  masterTickCount: 0,
  _configSyncTimer: null,

  // Streak milestone
  _lastStreakMilestone: 0,

  // Badge check
  badgeCheckTimer: null,

  // Midnight reset
  midnightResetFiredKey: '',

  // PWA
  deferredInstallPrompt: null,

  // Evening section tracking
  _lastEveningWasWeekend: null,

  // UID
  currentUID: 'sandy_shared'
};


/* ═══════════════════════════════════════════════════════════════
   defaultState() — Factory for a clean initial state
   ═══════════════════════════════════════════════════════════════ */

/**
 * Returns a fresh default state object.
 * Used on first load and factory reset.
 * @returns {object}
 */
export function defaultState() {
  const now = new Date();
  return {
    lastDate: '',
    lastResetTimestamp: 0,

    // Daily tracking
    checks: {},
    water: 0,
    pts: 0,
    totalPts: 0,

    // Badges
    earnedBadges: [],
    missedBannerDismissedDate: '',
    missedTasksAlertTime: '21:00',

    // English language tracking
    engStreak: 0,
    lastEngDate: '',
    engReadDone: false,
    engSpeakDone: false,
    engSpeakStreak: 0,
    engSpeakLastDate: '',
    engLearnDone: false,
    engLearnStreak: 0,
    engLearnLastDate: '',

    // Hindi language tracking
    hiReadDone: false,
    hiReadStreak: 0,
    hiReadLastDate: '',
    hiSpeakDone: false,
    hiSpeakStreak: 0,
    hiSpeakLastDate: '',
    hiLearnDone: false,
    hiLearnStreak: 0,
    hiLearnLastDate: '',

    // Career tracker
    ctSkills: { sql: 0, tools: 0, proj: 0, intv: 0 },
    ctStudyHrs: 0,
    ctDayDone: false,
    ctTodayLogged: false,
    ctTotalDays: 0,
    ctStreakDays: 0,
    ctStreakLastDate: null,
    ctLastDate: null,
    ctLastStudyDate: null,
    ctDayHistory: {},
    ctConsecutiveRestDays: 0,
    ctTasks: [],
    ctTasksUpdatedAt: 0,
    ctLog: [],
    ctLogUpdatedAt: 0,
    ctWeeklyHours: {},

    // Junk food tracking
    junkLog: [],
    sugarLog: [],
    biryLog: [],
    weeklyGrams: 0,
    sugarWeekStart: sugarWeekStartOf(now),
    jnkViewMonth: now.getMonth(),
    jnkViewYear: now.getFullYear(),
    jBViewM: now.getMonth(),
    jBViewY: now.getFullYear(),

    // Weekly tasks
    weeklyTasks: [],
    weeklyTasksResetDate: '',

    // Water log
    waterLog: {},
    wtReminderInterval: 60,
    wtReminderTime: null,
    wtReminderEnabled: false,
    wtLastReminderFired: null,

    // Configuration (synced via config path)
    habits: [],
    sections: [],
    reminders: [],
    deletedReminderIds: [],
    habitsUpdatedAt: 0,
    sectionsUpdatedAt: 0,
    remindersUpdatedAt: 0
  };
}


/* ═══════════════════════════════════════════════════════════════
   ensureDefaults() — Validates & repairs state after load/merge
   ═══════════════════════════════════════════════════════════════ */

/**
 * Ensures all state properties exist with valid types and values.
 * Repairs missing fields, clamps out-of-range numbers, trims
 * oversized arrays, prunes stale date-keyed objects.
 * Must be called after every load or merge operation.
 */
export function ensureDefaults() {
  // ── Habits, Sections, Reminders defaults ──
  if (!state.habits || !state.habits.length) {
    state.habits = JSON.parse(JSON.stringify(DEFAULT_HABITS));
  }
  if (!state.sections || !state.sections.length) {
    state.sections = JSON.parse(JSON.stringify(DEFAULT_SECTIONS));
  }
  if (!state.reminders || !state.reminders.length) {
    state.reminders = JSON.parse(JSON.stringify(DEFAULT_REMINDERS));
  }

  // ── Career skills validation ──
  if (!state.ctSkills || typeof state.ctSkills !== 'object') {
    state.ctSkills = { sql: 0, tools: 0, proj: 0, intv: 0 };
  }
  CT_SKILL_KEYS.forEach(k => {
    if (typeof state.ctSkills[k] !== 'number' || isNaN(state.ctSkills[k])) {
      state.ctSkills[k] = 0;
    }
    state.ctSkills[k] = Math.max(0, Math.min(100, state.ctSkills[k]));
  });

  // ── Array type guards ──
  if (!Array.isArray(state.ctTasks))       state.ctTasks = [];
  if (!Array.isArray(state.ctLog))         state.ctLog = [];
  if (!Array.isArray(state.junkLog))       state.junkLog = [];
  if (!Array.isArray(state.sugarLog))      state.sugarLog = [];
  if (!Array.isArray(state.biryLog))       state.biryLog = [];
  if (!Array.isArray(state.weeklyTasks))   state.weeklyTasks = [];
  if (!Array.isArray(state.earnedBadges))  state.earnedBadges = [];
  if (!Array.isArray(state.deletedReminderIds)) state.deletedReminderIds = [];

  // ── Object type guards ──
  if (!state.ctWeeklyHours || typeof state.ctWeeklyHours !== 'object') state.ctWeeklyHours = {};
  if (!state.waterLog || typeof state.waterLog !== 'object')           state.waterLog = {};
  if (!state.ctDayHistory || typeof state.ctDayHistory !== 'object')   state.ctDayHistory = {};
  if (!state.checks || typeof state.checks !== 'object')               state.checks = {};

  // ── Numeric defaults ──
  if (typeof state.ctConsecutiveRestDays !== 'number') state.ctConsecutiveRestDays = 0;
  if (typeof state.ctStreakDays !== 'number')          state.ctStreakDays = 0;
  if (typeof state.ctTotalDays !== 'number')           state.ctTotalDays = 0;

  // ── Timestamp defaults ──
  if (!state.habitsUpdatedAt)    state.habitsUpdatedAt = 0;
  if (!state.sectionsUpdatedAt)  state.sectionsUpdatedAt = 0;
  if (!state.remindersUpdatedAt) state.remindersUpdatedAt = 0;
  if (!state.ctTasksUpdatedAt)   state.ctTasksUpdatedAt = 0;
  if (!state.ctLogUpdatedAt)     state.ctLogUpdatedAt = 0;
  if (!state.lastResetTimestamp) state.lastResetTimestamp = 0;

  // ── String validation ──
  if (!validateTimeString(state.missedTasksAlertTime)) {
    state.missedTasksAlertTime = '21:00';
  }
  if (!state.sugarWeekStart) {
    state.sugarWeekStart = sugarWeekStartOf(new Date());
  }

  // ── Water reminder defaults ──
  if (state.wtReminderInterval === undefined)   state.wtReminderInterval = 60;
  if (state.wtReminderTime === undefined)       state.wtReminderTime = null;
  if (state.wtReminderEnabled === undefined)    state.wtReminderEnabled = false;
  if (state.wtLastReminderFired === undefined)  state.wtLastReminderFired = null;

  // ── Career optional fields ──
  if (state.ctTodayLogged === undefined)    state.ctTodayLogged = false;
  if (state.ctStreakLastDate === undefined)  state.ctStreakLastDate = null;
  if (state.ctLastStudyDate === undefined)   state.ctLastStudyDate = null;

  // ── Habit order assignment ──
  state.habits.forEach((h, i) => {
    if (h.order === undefined) h.order = i;
  });

  // ── Ensure IDs on log entries ──
  if (state.junkLog.some(e => !e.id)) {
    state.junkLog.forEach(e => { if (!e.id) e.id = _genId(); });
  }
  if (state.sugarLog.some(e => !e.id)) {
    state.sugarLog.forEach(e => { if (!e.id) e.id = _genId(); });
  }
  state.biryLog.forEach(b => {
    if (!b.entries) b.entries = [];
    if (b.entries.some(e => !e.id)) {
      b.entries.forEach(e => { if (!e.id) e.id = _genId(); });
    }
    b.count = b.entries.length;
  });

  // ── Array size caps ──
  if (state.junkLog.length > MAX_JUNK_LOG)      state.junkLog = state.junkLog.slice(-MAX_JUNK_LOG);
  if (state.sugarLog.length > MAX_SUGAR_LOG)    state.sugarLog = state.sugarLog.slice(-MAX_SUGAR_LOG);
  if (state.ctTasks.length > MAX_CT_TASKS)      state.ctTasks = state.ctTasks.slice(-MAX_CT_TASKS);
  if (state.weeklyTasks.length > MAX_WEEKLY_TASKS) state.weeklyTasks = state.weeklyTasks.slice(-MAX_WEEKLY_TASKS);

  // ── deletedReminderIds cap ──
  if (state.deletedReminderIds.length > 100) {
    state.deletedReminderIds = state.deletedReminderIds.slice(-100);
  }

  // ── ctDayHistory size cap ──
  if (state.ctDayHistory) {
    const keys = Object.keys(state.ctDayHistory).sort();
    if (keys.length > MAX_DAY_HISTORY) {
      keys.slice(0, keys.length - MAX_DAY_HISTORY).forEach(k => delete state.ctDayHistory[k]);
    }
  }

  // ── ctDayHistory value validation ──
  if (state.ctDayHistory) {
    const validDateRe = /^\d{4}-\d{2}-\d{2}$/;
    const validValues = new Set(['complete', 'partial', 'rest']);
    Object.keys(state.ctDayHistory).forEach(k => {
      if (!validDateRe.test(k) || !validValues.has(state.ctDayHistory[k])) {
        delete state.ctDayHistory[k];
      }
    });
  }

  // ── Prune waterLog older than 30 days ──
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.getFullYear() + '-' +
    String(cutoff.getMonth() + 1).padStart(2, '0') + '-' +
    String(cutoff.getDate()).padStart(2, '0');
  Object.keys(state.waterLog).forEach(k => {
    if (k < cutoffKey) delete state.waterLog[k];
  });

  // ── Prune ctWeeklyHours older than 14 days ──
  const wCutoff = new Date();
  wCutoff.setDate(wCutoff.getDate() - 14);
  const wCutoffKey = wCutoff.getFullYear() + '-' +
    String(wCutoff.getMonth() + 1).padStart(2, '0') + '-' +
    String(wCutoff.getDate()).padStart(2, '0');
  Object.keys(state.ctWeeklyHours).forEach(k => {
    if (k < wCutoffKey) delete state.ctWeeklyHours[k];
  });

  // ── Fix jnkSelected if corrupted ──
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) {
    flags.jnkSelected = {};
  }
}


/* ═══════════════════════════════════════════════════════════════
   FIRED TODAY — Local persistence for reminder deduplication
   ═══════════════════════════════════════════════════════════════ */

/**
 * Loads today's fired reminder keys from localStorage.
 * Prunes stale keys from previous days.
 */
export function loadFiredToday() {
  const key = DB_KEY_FIRED + todayKey();
  try {
    const s = localStorage.getItem(key);
    flags.firedToday = s ? JSON.parse(s) : {};
  } catch (e) {
    flags.firedToday = {};
  }

  // Prune old keys
  try {
    const yd = yesterdayKey();
    const dayBefore = new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    const dayBeforeKey = dayBefore.getFullYear() + '-' +
      String(dayBefore.getMonth() + 1).padStart(2, '0') + '-' +
      String(dayBefore.getDate()).padStart(2, '0');
    localStorage.removeItem(DB_KEY_FIRED + yd);
    localStorage.removeItem(DB_KEY_FIRED + dayBeforeKey);
  } catch (e) { /* ignore */ }

  // Safety cap
  if (Object.keys(flags.firedToday).length > 200) {
    flags.firedToday = {};
  }
}

/**
 * Persists today's fired reminder keys to localStorage.
 */
export function saveFiredToday() {
  try {
    safeLocalStorageSave(DB_KEY_FIRED + todayKey(), JSON.stringify(flags.firedToday));
  } catch (e) { /* ignore */ }
}


/* ═══════════════════════════════════════════════════════════════
   PRIVATE HELPERS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Internal genId — avoids importing from utils (circular safety).
 * @returns {string}
 */
function _genId() {
  return '_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}
