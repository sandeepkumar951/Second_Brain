/**
 * core/utils.js
 * Pure utility functions — no dependencies on other modules.
 * All exports also assigned to window.* for inline HTML handlers.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

export const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

export const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export const VALID_TASK_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun','Today','Tomorrow','Anytime'];

// ─── Date utilities ──────────────────────────────────────────────────────────

export function todayKey() {
  const n = new Date();
  return n.getFullYear() + '-' +
    String(n.getMonth()+1).padStart(2,'0') + '-' +
    String(n.getDate()).padStart(2,'0');
}

export function yesterdayKey() {
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

export function daysBetween(a, b) {
  if (!a||!b) return Infinity;
  return Math.floor((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
}

export function sugarWeekStartOf(d) {
  const x = new Date(d); const diff = (x.getDay()+6)%7;
  x.setDate(x.getDate()-diff); x.setHours(0,0,0,0);
  return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
}

export function monthKey(month, year) {
  return year+'-'+String(month+1).padStart(2,'0');
}

export function currentMonthKey() {
  const n = new Date(); return monthKey(n.getMonth(), n.getFullYear());
}

export function formatDateShort(dateKey) {
  if (!dateKey) return '';
  try {
    const d = new Date(dateKey+'T00:00:00');
    return d.getDate()+' '+MONTHS[d.getMonth()].slice(0,3);
  } catch(e) { return dateKey; }
}

export function formatDateFull(dateKey) {
  if (!dateKey) return '';
  try {
    return new Date(dateKey+'T00:00:00').toLocaleDateString('en-GB',
      {weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  } catch(e) { return dateKey; }
}

export function todayStr() {
  return new Date().toLocaleDateString('en-GB',
    {weekday:'short',day:'2-digit',month:'short',year:'numeric'});
}

// ─── General utilities ───────────────────────────────────────────────────────

export function genId() {
  return '_'+Math.random().toString(36).substr(2,9)+Date.now().toString(36);
}

export function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/javascript\s*:/gi,'nojs:')
    .replace(/on\w+\s*=/gi,'data-removed=')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#x27;').replace(/\//g,'&#x2F;');
}

export function sanitizeRemoteString(val, maxLen) {
  if (typeof val !== 'string') return '';
  return String(val).slice(0, maxLen || 200);
}

export function sanitizeRemoteNumber(val, min, max, fallback) {
  const n = Number(val);
  if (isNaN(n)) return fallback !== undefined ? fallback : 0;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

export function sanitizeRemoteBool(val) { return !!val; }

export function validateTimeString(val) {
  if (!val||typeof val!=='string') return false;
  const parts = val.split(':');
  if (parts.length!==2) return false;
  const h = parseInt(parts[0],10), m = parseInt(parts[1],10);
  return !isNaN(h)&&!isNaN(m)&&h>=0&&h<=23&&m>=0&&m<=59;
}

export function formatTime12(val) {
  if (!val) return '';
  const [h,m] = val.split(':').map(Number);
  if (isNaN(h)||isNaN(m)) return '';
  return ((h%12)||12)+':'+String(m||0).padStart(2,'0')+' '+(h<12?'AM':'PM');
}

export function validateTaskDay(day) {
  if (!VALID_TASK_DAYS.includes(day)) {
    console.warn('Sandy Brain: invalid task day "'+day+'" converted to Anytime');
    return 'Anytime';
  }
  return day;
}

export function validateTaskDays(dayStr) {
  if (!dayStr) return 'Anytime';
  const parts = dayStr.split(',').map(d=>d.trim()).filter(Boolean);
  const valid = parts.filter(d=>VALID_TASK_DAYS.includes(d));
  if (valid.length===0) return 'Anytime';
  if (valid.length===1) return valid[0];
  return valid.join(',');
}

export function copyToClipboard(text) {
  if (navigator.clipboard&&navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(()=>showToast('Copied!','gt'))
      .catch(()=>showToast('Copy failed','yt'));
  } else { showToast('Copy not supported','yt'); }
}

export function safeLocalStorageSave(key, value) {
  try { localStorage.setItem(key, value); }
  catch(e) {
    if (e.name==='QuotaExceededError'||e.name==='NS_ERROR_DOM_QUOTA_REACHED') {
      try {
        // Clean up old fired-today keys before retrying
        const keysToRemove = [];
        for (let i=0; i<localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('firedToday_')||k.startsWith('midnightFired_'))) {
            const dateInKey = k.split('_').pop();
            if (dateInKey && dateInKey < yesterdayKey()) keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k=>localStorage.removeItem(k));
        localStorage.setItem(key, value);
      } catch(e2) {
        showToast('Storage full — some data may not persist locally','yt');
      }
    }
  }
}

// ─── UI utilities ─────────────────────────────────────────────────────────────

/**
 * Shows a transient toast notification.
 * @param {string} msg
 * @param {string} [cls] - 'gt' (green), 'yt' (yellow), 'rt' (red)
 */
export function showToast(msg, cls) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show '+(cls||'');
  const ar = document.getElementById('aria-announce');
  if (ar) ar.textContent = msg;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>{
    t.className = 'toast '+(cls||'');
    if (ar) ar.textContent = '';
  }, 3000);
}

let _confettiLock = false;

export function confetti() {
  if (_confettiLock) return;
  _confettiLock = true;
  setTimeout(()=>{ _confettiLock=false; }, 1500);
  ['🎉','⭐','✨','🎊','💫'].forEach((e,i)=>{
    setTimeout(()=>{
      if (document.hidden) return;
      const el = document.createElement('div');
      el.className = 'confetti-piece'; el.textContent = e;
      el.setAttribute('aria-hidden','true');
      el.style.cssText = 'left:'+Math.random()*85+'vw;top:'+(80+Math.random()*30)+'px;position:fixed;';
      document.body.appendChild(el);
      setTimeout(()=>el.remove(), 1200);
    }, i*120);
  });
}

export function isWeekend() {
  const d = new Date().getDay(); return d===0||d===6;
}

export function isToday(dateKey) { return dateKey===todayKey(); }
export function isYesterday(dateKey) { return dateKey===yesterdayKey(); }

export function getRelativeDate(dateKey) {
  if (isToday(dateKey)) return 'Today';
  if (isYesterday(dateKey)) return 'Yesterday';
  return formatDateShort(dateKey);
}

// ─── Task emoji mapping ────────────────────────────────────────────────────

export function getTaskEmoji(name) {
  if (!name) return '✅';
  const n = name.toLowerCase();
  if (/prayer|pray|namaz/.test(n)) return '🙏';
  if (/lemon|lime/.test(n)) return '🍋';
  if (/almond|walnut|nut/.test(n)) return '🌰';
  if (/amla/.test(n)) return '🍈';
  if (/egg/.test(n)) return '🥚';
  if (/fruit|apple|banana|papaya/.test(n)) return '🍎';
  if (/spinach|green|vegetable/.test(n)) return '🥦';
  if (/curd|yogurt|dahi/.test(n)) return '🥛';
  if (/seed|chia|flax/.test(n)) return '🌻';
  if (/sql|database|query|join/.test(n)) return '🗄️';
  if (/python|code|program/.test(n)) return '🐍';
  if (/excel|spreadsheet|pivot/.test(n)) return '📊';
  if (/resume|cv|linkedin/.test(n)) return '📄';
  if (/interview|mock/.test(n)) return '🎤';
  if (/apply|job|company/.test(n)) return '💼';
  if (/study|learn|course|revise/.test(n)) return '📚';
  if (/read|reading|english|article/.test(n)) return '📰';
  if (/face.?wash|wash|cleanse/.test(n)) return '🧴';
  if (/moistur/.test(n)) return '💆';
  if (/sunscreen|spf/.test(n)) return '☀️';
  if (/tablet|medicine|pill|hair tab/.test(n)) return '💊';
  if (/shampoo|keto/.test(n)) return '🚿';
  if (/sleep|bed|night/.test(n)) return '😴';
  if (/walk|step|exercise|gym/.test(n)) return '🏃';
  if (/water|hydrat|drink/.test(n)) return '💧';
  if (/lunch|dal|roti|rice/.test(n)) return '🍛';
  if (/dinner/.test(n)) return '🌙';
  if (/breakfast/.test(n)) return '🍳';
  if (/soak/.test(n)) return '🌊';
  if (/prep|ready|tomorrow/.test(n)) return '📦';
  if (/reminder/.test(n)) return '🔔';
  if (/laundry|cloth|clean/.test(n)) return '🧹';
  if (/project|portfolio/.test(n)) return '🗂️';
  if (/network|connect/.test(n)) return '🤝';
  return '✅';
}

export function getSectionEmoji(id, icon) {
  const map = {
    morning:'☀️', skin_am:'🧴', breakfast:'🍳', lunch:'🍛',
    water:'💧', evening:'🌆', dinner:'🌙', night:'🌃', prep:'📦'
  };
  return map[id]||icon||'📌';
}

// ─── Audio ────────────────────────────────────────────────────────────────────

let _audioCtx = null;
let _userInteracted = false;
let _audioIdleTimer = null;

document.addEventListener('click', ()=>{ _userInteracted=true; }, {once:true});
document.addEventListener('touchstart', ()=>{ _userInteracted=true; }, {once:true});

export function playCompletionTick() {
  if (!_userInteracted) return;
  if (typeof AudioContext==='undefined'&&typeof webkitAudioContext==='undefined') return;
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    if (_audioCtx.state==='suspended') _audioCtx.resume();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain); gain.connect(_audioCtx.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime+0.15);
    osc.start(_audioCtx.currentTime); osc.stop(_audioCtx.currentTime+0.15);
    clearTimeout(_audioIdleTimer);
    _audioIdleTimer = setTimeout(()=>{
      if (_audioCtx) { try{_audioCtx.close();}catch(e){} _audioCtx=null; }
    }, 5000);
  } catch(e) {}
}

// ─── Export everything to window (for inline HTML handlers) ──────────────────

Object.assign(window, {
  todayKey, yesterdayKey, daysBetween, sugarWeekStartOf, monthKey,
  currentMonthKey, formatDateShort, formatDateFull, todayStr,
  genId, sanitizeHTML, sanitizeRemoteString, sanitizeRemoteNumber,
  sanitizeRemoteBool, validateTimeString, formatTime12,
  validateTaskDay, validateTaskDays, copyToClipboard,
  safeLocalStorageSave, showToast, confetti, isWeekend, isToday,
  isYesterday, getRelativeDate, getTaskEmoji, getSectionEmoji,
  playCompletionTick, MONTHS, DAY_NAMES, VALID_TASK_DAYS
});
