/* ═══════════════════════════════════════════════════════════════
   tabs/junk.js
   Junk food tracker, weekly sugar tracker, biryani tracker,
   activity logs, health panels, analytics donut chart.
   Depends on: core/state.js, core/utils.js, core/firebase.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  /* flags */
  jnkSelected,    setJnkSelected,
  jnkGridBuilt,   setJnkGridBuilt,
  jActiveLog,     setJActiveLog,
  biryaniLogInFlight, setBiryaniLogInFlight
} from '../core/state.js';

import {
  todayKey,
  todayStr,
  monthKey,
  currentMonthKey,
  sugarWeekStartOf,
  MONTHS,
  sanitizeHTML,
  showToast,
  genId,
  formatDateShort
} from '../core/utils.js';

import {
  debouncedSave,
  save
} from '../core/firebase.js';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────*/
const JNK_CATEGORIES = [
  { id: 'fried',    emoji: '🥟', name: 'Fried Snacks',    sub: 'Samosa, Kachori, Pakoda, etc.'   },
  { id: 'chaat',    emoji: '🥘', name: 'Chaat',           sub: 'Pani Puri, Sev Puri, etc.'       },
  { id: 'fastfood', emoji: '🍔', name: 'Fast Food',       sub: 'Burger, Pizza, Fries, etc.'      },
  { id: 'chinese',  emoji: '🍜', name: 'Street Chinese',  sub: 'Noodles, Manchurian, etc.'       },
  { id: 'rolls',    emoji: '🌯', name: 'Rolls / Shawarma',sub: 'Shawarma, Frankie, etc.'         },
  { id: 'bakery',   emoji: '🍰', name: 'Bakery / Desserts',sub: 'Pastry, Donut, Cake, etc.'      },
  { id: 'drinks',   emoji: '🥤', name: 'Sugary Drinks',   sub: 'Cold Drink, Soda, etc.'         },
  { id: 'packaged', emoji: '🍟', name: 'Packaged Snacks', sub: 'Chips, Kurkure, Chocolate, etc.' },
  { id: 'other',    emoji: '🍪', name: 'Other Junk',      sub: 'Anything unhealthy goes here'    }
];

const JNK_DONUT_COLORS = [
  '#8b5cf6','#f97316','#ec4899','#06b6d4',
  '#10b981','#f59e0b','#6366f1','#ef4444','#84cc16'
];

const DESSERT_IDS  = ['bakery'];
const DRINK_IDS    = ['drinks'];
const JNK_LIMIT    = 4;
const J_SUGAR_LIMIT= 50;
const J_BIRY_LIMIT = 2;

/* ─────────────────────────────────────────────────────────────
   MONTH HELPERS
───────────────────────────────────────────────────────────────*/
function jnkCurrentMKey() { return currentMonthKey(); }
function jBCurrentKey()   { return currentMonthKey(); }

export function jnkChangeMonth(d) {
  let m = (state.jnkViewMonth || 0) + d;
  let y =  state.jnkViewYear  || new Date().getFullYear();
  if (m < 0)  { m = 11; y--; }
  if (m > 11) { m = 0;  y++; }
  state.jnkViewMonth = m;
  state.jnkViewYear  = y;
  jnkRenderAll();
}

/* ─────────────────────────────────────────────────────────────
   CATEGORY GRID
───────────────────────────────────────────────────────────────*/

/**
 * Builds or updates the category grid.
 * Updates in-place when cards already exist (no full rebuild).
 */
export function jnkBuildCatGrid() {
  const grid = document.getElementById('jnk-cat-grid');
  if (!grid) return;
  if (!jnkSelected || Array.isArray(jnkSelected)) setJnkSelected({});

  JNK_CATEGORIES.forEach(cat => {
    const qty   = jnkSelected[cat.id] || 0;
    const isSel = qty > 0;
    let card    = grid.querySelector('[data-catid="' + cat.id + '"]');

    if (!card) {
      card             = document.createElement('div');
      card.className   = 'jnk-cat-card';
      card.dataset.catid = cat.id;
      card.setAttribute('role',     'checkbox');
      card.setAttribute('tabindex', '0');

      card.addEventListener('click', e => {
        if (e.target.closest('.jnk-qty-wrap')) return;
        jnkToggleCat(cat.id);
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jnkToggleCat(cat.id);
        }
      });
      grid.appendChild(card);
    }

    /* Only update DOM if state changed */
    const wasSelected = card.classList.contains('selected');
    const prevQty     = card.querySelector('.jnk-qty-display');
    const qtyChanged  = prevQty && prevQty.textContent !== String(qty);

    if (wasSelected !== isSel || qtyChanged) {
      card.classList.toggle('selected', isSel);
      card.setAttribute('aria-checked', isSel ? 'true' : 'false');
      card.setAttribute('aria-label',   sanitizeHTML(cat.name || '') + (isSel ? ' — selected' : ''));

      card.innerHTML =
        '<div class="jnk-cat-emoji" aria-hidden="true">' + cat.emoji + '</div>' +
        '<div class="jnk-cat-body">' +
          '<div class="jnk-cat-name">'  + sanitizeHTML(cat.name || '') + '</div>' +
          '<div class="jnk-cat-sub">'   + sanitizeHTML(cat.sub  || '') + '</div>' +
        '</div>' +
        (isSel
          ? '<div class="jnk-qty-wrap" onclick="event.stopPropagation();">' +
              '<button class="jnk-qty-btn" aria-label="Decrease" ' +
                'data-action="jnk-qty" data-id="' + cat.id + '" data-delta="-1">-</button>' +
              '<span class="jnk-qty-display" aria-live="polite">' + qty + '</span>' +
              '<button class="jnk-qty-btn" aria-label="Increase" ' +
                'data-action="jnk-qty" data-id="' + cat.id + '" data-delta="1">+</button>' +
            '</div>'
          : '<div class="jnk-cat-toggle" aria-hidden="true">+</div>');
    }
  });

  setJnkGridBuilt(true);
}

export function jnkToggleCat(id) {
  if (!jnkSelected || Array.isArray(jnkSelected)) setJnkSelected({});
  const sel = Object.assign({}, jnkSelected);
  if (sel[id]) delete sel[id];
  else         sel[id] = 1;
  setJnkSelected(sel);
  jnkBuildCatGrid();
  jnkRenderChips();
}

export function jnkSetQty(id, delta) {
  if (!jnkSelected || Array.isArray(jnkSelected)) setJnkSelected({});
  const sel  = Object.assign({}, jnkSelected);
  if (!sel[id]) sel[id] = 1;
  sel[id] = Math.max(1, (sel[id] || 1) + delta);
  setJnkSelected(sel);
  jnkBuildCatGrid();
  jnkRenderChips();
}

/* ─────────────────────────────────────────────────────────────
   CHIPS (selected items)
───────────────────────────────────────────────────────────────*/
export function jnkRenderChips() {
  const area  = document.getElementById('jnk-chips-area');
  const empty = document.getElementById('jnk-empty-chips');
  const btn   = document.getElementById('jnk-log-btn');
  const count = document.getElementById('jnk-sel-count');
  if (!area) return;

  if (!jnkSelected || Array.isArray(jnkSelected)) setJnkSelected({});

  area.querySelectorAll('.jnk-chip').forEach(c => c.remove());

  const keys     = Object.keys(jnkSelected);
  const totalQty = Object.values(jnkSelected).reduce((s, v) => s + v, 0);

  if (!keys.length) {
    if (empty) empty.style.display = 'block';
    if (btn)   { btn.disabled = true; btn.textContent = 'Log 0 Junk Items'; }
    if (count) count.textContent = '(0 items)';
    return;
  }

  if (empty) empty.style.display = 'none';
  if (count) count.textContent = '(' + totalQty + ' item' + (totalQty !== 1 ? 's' : '') + ')';
  if (btn)   { btn.disabled = false; btn.textContent = 'Log ' + totalQty + ' Junk Item' + (totalQty !== 1 ? 's' : ''); }

  keys.forEach(id => {
    const cat = JNK_CATEGORIES.find(c => c.id === id); if (!cat) return;
    const qty = jnkSelected[id];

    const chip       = document.createElement('div');
    chip.className   = 'jnk-chip';
    chip.setAttribute('role', 'listitem');
    chip.innerHTML   =
      cat.emoji + ' ' + sanitizeHTML(cat.name || '') +
      (qty > 1 ? ' <strong>x' + qty + '</strong>' : '') +
      '<button class="jnk-chip-remove" ' +
        'aria-label="Remove ' + sanitizeHTML(cat.name || '') + '" ' +
        'data-action="jnk-remove-chip" data-id="' + id + '">✕</button>';

    area.insertBefore(chip, null);
  });
}

export function jnkRemoveChip(id) {
  if (!jnkSelected || Array.isArray(jnkSelected)) setJnkSelected({});
  const sel = Object.assign({}, jnkSelected);
  delete sel[id];
  setJnkSelected(sel);
  jnkBuildCatGrid();
  jnkRenderChips();
  jnkRenderAll();
}

/* ─────────────────────────────────────────────────────────────
   LOG ITEMS
───────────────────────────────────────────────────────────────*/
export function jnkLogItems() {
  if (!jnkSelected || Array.isArray(jnkSelected)) setJnkSelected({});
  const keys = Object.keys(jnkSelected);
  if (!keys.length) return;

  const now      = new Date();
  const curMk    = jnkCurrentMKey();
  const todayK   = todayKey();
  const monthEntries = (state.junkLog || []).filter(e => e.monthKey === curMk);
  const totalQty = Object.values(jnkSelected).reduce((s, v) => s + v, 0);

  if (monthEntries.length + totalQty > JNK_LIMIT) {
    showToast('This would exceed the monthly junk limit of ' + JNK_LIMIT + '!', 'rt');
    return;
  }

  const todayEntries = (state.junkLog || []).filter(e => e.dateKey === todayK);
  if (todayEntries.length > 0) {
    if (!confirm('You already logged junk today. Log again?')) return;
  }

  const timeStr    = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const displayDate= now.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });

  keys.forEach(id => {
    const qty = jnkSelected[id] || 1;
    const cat = JNK_CATEGORIES.find(c => c.id === id); if (!cat) return;

    for (let i = 0; i < qty; i++) {
      if (!state.junkLog) state.junkLog = [];
      state.junkLog.push({
        id:        genId(),
        categories:[id],
        names:     [cat.name],
        emojis:    [cat.emoji],
        qty:       1,
        date:      displayDate,
        dateKey:   todayK,
        timeStr,
        monthKey:  curMk,
        isDessert: DESSERT_IDS.includes(id),
        isDrink:   DRINK_IDS.includes(id)
      });
    }
  });

  setJnkSelected({});
  setJnkGridBuilt(false);
  jnkBuildCatGrid();
  jnkRenderChips();
  debouncedSave();

  import('../shared/theme.js').then(m => { if (m.updateStatsBanner) m.updateStatsBanner(); });
  jnkRenderAll();

  const newCount = (state.junkLog || []).filter(e => e.monthKey === curMk).length;
  showToast(
    newCount >= JNK_LIMIT ? 'Monthly limit hit!' : 'Logged! Stay aware.',
    newCount >= JNK_LIMIT ? 'rt' : 'gt'
  );
}

export function jnkDeleteEntry(id) {
  if (!confirm('Remove this junk entry?')) return;
  state.junkLog = (state.junkLog || []).filter(e => e.id !== id);
  debouncedSave();
  import('../shared/theme.js').then(m => { if (m.updateStatsBanner) m.updateStatsBanner(); });
  jnkRenderAll();
  jnkRenderChips();
  showToast('Entry removed.');
}

export function jnkOpenSummary() {
  const el = document.querySelector('.jnk-bottom-grid');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* ─────────────────────────────────────────────────────────────
   RENDER ALL (stats, donut, activity)
───────────────────────────────────────────────────────────────*/
export function jnkRenderAll() {
  const vm  = state.jnkViewMonth || 0;
  const vy  = state.jnkViewYear  || new Date().getFullYear();
  const mk  = monthKey(vm, vy);
  const curMk = jnkCurrentMKey();

  const lbl = document.getElementById('jnk-month-label');
  if (lbl)  lbl.textContent = MONTHS[vm] + ' ' + vy;

  const entries      = (state.junkLog || []).filter(e => e.monthKey === mk);
  const totalUnits   = entries.length;
  const dessertUnits = entries.filter(e => e.isDessert).length;
  const drinkEntries = entries.filter(e => e.isDrink).length;
  const junkDays     = new Set(entries.map(e => e.dateKey)).size;

  /* Units stat card */
  _jnkStatCard(
    'jnk-val-units','jnk-bar-units','jnk-badge-units',
    String(totalUnits),
    Math.min(100, (totalUnits / JNK_LIMIT) * 100),
    'linear-gradient(90deg,#8b5cf6,#a78bfa)',
    totalUnits >= JNK_LIMIT ? 'Over Limit' : totalUnits >= JNK_LIMIT - 1 ? 'Caution' : 'On Track',
    totalUnits >= JNK_LIMIT
      ? 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;'
      : totalUnits >= JNK_LIMIT - 1
        ? 'background:#fffbeb;color:#d97706;border:1px solid #fde68a;'
        : 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;'
  );

  /* Drinks */
  const drkMl    = drinkEntries * 250;
  const drkVal   = document.getElementById('jnk-val-drinks');
  const drkBar   = document.getElementById('jnk-bar-drinks');
  const drkBadge = document.getElementById('jnk-badge-drinks');
  if (drkVal)   drkVal.textContent   = drkMl + ' ml';
  if (drkBar)   { drkBar.style.width = Math.min(100, (drkMl / 200) * 100) + '%'; drkBar.style.background = 'linear-gradient(90deg,#f97316,#fb923c)'; }
  if (drkBadge) {
    drkBadge.textContent = drkMl > 200 ? 'Over' : drkMl > 0 ? 'Logged' : 'Clear';
    drkBadge.style.cssText = (drkMl > 200
      ? 'background:#fef2f2;color:#dc2626;border:1px solid #fecaca;'
      : 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;') +
      'font-size:9px;font-weight:700;padding:3px 8px;border-radius:999px;';
  }

  /* Desserts */
  const dsVal   = document.getElementById('jnk-val-dessert');
  const dsBar   = document.getElementById('jnk-bar-dessert');
  const dsBadge = document.getElementById('jnk-badge-dessert');
  if (dsVal)   dsVal.textContent   = String(dessertUnits);
  if (dsBar)   { dsBar.style.width = Math.min(100, dessertUnits * 100) + '%'; dsBar.style.background = 'linear-gradient(90deg,#e879f9,#d946ef)'; }
  if (dsBadge) {
    dsBadge.textContent = dessertUnits > 1 ? 'Over' : dessertUnits === 1 ? 'Used' : 'Clear';
    dsBadge.style.cssText = (dessertUnits > 1
      ? 'background:#fdf4ff;color:#a21caf;border:1px solid #f0abfc;'
      : 'background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;') +
      'font-size:9px;font-weight:700;padding:3px 8px;border-radius:999px;';
  }

  /* Days */
  const daysEl = document.getElementById('jnk-val-days');
  if (daysEl)  daysEl.textContent = String(junkDays);

  /* Trend vs last month */
  const prevM  = vm === 0 ? 11 : vm - 1;
  const prevY  = vm === 0 ? vy - 1 : vy;
  const prevMk = monthKey(prevM, prevY);
  const prevCnt= (state.junkLog || []).filter(e => e.monthKey === prevMk).length;

  const trendEl = document.getElementById('jnk-val-trend');
  const subEl   = document.getElementById('jnk-sub-trend');
  const impEl   = document.getElementById('jnk-improve');
  const impVal  = document.getElementById('jnk-improve-val');

  if (prevCnt > 0 && mk === curMk) {
    const diff = prevCnt - totalUnits;
    const pct  = Math.abs(Math.round((diff / prevCnt) * 100));
    if (trendEl) { trendEl.textContent = pct + '%'; trendEl.style.color = diff >= 0 ? '#16a34a' : '#ef4444'; }
    if (subEl)   subEl.textContent = diff >= 0 ? 'better than last month' : 'worse than last month';
    if (impEl)   impEl.style.display = diff > 0 ? 'inline-flex' : 'none';
    if (impVal)  impVal.textContent  = pct + '%';
  } else {
    if (trendEl) { trendEl.textContent = '—'; trendEl.style.color = '#9c87d4'; }
    if (subEl)   subEl.textContent = 'no data yet';
    if (impEl)   impEl.style.display = 'none';
  }

  /* Donut + summary */
  _jnkRenderDonut(entries);

  const ssD  = document.getElementById('jnk-sum-drinks');
  const ssDs = document.getElementById('jnk-sum-dessert');
  const ssDy = document.getElementById('jnk-sum-days');
  const ssTr = document.getElementById('jnk-sum-trend');
  const dn   = document.getElementById('jnk-donut-num');

  if (ssD)  ssD.textContent  = drkMl + ' ml';
  if (ssDs) ssDs.textContent = String(dessertUnits);
  if (ssDy) ssDy.textContent = String(junkDays);
  if (dn)   dn.textContent   = String(totalUnits);

  if (ssTr) {
    if (prevCnt > 0 && mk === curMk) {
      const d2  = prevCnt - totalUnits;
      const p2  = Math.abs(Math.round((d2 / prevCnt) * 100));
      ssTr.textContent  = (d2 >= 0 ? '↓ ' : '↑ ') + p2 + '%';
      ssTr.style.color  = d2 >= 0 ? '#16a34a' : '#ef4444';
    } else {
      ssTr.textContent = '—';
      ssTr.style.color = '#9c87d4';
    }
  }

  _jnkRenderActivity(entries);
}

/* ─────────────────────────────────────────────────────────────
   STAT CARD HELPER
───────────────────────────────────────────────────────────────*/
function _jnkStatCard(valId, barId, badgeId, valText, barPct, barColor, badgeText, badgeCss) {
  const valEl  = document.getElementById(valId);
  const bar    = document.getElementById(barId);
  const badge  = document.getElementById(badgeId);
  if (valEl) valEl.textContent = valText;
  if (bar)   { bar.style.width = barPct + '%'; bar.style.background = barColor; }
  if (badge) { badge.textContent = badgeText; badge.style.cssText = badgeCss + 'font-size:9px;font-weight:700;padding:3px 8px;border-radius:999px;'; }
}

/* ─────────────────────────────────────────────────────────────
   DONUT CHART
───────────────────────────────────────────────────────────────*/
function _jnkRenderDonut(entries) {
  const svg    = document.getElementById('jnk-donut-svg');
  const legend = document.getElementById('jnk-legend');
  if (!svg || !legend) return;

  const counts = {};
  JNK_CATEGORIES.forEach(c => { counts[c.id] = 0; });
  entries.forEach(e => {
    (e.categories || []).forEach(cid => { counts[cid] = (counts[cid] || 0) + 1; });
  });

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const used  = JNK_CATEGORIES.filter(c => counts[c.id] > 0);

  svg.innerHTML = '<circle cx="55" cy="55" r="42" fill="none" stroke="#f3f4f6" stroke-width="14"/>';
  legend.innerHTML = '';

  if (!total) {
    legend.innerHTML = '<div style="font-size:12px;color:#c4b5fd;font-weight:600;font-style:italic;">No entries this month</div>';
    return;
  }

  /* Fixed-point dash accumulation to avoid floating-point drift */
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
    const dash  = dashes[i];
    if (dash < 0.5) { offset += dash; return; }
    const gap   = CIRC - dash;
    const color = JNK_DONUT_COLORS[i % JNK_DONUT_COLORS.length];

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', 55);
    circle.setAttribute('cy', 55);
    circle.setAttribute('r',  42);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', 14);
    circle.setAttribute('stroke-dasharray',  dash + ' ' + gap);
    circle.setAttribute('stroke-dashoffset', CIRC - offset);
    circle.setAttribute('stroke-linecap', 'butt');
    svg.appendChild(circle);
    offset += dash;

    const li = document.createElement('div');
    li.className = 'jnk-legend-item';
    li.setAttribute('role', 'listitem');
    li.innerHTML =
      '<div class="jnk-legend-dot" style="background:' + color + ';" aria-hidden="true"></div>' +
      cat.emoji + ' ' + sanitizeHTML(cat.name || '') +
      '<span class="jnk-legend-pct">' +
        counts[cat.id] + ' (' + Math.round((counts[cat.id] / total) * 100) + '%)' +
      '</span>';
    legend.appendChild(li);
  });
}

/* ─────────────────────────────────────────────────────────────
   ACTIVITY LIST
───────────────────────────────────────────────────────────────*/
function _jnkRenderActivity(entries) {
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
    const title     = sanitizeHTML((e.names || []).join(', ') || 'Junk Food');
    const subCats   = sanitizeHTML(
      (e.categories || [])
        .map(id => { const c = JNK_CATEGORIES.find(x => x.id === id); return c ? c.name : id; })
        .join(', ')
    );
    const isToday_  = e.dateKey === todayKey();
    const timeLabel = sanitizeHTML((isToday_ ? 'Today, ' : (e.date || '') + ', ') + e.timeStr);

    const item = document.createElement('div');
    item.className = 'jnk-activity-item';
    item.setAttribute('role', 'listitem');
    item.innerHTML =
      '<div class="jnk-activity-icon" aria-hidden="true">' + mainEmoji + '</div>' +
      '<div class="jnk-activity-body">' +
        '<div class="jnk-activity-title">' + title   + '</div>' +
        '<div class="jnk-activity-sub">'   + subCats + '</div>' +
      '</div>' +
      '<div class="jnk-activity-right">' +
        '<div class="jnk-activity-time">' + timeLabel + '</div>' +
        '<button class="jnk-del-btn" data-action="jnk-delete" data-id="' + e.id + '" ' +
          'aria-label="Delete this entry">✕</button>' +
      '</div>';
    list.appendChild(item);
  });
}

/* ─────────────────────────────────────────────────────────────
   SUGAR TRACKER
───────────────────────────────────────────────────────────────*/

/**
 * Computes the end key of a sugar week from its start key.
 * Uses string comparison (no Date objects) to avoid drift.
 */
function _sugarWeekEndKey(weekStart) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2,'0') + '-' +
         String(d.getDate()).padStart(2,'0');
}

/**
 * Checks if the sugar week has rolled over and resets if so.
 * Called on init, daily reset, and tab switch.
 */
export function jCheckWeekReset() {
  const ws = sugarWeekStartOf(new Date());
  if (state.sugarWeekStart === ws) return;

  state.sugarWeekStart = ws;
  const wsEndKey = _sugarWeekEndKey(ws);

  /* Recompute weeklyGrams from valid entries in the new week */
  state.weeklyGrams = Math.max(0,
    (state.sugarLog || [])
      .filter(e =>
        e.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey) &&
        e.dateKey >= ws &&
        e.dateKey <  wsEndKey
      )
      .reduce((sum, e) => sum + (e.grams || 0), 0)
  );

  debouncedSave(500);
  if (document.getElementById('j-sugar-big')) jRenderSugar();
  import('../shared/theme.js').then(m => { if (m.updateStatsBanner) m.updateStatsBanner(); });
}

/**
 * Returns days remaining in the current sugar week.
 * Returns 'tonight' string when 0.
 */
function _jDaysLeft() {
  const end  = new Date(state.sugarWeekStart + 'T00:00:00');
  end.setDate(end.getDate() + 7);
  const diff = end - new Date();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86400000);
}

function _jWeekRange() {
  const s = new Date(state.sugarWeekStart + 'T00:00:00');
  const e = new Date(state.sugarWeekStart + 'T00:00:00');
  e.setDate(e.getDate() + 6);
  const f = d => d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
  return f(s) + ' – ' + f(e);
}

export function jAddSugar(name, icon, g) {
  jCheckWeekReset();
  const prev        = state.weeklyGrams;
  state.weeklyGrams = (state.weeklyGrams || 0) + g;

  if (!state.sugarLog) state.sugarLog = [];
  state.sugarLog.push({
    id:        genId(),
    name,
    icon,
    grams:     g,
    date:      todayStr(),
    dateKey:   todayKey(),
    ts:        Date.now(),
    weekStart: state.sugarWeekStart,
    exceeded:  state.weeklyGrams > J_SUGAR_LIMIT
  });

  debouncedSave();
  jRenderSugar();
  jRenderLogs();
  import('../shared/theme.js').then(m => { if (m.updateStatsBanner) m.updateStatsBanner(); });

  if (state.weeklyGrams > J_SUGAR_LIMIT && prev <= J_SUGAR_LIMIT)
    showToast('Limit crossed — damage mode!', 'rt');
  else if (state.weeklyGrams > 40 && prev <= 40)
    showToast('Almost at weekly limit!', 'yt');
  else
    showToast('+' + g + 'g added to weekly sugar', 'yt');
}

export function jAddManualSugar() {
  const nameEl = document.getElementById('j-manual-name');
  const gEl    = document.getElementById('j-manual-g');
  const name   = nameEl ? (nameEl.value.trim() || 'Custom') : 'Custom';
  const g      = parseInt(gEl ? gEl.value : 0);

  if (!g || g < 1 || g > 300) {
    showToast('Enter a valid gram amount (1–300)', 'yt');
    return;
  }

  jAddSugar(name, '🔢', g);
  if (nameEl) nameEl.value = '';
  if (gEl)    gEl.value    = '';
}

export function jDeleteSugar(id) {
  const entry = (state.sugarLog || []).find(e => e.id === id);
  if (!entry) { showToast('Entry not found'); return; }

  state.sugarLog = (state.sugarLog || []).filter(e => e.id !== id);

  /* Recompute weekly grams from remaining valid entries */
  const wsEndKey = _sugarWeekEndKey(state.sugarWeekStart);
  state.weeklyGrams = Math.max(0,
    (state.sugarLog || [])
      .filter(e =>
        e.dateKey &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey) &&
        e.dateKey >= state.sugarWeekStart &&
        e.dateKey <  wsEndKey
      )
      .reduce((sum, e) => sum + (e.grams || 0), 0)
  );

  debouncedSave();
  jRenderSugar();
  jRenderLogs();
  import('../shared/theme.js').then(m => { if (m.updateStatsBanner) m.updateStatsBanner(); });
  showToast('Entry removed — weekly total recalculated.');
}

export function jRenderSugar() {
  jCheckWeekReset();

  const g   = state.weeklyGrams || 0;
  const pct = Math.min(100, (g / J_SUGAR_LIMIT) * 100);
  const circ= 264;
  const offs= circ - (pct / 100) * circ;

  let col, zone;
  if      (g > J_SUGAR_LIMIT) { col = '#ef4444'; zone = 'r'; }
  else if (g > 25)             { col = '#f59e0b'; zone = 'y'; }
  else                         { col = '#22c55e'; zone = 'g'; }

  const big  = document.getElementById('j-sugar-big');
  const frac = document.getElementById('j-sugar-fraction');
  const dl   = document.getElementById('j-days-left');
  const wr   = document.getElementById('j-week-range');
  const bd   = document.getElementById('j-sugar-badge');
  const mc   = document.getElementById('j-meter-circle');
  const mp   = document.getElementById('j-meter-pct');
  const sb   = document.getElementById('j-sugar-bar');
  const hp   = document.getElementById('j-health-panel');
  const hpt  = document.getElementById('j-hp-title');
  const hpi  = document.getElementById('j-hp-items');
  const cw   = document.getElementById('j-cond-wrap');
  const db2  = document.getElementById('j-danger-box');
  const disc = document.getElementById('j-disc-banner');
  const lt   = document.getElementById('j-log-total');

  if (big)  { big.textContent  = g + 'g'; big.className = 'sugar-big ' + zone; }
  if (frac) frac.textContent   = g + ' / 50g';

  const daysLeftVal = _jDaysLeft();
  if (dl) dl.textContent = daysLeftVal === 0 ? 'tonight' : daysLeftVal;
  if (wr) wr.textContent = _jWeekRange();

  if (bd) {
    bd.textContent = zone === 'r' ? 'Danger Zone' : zone === 'y' ? 'Caution' : 'Safe Zone';
    bd.className   = 'sugar-badge ' + zone;
  }
  if (mc) {
    mc.setAttribute('stroke-dashoffset', offs);
    mc.setAttribute('stroke', col);
    const t = mc.closest('[role="progressbar"]');
    if (t)  t.setAttribute('aria-valuenow', Math.round(pct));
  }
  if (mp) { mp.textContent = Math.round(pct) + '%'; mp.className = 'circ-pct ' + zone; }
  if (sb) {
    sb.style.width      = Math.min(100, pct) + '%';
    sb.style.background = col;
    const t = sb.closest('[role="progressbar"]');
    if (t)  t.setAttribute('aria-valuenow', Math.round(pct));
  }
  if (lt) lt.textContent = g + 'g';

  /* Health panel */
  if (hp) hp.className = 'health-panel ' + zone;
  if (hpt && hpi) {
    if (g <= 25) {
      hpt.textContent  = 'Liver and Immunity Status — Good';
      hpi.innerHTML    =
        '<div class="hp-item">Liver under control — minimal fat storage</div>' +
        '<div class="hp-item">Low inflammation levels</div>' +
        '<div class="hp-item">Throat bacteria not being fed</div>' +
        '<div class="hp-item">Immune system functioning normally</div>';
    } else if (g <= J_SUGAR_LIMIT) {
      hpt.textContent  = 'Early Warning Signs';
      hpi.innerHTML    =
        '<div class="hp-item">Liver starting to store fat (early stage)</div>' +
        '<div class="hp-item">Mild inflammation rising</div>' +
        '<div class="hp-item">Throat bacteria getting fuel — tonsil risk building</div>';
    } else {
      hpt.textContent  = 'Active Damage Mode';
      hpi.innerHTML    =
        '<div class="hp-item">Fatty liver worsening — fat accumulation accelerating</div>' +
        '<div class="hp-item">Throat bacteria feeding — tonsil infection risk HIGH</div>' +
        '<div class="hp-item">Systemic inflammation elevated</div>';
    }
  }

  if (cw)  cw.style.display  = g > 30 ? 'block' : 'none';
  if (db2) db2.style.display = g > J_SUGAR_LIMIT ? 'block' : 'none';

  if (disc) {
    const tw = (state.sugarLog || []).filter(e =>
      (e.weekStart || state.sugarWeekStart) === state.sugarWeekStart
    );
    disc.className = 'disc-banner' + (g <= 15 && tw.length >= 1 ? ' show' : '');
  }
}

/* ─────────────────────────────────────────────────────────────
   BIRYANI TRACKER
───────────────────────────────────────────────────────────────*/
function _jBKey() {
  return monthKey(
    state.jBViewM || 0,
    state.jBViewY || new Date().getFullYear()
  );
}

function _jBCount(mk) {
  const e = (state.biryLog || []).find(x => x.monthKey === mk);
  return e ? (e.entries || []).length : 0;
}

export function openBiryaniConfirm() {
  const curMk = jBCurrentKey();
  const cnt   = _jBCount(curMk);
  const body  = document.getElementById('biryani-confirm-body');
  if (body)   body.textContent = 'You have eaten ' + cnt + ' of 2 allowed this month.';

  const modal = document.getElementById('biryani-confirm-modal');
  if (modal) {
    modal.classList.add('open');
    const btn = modal.querySelector('button');
    if (btn)  btn.focus();
  }
}

export function closeBiryaniConfirm() {
  const m = document.getElementById('biryani-confirm-modal');
  if (m)  m.classList.remove('open');
  if (biryaniLogInFlight) {
    setTimeout(() => setBiryaniLogInFlight(false), 5000);
  }
}

export async function confirmBiryaniLog() {
  if (biryaniLogInFlight) return;
  setBiryaniLogInFlight(true);

  try {
    closeBiryaniConfirm();

    const curMk       = jBCurrentKey();
    let entry         = (state.biryLog || []).find(x => x.monthKey === curMk);
    const currentCount= entry ? (entry.entries || []).length : 0;

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
      entry.count >= J_BIRY_LIMIT
        ? 'Biryani limit reached for this month!'
        : 'Biryani logged! Enjoy every grain.',
      entry.count >= J_BIRY_LIMIT ? 'yt' : 'gt'
    );

  } finally {
    setBiryaniLogInFlight(false);
  }
}

export function jLogBiryani() {
  if (biryaniLogInFlight) return;

  const curMk  = jBCurrentKey();
  const viewMk = _jBKey();

  if (viewMk !== curMk) {
    showToast('Switch to current month to log biryani', 'yt');
    return;
  }

  const cnt = _jBCount(curMk);
  if (cnt >= J_BIRY_LIMIT) {
    showToast('Max ' + J_BIRY_LIMIT + ' biryanis this month!', 'rt');
    return;
  }

  openBiryaniConfirm();
}

export function jDeleteBiryani(mKey, entryId) {
  if (!confirm('Remove this biryani entry?')) return;
  const month = (state.biryLog || []).find(x => x.monthKey === mKey);
  if (!month) return;
  month.entries = (month.entries || []).filter(e => e.id !== entryId);
  month.count   = month.entries.length;
  if (month.count === 0) state.biryLog = state.biryLog.filter(x => x.monthKey !== mKey);
  debouncedSave();
  jRenderBiryani();
  jRenderLogs();
  showToast('Biryani entry removed.');
}

export function jChangeBMonth(d) {
  let m = (state.jBViewM || 0) + d;
  let y =  state.jBViewY || new Date().getFullYear();
  if (m < 0)  { m = 11; y--; }
  if (m > 11) { m = 0;  y++; }
  state.jBViewM = m;
  state.jBViewY = y;
  jRenderBiryani();
}

export function jRenderBiryani() {
  const viewMk = _jBKey();
  const curMk  = jBCurrentKey();
  const cnt    = _jBCount(viewMk);
  const rem    = J_BIRY_LIMIT - cnt;
  const vm     = state.jBViewM || 0;
  const vy     = state.jBViewY || new Date().getFullYear();

  const bm   = document.getElementById('j-b-month');
  const bc   = document.getElementById('j-b-count');
  const be   = document.getElementById('j-b-eaten');
  const br   = document.getElementById('j-b-rem');
  const bb   = document.getElementById('j-b-bar');
  const row  = document.getElementById('biry-log-row');
  const slot1= document.getElementById('b-slot-1');
  const slot2= document.getElementById('b-slot-2');

  if (bm) bm.textContent  = MONTHS[vm] + ' ' + vy;
  if (bc) bc.textContent  = String(cnt);
  if (be) be.textContent  = String(cnt);
  if (br) br.textContent  = rem > 0 ? rem + ' remaining' : 'Limit reached';
  if (bb) {
    bb.style.width      = Math.min(100, (cnt / J_BIRY_LIMIT) * 100) + '%';
    bb.style.background = cnt >= J_BIRY_LIMIT ? '#ef4444' : '#f59e0b';
    const track = bb.closest('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', cnt);
  }

  /* Slot styling uses current month count */
  const curCnt   = _jBCount(curMk);
  const isCurrent= viewMk === curMk;
  const isLimit  = isCurrent && curCnt >= J_BIRY_LIMIT;

  if (slot1 && slot2) {
    slot1.className = 'b-slot' + (cnt >= 1 ? (isLimit ? ' limit' : ' filled') : '');
    slot2.className = 'b-slot' + (cnt >= 2 ? (isLimit ? ' limit' : ' filled') : '');
  }

  if (row) {
    const atLimit = isCurrent && curCnt >= J_BIRY_LIMIT;
    if (!isCurrent || atLimit) {
      row.style.opacity       = '0.45';
      row.style.pointerEvents = 'none';
      row.setAttribute('aria-disabled', 'true');
      row.title = !isCurrent ? 'Switch to current month to log' : 'Monthly limit reached';
    } else {
      row.style.opacity       = '1';
      row.style.pointerEvents = 'auto';
      row.removeAttribute('aria-disabled');
      row.title = '';
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   LOG TAB SWITCHER
───────────────────────────────────────────────────────────────*/
export function jSwitchLog(t) {
  setJActiveLog(t);
  ['sugar','junk','biry'].forEach(x => {
    const tab   = document.getElementById('jlt-' + x);
    const panel = document.getElementById('jlog-' + x);
    if (tab)   { tab.className = 'log-tab-btn' + (t === x ? ' active' : ''); tab.setAttribute('aria-pressed', t === x ? 'true' : 'false'); }
    if (panel) panel.style.display = t === x ? 'block' : 'none';
  });
  jRenderLogs();
}

export function jRenderLogs() {
  const wsEndKey = _sugarWeekEndKey(state.sugarWeekStart);

  /* ── Sugar log ── */
  const weekEntries = (state.sugarLog || [])
    .filter(e =>
      e.dateKey &&
      /^\d{4}-\d{2}-\d{2}$/.test(e.dateKey) &&
      e.dateKey >= state.sugarWeekStart &&
      e.dateKey <  wsEndKey
    )
    .slice()
    .reverse();

  const lt = document.getElementById('j-log-total');
  if (lt)  lt.textContent = (state.weeklyGrams || 0) + 'g';

  const sl = document.getElementById('j-sugar-log-list');
  if (sl) {
    if (!weekEntries.length) {
      sl.innerHTML = '<div class="tempty">No sugar entries this week</div>';
    } else {
      sl.innerHTML = weekEntries.map(e => {
        const bc  = e.grams >= 15 ? 'hi' : e.grams >= 8 ? 'mid' : 'low';
        const tag = e.exceeded
          ? '<span class="le-tag exceeded">Limit Exceeded</span>'
          : e.grams >= 15
            ? '<span class="le-tag highsugar">High Sugar</span>'
            : '';
        return (
          '<div class="j-log-entry" role="listitem">' +
            '<div style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">' + e.icon + '</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + sanitizeHTML(e.name || '') + '</div>' +
              '<div style="font-size:10px;color:#bbb;">' + sanitizeHTML(e.date || '') + '</div>' +
            '</div>' +
            '<span class="le-badge ' + bc + '">+' + e.grams + 'g</span>' + tag +
            '<button class="le-del-btn" aria-label="Delete entry" ' +
              'data-action="delete-sugar" data-id="' + e.id + '">✕</button>' +
          '</div>'
        );
      }).join('');
    }
  }

  /* ── Junk log ── */
  const jl  = document.getElementById('j-junk-log-list');
  const jlc = document.getElementById('j-junk-log-count');
  const all = state.junkLog || [];
  if (jlc) jlc.textContent = all.length + ' total entries';

  if (jl) {
    if (!all.length) {
      jl.innerHTML = '<div class="tempty">No junk food entries yet</div>';
    } else {
      jl.innerHTML = all.slice().reverse().map(e => {
        const mainEmoji = e.emojis && e.emojis[0] ? e.emojis[0] : '🛍️';
        return (
          '<div class="j-log-entry" role="listitem">' +
            '<div style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">' + mainEmoji + '</div>' +
            '<div style="flex:1;">' +
              '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">' + sanitizeHTML((e.names || []).join(', ') || '') + '</div>' +
              '<div style="font-size:10px;color:#bbb;">' + sanitizeHTML(e.date || '') + '</div>' +
            '</div>' +
            '<span style="font-size:10px;background:#f5f3ff;color:#7c3aed;border-radius:9px;padding:2px 7px;font-weight:700;">' + sanitizeHTML(e.monthKey || '') + '</span>' +
            '<button class="le-del-btn" aria-label="Delete entry" ' +
              'data-action="jnk-delete" data-id="' + e.id + '">✕</button>' +
          '</div>'
        );
      }).join('');
    }
  }

  /* ── Biryani log ── */
  const bl = document.getElementById('j-biry-log-list');
  if (bl) {
    const allB = [];
    (state.biryLog || []).forEach(m => {
      (m.entries || []).forEach(e => {
        allB.push({ id: e.id, date: e.date, dateKey: e.dateKey, monthKey: m.monthKey });
      });
    });
    allB.sort((a, b) => (b.dateKey || b.date || '').localeCompare(a.dateKey || a.date || ''));

    if (!allB.length) {
      bl.innerHTML = '<div class="tempty">No biryani entries yet</div>';
    } else {
      bl.innerHTML = allB.map(e =>
        '<div class="j-log-entry" role="listitem">' +
          '<div style="font-size:20px;width:28px;text-align:center;" aria-hidden="true">🍛</div>' +
          '<div style="flex:1;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-primary);">Biryani</div>' +
            '<div style="font-size:10px;color:#bbb;">' + sanitizeHTML(e.date || '') + '</div>' +
          '</div>' +
          '<span class="le-badge mid">' + sanitizeHTML(e.monthKey || '') + '</span>' +
          '<button class="le-del-btn" aria-label="Delete biryani entry" ' +
            'data-action="delete-biryani" ' +
            'data-month-key="' + e.monthKey + '" ' +
            'data-id="' + e.id + '">✕</button>' +
        '</div>'
      ).join('');
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   PAGE BUILDER
───────────────────────────────────────────────────────────────*/
export function buildJunkPage() {
  const page = document.getElementById('page-junk');
  if (!page || page.children.length > 0) return;

  _injectJunkCSS();

  page.innerHTML = `
<div class="jnk-root">

  <!-- Header -->
  <div class="jnk-header" role="banner">
    <div class="jnk-header-left">
      <div class="jnk-header-icon" aria-hidden="true">🍩</div>
      <div>
        <div class="jnk-header-title">Junk Food Tracker</div>
        <div class="jnk-header-sub">Track junk. Stay aware. Stay in control.</div>
      </div>
    </div>
    <div class="jnk-month-switcher" role="group" aria-label="Month navigation">
      <button class="jnk-month-btn" data-action="jnk-month" data-dir="-1" aria-label="Previous month">‹</button>
      <span class="jnk-month-label" id="jnk-month-label" aria-live="polite">May 2026</span>
      <button class="jnk-month-btn" data-action="jnk-month" data-dir="1" aria-label="Next month">›</button>
    </div>
    <button class="jnk-summary-btn" onclick="jnkOpenSummary()" aria-label="View monthly summary">
      Monthly Summary
    </button>
  </div>

  <!-- Stats row -->
  <div class="jnk-stats-row" role="region" aria-label="Junk food statistics">

    <div class="jnk-stat-card">
      <div class="jnk-stat-icon-row">
        <div class="jnk-stat-icon" style="background:#f5f3ff;">🛍️</div>
        <span class="jnk-stat-badge" id="jnk-badge-units"
              style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;">On Track</span>
      </div>
      <div class="jnk-stat-value" id="jnk-val-units" aria-live="polite">0</div>
      <div class="jnk-stat-label">Junk Units</div>
      <div class="jnk-stat-sub">of 4 allowed/month</div>
      <div class="jnk-stat-bar-track" style="background:#f3f4f6;">
        <div class="jnk-stat-bar-fill" id="jnk-bar-units"
             style="width:0%;background:linear-gradient(90deg,#8b5cf6,#a78bfa);"></div>
      </div>
    </div>

    <div class="jnk-stat-card">
      <div class="jnk-stat-icon-row">
        <div class="jnk-stat-icon" style="background:#fff7ed;">🥤</div>
        <span class="jnk-stat-badge" id="jnk-badge-drinks"
              style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;">Clear</span>
      </div>
      <div class="jnk-stat-value" id="jnk-val-drinks" aria-live="polite">0 ml</div>
      <div class="jnk-stat-label">Sugary Drinks</div>
      <div class="jnk-stat-sub">of 200 ml limit</div>
      <div class="jnk-stat-bar-track" style="background:#fff7ed;">
        <div class="jnk-stat-bar-fill" id="jnk-bar-drinks"
             style="width:0%;background:linear-gradient(90deg,#f97316,#fb923c);"></div>
      </div>
    </div>

    <div class="jnk-stat-card">
      <div class="jnk-stat-icon-row">
        <div class="jnk-stat-icon" style="background:#fdf4ff;">🧁</div>
        <span class="jnk-stat-badge" id="jnk-badge-dessert"
              style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;">Clear</span>
      </div>
      <div class="jnk-stat-value" id="jnk-val-dessert" aria-live="polite">0</div>
      <div class="jnk-stat-label">Dessert Units</div>
      <div class="jnk-stat-sub">of 1 allowed</div>
      <div class="jnk-stat-bar-track" style="background:#fdf4ff;">
        <div class="jnk-stat-bar-fill" id="jnk-bar-dessert"
             style="width:0%;background:linear-gradient(90deg,#e879f9,#d946ef);"></div>
      </div>
    </div>

    <div class="jnk-stat-card">
      <div class="jnk-stat-icon-row">
        <div class="jnk-stat-icon" style="background:#eff6ff;">📅</div>
        <span class="jnk-stat-badge"
              style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;">Month</span>
      </div>
      <div class="jnk-stat-value" id="jnk-val-days" aria-live="polite">0</div>
      <div class="jnk-stat-label">Junk Days</div>
      <div class="jnk-stat-sub">days with junk logged</div>
    </div>

    <div class="jnk-stat-card">
      <div class="jnk-stat-icon-row">
        <div class="jnk-stat-icon" style="background:#f0fdf4;">📈</div>
        <span class="jnk-stat-badge"
              style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;">Trend</span>
      </div>
      <div class="jnk-stat-value" style="color:#16a34a;" id="jnk-val-trend" aria-live="polite">—</div>
      <div class="jnk-stat-label">vs Last Month</div>
      <div class="jnk-stat-sub" id="jnk-sub-trend">no data yet</div>
      <div class="jnk-stat-improve" id="jnk-improve" style="display:none;" aria-live="polite">
        ↓ <span id="jnk-improve-val">0%</span> Better
      </div>
    </div>

  </div><!-- /stats-row -->

  <!-- Category grid -->
  <div class="jnk-section-wrap" role="region" aria-label="Select junk food categories">
    <div class="jnk-section-title">
      1. Select Junk Food
      <span style="font-size:12px;font-weight:600;color:#9c87d4;">(you can select multiple)</span>
    </div>
    <div class="jnk-cat-grid" id="jnk-cat-grid" role="group" aria-label="Junk food categories"></div>
  </div>

  <!-- Selected chips + log button -->
  <div class="jnk-selected-row" role="region" aria-label="Selected items">
    <div style="font-size:13px;font-weight:900;color:#1e1b4b;white-space:nowrap;">
      2. Selected
      <span style="font-size:11px;font-weight:600;color:#9c87d4;"
            id="jnk-sel-count" aria-live="polite">(0 items)</span>
    </div>
    <div class="jnk-chips-area" id="jnk-chips-area" aria-live="polite">
      <span class="jnk-empty-chips" id="jnk-empty-chips">
        Nothing selected yet — tap a category above
      </span>
    </div>
    <button class="jnk-log-btn" id="jnk-log-btn"
            onclick="jnkLogItems()" disabled
            aria-label="Log selected junk food items">
      Log 0 Junk Items
    </button>
  </div>

  <!-- Sugar section label -->
  <div class="j-sec-label">Weekly Sugar Tracker</div>

  <!-- Discipline banner -->
  <div class="disc-banner" id="j-disc-banner" role="status" aria-live="polite">
    <span style="font-size:24px;" aria-hidden="true">🔥</span>
    <div>
      <div style="font-size:12px;font-weight:900;">Discipline Win — Sugar controlled this week!</div>
      <div style="font-size:10px;opacity:.85;margin-top:2px;">
        Keep it below 25g for maximum liver protection.
      </div>
    </div>
  </div>

  <!-- Sugar card -->
  <div class="sc" role="region" aria-label="Weekly sugar tracker">
    <div style="padding:14px 16px 9px;">

      <div style="display:flex;align-items:center;justify-content:space-between;
                  flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        <div>
          <div class="sugar-big g" id="j-sugar-big" aria-live="polite">0g</div>
          <div style="font-size:12px;color:#888;margin-top:2px;">
            Weekly Sugar: <strong id="j-sugar-fraction">0 / 50g</strong>
          </div>
          <div style="font-size:10px;color:#bbb;margin-top:1px;">
            Resets in <span id="j-days-left">7</span> days &nbsp;|&nbsp;
            <span id="j-week-range"></span>
          </div>
        </div>
        <div class="sugar-badge g" id="j-sugar-badge" aria-live="polite">Safe Zone</div>
      </div>

      <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:9px 0 12px;">
        <div class="circ" role="img" aria-label="Sugar consumption gauge">
          <svg width="90" height="90" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#f0f0f5" stroke-width="10"/>
            <circle cx="50" cy="50" r="42" fill="none" stroke="#22c55e" stroke-width="10"
                    stroke-dasharray="264" stroke-dashoffset="264" stroke-linecap="round"
                    id="j-meter-circle" style="transition:stroke-dashoffset .6s,stroke .5s;"/>
          </svg>
          <div class="circ-center">
            <div class="circ-pct g" id="j-meter-pct" aria-live="polite">0%</div>
            <div style="font-size:8px;color:#aaa;">of 50g</div>
          </div>
        </div>
        <div style="flex:1;min-width:120px;">
          <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#555;margin-bottom:4px;">
            <div style="width:10px;height:10px;border-radius:3px;background:#22c55e;flex-shrink:0;"></div>0-25g Safe
          </div>
          <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#555;margin-bottom:4px;">
            <div style="width:10px;height:10px;border-radius:3px;background:#f59e0b;flex-shrink:0;"></div>25-50g Caution
          </div>
          <div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#555;">
            <div style="width:10px;height:10px;border-radius:3px;background:#ef4444;flex-shrink:0;"></div>Over 50g Danger
          </div>
        </div>
      </div>

      <div class="j-prog-track" role="progressbar"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
           aria-label="Weekly sugar progress">
        <div class="j-prog-fill" id="j-sugar-bar" style="width:0%;background:#22c55e;"></div>
      </div>

      <!-- Quick add -->
      <div style="font-size:10px;font-weight:900;letter-spacing:.8px;
                  text-transform:uppercase;color:#aaa;margin:12px 0 5px;">Quick Add:</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-bottom:5px;"
           role="group" aria-label="Quick add sugar items">
        <button class="s-btn" data-action="add-sugar" data-name="Tea/Coffee"  data-icon="☕" data-grams="5">
          <span class="s-ico">☕</span><span>Tea</span><span class="s-g">+5g</span>
        </button>
        <button class="s-btn" data-action="add-sugar" data-name="Soft Drink"  data-icon="🥤" data-grams="20">
          <span class="s-ico">🥤</span><span>Drink</span><span class="s-g">+20g</span>
        </button>
        <button class="s-btn" data-action="add-sugar" data-name="Juice"       data-icon="🧃" data-grams="15">
          <span class="s-ico">🧃</span><span>Juice</span><span class="s-g">+15g</span>
        </button>
        <button class="s-btn" data-action="add-sugar" data-name="Chocolate"   data-icon="🍫" data-grams="10">
          <span class="s-ico">🍫</span><span>Choc</span><span class="s-g">+10g</span>
        </button>
        <button class="s-btn" data-action="add-sugar" data-name="Biscuits"    data-icon="🍪" data-grams="8">
          <span class="s-ico">🍪</span><span>Biscuit</span><span class="s-g">+8g</span>
        </button>
      </div>

      <!-- Manual entry -->
      <div style="font-size:10px;font-weight:900;letter-spacing:.8px;
                  text-transform:uppercase;color:#aaa;margin:12px 0 5px;">Manual Entry:</div>
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
        <input id="j-manual-name" type="text" placeholder="Item name" maxlength="30"
               aria-label="Sugar item name"
               style="flex:1;min-width:90px;padding:8px 10px;
                      border:2px solid var(--purple-200);border-radius:9px;
                      outline:none;font-family:var(--font);font-size:16px;"/>
        <input id="j-manual-g" type="number" placeholder="grams" min="1" max="300"
               aria-label="Sugar amount in grams"
               style="width:74px;padding:8px 10px;
                      border:2px solid var(--purple-200);border-radius:9px;
                      outline:none;font-family:var(--font);font-size:16px;"/>
        <button onclick="jAddManualSugar()"
                style="padding:8px 14px;background:var(--purple-500);color:#fff;
                       border:none;border-radius:9px;font-size:12px;font-weight:700;
                       cursor:pointer;font-family:var(--font);">Add</button>
      </div>

    </div>
  </div><!-- /sugar card -->

  <!-- Health panel -->
  <div class="sc" style="overflow:hidden;" role="region" aria-label="Body health status">
    <div style="padding:12px 16px 2px;font-size:10px;font-weight:900;
                letter-spacing:.8px;text-transform:uppercase;color:#aaa;">
      What is Happening Inside Your Body
    </div>
    <div class="health-panel g" id="j-health-panel"
         style="border-radius:0 0 var(--r-lg) var(--r-lg);" aria-live="polite">
      <div class="hp-title" id="j-hp-title">Liver and Immunity Status</div>
      <div id="j-hp-items"></div>
    </div>
  </div>

  <!-- Conditions grid -->
  <div id="j-cond-wrap" style="display:none;margin-bottom:12px;"
       role="alert" aria-live="polite">
    <div class="cond-grid">
      <div class="warn-box fatty">
        <div class="wb-title">Fatty Liver Impact</div>
        <ul>
          <li>Sugar converts directly into liver fat</li>
          <li>Slows your body natural healing</li>
        </ul>
      </div>
      <div class="warn-box tonsil">
        <div class="wb-title">Tonsils Impact</div>
        <ul>
          <li>Sugar feeds harmful throat bacteria</li>
          <li>Increases throat irritation</li>
        </ul>
      </div>
      <div class="warn-box danger" id="j-danger-box" style="display:none;">
        <div class="wb-title">HIGH RISK — Limit Exceeded</div>
        <ul>
          <li>Liver fat accumulation accelerating</li>
          <li>Tonsil infection risk is HIGH</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- Biryani section label -->
  <div class="j-sec-label">Biryani Tracker</div>

  <!-- Biryani month nav -->
  <div class="j-month-nav" role="group" aria-label="Biryani month navigation">
    <button data-action="biry-month" data-dir="-1" aria-label="Previous month">‹</button>
    <span id="j-b-month" aria-live="polite">May 2026</span>
    <button data-action="biry-month" data-dir="1" aria-label="Next month">›</button>
  </div>

  <!-- Biryani card -->
  <div class="biry-card" role="region" aria-label="Biryani tracker">
    <div style="font-size:11px;color:#b45309;font-weight:700;margin-bottom:9px;
                background:rgba(245,158,11,.12);padding:7px 10px;border-radius:7px;">
      Max 2 biryanis per month — Savour every grain!
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px;">
      <div style="font-size:34px;font-weight:900;color:#92400e;"
           id="j-b-count" aria-live="polite">0</div>
      <div>
        <div style="font-size:12px;color:#92400e;font-weight:700;">/ 2 this month</div>
        <div style="font-size:10px;color:#b45309;" id="j-b-rem">2 remaining</div>
      </div>
      <div style="margin-left:auto;">
        <div class="j-prog-track" style="width:110px;height:7px;"
             role="progressbar" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0">
          <div class="j-prog-fill" id="j-b-bar" style="width:0%;background:#f59e0b;"></div>
        </div>
      </div>
    </div>

    <div class="biry-row" id="biry-log-row" onclick="jLogBiryani()"
         role="button" tabindex="0" aria-label="Log a biryani"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();jLogBiryani()}">
      <div style="font-size:26px;" aria-hidden="true">🍛</div>
      <div>
        <div style="font-size:13px;font-weight:900;color:#92400e;">Log Biryani</div>
        <div style="font-size:11px;color:#b45309;">Max 2/month — Enjoy every bite!</div>
      </div>
      <div style="margin-left:auto;">
        <div class="b-slots-row" id="j-b-slots" aria-label="Biryani slots">
          <div class="b-slot" id="b-slot-1"></div>
          <div class="b-slot" id="b-slot-2"></div>
        </div>
      </div>
    </div>

    <div style="font-size:11px;color:#92400e;padding:3px 2px;margin-top:3px;"
         aria-live="polite">
      Eaten: <strong id="j-b-eaten">0</strong> / 2
    </div>
  </div>

  <!-- Bottom analytics grid -->
  <div class="jnk-bottom-grid" role="region" aria-label="Junk food analytics">

    <div class="jnk-analytics-card">
      <div class="jnk-card-header">
        <div class="jnk-card-title">This Month Summary</div>
        <button class="jnk-view-link" onclick="jnkOpenSummary()">View Detailed</button>
      </div>
      <div class="jnk-donut-row">
        <div class="jnk-donut-wrap" role="img" aria-label="Junk food category breakdown">
          <svg width="110" height="110" viewBox="0 0 110 110"
               id="jnk-donut-svg" aria-hidden="true">
            <circle cx="55" cy="55" r="42" fill="none" stroke="#f3f4f6" stroke-width="14"/>
          </svg>
          <div class="jnk-donut-center">
            <div class="jnk-donut-num" id="jnk-donut-num" aria-live="polite">0</div>
            <div class="jnk-donut-lbl">Total Units</div>
          </div>
        </div>
        <div class="jnk-legend" id="jnk-legend" role="list"></div>
      </div>
      <div class="jnk-summary-stats">
        <div class="jnk-sum-item">
          <div class="jnk-sum-val" id="jnk-sum-drinks" aria-live="polite">0 ml</div>
          <div class="jnk-sum-label">Sugary Drinks</div>
        </div>
        <div class="jnk-sum-item">
          <div class="jnk-sum-val" id="jnk-sum-dessert" aria-live="polite">0</div>
          <div class="jnk-sum-label">Dessert Units</div>
        </div>
        <div class="jnk-sum-item">
          <div class="jnk-sum-val" id="jnk-sum-days" aria-live="polite">0</div>
          <div class="jnk-sum-label">Junk Days</div>
        </div>
        <div class="jnk-sum-item">
          <div class="jnk-sum-val" style="color:#16a34a;"
               id="jnk-sum-trend" aria-live="polite">—</div>
          <div class="jnk-sum-label">vs Last Month</div>
        </div>
      </div>
    </div>

    <div class="jnk-analytics-card">
      <div class="jnk-card-header">
        <div class="jnk-card-title">Recent Activity</div>
        <button class="jnk-view-link" onclick="jSwitchLog('junk')">View All</button>
      </div>
      <div class="jnk-activity-list" id="jnk-activity-list" role="list"></div>
    </div>

  </div><!-- /bottom-grid -->

  <!-- Activity log section label -->
  <div class="j-sec-label">Activity Log</div>

  <!-- Log card -->
  <div class="sc" style="overflow:hidden;" role="region" aria-label="Junk food activity log">
    <div style="padding:12px 14px 9px;">

      <div style="display:flex;align-items:center;
                  justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:11px;color:#888;font-weight:700;">All entries</div>
        <div style="display:flex;gap:5px;" role="group" aria-label="Log tab filters">
          <button class="log-tab-btn active" id="jlt-sugar"
                  data-action="jnk-switch-log" data-tab="sugar"
                  aria-pressed="true">Sugar</button>
          <button class="log-tab-btn" id="jlt-junk"
                  data-action="jnk-switch-log" data-tab="junk"
                  aria-pressed="false">Junk</button>
          <button class="log-tab-btn" id="jlt-biry"
                  data-action="jnk-switch-log" data-tab="biry"
                  aria-pressed="false">Biryani</button>
        </div>
      </div>

      <!-- Sugar log panel -->
      <div id="jlog-sugar">
        <div style="display:flex;align-items:center;
                    justify-content:space-between;margin-bottom:7px;">
          <div style="font-size:11px;color:#888;">This week's sugar intake</div>
          <div style="font-size:11px;color:var(--purple-600);font-weight:900;">
            Total: <span id="j-log-total" aria-live="polite">0g</span>
          </div>
        </div>
        <div id="j-sugar-log-list" aria-live="polite">
          <div class="tempty">No sugar entries this week</div>
        </div>
      </div>

      <!-- Junk log panel -->
      <div id="jlog-junk" style="display:none;">
        <div style="font-size:11px;color:#888;margin-bottom:7px;"
             id="j-junk-log-count">0 total entries</div>
        <div id="j-junk-log-list" aria-live="polite">
          <div class="tempty">No junk food entries yet</div>
        </div>
      </div>

      <!-- Biryani log panel -->
      <div id="jlog-biry" style="display:none;">
        <div style="font-size:11px;color:#888;margin-bottom:7px;">
          All biryani entries — tap ✕ to delete
        </div>
        <div id="j-biry-log-list" aria-live="polite">
          <div class="tempty">No biryani entries yet</div>
        </div>
      </div>

    </div>
  </div><!-- /log card -->

</div><!-- /jnk-root -->
  `;
}

/* ─────────────────────────────────────────────────────────────
   CSS INJECTOR
───────────────────────────────────────────────────────────────*/
function _injectJunkCSS() {
  if (document.getElementById('jnk-css')) return;
  const s = document.createElement('style');
  s.id    = 'jnk-css';
  s.textContent = `
    .jnk-root{min-height:100vh;background:linear-gradient(145deg,#f5f3ff 0%,#ede9fe 40%,#f0f4ff 100%);padding:28px 32px 60px;overflow-x:hidden;width:100%;box-sizing:border-box;}
    @media(max-width:768px){.jnk-root{padding:14px 14px 60px;}}
    @media(max-width:480px){.jnk-root{padding:10px 10px 60px;}}
    .jnk-header{display:flex;align-items:center;justify-content:space-between;background:#fff;border-radius:20px;padding:18px 24px;margin-bottom:22px;border:1px solid rgba(139,92,246,0.10);box-shadow:0 4px 24px rgba(139,92,246,0.08);flex-wrap:wrap;gap:14px;}
    .jnk-header-left{display:flex;align-items:center;gap:12px;}
    .jnk-header-icon{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#ede9fe,#ddd6fe);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
    .jnk-header-title{font-size:20px;font-weight:900;color:#1e1b4b;letter-spacing:-0.4px;line-height:1.1;}
    .jnk-header-sub{font-size:12px;color:#8b7fc7;font-weight:500;margin-top:2px;}
    .jnk-month-switcher{display:flex;align-items:center;gap:8px;background:#f5f3ff;border-radius:999px;padding:6px 8px;border:1px solid #ede9fe;}
    .jnk-month-btn{width:30px;height:30px;border-radius:50%;border:none;background:#fff;color:#7c3aed;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(139,92,246,0.12);transition:all 0.15s;font-family:var(--font);}
    .jnk-month-btn:hover{background:#7c3aed;color:#fff;}
    .jnk-month-label{font-size:13px;font-weight:800;color:#4c1d95;padding:0 8px;white-space:nowrap;}
    .jnk-summary-btn{display:flex;align-items:center;gap:7px;padding:10px 20px;border-radius:999px;border:1.5px solid #ddd6fe;background:#fff;color:#7c3aed;font-size:13px;font-weight:700;cursor:pointer;transition:all 0.18s;font-family:var(--font);white-space:nowrap;}
    .jnk-summary-btn:hover{background:#7c3aed;color:#fff;border-color:#7c3aed;}
    .jnk-stats-row{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:24px;}
    @media(max-width:1100px){.jnk-stats-row{grid-template-columns:repeat(3,1fr);}}
    @media(max-width:640px){.jnk-stats-row{grid-template-columns:1fr 1fr;}.jnk-stats-row .jnk-stat-card:last-child{grid-column:span 2;}}
    @media(max-width:400px){.jnk-stats-row{grid-template-columns:1fr;}.jnk-stats-row .jnk-stat-card:last-child{grid-column:span 1;}}
    .jnk-stat-card{background:#fff;border-radius:18px;padding:16px 16px 14px;border:1px solid rgba(139,92,246,0.08);box-shadow:0 2px 16px rgba(139,92,246,0.07);display:flex;flex-direction:column;gap:4px;transition:transform 0.18s,box-shadow 0.18s;}
    .jnk-stat-card:hover{transform:translateY(-3px);box-shadow:0 8px 28px rgba(139,92,246,0.13);}
    .jnk-stat-icon-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
    .jnk-stat-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
    .jnk-stat-badge{font-size:9px;font-weight:700;padding:3px 8px;border-radius:999px;letter-spacing:0.5px;text-transform:uppercase;}
    .jnk-stat-value{font-size:26px;font-weight:900;color:#1e1b4b;line-height:1;letter-spacing:-1px;}
    .jnk-stat-label{font-size:12px;font-weight:700;color:#4c1d95;margin-top:1px;}
    .jnk-stat-sub{font-size:10px;font-weight:500;color:#a09cc0;margin-top:1px;}
    .jnk-stat-bar-track{height:4px;border-radius:999px;margin-top:10px;overflow:hidden;}
    .jnk-stat-bar-fill{height:4px;border-radius:999px;transition:width 0.5s ease;}
    .jnk-section-title{font-size:14px;font-weight:900;color:#1e1b4b;letter-spacing:-0.2px;margin-bottom:14px;display:flex;align-items:center;gap:8px;}
    .jnk-section-wrap{background:#fff;border-radius:20px;padding:20px 16px;border:1px solid rgba(139,92,246,0.08);box-shadow:0 4px 24px rgba(139,92,246,0.08);margin-bottom:22px;overflow:hidden;width:100%;box-sizing:border-box;}
    .jnk-cat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:4px;width:100%;box-sizing:border-box;}
    @media(max-width:1024px){.jnk-cat-grid{grid-template-columns:repeat(2,1fr);gap:8px;}}
    @media(max-width:600px){.jnk-cat-grid{grid-template-columns:1fr!important;gap:8px;}}
    .jnk-cat-card{background:#fff;border-radius:14px;padding:12px 12px;border:2px solid #ede9fe;display:flex;align-items:center;gap:10px;cursor:pointer;transition:all 0.18s cubic-bezier(.34,1.56,.64,1);position:relative;user-select:none;width:100%;box-sizing:border-box;overflow:hidden;min-width:0;}
    .jnk-cat-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(139,92,246,0.12);border-color:#c4b5fd;}
    .jnk-cat-card.selected{background:linear-gradient(135deg,#f5f3ff,#ede9fe);border-color:#7c3aed;box-shadow:0 4px 18px rgba(139,92,246,0.22);transform:none;}
    .jnk-cat-emoji{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;background:#f5f3ff;border:1px solid #ede9fe;transition:background 0.18s;}
    .jnk-cat-card.selected .jnk-cat-emoji{background:#ddd6fe;border-color:#c4b5fd;}
    .jnk-cat-body{flex:1;min-width:0;}
    .jnk-cat-name{font-size:13px;font-weight:800;color:#1e1b4b;margin-bottom:2px;}
    .jnk-cat-sub{font-size:10px;color:#9c87d4;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .jnk-cat-toggle{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;flex-shrink:0;transition:all 0.18s;background:#f5f3ff;border:2px solid #ddd6fe;color:#a78bfa;}
    .jnk-cat-card.selected .jnk-cat-toggle{background:#7c3aed;border-color:#7c3aed;color:#fff;font-size:13px;}
    .jnk-qty-wrap{display:flex;align-items:center;gap:4px;flex-shrink:0;}
    .jnk-qty-btn{width:28px;height:28px;border-radius:50%;border:1.5px solid #ddd6fe;background:#f5f3ff;color:#7c3aed;font-size:14px;font-weight:900;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;transition:all 0.15s;font-family:var(--font);flex-shrink:0;}
    .jnk-qty-btn:hover{background:#7c3aed;color:#fff;border-color:#7c3aed;}
    .jnk-qty-display{font-size:13px;font-weight:900;color:#4c1d95;min-width:16px;text-align:center;}
    .jnk-selected-row{background:#fff;border-radius:18px;padding:16px 20px;border:1px solid rgba(139,92,246,0.10);box-shadow:0 2px 16px rgba(139,92,246,0.07);display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:24px;}
    .jnk-chips-area{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;}
    .jnk-chip{display:inline-flex;align-items:center;gap:6px;background:#f5f3ff;border:1.5px solid #ddd6fe;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;color:#4c1d95;}
    .jnk-chip-remove{width:18px;height:18px;border-radius:50%;border:none;background:#ddd6fe;color:#7c3aed;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:900;padding:0;line-height:1;transition:all 0.15s;font-family:var(--font);}
    .jnk-chip-remove:hover{background:#7c3aed;color:#fff;}
    .jnk-empty-chips{font-size:12px;color:#c4b5fd;font-weight:600;font-style:italic;}
    .jnk-log-btn{padding:12px 28px;border-radius:999px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;transition:all 0.18s;font-family:var(--font);box-shadow:0 4px 18px rgba(124,58,237,0.35);}
    .jnk-log-btn:hover:not(:disabled){transform:translateY(-2px);}
    .jnk-log-btn:disabled{background:#e5e7eb;color:#9ca3af;box-shadow:none;cursor:not-allowed;}
    .jnk-bottom-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
    @media(max-width:900px){.jnk-bottom-grid{grid-template-columns:1fr;}}
    .jnk-analytics-card{background:#fff;border-radius:20px;padding:20px 22px;border:1px solid rgba(139,92,246,0.08);box-shadow:0 4px 24px rgba(139,92,246,0.08);}
    .jnk-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
    .jnk-card-title{font-size:11px;font-weight:900;color:#8b7fc7;letter-spacing:2px;text-transform:uppercase;}
    .jnk-view-link{font-size:11px;font-weight:700;color:#7c3aed;cursor:pointer;display:flex;align-items:center;gap:4px;background:none;border:none;font-family:var(--font);}
    .jnk-donut-row{display:flex;align-items:center;gap:20px;margin-bottom:18px;}
    .jnk-donut-wrap{position:relative;width:110px;height:110px;flex-shrink:0;}
    .jnk-donut-wrap svg{transform:rotate(-90deg);}
    .jnk-donut-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;}
    .jnk-donut-num{font-size:22px;font-weight:900;color:#1e1b4b;}
    .jnk-donut-lbl{font-size:9px;font-weight:700;color:#9c87d4;text-transform:uppercase;letter-spacing:0.5px;}
    .jnk-legend{flex:1;display:flex;flex-direction:column;gap:6px;}
    .jnk-legend-item{display:flex;align-items:center;gap:7px;font-size:11px;color:#4c1d95;font-weight:600;}
    .jnk-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
    .jnk-legend-pct{margin-left:auto;font-size:10px;color:#9c87d4;font-weight:600;}
    .jnk-summary-stats{background:#f9f8ff;border-radius:14px;padding:12px 16px;border:1px solid #ede9fe;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px;}
    .jnk-sum-item{display:flex;flex-direction:column;gap:1px;}
    .jnk-sum-val{font-size:16px;font-weight:900;color:#1e1b4b;line-height:1;}
    .jnk-sum-label{font-size:10px;font-weight:600;color:#9c87d4;}
    .jnk-activity-list{display:flex;flex-direction:column;gap:10px;}
    .jnk-activity-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:#faf9ff;border:1px solid #ede9fe;transition:all 0.15s;}
    .jnk-activity-item:hover{background:#f5f3ff;border-color:#ddd6fe;}
    .jnk-activity-icon{width:40px;height:40px;border-radius:12px;background:#ede9fe;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
    .jnk-activity-body{flex:1;min-width:0;}
    .jnk-activity-title{font-size:13px;font-weight:800;color:#1e1b4b;margin-bottom:1px;}
    .jnk-activity-sub{font-size:10px;color:#9c87d4;font-weight:500;}
    .jnk-activity-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;}
    .jnk-activity-time{font-size:10px;font-weight:600;color:#b8aee0;white-space:nowrap;}
    .jnk-del-btn{width:28px;height:28px;border-radius:8px;border:1px solid #fecaca;background:#fff5f5;color:#f87171;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;font-family:var(--font);}
    .jnk-del-btn:hover{background:#ef4444;color:#fff;border-color:#ef4444;}
    .j-sec-label{display:flex;align-items:center;gap:8px;font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:#9f8fef;margin:16px 0 8px;}
    .j-sec-label::after{content:'';flex:1;height:1px;background:#e0dcf5;}
    .biry-card{background:linear-gradient(135deg,#fffbeb,#fef3c7);border:1.5px solid #fde68a;border-radius:16px;padding:16px 18px;margin-bottom:12px;}
    .biry-row{display:flex;align-items:center;gap:10px;cursor:pointer;padding:9px 10px;border-radius:11px;transition:background .2s;}
    .biry-row:hover{background:rgba(245,158,11,.1);}
    .b-slots-row{display:flex;align-items:center;gap:8px;flex-shrink:0;}
    .b-slot{width:22px;height:22px;border-radius:50%;border:2.5px solid #f59e0b;background:transparent;transition:all 0.3s cubic-bezier(.34,1.56,.64,1);}
    .b-slot.filled{background:#f59e0b;box-shadow:0 0 10px rgba(245,158,11,0.45);transform:scale(1.1);}
    .b-slot.limit{background:#ef4444;border-color:#ef4444;box-shadow:0 0 10px rgba(239,68,68,0.45);}
    .log-tab-btn{padding:4px 12px;border-radius:18px;border:1.5px solid var(--purple-200);background:#fff;color:var(--purple-600);font-size:11px;font-weight:700;cursor:pointer;transition:all .2s;font-family:var(--font);}
    .log-tab-btn.active{background:var(--purple-600);color:#fff;border-color:var(--purple-600);}
    .j-log-entry{display:flex;align-items:center;gap:9px;padding:10px 0;border-bottom:1px solid #f3f3f5;}
    .j-log-entry:last-child{border-bottom:none;}
    .le-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:18px;}
    .le-badge.low{background:#f0fdf4;color:#16a34a;}
    .le-badge.mid{background:#fffbeb;color:#d97706;}
    .le-badge.hi{background:#fff0f0;color:#dc2626;}
    .le-tag{font-size:9px;padding:2px 6px;border-radius:9px;font-weight:700;margin-left:3px;}
    .le-tag.exceeded{background:#fee2e2;color:#b91c1c;}
    .le-tag.highsugar{background:#fef9c3;color:#92400e;}
    .le-del-btn{background:none;border:none;color:#ddd;font-size:15px;cursor:pointer;margin-left:3px;}
    .le-del-btn:hover{color:#e05555;}
    .sugar-big{font-size:44px;font-weight:900;line-height:1;}
    .sugar-big.g{color:#22c55e;}.sugar-big.y{color:#f59e0b;}.sugar-big.r{color:#ef4444;}
    .sugar-badge{font-size:11px;padding:4px 12px;border-radius:18px;font-weight:700;}
    .sugar-badge.g{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}
    .sugar-badge.y{background:#fffbeb;color:#d97706;border:1px solid #fde68a;}
    .sugar-badge.r{background:#fff0f0;color:#dc2626;border:1px solid #fca5a5;}
    .circ{position:relative;width:90px;height:90px;flex-shrink:0;}
    .circ svg{transform:rotate(-90deg);}
    .circ-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;}
    .circ-pct{font-size:16px;font-weight:900;}
    .circ-pct.g{color:#22c55e;}.circ-pct.y{color:#f59e0b;}.circ-pct.r{color:#ef4444;}
    .s-btn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 5px;border-radius:12px;border:2px solid var(--purple-200);background:var(--purple-50);cursor:pointer;font-weight:700;font-size:11px;color:var(--purple-600);transition:all .2s;font-family:var(--font);}
    .s-btn:hover{background:var(--purple-600);color:#fff;border-color:var(--purple-600);transform:translateY(-2px);}
    .s-btn .s-ico{font-size:18px;}
    .s-btn .s-g{font-size:9px;font-weight:500;opacity:.7;}
    .health-panel{border-radius:12px;padding:12px 14px;margin-top:0;transition:all .4s;}
    .health-panel.g{background:#f0fdf4;border:1.5px solid #bbf7d0;}
    .health-panel.y{background:#fffbeb;border:1.5px solid #fde68a;}
    .health-panel.r{background:#fff5f5;border:1.5px solid #fca5a5;}
    .hp-title{font-size:11px;font-weight:900;letter-spacing:.6px;text-transform:uppercase;margin-bottom:6px;}
    .health-panel.g .hp-title{color:#16a34a;}.health-panel.y .hp-title{color:#d97706;}.health-panel.r .hp-title{color:#dc2626;}
    .hp-item{font-size:11px;line-height:1.8;}
    .cond-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px;}
    .warn-box{border-radius:11px;padding:11px 12px;}
    .warn-box.fatty{background:#fff7ed;border:1.5px solid #fdba74;}
    .warn-box.tonsil{background:#fdf4ff;border:1.5px solid #e9b8fd;}
    .warn-box.danger{background:#fff0f0;border:1.5px solid #fca5a5;grid-column:1/-1;}
    .wb-title{font-size:11px;font-weight:900;margin-bottom:4px;}
    .warn-box.fatty .wb-title{color:#c2410c;}.warn-box.tonsil .wb-title{color:#7e22ce;}.warn-box.danger .wb-title{color:#dc2626;}
    .warn-box ul{margin-left:12px;font-size:10px;line-height:1.8;color:#666;}
    .disc-banner{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border-radius:13px;padding:12px 16px;display:none;align-items:center;gap:10px;margin-bottom:10px;}
    .disc-banner.show{display:flex;}
    .j-prog-track{height:7px;background:#f0f0f0;border-radius:7px;overflow:hidden;margin:7px 0 3px;}
    .j-prog-fill{height:100%;border-radius:7px;transition:width .5s,background .5s;}
    .j-month-nav{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:12px;}
    .j-month-nav button{background:var(--purple-100);border:none;border-radius:50%;width:26px;height:26px;font-size:14px;cursor:pointer;color:var(--purple-600);font-family:var(--font);}
    .j-month-nav button:hover{background:var(--purple-200);}
    .j-month-nav span{font-weight:900;font-size:13px;color:var(--text-primary);}
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────────────────────
   AUTO-BUILD PAGE ON MODULE LOAD
───────────────────────────────────────────────────────────────*/
document.addEventListener('DOMContentLoaded', () => {
  buildJunkPage();
});
