/**
 * ═══════════════════════════════════════════════════════════════
 * tabs/junk.js — Junk food, sugar, and biryani tracker
 *
 * This module owns:
 * - Junk food category grid & selection
 * - Junk food logging & monthly stats
 * - Donut chart rendering
 * - Sugar weekly tracker (quick add, manual, gauge)
 * - Health impact panel
 * - Biryani monthly tracker
 * - Combined activity log with tab switching
 * - Week reset logic for sugar
 *
 * BUG FIXES APPLIED:
 * FIX-JNK-1: Week end boundary uses pure string comparison
 * FIX-JNK-2: Sugar recompute uses Math.max(0,...) with valid dateKey filter
 * FIX-JNK-3: jDaysLeft off-by-one fixed with Math.floor
 * FIX-JNK-4: jnkBuildCatGrid updates in-place, only rebuilds changed cards
 * FIX-JNK-5: biryaniLogInFlight reset only in finally block
 * FIX-JNK-6: confirmBiryaniLog re-entrance limit check
 * FIX-JNK-7: Donut chart floating-point drift fix
 * ═══════════════════════════════════════════════════════════════
 */

import {
  MONTHS,
  JNK_LIMIT,
  J_SUGAR_LIMIT,
  J_BIRY_LIMIT,
  todayKey,
  todayStr,
  currentMonthKey,
  monthKey,
  sugarWeekStartOf,
  sugarWeekEndKey,
  genId,
  sanitizeHTML,
  showToast
} from '../core/utils.js';

import { state, flags } from '../core/state.js';
import { debouncedSave, save } from '../core/firebase.js';
import { updateStatsBanner } from '../shared/theme.js';
import { onPageShow, onLightweightRefresh, onFullRefresh } from '../tabs/today.js';


/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const JNK_CATEGORIES = [
  { id: 'fried',    emoji: '🥟', name: 'Fried Snacks',     sub: 'Samosa, Kachori, Pakoda, etc.' },
  { id: 'chaat',    emoji: '🥘', name: 'Chaat',            sub: 'Pani Puri, Sev Puri, etc.' },
  { id: 'fastfood', emoji: '🍔', name: 'Fast Food',        sub: 'Burger, Pizza, Fries, etc.' },
  { id: 'chinese',  emoji: '🍜', name: 'Street Chinese',   sub: 'Noodles, Manchurian, etc.' },
  { id: 'rolls',    emoji: '🌯', name: 'Rolls / Shawarma', sub: 'Shawarma, Frankie, etc.' },
  { id: 'bakery',   emoji: '🍰', name: 'Bakery / Desserts', sub: 'Pastry, Donut, Cake, etc.' },
  { id: 'drinks',   emoji: '🥤', name: 'Sugary Drinks',    sub: 'Cold Drink, Soda, etc.' },
  { id: 'packaged', emoji: '🍟', name: 'Packaged Snacks',  sub: 'Chips, Kurkure, Chocolate, etc.' },
  { id: 'other',    emoji: '🍪', name: 'Other Junk',       sub: 'Anything unhealthy goes here' }
];

const JNK_DONUT_COLORS = [
  '#8b5cf6', '#f97316', '#ec4899', '#06b6d4',
  '#10b981', '#f59e0b', '#6366f1', '#ef4444', '#84cc16'
];

const DESSERT_IDS = ['bakery'];
const DRINK_IDS = ['drinks'];

/** Active log tab */
let _jActiveLog = 'sugar';


/* ═══════════════════════════════════════════════════════════════
   JUNK MONTH NAVIGATION
   ═══════════════════════════════════════════════════════════════ */

/**
 * Changes the junk food view month.
 * @param {number} d - Direction: -1 or +1
 */
export function jnkChangeMonth(d) {
  let m = (state.jnkViewMonth || 0) + d;
  let y = state.jnkViewYear || new Date().getFullYear();
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  state.jnkViewMonth = m;
  state.jnkViewYear = y;
  jnkRenderAll();
}


/* ═══════════════════════════════════════════════════════════════
   CATEGORY GRID
   FIX-JNK-4: Updates cards in-place, only rebuilds when needed
   ═══════════════════════════════════════════════════════════════ */

/**
 * Builds or updates the junk food category selection grid.
 */
export function jnkBuildCatGrid() {
  const grid = document.getElementById('jnk-cat-grid');
  if (!grid) return;
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) flags.jnkSelected = {};

  JNK_CATEGORIES.forEach(cat => {
    const qty = flags.jnkSelected[cat.id] || 0;
    const isSel = qty > 0;
    let card = grid.querySelector('[data-catid="' + cat.id + '"]');

    if (!card) {
      card = document.createElement('div');
      card.className = 'jnk-cat-card';
      card.dataset.catid = cat.id;
      card.setAttribute('role', 'checkbox');
      card.setAttribute('tabindex', '0');
      card.addEventListener('click', e => {
        if (e.target.closest('.jnk-qty-wrap')) return;
        jnkToggleCat(cat.id);
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jnkToggleCat(cat.id); }
      });
      grid.appendChild(card);
    }

    // Only update DOM if state changed
    const wasSelected = card.classList.contains('selected');
    const qtyEl = card.querySelector('.jnk-qty-display');
    if (wasSelected !== isSel || (qtyEl && qtyEl.textContent !== String(qty))) {
      card.classList.toggle('selected', isSel);
      card.setAttribute('aria-checked', isSel ? 'true' : 'false');
      card.setAttribute('aria-label', sanitizeHTML(cat.name || '') + (isSel ? ' — selected' : ''));

      card.innerHTML =
        '<div class="jnk-cat-emoji" aria-hidden="true">' + cat.emoji + '</div>' +
        '<div class="jnk-cat-body"><div class="jnk-cat-name">' + sanitizeHTML(cat.name || '') + '</div>' +
        '<div class="jnk-cat-sub">' + sanitizeHTML(cat.sub || '') + '</div></div>' +
        (isSel
          ? '<div class="jnk-qty-wrap">' +
              '<button class="jnk-qty-btn" aria-label="Decrease" data-action="jnk-qty" data-id="' + cat.id + '" data-delta="-1">-</button>' +
              '<span class="jnk-qty-display" aria-live="polite">' + qty + '</span>' +
              '<button class="jnk-qty-btn" aria-label="Increase" data-action="jnk-qty" data-id="' + cat.id + '" data-delta="1">+</button>' +
            '</div>'
          : '<div class="jnk-cat-toggle" aria-hidden="true">+</div>');
    }
  });

  flags.jnkGridBuilt = true;
}


/* ═══════════════════════════════════════════════════════════════
   CATEGORY SELECTION
   ═══════════════════════════════════════════════════════════════ */

export function jnkToggleCat(id) {
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) flags.jnkSelected = {};
  if (flags.jnkSelected[id]) delete flags.jnkSelected[id];
  else flags.jnkSelected[id] = 1;
  jnkBuildCatGrid();
  jnkRenderChips();
}

export function jnkSetQty(id, delta) {
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) flags.jnkSelected = {};
  if (!flags.jnkSelected[id]) flags.jnkSelected[id] = 1;
  flags.jnkSelected[id] = Math.max(1, (flags.jnkSelected[id] || 1) + delta);
  jnkBuildCatGrid();
  jnkRenderChips();
}

export function jnkRemoveChip(id) {
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) flags.jnkSelected = {};
  delete flags.jnkSelected[id];
  jnkBuildCatGrid();
  jnkRenderChips();
  jnkRenderAll();
}


/* ═══════════════════════════════════════════════════════════════
   CHIPS RENDERING
   ═══════════════════════════════════════════════════════════════ */

export function jnkRenderChips() {
  const area = document.getElementById('jnk-chips-area');
  const empty = document.getElementById('jnk-empty-chips');
  const btn = document.getElementById('jnk-log-btn');
  const count = document.getElementById('jnk-sel-count');
  if (!area) return;
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) flags.jnkSelected = {};

  area.querySelectorAll('.jnk-chip').forEach(c => c.remove());
  const keys = Object.keys(flags.jnkSelected);
  const totalQty = Object.values(flags.jnkSelected).reduce((s, v) => s + v, 0);

  if (!keys.length) {
    if (empty) empty.style.display = 'block';
    if (btn) { btn.disabled = true; btn.textContent = 'Log 0 Junk Items'; }
    if (count) count.textContent = '(0 items)';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (count) count.textContent = '(' + totalQty + ' item' + (totalQty !== 1 ? 's' : '') + ')';
  if (btn) { btn.disabled = false; btn.textContent = 'Log ' + totalQty + ' Junk Item' + (totalQty !== 1 ? 's' : ''); }

  keys.forEach(id => {
    const cat = JNK_CATEGORIES.find(c => c.id === id);
    if (!cat) return;
    const qty = flags.jnkSelected[id];
    const chip = document.createElement('div');
    chip.className = 'jnk-chip';
    chip.setAttribute('role', 'listitem');
    chip.innerHTML = cat.emoji + ' ' + sanitizeHTML(cat.name || '') +
      (qty > 1 ? ' <strong>x' + qty + '</strong>' : '') +
      '<button class="jnk-chip-remove" aria-label="Remove ' + sanitizeHTML(cat.name || '') + '" ' +
      'data-action="jnk-remove-chip" data-id="' + id + '">x</button>';
    area.appendChild(chip);
  });
}


/* ═══════════════════════════════════════════════════════════════
   JUNK LOGGING
   ═══════════════════════════════════════════════════════════════ */

export function jnkLogItems() {
  if (!flags.jnkSelected || Array.isArray(flags.jnkSelected)) flags.jnkSelected = {};
  const keys = Object.keys(flags.jnkSelected);
  if (!keys.length) return;

  const now = new Date();
  const curMk = currentMonthKey();
  const todayK = todayKey();
  const monthEntries = (state.junkLog || []).filter(e => e.monthKey === curMk);
  const totalQty = Object.values(flags.jnkSelected).reduce((s, v) => s + v, 0);

  if (monthEntries.length + totalQty > JNK_LIMIT) {
    showToast('This would exceed the monthly junk limit of ' + JNK_LIMIT + '!', 'rt');
    return;
  }

  const todayEntries = (state.junkLog || []).filter(e => e.dateKey === todayK);
  if (todayEntries.length > 0) {
    if (!confirm('You already logged junk today. Log again?')) return;
  }

  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const displayDate = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  keys.forEach(id => {
    const qty = flags.jnkSelected[id] || 1;
    const cat = JNK_CATEGORIES.find(c => c.id === id);
    if (!cat) return;
    for (let i = 0; i < qty; i++) {
      if (!state.junkLog) state.junkLog = [];
      state.junkLog.push({
        id: genId(), categories: [id], names: [cat.name], emojis: [cat.emoji],
        qty: 1, date: displayDate, dateKey: todayK, timeStr,
        monthKey: curMk, isDessert: DESSERT_IDS.includes(id), isDrink: DRINK_IDS.includes(id)
      });
    }
  });

  flags.jnkSelected = {};
  flags.jnkGridBuilt = false;
  jnkBuildCatGrid();
  jnkRenderChips();
  debouncedSave();
  updateStatsBanner();
  jnkRenderAll();

  const newCount = (state.junkLog || []).filter(e => e.monthKey === curMk).length;
  showToast(newCount >= JNK_LIMIT ? 'Monthly limit hit!' : 'Logged! Stay aware.', newCount >= JNK_LIMIT ? 'rt' : 'gt');
}

export function jnkDeleteEntry(id) {
  if (!confirm('Remove this junk entry?')) return;
  state.junkLog = (state.junkLog || []).filter(e => e.id !== id);
  debouncedSave();
  updateStatsBanner();
  jnkRenderAll();
  jnkRenderChips();
  showToast('Entry removed.');
}

export function jnkOpenSummary() {
  const el = document.querySelector('.jnk-bottom-grid');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}


/* ═══════════════════════════════════════════════════════════════
   JUNK RENDER ALL
   ═══════════════════════════════════════════════════════════════ */

export function jnkRenderAll() {
  const vm = state.jnkViewMonth || 0;
  const vy = state.jnkViewYear || new Date().getFullYear();
  const mk = monthKey(vm, vy);
  const curMk = currentMonthKey();

  const lbl = document.getElementById('jnk-month-label');
  if (lbl) lbl.textContent = MONTHS[vm] + ' ' + vy;

  const entries = (state.junkLog || []).filter(e => e.monthKey === mk);
  const totalUnits = entries.length;
  const dessertUnits = entries.filter(e => e.isDessert).length;
  const drinkEntries = entries.filter(e => e.isDrink).length;
  const junkDays = new Set(entries.map(e => e.dateKey)).size;

  // Stats cards
  _updateStatCard('jnk-val-units', String(totalUnits));
  _updateBarAndBadge('jnk-bar-units', 'jnk-badge-units',
    Math.min(100, (totalUnits / JNK_LIMIT) * 100),
    'linear-gradient(90deg,#8b5cf6,#a78bfa)',
    totalUnits >= JNK_LIMIT ? 'Over Limit' : totalUnits >= JNK_LIMIT - 1 ? 'Caution' : 'On Track',
    totalUnits >= JNK_LIMIT ? 'danger' : totalUnits >= JNK_LIMIT - 1 ? 'warn' : 'safe'
  );

  const drkMl = drinkEntries * 250;
  _updateStatCard('jnk-val-drinks', drkMl + ' ml');
  _updateStatCard('jnk-val-dessert', String(dessertUnits));
  _updateStatCard('jnk-val-days', String(junkDays));

  // Trend
  const prevM = vm === 0 ? 11 : vm - 1;
  const prevY = vm === 0 ? vy - 1 : vy;
  const prevMk = monthKey(prevM, prevY);
  const prevCnt = (state.junkLog || []).filter(e => e.monthKey === prevMk).length;
  const trendEl = document.getElementById('jnk-val-trend');

  if (prevCnt > 0 && mk === curMk) {
    const diff = prevCnt - totalUnits;
    const pct = Math.abs(Math.round((diff / prevCnt) * 100));
    if (trendEl) { trendEl.textContent = pct + '%'; trendEl.style.color = diff >= 0 ? '#16a34a' : '#ef4444'; }
  } else {
    if (trendEl) { trendEl.textContent = '—'; trendEl.style.color = '#9c87d4'; }
  }

  _renderDonut(entries);
  _renderActivity(entries);

  // Summary stats
  const dn = document.getElementById('jnk-donut-num');
  if (dn) dn.textContent = String(totalUnits);
}


/* ═══════════════════════════════════════════════════════════════
   SUGAR TRACKER
   FIX-JNK-1: Week end boundary uses string comparison
   FIX-JNK-2: Recompute uses Math.max(0,...) and valid dateKeys
   FIX-JNK-3: jDaysLeft off-by-one fix
   ═══════════════════════════════════════════════════════════════ */

/**
 * Checks if the sugar week should reset and recalculates if needed.
 */
export function jCheckWeekReset() {
  const ws = sugarWeekStartOf(new Date());
  if (state.sugarWeekStart === ws) return;
  state.sugarWeekStart = ws;

  const wsEnd = sugarWeekEndKey(ws);
  state.weeklyGrams = Math.max(0,
    (state.sugarLog || [])
      .filter(e => e.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey) &&
        e.dateKey >= ws &&
        e.dateKey < wsEnd)
      .reduce((sum, e) => sum + (e.grams || 0), 0)
  );

  debouncedSave(500);
  if (document.getElementById('j-sugar-big')) jRenderSugar();
  updateStatsBanner();
}

/**
 * Returns days left in the current sugar week.
 * FIX-JNK-3: Uses Math.floor to avoid off-by-one.
 */
function jDaysLeft() {
  const end = new Date(state.sugarWeekStart + 'T00:00:00');
  end.setDate(end.getDate() + 7);
  const diff = end - new Date();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86400000);
}

function jWeekRange() {
  const s = new Date(state.sugarWeekStart + 'T00:00:00');
  const e = new Date(state.sugarWeekStart + 'T00:00:00');
  e.setDate(e.getDate() + 6);
  const f = d => d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  return f(s) + ' – ' + f(e);
}

/**
 * Adds a sugar entry.
 */
export function jAddSugar(name, icon, g) {
  jCheckWeekReset();
  const prev = state.weeklyGrams;
  state.weeklyGrams = (state.weeklyGrams || 0) + g;

  if (!state.sugarLog) state.sugarLog = [];
  state.sugarLog.push({
    id: genId(), name, icon, grams: g,
    date: todayStr(), dateKey: todayKey(),
    ts: Date.now(), weekStart: state.sugarWeekStart,
    exceeded: state.weeklyGrams > J_SUGAR_LIMIT
  });

  debouncedSave();
  jRenderSugar();
  jRenderLogs();
  updateStatsBanner();

  if (state.weeklyGrams > J_SUGAR_LIMIT && prev <= J_SUGAR_LIMIT) showToast('Limit crossed — damage mode!', 'rt');
  else if (state.weeklyGrams > 40 && prev <= 40) showToast('Almost at weekly limit!', 'yt');
  else showToast('+' + g + 'g added to weekly sugar', 'yt');
}

export function jAddManualSugar() {
  const nameEl = document.getElementById('j-manual-name');
  const gEl = document.getElementById('j-manual-g');
  const name = nameEl ? (nameEl.value.trim() || 'Custom') : 'Custom';
  const g = parseInt(gEl ? gEl.value : 0);
  if (!g || g < 1 || g > 300) { showToast('Enter a valid gram amount (1-300)', 'yt'); return; }
  jAddSugar(name, '🔢', g);
  if (nameEl) nameEl.value = '';
  if (gEl) gEl.value = '';
}

/**
 * Deletes a sugar entry and recalculates weekly total.
 * FIX-JNK-2: Recalculates using only valid dateKey entries.
 */
export function jDeleteSugar(id) {
  const entry = (state.sugarLog || []).find(e => e.id === id);
  if (!entry) { showToast('Entry not found'); return; }
  state.sugarLog = (state.sugarLog || []).filter(e => e.id !== id);

  const wsEnd = sugarWeekEndKey(state.sugarWeekStart);
  state.weeklyGrams = Math.max(0,
    (state.sugarLog || [])
      .filter(e => e.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey) &&
        e.dateKey >= state.sugarWeekStart &&
        e.dateKey < wsEnd)
      .reduce((sum, e) => sum + (e.grams || 0), 0)
  );

  debouncedSave();
  jRenderSugar();
  jRenderLogs();
  updateStatsBanner();
  showToast('Entry removed — weekly total recalculated.');
}

/**
 * Renders the sugar tracker UI (gauge, bars, health panel).
 */
export function jRenderSugar() {
  jCheckWeekReset();
  const g = state.weeklyGrams || 0;
  const pct = Math.min(100, (g / J_SUGAR_LIMIT) * 100);
  const circ = 264;
  const offs = circ - (pct / 100) * circ;

  let col, zone;
  if (g > J_SUGAR_LIMIT) { col = '#ef4444'; zone = 'r'; }
  else if (g > 25) { col = '#f59e0b'; zone = 'y'; }
  else { col = '#22c55e'; zone = 'g'; }

  _setText('j-sugar-big', g + 'g');
  const bigEl = document.getElementById('j-sugar-big');
  if (bigEl) bigEl.className = 'sugar-big ' + zone;

  _setText('j-sugar-fraction', g + ' / 50g');

  const daysLeftVal = jDaysLeft();
  _setText('j-days-left', daysLeftVal === 0 ? 'tonight' : String(daysLeftVal));
  _setText('j-week-range', jWeekRange());

  const bd = document.getElementById('j-sugar-badge');
  if (bd) { bd.textContent = zone === 'r' ? 'Danger Zone' : zone === 'y' ? 'Caution' : 'Safe Zone'; bd.className = 'sugar-badge ' + zone; }

  const mc = document.getElementById('j-meter-circle');
  if (mc) { mc.setAttribute('stroke-dashoffset', offs); mc.setAttribute('stroke', col); }

  const mp = document.getElementById('j-meter-pct');
  if (mp) { mp.textContent = Math.round(pct) + '%'; mp.className = 'circ-pct ' + zone; }

  const sb = document.getElementById('j-sugar-bar');
  if (sb) { sb.style.width = Math.min(100, pct) + '%'; sb.style.background = col; }

  _setText('j-log-total', g + 'g');

  // Health panel
  const hp = document.getElementById('j-health-panel');
  const hpt = document.getElementById('j-hp-title');
  const hpi = document.getElementById('j-hp-items');
  if (hp) hp.className = 'health-panel ' + zone;
  if (hpt && hpi) {
    if (g <= 25) {
      hpt.textContent = 'Liver and Immunity Status — Good';
      hpi.innerHTML = '<div class="hp-item">Liver under control — minimal fat storage</div><div class="hp-item">Low inflammation levels</div><div class="hp-item">Throat bacteria not being fed</div><div class="hp-item">Immune system functioning normally</div>';
    } else if (g <= J_SUGAR_LIMIT) {
      hpt.textContent = 'Early Warning Signs';
      hpi.innerHTML = '<div class="hp-item">Liver starting to store fat (early stage)</div><div class="hp-item">Mild inflammation rising</div><div class="hp-item">Throat bacteria getting fuel — tonsil risk building</div>';
    } else {
      hpt.textContent = 'Active Damage Mode';
      hpi.innerHTML = '<div class="hp-item">Fatty liver worsening — fat accumulation accelerating</div><div class="hp-item">Throat bacteria feeding — tonsil infection risk HIGH</div><div class="hp-item">Systemic inflammation elevated</div>';
    }
  }

  // Condition warnings
  const cw = document.getElementById('j-cond-wrap');
  const db2 = document.getElementById('j-danger-box');
  const disc = document.getElementById('j-disc-banner');
  if (cw) cw.style.display = g > 30 ? 'block' : 'none';
  if (db2) db2.style.display = g > J_SUGAR_LIMIT ? 'block' : 'none';
  if (disc) {
    const tw = (state.sugarLog || []).filter(e => (e.weekStart || state.sugarWeekStart) === state.sugarWeekStart);
    disc.className = 'disc-banner' + (g <= 15 && tw.length >= 1 ? ' show' : '');
  }
}


/* ═══════════════════════════════════════════════════════════════
   BIRYANI TRACKER
   FIX-JNK-5: biryaniLogInFlight reset only in finally block
   FIX-JNK-6: confirmBiryaniLog re-entrance limit check
   ═══════════════════════════════════════════════════════════════ */

function jBKey() {
  return monthKey(state.jBViewM || 0, state.jBViewY || new Date().getFullYear());
}

function jBCurrentKey() { return currentMonthKey(); }

function jBCount(mk) {
  const e = (state.biryLog || []).find(x => x.monthKey === mk);
  return e ? (e.entries || []).length : 0;
}

export function jChangeBMonth(d) {
  let m = (state.jBViewM || 0) + d;
  let y = state.jBViewY || new Date().getFullYear();
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  state.jBViewM = m;
  state.jBViewY = y;
  jRenderBiryani();
}

export function jLogBiryani() {
  if (flags.biryaniLogInFlight) return;
  const curMk = jBCurrentKey();
  const viewMk = jBKey();
  if (viewMk !== curMk) { showToast('Switch to current month to log biryani', 'yt'); return; }
  const cnt = jBCount(curMk);
  if (cnt >= J_BIRY_LIMIT) { showToast('Max ' + J_BIRY_LIMIT + ' biryanis this month!', 'rt'); return; }
  _openBiryaniConfirm();
}

function _openBiryaniConfirm() {
  const curMk = jBCurrentKey();
  const cnt = jBCount(curMk);
  const body = document.getElementById('biryani-confirm-body');
  if (body) body.textContent = 'You have eaten ' + cnt + ' of 2 allowed this month.';
  const modal = document.getElementById('biryani-confirm-modal');
  if (modal) { modal.classList.add('open'); const btn = modal.querySelector('button'); if (btn) btn.focus(); }
}

export function closeBiryaniConfirm() {
  const m = document.getElementById('biryani-confirm-modal');
  if (m) m.classList.remove('open');
  if (flags.biryaniLogInFlight) {
    setTimeout(() => { flags.biryaniLogInFlight = false; }, 5000);
  }
}

/**
 * Confirms and logs a biryani entry.
 * FIX-JNK-5: Flag reset in finally block.
 * FIX-JNK-6: Limit check before logging.
 */
export async function confirmBiryaniLog() {
  if (flags.biryaniLogInFlight) return;
  flags.biryaniLogInFlight = true;

  try {
    closeBiryaniConfirm();
    const curMk = jBCurrentKey();
    let entry = (state.biryLog || []).find(x => x.monthKey === curMk);
    const currentCount = entry ? (entry.entries || []).length : 0;

    // FIX-JNK-6: Check limit before logging
    if (currentCount >= J_BIRY_LIMIT) {
      showToast('Monthly limit already reached!', 'rt');
      return;
    }

    if (!entry) {
      if (!state.biryLog) state.biryLog = [];
      entry = { monthKey: curMk, count: 0, entries: [] };
      state.biryLog.push(entry);
    }
    if (!entry.entries) entry.entries = [];
    entry.entries.push({ id: genId(), date: todayStr(), dateKey: todayKey() });
    entry.count = entry.entries.length;

    await save();
    jRenderBiryani();
    jRenderLogs();

    showToast(
      entry.count >= J_BIRY_LIMIT ? 'Biryani limit reached for this month!' : 'Biryani logged! Enjoy every grain.',
      entry.count >= J_BIRY_LIMIT ? 'yt' : 'gt'
    );
  } finally {
    // FIX-JNK-5: Always reset in finally
    flags.biryaniLogInFlight = false;
  }
}

export function jDeleteBiryani(mKey, entryId) {
  if (!confirm('Remove this biryani entry?')) return;
  const month = (state.biryLog || []).find(x => x.monthKey === mKey);
  if (!month) return;
  month.entries = (month.entries || []).filter(e => e.id !== entryId);
  month.count = month.entries.length;
  if (month.count === 0) state.biryLog = state.biryLog.filter(x => x.monthKey !== mKey);
  debouncedSave();
  jRenderBiryani();
  jRenderLogs();
  showToast('Biryani entry removed.');
}

export function jRenderBiryani() {
  const viewMk = jBKey();
  const curMk = jBCurrentKey();
  const cnt = jBCount(viewMk);
  const rem = J_BIRY_LIMIT - cnt;
  const vm = state.jBViewM || 0;
  const vy = state.jBViewY || new Date().getFullYear();

  _setText('j-b-month', MONTHS[vm] + ' ' + vy);
  _setText('j-b-count', String(cnt));
  _setText('j-b-eaten', String(cnt));
  _setText('j-b-rem', rem > 0 ? rem + ' remaining' : 'Limit reached');

  const bb = document.getElementById('j-b-bar');
  if (bb) { bb.style.width = Math.min(100, (cnt / J_BIRY_LIMIT) * 100) + '%'; bb.style.background = cnt >= J_BIRY_LIMIT ? '#ef4444' : '#f59e0b'; }

  // Slots
  const curCnt = jBCount(curMk);
  const isCurrent = viewMk === curMk;
  const isLimit = isCurrent && curCnt >= J_BIRY_LIMIT;

  const slot1 = document.getElementById('b-slot-1');
  const slot2 = document.getElementById('b-slot-2');
  if (slot1) slot1.className = 'b-slot' + (cnt >= 1 ? (isLimit ? ' limit' : ' filled') : '');
  if (slot2) slot2.className = 'b-slot' + (cnt >= 2 ? (isLimit ? ' limit' : ' filled') : '');

  // Log row state
  const row = document.getElementById('biry-log-row');
  if (row) {
    const atLimit = isCurrent && curCnt >= J_BIRY_LIMIT;
    if (!isCurrent || atLimit) {
      row.style.opacity = '0.45';
      row.style.pointerEvents = 'none';
      row.setAttribute('aria-disabled', 'true');
    } else {
      row.style.opacity = '1';
      row.style.pointerEvents = 'auto';
      row.removeAttribute('aria-disabled');
    }
  }
}


/* ═══════════════════════════════════════════════════════════════
   LOG TAB SWITCHING & RENDERING
   ═══════════════════════════════════════════════════════════════ */

export function jSwitchLog(t) {
  _jActiveLog = t;
  ['sugar', 'junk', 'biry'].forEach(x => {
    const tab = document.getElementById('jlt-' + x);
    const panel = document.getElementById('jlog-' + x);
    if (tab) { tab.className = 'log-tab-btn' + (t === x ? ' active' : ''); tab.setAttribute('aria-pressed', t === x ? 'true' : 'false'); }
    if (panel) panel.style.display = t === x ? 'block' : 'none';
  });
  jRenderLogs();
}

export function jRenderLogs() {
  const wsEnd = sugarWeekEndKey(state.sugarWeekStart);
  const weekEntries = (state.sugarLog || [])
    .filter(e => e.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey) && e.dateKey >= state.sugarWeekStart && e.dateKey < wsEnd)
    .slice().reverse();

  _setText('j-log-total', (state.weeklyGrams || 0) + 'g');

  // Sugar log
  const sl = document.getElementById('j-sugar-log-list');
  if (sl) {
    if (!weekEntries.length) { sl.innerHTML = '<div class="tempty">No sugar entries this week</div>'; }
    else {
      sl.innerHTML = weekEntries.map(e => {
        const bc = e.grams >= 15 ? 'hi' : e.grams >= 8 ? 'mid' : 'low';
        const tag = e.exceeded ? '<span class="le-tag exceeded">Limit Exceeded</span>' : e.grams >= 15 ? '<span class="le-tag highsugar">High Sugar</span>' : '';
        return '<div class="j-log-entry" role="listitem">' +
          '<div style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">' + e.icon + '</div>' +
          '<div style="flex:1;"><div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + sanitizeHTML(e.name || '') + '</div>' +
          '<div style="font-size:10px;color:#bbb;">' + sanitizeHTML(e.date || '') + '</div></div>' +
          '<span class="le-badge ' + bc + '">+' + e.grams + 'g</span>' + tag +
          '<button class="le-del-btn" aria-label="Delete entry" data-action="delete-sugar" data-id="' + e.id + '">x</button></div>';
      }).join('');
    }
  }

  // Junk log
  const jl = document.getElementById('j-junk-log-list');
  const all = state.junkLog || [];
  if (jl) {
    if (!all.length) { jl.innerHTML = '<div class="tempty">No junk food entries yet</div>'; }
    else {
      jl.innerHTML = all.slice().reverse().map(e => {
        const mainEmoji = e.emojis && e.emojis[0] ? e.emojis[0] : '🛍️';
        return '<div class="j-log-entry" role="listitem">' +
          '<div style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">' + mainEmoji + '</div>' +
          '<div style="flex:1;"><div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + sanitizeHTML((e.names || []).join(', ') || '') + '</div>' +
          '<div style="font-size:10px;color:#bbb;">' + sanitizeHTML(e.date || '') + '</div></div>' +
          '<span style="font-size:10px;background:#f5f3ff;color:#7c3aed;border-radius:9px;padding:2px 7px;font-weight:700;">' + sanitizeHTML(e.monthKey || '') + '</span>' +
          '<button class="le-del-btn" aria-label="Delete entry" data-action="jnk-delete" data-id="' + e.id + '">x</button></div>';
      }).join('');
    }
  }

  // Biryani log
  const bl = document.getElementById('j-biry-log-list');
  if (bl) {
    const allB = [];
    (state.biryLog || []).forEach(m => {
      (m.entries || []).forEach(e => { allB.push({ id: e.id, date: e.date, dateKey: e.dateKey, monthKey: m.monthKey }); });
    });
    allB.sort((a, b) => (b.dateKey || b.date || '').localeCompare(a.dateKey || a.date || ''));

    if (!allB.length) { bl.innerHTML = '<div class="tempty">No biryani entries yet</div>'; }
    else {
      bl.innerHTML = allB.map(e =>
        '<div class="j-log-entry" role="listitem">' +
        '<div style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">🍛</div>' +
        '<div style="flex:1;"><div style="font-size:12px;font-weight:700;color:var(--text-primary);">Biryani</div>' +
        '<div style="font-size:10px;color:#bbb;">' + sanitizeHTML(e.date || '') + '</div></div>' +
        '<span class="le-badge mid">' + sanitizeHTML(e.monthKey || '') + '</span>' +
        '<button class="le-del-btn" aria-label="Delete biryani entry" ' +
        'data-action="delete-biryani" data-month-key="' + e.monthKey + '" data-id="' + e.id + '">x</button></div>'
      ).join('');
    }
  }
}


/* ═══════════════════════════════════════════════════════════════
   PRIVATE RENDER HELPERS
   ═══════════════════════════════════════════════════════════════ */

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function _updateStatCard(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _updateBarAndBadge(barId, badgeId, pct, color, badgeText, level) {
  const bar = document.getElementById(barId);
  if (bar) { bar.style.width = pct + '%'; bar.style.background = color; }

  const badge = document.getElementById(badgeId);
  if (badge) {
    badge.textContent = badgeText;
    const styles = {
      safe: 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;',
      warn: 'background:#fffbeb;color:#d97706;border:1px solid #fde68a;',
      danger: 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;'
    };
    badge.style.cssText = (styles[level] || styles.safe) + 'font-size:9px;font-weight:700;padding:3px 8px;border-radius:999px;';
  }
}

/**
 * Renders the donut chart.
 * FIX-JNK-7: Accumulates dashes with fixed-point arithmetic.
 */
function _renderDonut(entries) {
  const svg = document.getElementById('jnk-donut-svg');
  const legend = document.getElementById('jnk-legend');
  if (!svg || !legend) return;

  const counts = {};
  JNK_CATEGORIES.forEach(c => { counts[c.id] = 0; });
  entries.forEach(e => { (e.categories || []).forEach(cid => { counts[cid] = (counts[cid] || 0) + 1; }); });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const used = JNK_CATEGORIES.filter(c => counts[c.id] > 0);

  svg.innerHTML = '<circle cx="55" cy="55" r="42" fill="none" stroke="#f3f4f6" stroke-width="14"/>';
  legend.innerHTML = '';

  if (!total) {
    legend.innerHTML = '<div style="font-size:12px;color:#c4b5fd;font-weight:600;font-style:italic;">No entries this month</div>';
    return;
  }

  // FIX-JNK-7: Fixed-point arithmetic for dash lengths
  const CIRC = 2 * Math.PI * 42;
  let totalDashAccum = 0;
  const dashes = used.map((cat, i) => {
    if (i === used.length - 1) return CIRC - totalDashAccum;
    const d = Math.round((counts[cat.id] / total) * CIRC * 1000) / 1000;
    totalDashAccum += d;
    return d;
  });

  let offset = 0;
  used.forEach((cat, i) => {
    const dash = dashes[i];
    if (dash < 0.5) { offset += dash; return; }
    const gap = CIRC - dash;
    const color = JNK_DONUT_COLORS[i % JNK_DONUT_COLORS.length];

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', 55);
    circle.setAttribute('cy', 55);
    circle.setAttribute('r', 42);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', 14);
    circle.setAttribute('stroke-dasharray', dash + ' ' + gap);
    circle.setAttribute('stroke-dashoffset', CIRC - offset);
    circle.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(circle);
    offset += dash;

    const li = document.createElement('div');
    li.className = 'jnk-legend-item';
    li.setAttribute('role', 'listitem');
    li.innerHTML = '<div class="jnk-legend-dot" style="background:' + color + ';" aria-hidden="true"></div>' +
      cat.emoji + ' ' + sanitizeHTML(cat.name || '') +
      '<span class="jnk-legend-pct">' + counts[cat.id] + ' (' + Math.round((counts[cat.id] / total) * 100) + '%)</span>';
    legend.appendChild(li);
  });
}

function _renderActivity(entries) {
  const list = document.getElementById('jnk-activity-list');
  if (!list) return;
  const recent = entries.slice().reverse().slice(0, 6);

  if (!recent.length) {
    list.innerHTML = '<div style="text-align:center;padding:28px 0;font-size:13px;color:#c4b5fd;font-weight:600;">No entries this month. Keep it clean!</div>';
    return;
  }

  list.innerHTML = '';
  recent.forEach(e => {
    const mainEmoji = e.emojis && e.emojis[0] ? e.emojis[0] : '🛍️';
    const title = sanitizeHTML((e.names || []).join(', ') || 'Junk Food');
    const isToday_ = e.dateKey === todayKey();
    const timeLabel = sanitizeHTML((isToday_ ? 'Today, ' : (e.date || '') + ', ') + e.timeStr);

    const item = document.createElement('div');
    item.className = 'jnk-activity-item';
    item.setAttribute('role', 'listitem');
    item.innerHTML =
      '<div class="jnk-activity-icon" aria-hidden="true">' + mainEmoji + '</div>' +
      '<div class="jnk-activity-body"><div class="jnk-activity-title">' + title + '</div><div class="jnk-activity-sub">' + sanitizeHTML((e.categories || []).join(', ')) + '</div></div>' +
      '<div class="jnk-activity-right">' +
      '<div class="jnk-activity-time">' + timeLabel + '</div>' +
      '<button class="jnk-del-btn" data-action="jnk-delete" data-id="' + e.id + '" aria-label="Delete this entry">x</button></div>';
    list.appendChild(item);
  });
}


/* ═══════════════════════════════════════════════════════════════
   EVENT BINDING
   ═══════════════════════════════════════════════════════════════ */

export function bindJunkEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;

    switch (el.dataset.action) {
      case 'jnk-month': jnkChangeMonth(+el.dataset.dir); break;
      case 'jnk-qty': e.stopPropagation(); jnkSetQty(el.dataset.id, +el.dataset.delta); break;
      case 'jnk-remove-chip': jnkRemoveChip(el.dataset.id); break;
      case 'jnk-delete': jnkDeleteEntry(el.dataset.id); break;
      case 'add-sugar': jAddSugar(el.dataset.name, el.dataset.icon, +el.dataset.grams); break;
      case 'delete-sugar': jDeleteSugar(el.dataset.id); break;
      case 'biry-month': jChangeBMonth(+el.dataset.dir); break;
      case 'delete-biryani': jDeleteBiryani(el.dataset.monthKey, el.dataset.id); break;
      case 'jnk-switch-log': jSwitchLog(el.dataset.tab); break;
    }
  });

  // Log button
  document.addEventListener('click', e => {
    if (e.target && (e.target.id === 'jnk-log-btn' || e.target.closest('#jnk-log-btn'))) {
      jnkLogItems();
    }
  });

  // Manual sugar add
  document.addEventListener('click', e => {
    if (e.target && e.target.closest('[data-action="j-manual-add"]')) {
      jAddManualSugar();
    }
  });

  // Biryani log row click
  document.addEventListener('click', e => {
    if (e.target && e.target.closest('#biry-log-row')) {
      jLogBiryani();
    }
  });

  // Biryani confirm/cancel
  document.addEventListener('click', e => {
    if (e.target && (e.target.id === 'biryani-confirm-btn' || e.target.closest('#biryani-confirm-btn'))) {
      confirmBiryaniLog();
    }
  });
}


/* ═══════════════════════════════════════════════════════════════
   PAGE INIT & REGISTRATION
   ═══════════════════════════════════════════════════════════════ */

function _initJunkPage() {
  const nowJ = new Date();
  state.jnkViewMonth = nowJ.getMonth();
  state.jnkViewYear = nowJ.getFullYear();

  if (!flags.jnkGridBuilt && Object.keys(flags.jnkSelected).length === 0) {
    flags.jnkSelected = {};
  }

  jnkBuildCatGrid();
  jnkRenderChips();
  jnkRenderAll();
  jRenderSugar();
  jRenderBiryani();
  jRenderLogs();

  setTimeout(() => {
    const jPage = document.getElementById('page-junk');
    if (jPage) jPage.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
}

// Register with navigation system
onPageShow('junk', _initJunkPage);

// Register refresh callbacks
onLightweightRefresh(() => {
  jnkRenderAll();
  jRenderSugar();
  jRenderBiryani();
});

onFullRefresh(() => {
  jRenderLogs();
});
