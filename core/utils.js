/* ═══════════════════════════════════════════════════════════════
   core/utils.js
   Pure utility functions — no DOM manipulation, no Firebase.
   Safe to import from any other module.
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  MONTHS,
  DAY_NAMES,
  VALID_TASK_DAYS,
  DB_KEY_FIRED,
  DB_KEY_MIDNIGHT,
  state,
  firedToday,
  setFiredToday,
  confettiLock,
  setConfettiLock,
  inAppTimeoutId,
  setInAppTimeoutId
} from './state.js';

/* ─────────────────────────────────────────────────────────────
   DATE UTILITIES
───────────────────────────────────────────────────────────────*/

/**
 * Returns today's date as YYYY-MM-DD string.
 */
export function todayKey() {
  const n = new Date();
  return (
    n.getFullYear() + '-' +
    String(n.getMonth() + 1).padStart(2, '0') + '-' +
    String(n.getDate()).padStart(2, '0')
  );
}

/**
 * Returns yesterday's date as YYYY-MM-DD string.
 */
export function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Returns the number of days between two YYYY-MM-DD strings.
 * Returns Infinity if either value is missing.
 */
export function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.floor(
    (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000
  );
}

/**
 * Returns the Monday of the week containing date d.
 * Result is a YYYY-MM-DD string.
 */
export function weekStartOf(d) {
  const x    = new Date(d);
  const diff = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return (
    x.getFullYear() + '-' +
    String(x.getMonth() + 1).padStart(2, '0') + '-' +
    String(x.getDate()).padStart(2, '0')
  );
}

/**
 * Returns the Monday of the week containing date d.
 * Alias used specifically for sugar week calculations.
 */
export function sugarWeekStartOf(d) {
  return weekStartOf(d);
}

/**
 * Returns a YYYY-MM key string for a given month + year.
 * month is 0-indexed (0 = January).
 */
export function monthKey(month, year) {
  return year + '-' + String(month + 1).padStart(2, '0');
}

/**
 * Returns the YYYY-MM key for the current month.
 */
export function currentMonthKey() {
  const n = new Date();
  return monthKey(n.getMonth(), n.getFullYear());
}

/**
 * Formats a YYYY-MM-DD string as "14 May" style.
 */
export function formatDateShort(dateKey) {
  if (!dateKey) return '';
  try {
    const d = new Date(dateKey + 'T00:00:00');
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  } catch (e) {
    return dateKey;
  }
}

/**
 * Formats a YYYY-MM-DD string as "Mon, 14 May 2026" style.
 */
export function formatDateFull(dateKey) {
  if (!dateKey) return '';
  try {
    return new Date(dateKey + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'short',
      day:     '2-digit',
      month:   'short',
      year:    'numeric'
    });
  } catch (e) {
    return dateKey;
  }
}

/**
 * Returns today's date formatted as "Mon, 13 May 2026".
 */
export function todayStr() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day:     '2-digit',
    month:   'short',
    year:    'numeric'
  });
}

/**
 * Returns "Today", "Yesterday", or a short date like "14 May".
 */
export function getRelativeDate(dateKey) {
  if (dateKey === todayKey())     return 'Today';
  if (dateKey === yesterdayKey()) return 'Yesterday';
  return formatDateShort(dateKey);
}

/**
 * Returns true if the current day is Saturday or Sunday.
 */
export function isWeekend() {
  const d = new Date().getDay();
  return d === 0 || d === 6;
}

/**
 * Returns true if dateKey matches today.
 */
export function isToday(dateKey) {
  return dateKey === todayKey();
}

/**
 * Returns true if dateKey matches yesterday.
 */
export function isYesterday(dateKey) {
  return dateKey === yesterdayKey();
}

/* ─────────────────────────────────────────────────────────────
   ID GENERATION
───────────────────────────────────────────────────────────────*/

/**
 * Generates a random unique string ID.
 */
export function genId() {
  return '_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/* ─────────────────────────────────────────────────────────────
   STRING / SECURITY UTILITIES
───────────────────────────────────────────────────────────────*/

/**
 * Escapes HTML special characters to prevent XSS.
 * Also strips javascript: and inline event handlers.
 */
export function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  const cleaned = str
    .replace(/javascript\s*:/gi, 'nojs:')
    .replace(/on\w+\s*=/gi, 'data-removed=');
  return cleaned
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitizes a value that arrived from Firebase as a string.
 * Returns '' if not a string. Trims to maxLen characters.
 */
export function sanitizeRemoteString(val, maxLen) {
  if (typeof val !== 'string') return '';
  return String(val).slice(0, maxLen || 200);
}

/**
 * Sanitizes a value that arrived from Firebase as a number.
 * Clamps to [min, max]. Returns fallback if NaN.
 */
export function sanitizeRemoteNumber(val, min, max, fallback) {
  const n = Number(val);
  if (isNaN(n)) return fallback !== undefined ? fallback : 0;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/**
 * Sanitizes a value that arrived from Firebase as a boolean.
 */
export function sanitizeRemoteBool(val) {
  return !!val;
}

/* ─────────────────────────────────────────────────────────────
   VALIDATION
───────────────────────────────────────────────────────────────*/

/**
 * Returns true if val is a valid HH:MM time string.
 */
export function validateTimeString(val) {
  if (!val || typeof val !== 'string') return false;
  const parts = val.split(':');
  if (parts.length !== 2) return false;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return !isNaN(h) && !isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Validates a single task day string.
 * Returns 'Anytime' if the value is not in VALID_TASK_DAYS.
 */
export function validateTaskDay(day) {
  if (!VALID_TASK_DAYS.includes(day)) {
    console.warn('Sandy Brain: invalid task day "' + day + '" converted to Anytime');
    return 'Anytime';
  }
  return day;
}

/**
 * Validates a comma-separated list of task days.
 * Filters out any invalid values. Falls back to 'Anytime'.
 */
export function validateTaskDays(dayStr) {
  if (!dayStr) return 'Anytime';
  const parts = dayStr.split(',').map(d => d.trim()).filter(Boolean);
  const valid  = parts.filter(d => VALID_TASK_DAYS.includes(d));
  if (valid.length === 0) return 'Anytime';
  if (valid.length === 1) return valid[0];
  return valid.join(',');
}

/**
 * Returns true if the habit name string is valid (1–80 chars).
 */
export function validateHabitName(name) {
  if (!name || typeof name !== 'string') return false;
  const t = name.trim();
  return t.length >= 1 && t.length <= 80;
}

/* ─────────────────────────────────────────────────────────────
   FORMAT UTILITIES
───────────────────────────────────────────────────────────────*/

/**
 * Converts a HH:MM string to "9:30 AM" / "10:00 PM" format.
 */
export function formatTime12(val) {
  if (!val) return '';
  const [h, m] = val.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return '';
  return (
    ((h % 12) || 12) + ':' +
    String(m || 0).padStart(2, '0') + ' ' +
    (h < 12 ? 'AM' : 'PM')
  );
}

/* ─────────────────────────────────────────────────────────────
   TOAST NOTIFICATION
───────────────────────────────────────────────────────────────*/

/**
 * Shows a toast message at the bottom of the screen.
 * cls options: 'gt' (green), 'yt' (yellow), 'rt' (red)
 */
export function showToast(msg, cls) {
  const t  = document.getElementById('toast');
  if (!t) return;

  t.textContent  = msg;
  t.className    = 'toast show ' + (cls || '');

  const ar = document.getElementById('aria-announce');
  if (ar) ar.textContent = msg;

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    t.className = 'toast ' + (cls || '');
    if (ar) ar.textContent = '';
  }, 3000);
}
showToast._timer = null;

/* ─────────────────────────────────────────────────────────────
   CONFETTI ANIMATION
───────────────────────────────────────────────────────────────*/

/**
 * Fires a small confetti burst.
 * Locked for 1.5 s after each call to prevent spam.
 */
export function confetti() {
  if (confettiLock) return;
  setConfettiLock(true);
  setTimeout(() => setConfettiLock(false), 1500);

  ['🎉', '⭐', '✨', '🎊', '💫'].forEach((e, i) => {
    setTimeout(() => {
      if (document.hidden) return;
      const el       = document.createElement('div');
      el.className   = 'confetti-piece';
      el.textContent = e;
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText =
        'left:' + Math.random() * 85 + 'vw;' +
        'top:'  + (80 + Math.random() * 30) + 'px;' +
        'position:fixed;';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }, i * 120);
  });
}

/* ─────────────────────────────────────────────────────────────
   AUDIO FEEDBACK
───────────────────────────────────────────────────────────────*/

let _audioCtx       = null;
let _userInteracted = false;
let _audioIdleTimer = null;

document.addEventListener('click',      () => { _userInteracted = true; }, { once: true });
document.addEventListener('touchstart', () => { _userInteracted = true; }, { once: true });

/**
 * Plays a short completion tick sound when a task is checked.
 * Silently fails if AudioContext is unavailable.
 */
export function playCompletionTick() {
  if (!_userInteracted) return;
  if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return;

  try {
    if (!_audioCtx)
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (_audioCtx.state === 'suspended') _audioCtx.resume();

    const osc  = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();

    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    osc.type            = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.15);

    osc.start(_audioCtx.currentTime);
    osc.stop(_audioCtx.currentTime + 0.15);

    clearTimeout(_audioIdleTimer);
    _audioIdleTimer = setTimeout(() => {
      if (_audioCtx) {
        try { _audioCtx.close(); } catch (e) {}
        _audioCtx = null;
      }
    }, 5000);

  } catch (e) { /* silently ignore — audio not critical */ }
}

/* ─────────────────────────────────────────────────────────────
   LOCAL STORAGE
───────────────────────────────────────────────────────────────*/

/**
 * Saves a value to localStorage.
 * On QuotaExceededError, prunes old fired-today keys then retries.
 */
export function safeLocalStorageSave(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    ) {
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k &&
            (k.startsWith(DB_KEY_FIRED) || k.startsWith(DB_KEY_MIDNIGHT))
          ) {
            const dateInKey = k.split('_').pop();
            if (dateInKey && dateInKey < yesterdayKey()) keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        localStorage.setItem(key, value);
      } catch (e2) {
        showToast('Storage full — some data may not persist locally', 'yt');
      }
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   FIRED TODAY (reminder deduplication)
───────────────────────────────────────────────────────────────*/

/**
 * Loads the firedToday map from localStorage for today's date.
 * Cleans up entries from previous days.
 */
export function loadFiredToday() {
  const key = DB_KEY_FIRED + todayKey();
  try {
    const s = localStorage.getItem(key);
    setFiredToday(s ? JSON.parse(s) : {});
  } catch (e) {
    setFiredToday({});
  }

  /* Remove yesterday and day-before keys */
  try {
    const yesterday  = yesterdayKey();
    const dayBefore  = new Date();
    dayBefore.setDate(dayBefore.getDate() - 2);
    const dayBeforeKey =
      dayBefore.getFullYear() + '-' +
      String(dayBefore.getMonth() + 1).padStart(2, '0') + '-' +
      String(dayBefore.getDate()).padStart(2, '0');
    localStorage.removeItem(DB_KEY_FIRED    + yesterday);
    localStorage.removeItem(DB_KEY_FIRED    + dayBeforeKey);
    localStorage.removeItem(DB_KEY_MIDNIGHT + yesterday);
    localStorage.removeItem(DB_KEY_MIDNIGHT + dayBeforeKey);
  } catch (e) {}

  /* Safety cap */
  if (Object.keys(firedToday).length > 200) setFiredToday({});
}

/**
 * Persists the current firedToday map to localStorage.
 */
export function saveFiredToday() {
  try {
    safeLocalStorageSave(
      DB_KEY_FIRED + todayKey(),
      JSON.stringify(firedToday)
    );
  } catch (e) {}
}

/* ─────────────────────────────────────────────────────────────
   CLIPBOARD
───────────────────────────────────────────────────────────────*/

/**
 * Copies text to the system clipboard.
 * Shows a toast on success or failure.
 */
export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(()  => showToast('Copied!', 'gt'))
      .catch(()  => showToast('Copy failed', 'yt'));
  } else {
    showToast('Copy not supported', 'yt');
  }
}

/* ─────────────────────────────────────────────────────────────
   TASK / HABIT EMOJI HELPER
───────────────────────────────────────────────────────────────*/

/**
 * Returns a relevant emoji for a habit or task based on its name.
 * Falls back to ✅ if no keyword matches.
 */
export function getTaskEmoji(name) {
  if (!name) return '✅';
  const n = name.toLowerCase();

  if (/prayer|pray|namaz/.test(n))           return '🙏';
  if (/lemon|lime/.test(n))                  return '🍋';
  if (/almond|walnut|nut/.test(n))           return '🌰';
  if (/amla/.test(n))                        return '🍈';
  if (/egg/.test(n))                         return '🥚';
  if (/fruit|apple|banana|papaya/.test(n))   return '🍎';
  if (/spinach|green|vegetable/.test(n))     return '🥦';
  if (/curd|yogurt|dahi/.test(n))            return '🥛';
  if (/seed|chia|flax/.test(n))              return '🌻';
  if (/sql|database|query|join/.test(n))     return '🗄️';
  if (/python|code|program/.test(n))         return '🐍';
  if (/excel|spreadsheet|pivot/.test(n))     return '📊';
  if (/resume|cv|linkedin/.test(n))          return '📄';
  if (/interview|mock/.test(n))              return '🎤';
  if (/apply|job|company/.test(n))           return '💼';
  if (/study|learn|course|revise/.test(n))   return '📚';
  if (/read|reading|english|article/.test(n))return '📰';
  if (/face.?wash|wash|cleanse/.test(n))     return '🧴';
  if (/moistur/.test(n))                     return '💆';
  if (/sunscreen|spf/.test(n))               return '☀️';
  if (/tablet|medicine|pill|hair tab/.test(n))return '💊';
  if (/shampoo|keto/.test(n))                return '🚿';
  if (/sleep|bed|night/.test(n))             return '😴';
  if (/oil|massage/.test(n))                 return '🛢️';
  if (/walk|step|exercise|gym/.test(n))      return '🏃';
  if (/water|hydrat|drink/.test(n))          return '💧';
  if (/lunch|dal|roti|rice/.test(n))         return '🍛';
  if (/dinner/.test(n))                      return '🌙';
  if (/breakfast/.test(n))                   return '🍳';
  if (/soak/.test(n))                        return '🌊';
  if (/prep|ready|tomorrow/.test(n))         return '📦';
  if (/reminder/.test(n))                    return '🔔';
  if (/laundry|cloth|iron|clean/.test(n))    return '🧹';
  if (/project|portfolio/.test(n))           return '🗂️';
  if (/network|connect/.test(n))             return '🤝';
  return '✅';
}

/* ─────────────────────────────────────────────────────────────
   SECTION EMOJI HELPER
───────────────────────────────────────────────────────────────*/

/**
 * Returns the display emoji for a section.
 * Uses the section's own icon field as fallback, then 📌.
 */
export function getSectionEmoji(id, icon) {
  const map = {
    morning:   '☀️',
    skin_am:   '🧴',
    breakfast: '🍳',
    lunch:     '🍛',
    water:     '💧',
    evening:   '🌆',
    dinner:    '🌙',
    night:     '🌃',
    prep:      '📦'
  };
  return map[id] || icon || '📌';
}

/* ─────────────────────────────────────────────────────────────
   HABIT ICON HTML HELPER
───────────────────────────────────────────────────────────────*/

/**
 * Returns the HTML string to render a habit's icon.
 * Handles emoji, uploaded images, sync-pending images,
 * and image_local (stored only in localStorage).
 */
export function getHabitIconHtml(habit) {

  /* Image not yet synced to Firebase — show fallback emoji */
  if (habit.customIcon === '__needs_upload__') {
    return (
      '<span title="Image not synced — re-upload on this device" style="font-size:18px;">' +
      getTaskEmoji(habit.name) +
      '</span>'
    );
  }

  /* Full base64 image stored in state */
  if (
    habit.customIconType === 'image' &&
    habit.customIcon &&
    habit.customIcon.startsWith('data:image/')
  ) {
    const safeUrl = habit.customIcon.replace(/"/g, '&quot;');
    return (
      '<img src="' + safeUrl + '" alt="" ' +
      'style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>'
    );
  }

  /* Image stored only in localStorage (too large for Firebase) */
  if (
    habit.customIconType === 'image_local' ||
    habit.customIcon === '__local_image__'
  ) {
    try {
      const raw = localStorage.getItem('htrack_v20');
      if (raw) {
        const ls = JSON.parse(raw);
        const lh = (ls.habits || []).find(x => x.id === habit.id);
        if (
          lh &&
          lh.customIconType === 'image' &&
          lh.customIcon &&
          lh.customIcon.startsWith('data:image/')
        ) {
          const safeUrl = lh.customIcon.replace(/"/g, '&quot;');
          return (
            '<img src="' + safeUrl + '" alt="" ' +
            'style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"/>'
          );
        }
      }
    } catch (e) {}
    return (
      '<span title="Image not synced — re-upload on this device" style="font-size:18px;">' +
      getTaskEmoji(habit.name) +
      '</span>'
    );
  }

  /* Plain emoji */
  if (habit.customIcon) return sanitizeHTML(habit.customIcon);

  /* Default: keyword-based emoji */
  return getTaskEmoji(habit.name);
}

/* ─────────────────────────────────────────────────────────────
   WEEKLY TASK DAY COLOR
───────────────────────────────────────────────────────────────*/

/**
 * Returns { bg, color } for a weekly task day badge.
 * Uses the first day in a comma-separated list.
 */
export function getWeeklyDayColor(day) {
  const map = {
    Mon:      { bg: '#eff6ff', color: '#2563eb' },
    Tue:      { bg: '#f0fdf4', color: '#16a34a' },
    Wed:      { bg: '#fffbeb', color: '#d97706' },
    Thu:      { bg: '#fdf4ff', color: '#9333ea' },
    Fri:      { bg: '#fef2f2', color: '#dc2626' },
    Sat:      { bg: '#ecfdf5', color: '#059669' },
    Sun:      { bg: '#fff1f2', color: '#e11d48' },
    Today:    { bg: '#e0f2fe', color: '#0284c7' },
    Tomorrow: { bg: '#f0fdf4', color: '#16a34a' },
    Anytime:  { bg: '#f5f3ff', color: '#7c3aed' }
  };
  const firstDay = (day || '').split(',')[0].trim();
  return map[firstDay] || map['Anytime'];
}

/* ─────────────────────────────────────────────────────────────
   XP / LEVEL HELPER
───────────────────────────────────────────────────────────────*/

/**
 * Returns the LEVELS entry that matches the given XP total.
 */
export function getLevel(pts) {
  const LEVELS = [
    { min: 0,    label: '🌱 Beginner',   next: 50   },
    { min: 50,   label: '🌿 Growing',    next: 150  },
    { min: 150,  label: '💪 Consistent', next: 300  },
    { min: 300,  label: '🔥 Dedicated',  next: 500  },
    { min: 500,  label: '⭐ Advanced',   next: 800  },
    { min: 800,  label: '🚀 Elite',      next: 1200 },
    { min: 1200, label: '🏆 Legend',     next: 9999 }
  ];
  for (let i = LEVELS.length - 1; i >= 0; i--)
    if (pts >= LEVELS[i].min) return LEVELS[i];
  return LEVELS[0];
}

/* ─────────────────────────────────────────────────────────────
   IN-APP NOTIFICATION HELPERS
───────────────────────────────────────────────────────────────*/

/**
 * Shows the in-app notification banner at the top of the today page.
 * Auto-hides after 7 seconds.
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
   FIREBASE STATUS DISPLAY
───────────────────────────────────────────────────────────────*/

/**
 * Updates the Firebase connection status dot and text.
 * status: 'online' | 'syncing' | 'offline'
 */
export function updateFbStatus(status) {
  const map = {
    online:  { cls: 'online',  txt: 'Connected to sandyhealthtracker' },
    syncing: { cls: 'syncing', txt: 'Syncing...'                      },
    offline: { cls: 'offline', txt: 'Offline — saved locally'          }
  };
  const ref = map[status] || map.offline;

  ['fb-dot', 'settings-fb-dot'].forEach(id => {
    const d = document.getElementById(id);
    if (d) d.className = 'fb-dot ' + ref.cls;
  });

  const t1 = document.getElementById('fb-status-text');
  const t2 = document.getElementById('settings-fb-text');
  if (t1) t1.textContent = ref.txt;
  if (t2) t2.textContent = ref.txt.replace('sandyhealthtracker', 'Firebase');
}

/**
 * Shows the top-right sync pill for 2.2 seconds.
 * type: 'syncing' | 'success' | 'error'
 */
export function showSync(type, msg) {
  const s = document.getElementById('sync-status');
  const d = document.getElementById('sync-dot');
  const t = document.getElementById('sync-text');
  if (!s) return;

  s.className = 'sync-status show ' + type;
  if (d) d.className = type === 'syncing' ? 'sync-dot pulse' : 'sync-dot';
  if (t) t.textContent = msg;

  clearTimeout(showSync._timer);
  showSync._timer = setTimeout(() => s.classList.remove('show'), 2200);
}
showSync._timer = null;

/* ─────────────────────────────────────────────────────────────
   DEVICE ID (for Firebase echo detection)
───────────────────────────────────────────────────────────────*/

/**
 * Returns a persistent device ID stored in localStorage.
 * Used to detect and ignore our own Firebase writes.
 */
export function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem('sandy_device_id'); } catch (e) {}
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    try { safeLocalStorageSave('sandy_device_id', id); } catch (e) {}
  }
  return id;
}

/* ─────────────────────────────────────────────────────────────
   PRINT STYLES INJECTOR
───────────────────────────────────────────────────────────────*/

/**
 * Injects a <style media="print"> tag that hides non-essential
 * UI elements when the user prints the page.
 * Safe to call multiple times — guards against duplicate injection.
 */
export function injectPrintStyles() {
  if (document.getElementById('print-styles')) return;
  const s   = document.createElement('style');
  s.id      = 'print-styles';
  s.media   = 'print';
  s.textContent = `
    nav, .stats-banner, .sync-status, .pwa-install-banner,
    .toast, .wt-reminder-wrap, .reset-row, .reorder-btns,
    .habit-actions, .weekly-task-actions, .ct-hour-btns,
    .ct-task-add-row, .ct-log-clear-btn, .add-reminder-form,
    .alert-time-card, .firebase-status, .theme-hero {
      display: none !important;
    }
    body {
      background: white !important;
      color: black !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .app-wrapper { padding: 16px; }
    .page        { display: block !important; }
    .sc          { box-shadow: none !important; border: 1px solid #ccc !important; }
    @media print { body { padding-bottom: 0 !important; } }
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────────────────────
   DOM SAFETY CHECK
───────────────────────────────────────────────────────────────*/

/**
 * Logs a warning for any critical DOM elements that are missing.
 * Run once after init to catch HTML structure problems early.
 */
export function checkCriticalDomElements() {
  const CRITICAL = [
    'today-sections', 'page-today', 'page-study', 'page-junk',
    'page-weekly', 'page-reminders', 'page-settings',
    'stats-banner', 'theme-prog-fill', 'toast',
    'missed-banner', 'home-rem-list', 'firebase-status-bar'
  ];
  CRITICAL.forEach(id => {
    if (!document.getElementById(id))
      console.warn('Sandy Brain: missing critical element #' + id);
  });
}

/* ─────────────────────────────────────────────────────────────
   STORAGE QUOTA CHECK
───────────────────────────────────────────────────────────────*/

/**
 * Logs a warning if localStorage usage exceeds 4 MB.
 */
export function checkStorageQuota() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) total += (localStorage.getItem(k) || '').length;
    }
    if (total / (1024 * 1024) > 4)
      console.warn(
        'Sandy Brain: localStorage usage is high —',
        (total / (1024 * 1024)).toFixed(2) + 'MB'
      );
  } catch (e) {}
}
