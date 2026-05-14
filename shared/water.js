/**
 * ═══════════════════════════════════════════════════════════════
 * shared/water.js — Water tracker system
 *
 * This module owns:
 * - Water scene HTML builder (submarine, waves, clouds, fish)
 * - Glass buttons (tap to fill)
 * - Water level animation
 * - Bubble/particle/fish effects
 * - Drop/splash animations
 * - Completion detection & celebration
 * - Water reminder engine (schedule, fire, skip)
 * - Hydration insights panel
 *
 * ANIMATION STRATEGY:
 * - requestAnimationFrame for submarine propeller
 * - CSS transitions for water level
 * - CSS animations for waves, fish, clouds
 * - JS-spawned bubbles with CSS @keyframes
 * ═══════════════════════════════════════════════════════════════
 */

import {
  WT_GOAL,
  WT_ML,
  todayKey,
  MONTHS,
  sanitizeHTML,
  showToast,
  confetti,
  validateTimeString,
  formatTime12
} from '../core/utils.js';

import { state, flags } from '../core/state.js';
import { debouncedSave } from '../core/firebase.js';
import { updateStatsBanner } from '../shared/theme.js';
import { checkBadgesDebounced } from '../shared/badges.js';


/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const WT_SCENE_H = 200;
const WT_X0 = 10, WT_X1 = 84, WT_Y0 = 8, WT_CLR = 30;

/** Propeller rotation angle */
let wtPropAng = 0;


/* ═══════════════════════════════════════════════════════════════
   ANIMATION ENGINE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Starts the submarine propeller animation loop.
 * Stores the RAF handle in flags.wtPropRAF for cleanup.
 */
export function wtStartAnimation() {
  if (flags.wtPropRAF) {
    cancelAnimationFrame(flags.wtPropRAF);
    flags.wtPropRAF = null;
  }
  wtPropAng = 0;
  _wtAnimProp();
}

/**
 * @private RAF loop for propeller rotation.
 */
function _wtAnimProp() {
  wtPropAng += 10;
  const p = document.getElementById('wt-prop');
  if (p) p.setAttribute('transform', 'rotate(' + wtPropAng + ',5,20)');
  flags.wtPropRAF = requestAnimationFrame(_wtAnimProp);
}

/**
 * Stops the propeller animation.
 */
export function wtStopAnimation() {
  if (flags.wtPropRAF) {
    cancelAnimationFrame(flags.wtPropRAF);
    flags.wtPropRAF = null;
  }
}


/* ═══════════════════════════════════════════════════════════════
   BUILD WATER GLASSES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Builds or rebuilds the 11 glass buttons in the water panel.
 */
export function wtBuildGlasses() {
  const row = document.getElementById('wt-glasses');
  if (!row) return;
  row.innerHTML = '';

  for (let i = 0; i < WT_GOAL; i++) {
    const b = document.createElement('button');
    b.className = 'wt-glass-btn' + (i < state.water ? ' wt-filled' : '');
    b.innerHTML = '💧';
    b.setAttribute('aria-label', 'Glass ' + (i + 1) + ' of ' + WT_GOAL + (i < state.water ? ' — filled' : ' — empty'));
    b.setAttribute('aria-pressed', i < state.water ? 'true' : 'false');
    b.dataset.i = i;

    b.addEventListener('click', () => {
      if (flags.wtDone) return;
      const idx = i;
      const was = idx < state.water;
      state.water = was ? idx : idx + 1;

      if (!was) {
        wtSpawnDrop();
        wtBubbles(7);
      }

      if (!state.waterLog) state.waterLog = {};
      state.waterLog[todayKey()] = state.water;

      wtApply(state.water / WT_GOAL);
      renderWater();
      debouncedSave();
      renderHydrationInsights();
      updateStatsBanner();
    });

    row.appendChild(b);
  }
}


/* ═══════════════════════════════════════════════════════════════
   wtApply — Updates water level, submarine position, fish, status
   ═══════════════════════════════════════════════════════════════ */

/**
 * Applies the water fill percentage to the scene.
 * Moves submarine, shows/hides fish, updates status text.
 * @param {number} P - Fill percentage 0-1
 */
export function wtApply(P) {
  P = Math.min(Math.max(P, 0), 1);

  if (!flags.cachedSceneHeight) {
    const scene = document.getElementById('wt-scene');
    if (scene) flags.cachedSceneHeight = scene.offsetHeight || WT_SCENE_H;
  }

  const scH = flags.cachedSceneHeight || WT_SCENE_H;
  const maxWH = scH * 0.50;
  const waterPx = P * maxWH;
  const waterPct = (waterPx / scH) * 100;

  requestAnimationFrame(() => {
    // Water level
    const waterEl = document.getElementById('wt-water');
    if (waterEl) waterEl.style.height = waterPct + '%';

    // Submarine position
    const sub = document.getElementById('wt-sub');
    if (sub) {
      if (P <= 0) {
        sub.classList.remove('wt-visible');
        sub.style.left = WT_X0 + '%';
        sub.style.bottom = WT_Y0 + 'px';
      } else {
        sub.classList.add('wt-visible');
        const rawX = WT_X0 + P * (WT_X1 - WT_X0);
        const subY1 = maxWH - WT_CLR;
        const rawB = WT_Y0 + P * (subY1 - WT_Y0);
        const maxB = Math.max(waterPx - WT_CLR, WT_Y0);
        sub.style.left = rawX + '%';
        sub.style.bottom = Math.min(rawB, maxB) + 'px';
      }
    }

    // Fish visibility
    ['wt-fish1', 'wt-fish2', 'wt-fish3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('wt-visible', P > 0.04);
    });

    // Particle visibility
    document.querySelectorAll('.wt-particle')
      .forEach(pt => pt.classList.toggle('wt-visible', P > 0.04));
  });

  // Status text
  const mlEl = document.getElementById('wt-ml-now');
  const stEl = document.getElementById('wt-status');
  if (mlEl) mlEl.textContent = (state.water * WT_ML) + 'ml';
  if (stEl) {
    if (P === 0)      { stEl.textContent = 'start drinking';   stEl.style.color = '#aaa'; }
    else if (P < .30) { stEl.textContent = 'keep going!';      stEl.style.color = '#4A90E2'; }
    else if (P < .70) { stEl.textContent = 'halfway there!';   stEl.style.color = '#2B7AB8'; }
    else if (P < 1)   { stEl.textContent = 'almost there!';    stEl.style.color = '#1a5f8f'; }
    else              { stEl.textContent = 'goal reached!';     stEl.style.color = '#27AE60'; }
  }

  // Completion check
  if (P >= 1 && !flags.wtDone) {
    flags.wtDone = true;
    const cg = document.getElementById('wt-comp-glow');
    if (cg) cg.classList.add('show');
    wtBubbles(20);
    setTimeout(() => {
      const cb = document.getElementById('wt-comp-banner');
      if (cb) cb.classList.add('show');
    }, 700);

    if (!(state.earnedBadges || []).includes('hydrated')) {
      state.earnedBadges = state.earnedBadges || [];
      state.earnedBadges.push('hydrated');
      showToast('New badge: Pool Master!');
      confetti();
      debouncedSave();
    }
  }
}


/* ═══════════════════════════════════════════════════════════════
   renderWater — Syncs glass button states with current water level
   ═══════════════════════════════════════════════════════════════ */

/**
 * Re-renders water glass states and applies water level.
 * Efficiently updates only changed buttons.
 */
export function renderWater() {
  const glasses = document.getElementById('wt-glasses');
  const scene = document.getElementById('wt-scene');
  if (!glasses && !scene) return;

  wtApply(state.water / WT_GOAL);

  if (!glasses) {
    if (scene) wtBuildGlasses();
    return;
  }

  const buttons = glasses.querySelectorAll('.wt-glass-btn');
  if (buttons.length === WT_GOAL) {
    buttons.forEach((btn, i) => {
      const shouldBeFilled = i < state.water;
      const isFilled = btn.classList.contains('wt-filled');
      if (shouldBeFilled !== isFilled) {
        btn.classList.toggle('wt-filled', shouldBeFilled);
        btn.setAttribute('aria-pressed', shouldBeFilled ? 'true' : 'false');
        btn.setAttribute('aria-label', 'Glass ' + (i + 1) + ' of ' + WT_GOAL + (shouldBeFilled ? ' — filled' : ' — empty'));
      }
    });
  } else {
    wtBuildGlasses();
  }
}


/* ═══════════════════════════════════════════════════════════════
   EFFECTS — Drop, Splash, Bubbles, Particles
   ═══════════════════════════════════════════════════════════════ */

/**
 * Spawns a water drop animation falling into the scene.
 */
export function wtSpawnDrop() {
  const scene = document.getElementById('wt-scene');
  if (!scene) return;
  const d = document.createElement('div');
  d.className = 'wt-drop-fall';
  d.textContent = '💧';
  d.style.left = (15 + Math.random() * 65) + '%';
  scene.appendChild(d);
  setTimeout(() => { wtSpawnSplash(d.style.left); d.remove(); }, 950);
}

/**
 * Spawns a splash at the water surface.
 * @param {string} leftCss - CSS left value
 */
export function wtSpawnSplash(leftCss) {
  const scene = document.getElementById('wt-scene');
  if (!scene) return;
  const s = document.createElement('div');
  s.className = 'wt-splash';
  s.textContent = '💦';
  s.style.left = leftCss;
  s.style.top = Math.max(50, 100 - (state.water / WT_GOAL) * 50) + '%';
  scene.appendChild(s);
  setTimeout(() => s.remove(), 800);
}

/**
 * Spawns bubble effects near the submarine.
 * @param {number} [fc] - Forced count (0 = auto based on water level)
 */
export function wtBubbles(fc) {
  const P = state.water / WT_GOAL;
  const count = fc || (P < .3 ? 3 : P < .7 ? 6 : 10);
  const scene = document.getElementById('wt-scene');
  const sub = document.getElementById('wt-sub');
  if (!scene || !sub) return;

  const sL = parseFloat(sub.style.left) || WT_X0;
  const sB = parseFloat(sub.style.bottom) || WT_Y0;

  for (let i = 0; i < count; i++) {
    ((idx) => setTimeout(() => {
      const b = document.createElement('div');
      b.className = 'wt-bubble';
      const sz = 3 + Math.random() * 7;
      b.style.cssText =
        'width:' + sz + 'px;height:' + sz + 'px;' +
        'left:' + (sL + (Math.random() - .5) * 8) + '%;' +
        'bottom:' + (sB + 20 + Math.random() * 12) + 'px;' +
        '--dx:' + ((Math.random() - .5) * 28) + 'px;' +
        'animation-duration:' + (1.1 + Math.random() * 1.3) + 's;';
      scene.appendChild(b);
      setTimeout(() => b.remove(), 2600);
    }, idx * 80))(i);
  }
}

/**
 * Spawns floating particles inside the water body.
 * Only spawns when water > 0.
 */
export function wtSpawnParticles() {
  if ((state.water || 0) <= 0) return;
  const body = document.getElementById('wt-water-body');
  if (!body) return;

  // Remove existing particles
  body.querySelectorAll('.wt-particle').forEach(p => p.remove());

  for (let i = 0; i < 10; i++) {
    const pt = document.createElement('div');
    pt.className = 'wt-particle';
    const sz = 2 + Math.random() * 4;
    pt.style.cssText =
      'width:' + sz + 'px;height:' + sz + 'px;' +
      'left:' + Math.random() * 100 + '%;' +
      'bottom:' + Math.random() * 80 + '%;' +
      'animation-duration:' + (4 + Math.random() * 5) + 's;' +
      'animation-delay:-' + Math.random() * 6 + 's;';
    body.appendChild(pt);
  }
}


/* ═══════════════════════════════════════════════════════════════
   BUILD WATER SECTION — Complete scene HTML
   ═══════════════════════════════════════════════════════════════ */

/**
 * Builds the entire water section card with scene, glasses, reminder, and insights.
 * @returns {HTMLElement} The section card element
 */
export function buildWaterSection() {
  const sc = document.createElement('div');
  sc.className = 'sc sc-water-full-width';

  sc.innerHTML =
    '<div class="sh">' +
      '<span class="si" aria-hidden="true">💧</span>' +
      '<span class="st">Water</span>' +
      '<span class="stag">11 × 300ml = 3.3L</span>' +
    '</div>' +
    '<div class="wt-wrap">' +
      '<div class="wt-scene" id="wt-scene" role="img" aria-label="Water tracker visualization">' +
        '<div class="wt-sun" aria-hidden="true"><div class="wt-sun-core"></div></div>' +
        '<div class="wt-clouds" aria-hidden="true">' +
          '<div class="wt-cloud wc1"><div class="wt-cshape"></div></div>' +
          '<div class="wt-cloud wc2"><div class="wt-cshape"></div></div>' +
          '<div class="wt-cloud wc3"><div class="wt-cshape"></div></div>' +
          '<div class="wt-cloud wc4"><div class="wt-cshape"></div></div>' +
        '</div>' +
        '<div class="wt-water" id="wt-water" aria-hidden="true">' +
          '<div class="wt-water-body" id="wt-water-body">' +
            '<div class="wt-fish" id="wt-fish1" style="bottom:26%;left:68%;font-size:14px;animation-duration:17s;animation-delay:-4s;">🐟</div>' +
            '<div class="wt-fish" id="wt-fish2" style="bottom:54%;left:50%;font-size:10px;animation-duration:23s;animation-delay:-9s;">🐠</div>' +
            '<div class="wt-fish" id="wt-fish3" style="bottom:38%;left:80%;font-size:9px;animation-duration:20s;animation-delay:-6s;">🐡</div>' +
          '</div>' +
          '<div class="wt-wave-wrap">' +
            '<svg viewBox="0 0 1200 20" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
              '<path d="M0,10 C100,2 200,18 300,10 C400,2 500,18 600,10 C700,2 800,18 900,10 C1000,2 1100,18 1200,10 L1200,20 L0,20 Z" fill="rgba(255,255,255,0.32)"/>' +
            '</svg>' +
          '</div>' +
        '</div>' +
        '<div class="wt-sub" id="wt-sub" aria-hidden="true">' +
          '<svg width="62" height="28" viewBox="0 0 64 30" xmlns="http://www.w3.org/2000/svg">' +
            '<ellipse cx="32" cy="20" rx="25" ry="9" fill="#E74C3C"/>' +
            '<rect x="25" y="9" width="13" height="9" rx="3" fill="#C0392B"/>' +
            '<rect x="30" y="4" width="4" height="7" rx="2" fill="#C0392B"/>' +
            '<circle cx="32" cy="4" r="3" fill="#888"/>' +
            '<circle cx="44" cy="20" r="5.5" fill="#5DADE2" opacity=".88"/>' +
            '<ellipse cx="9" cy="20" rx="7" ry="9" fill="#C0392B"/>' +
            '<g id="wt-prop"><ellipse cx="5" cy="20" rx="2" ry="6" fill="#7F8C8D"/>' +
            '<ellipse cx="5" cy="20" rx="6" ry="2" fill="#95A5A6" opacity=".8"/></g>' +
            '<polygon points="29,27 25,30 35,30" fill="#C0392B"/>' +
          '</svg>' +
        '</div>' +
        '<div class="wt-comp-glow" id="wt-comp-glow" aria-hidden="true"></div>' +
        '<div class="wt-comp-banner" id="wt-comp-banner" aria-live="polite">' +
          '<p>🌊 Hydration complete!</p><span>The submarine has surfaced. Well done!</span>' +
        '</div>' +
      '</div>' +
      '<div class="wt-panel">' +
        '<div class="wt-glasses-row" id="wt-glasses" role="group" aria-label="Water glasses — tap to log"></div>' +
        '<div class="wt-info">' +
          '<span class="wt-ml-now" id="wt-ml-now" aria-live="polite">0ml</span>' +
          '<span class="wt-ml-goal">/ 3300ml</span>' +
          '<span class="wt-status" id="wt-status" aria-live="polite" style="color:#aaa;">start drinking</span>' +
        '</div>' +
      '</div>' +
      _buildWaterReminderHTML() +
    '</div>';

  // Hydration insights container (appended inside wt-wrap)
  const hydroDiv = document.createElement('div');
  hydroDiv.id = 'hydration-insights-wrap';
  hydroDiv.className = 'hydro-wrap';
  const wtWrap = sc.querySelector('.wt-wrap');
  if (wtWrap) {
    wtWrap.appendChild(hydroDiv);
  } else {
    sc.appendChild(hydroDiv);
  }

  // Initialize after DOM insertion (deferred)
  setTimeout(() => {
    flags.wtDone = false;
    flags.cachedSceneHeight = 0;
    wtBuildGlasses();
    wtApply(state.water / WT_GOAL);

    // Clear existing idle timer before creating new
    if (flags.wtIdleTmr) { clearInterval(flags.wtIdleTmr); flags.wtIdleTmr = null; }
    flags.wtIdleTmr = setInterval(() => {
      if (state.water > 0 && !flags.wtDone) wtBubbles(0);
    }, 3200);

    wtStartAnimation();
    wtSpawnParticles();

    const hw = document.getElementById('hydration-insights-wrap');
    if (hw) renderHydrationInsights();

    flags.wtSceneInitialized = true;

    // Init reminder if present
    const intInp = document.getElementById('wt-rem-interval');
    if (intInp) wtRemInit();
  }, 100);

  return sc;
}


/* ═══════════════════════════════════════════════════════════════
   WATER REMINDER ENGINE
   ═══════════════════════════════════════════════════════════════ */

const WT_REM_PRESETS = [
  { label: 'Every 30m', interval: 30 },
  { label: 'Every 45m', interval: 45 },
  { label: 'Every 1hr', interval: 60 },
  { label: 'Every 90m', interval: 90 },
  { label: 'Every 2hr', interval: 120 }
];

/** @private Guard for double-init */
let _wtRemInitPending = false;

/**
 * Initializes the water reminder UI and scheduling.
 */
export function wtRemInit() {
  if (_wtRemInitPending) return;
  _wtRemInitPending = true;

  try {
    setTimeout(() => { _wtRemInitPending = false; }, 200);

    if (state.wtReminderInterval === undefined) state.wtReminderInterval = 60;
    if (state.wtReminderTime === undefined) state.wtReminderTime = null;
    if (state.wtReminderEnabled === undefined) state.wtReminderEnabled = false;

    const intInp = document.getElementById('wt-rem-interval');
    const timeInp = document.getElementById('wt-rem-starttime');

    if (intInp) intInp.value = state.wtReminderInterval;
    if (state.wtReminderTime && timeInp) {
      timeInp.value = state.wtReminderTime;
    } else if (timeInp) {
      const n = new Date();
      n.setMinutes(n.getMinutes() + state.wtReminderInterval);
      timeInp.value = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
    }

    wtRemBuildPresets();
    wtRemUpdatePill();
    wtRemUpdateStatus();
    wtRemHighlightPreset(state.wtReminderInterval);

    if (flags.wtRemNextTimeout) { clearTimeout(flags.wtRemNextTimeout); flags.wtRemNextTimeout = null; }
    if (flags.wtRemTimer) { clearInterval(flags.wtRemTimer); flags.wtRemTimer = null; }

    if (state.wtReminderEnabled) {
      wtRemScheduleNext();
      flags.wtRemTimer = setInterval(() => {
        if (document.getElementById('wt-rem-next-pill')) {
          wtRemUpdatePill();
          wtRemUpdateStatus();
        }
      }, 30000);
    }
  } catch (e) {
    _wtRemInitPending = false;
    console.warn('wtRemInit error:', e);
  }
}

/**
 * Schedules the next water reminder notification.
 */
export function wtRemScheduleNext() {
  if (!state.wtReminderEnabled) return;
  const ms = wtRemMsUntilNext();

  if (ms <= 0) {
    const sinceLastFire = state.wtLastReminderFired ? Date.now() - state.wtLastReminderFired : Infinity;
    const sinceAppOpen = Date.now() - flags._wtAppOpenTime;
    const interval = (state.wtReminderInterval || 60) * 60 * 1000;

    if (sinceAppOpen < 30000 || sinceLastFire < 60000) {
      if (flags.wtRemNextTimeout) clearTimeout(flags.wtRemNextTimeout);
      flags.wtRemNextTimeout = setTimeout(() => wtRemFire(), interval);
      return;
    }
    wtRemFire();
    return;
  }

  if (flags.wtRemNextTimeout) clearTimeout(flags.wtRemNextTimeout);
  flags.wtRemNextTimeout = setTimeout(() => wtRemFire(), ms);
}

/**
 * Fires a water reminder notification.
 */
export function wtRemFire() {
  if (!state.wtReminderEnabled) return;
  state.wtLastReminderFired = Date.now();
  debouncedSave(200);

  // Fire notification (uses the notification system from reminders module)
  _fireWaterNotification();

  showToast('Time to drink water!', 'gt');
  wtRemUpdatePill();

  const statusEl = document.getElementById('wt-rem-status');
  if (statusEl) {
    statusEl.textContent = 'Just reminded you! Drink up.';
    statusEl.className = 'wt-rem-status wt-rem-fired';
  }

  if (state.wtReminderEnabled) {
    const interval = (state.wtReminderInterval || 60) * 60 * 1000;
    if (flags.wtRemNextTimeout) clearTimeout(flags.wtRemNextTimeout);
    flags.wtRemNextTimeout = setTimeout(() => wtRemFire(), interval);
  }
}

/**
 * Saves the water reminder settings and starts the schedule.
 */
export function wtRemSave() {
  const intInp = document.getElementById('wt-rem-interval');
  const timeInp = document.getElementById('wt-rem-starttime');

  let interval = intInp ? (parseInt(intInp.value) || 60) : 60;
  interval = Math.max(15, Math.min(240, interval));

  if (timeInp && !validateTimeString(timeInp.value)) {
    showToast('Invalid time format', 'rt');
    return;
  }

  state.wtReminderInterval = interval;
  state.wtReminderTime = timeInp ? timeInp.value : null;
  state.wtReminderEnabled = true;

  const nextMs = wtRemMsUntilNext();
  const minStr = nextMs > 0 ? wtRemFormatCountdown(nextMs) : 'right now';

  wtRemHighlightPreset(interval);
  wtRemUpdatePill();
  wtRemUpdateStatus('Reminder set! Next alert in ' + minStr);

  if (flags.wtRemNextTimeout) { clearTimeout(flags.wtRemNextTimeout); flags.wtRemNextTimeout = null; }
  if (flags.wtRemTimer) { clearInterval(flags.wtRemTimer); flags.wtRemTimer = null; }

  flags.wtRemTimer = setInterval(() => {
    if (document.getElementById('wt-rem-next-pill')) {
      wtRemUpdatePill();
      wtRemUpdateStatus();
    }
  }, 30000);

  wtRemScheduleNext();
  debouncedSave();
  showToast('Water reminder set — every ' + interval + ' min!', 'gt');
}

/**
 * Skips the next scheduled water reminder.
 */
export function wtRemSkip() {
  if (flags.wtRemNextTimeout) { clearTimeout(flags.wtRemNextTimeout); flags.wtRemNextTimeout = null; }
  state.wtLastReminderFired = Date.now();
  const interval = (state.wtReminderInterval || 60) * 60 * 1000;
  wtRemUpdatePill();
  wtRemUpdateStatus('Next reminder skipped. Resuming after that.');
  flags.wtRemNextTimeout = setTimeout(() => wtRemFire(), interval);
  debouncedSave(200);
  showToast('Skipped next water reminder', 'yt');
}

/**
 * Handles interval input change.
 */
export function wtRemOnIntervalChange() {
  const inp = document.getElementById('wt-rem-interval');
  if (!inp) return;
  let v = parseInt(inp.value) || 60;
  v = Math.max(15, Math.min(240, v));
  state.wtReminderInterval = v;
  wtRemHighlightPreset(v);
  wtRemUpdatePill();
  debouncedSave(1500);
}

/**
 * Handles start time input change.
 */
export function wtRemOnTimeChange() {
  const inp = document.getElementById('wt-rem-starttime');
  if (!inp) return;
  if (validateTimeString(inp.value)) {
    state.wtReminderTime = inp.value;
    wtRemUpdatePill();
  }
}

/**
 * Steps the interval up/down by delta minutes.
 * @param {number} delta
 */
export function wtRemStep(delta) {
  const inp = document.getElementById('wt-rem-interval');
  if (!inp) return;
  let v = (parseInt(inp.value) || 60) + delta;
  v = Math.max(15, Math.min(240, v));
  inp.value = v;
  state.wtReminderInterval = v;
  wtRemHighlightPreset(v);
  wtRemUpdatePill();
  debouncedSave(1500);
}


/* ── Reminder helpers ── */

function wtRemMsUntilNext() {
  if (!state.wtReminderEnabled) return -1;
  const now = Date.now();
  const interval = (state.wtReminderInterval || 60) * 60 * 1000;

  if (state.wtLastReminderFired) {
    return (state.wtLastReminderFired + interval) - now;
  }

  if (state.wtReminderTime) {
    const d = new Date();
    const [hh, mm] = state.wtReminderTime.split(':').map(Number);
    d.setHours(hh, mm, 0, 0);
    let startMs = d.getTime();
    if (startMs <= now) {
      const elapsed = now - startMs;
      const periods = Math.floor(elapsed / interval) + 1;
      startMs += periods * interval;
    }
    return startMs - now;
  }

  return interval;
}

function wtRemFormatCountdown(ms) {
  if (ms <= 0) return 'now';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + ' min';
  return totalSec + 's';
}

function wtRemUpdatePill() {
  const pill = document.getElementById('wt-rem-next-pill');
  if (!pill) return;
  if (!state.wtReminderEnabled) { pill.textContent = 'Not set'; pill.className = 'wt-rem-next-pill'; return; }

  const ms = wtRemMsUntilNext();
  if (ms < 0) { pill.textContent = 'Not set'; pill.className = 'wt-rem-next-pill'; }
  else if (ms === 0) { pill.textContent = 'Due now!'; pill.className = 'wt-rem-next-pill overdue'; }
  else if (ms <= 5 * 60 * 1000) { pill.textContent = 'In ' + wtRemFormatCountdown(ms); pill.className = 'wt-rem-next-pill soon'; }
  else { pill.textContent = 'In ' + wtRemFormatCountdown(ms); pill.className = 'wt-rem-next-pill'; }
}

function wtRemUpdateStatus(msg) {
  const el = document.getElementById('wt-rem-status');
  if (!el) return;
  if (msg) { el.textContent = msg; el.className = 'wt-rem-status'; return; }
  if (!state.wtReminderEnabled) { el.textContent = 'Tap "Set Reminder" to enable water alerts.'; el.className = 'wt-rem-status'; return; }

  const ms = wtRemMsUntilNext();
  const interval = state.wtReminderInterval || 60;
  if (ms < 0) { el.textContent = 'Reminder disabled.'; el.className = 'wt-rem-status'; }
  else if (ms === 0) { el.textContent = 'Time to drink water!'; el.className = 'wt-rem-status wt-rem-fired'; }
  else {
    el.className = 'wt-rem-status';
    el.textContent = 'Reminding every ' + interval + ' min · next in ' + wtRemFormatCountdown(ms) + ' · start ' + (state.wtReminderTime || '--:--');
  }
}

function wtRemBuildPresets() {
  const row = document.getElementById('wt-rem-presets');
  if (!row) return;
  row.innerHTML = '';

  WT_REM_PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'wt-rem-preset-btn';
    btn.textContent = p.label;
    btn.dataset.interval = p.interval;
    btn.setAttribute('aria-label', 'Set reminder to ' + p.label);
    btn.addEventListener('click', () => {
      const intInp = document.getElementById('wt-rem-interval');
      if (intInp) intInp.value = p.interval;
      state.wtReminderInterval = p.interval;
      wtRemHighlightPreset(p.interval);
      wtRemUpdatePill();
      wtRemUpdateStatus();
    });
    row.appendChild(btn);
  });
}

function wtRemHighlightPreset(interval) {
  document.querySelectorAll('.wt-rem-preset-btn')
    .forEach(btn => btn.classList.toggle('active-preset', +btn.dataset.interval === +interval));
}


/* ── Water reminder HTML builder ── */

function _buildWaterReminderHTML() {
  return '<div class="wt-reminder-wrap" id="wt-reminder-wrap">' +
    '<div class="wt-rem-header">' +
      '<div class="wt-rem-title"><div class="wt-rem-title-icon" aria-hidden="true">⏰</div>Next Water Reminder</div>' +
      '<div class="wt-rem-next-pill" id="wt-rem-next-pill" aria-live="polite">Not set</div>' +
    '</div>' +
    '<div class="wt-rem-grid">' +
      '<div class="wt-rem-card">' +
        '<div class="wt-rem-card-label">Remind every</div>' +
        '<div class="wt-rem-card-row">' +
          '<input class="wt-rem-interval-input" id="wt-rem-interval" type="number" min="15" max="240" value="60" aria-label="Reminder interval in minutes"/>' +
          '<span class="wt-rem-unit">min</span>' +
          '<div class="wt-rem-stepper">' +
            '<button class="wt-rem-step-btn" id="wt-rem-step-up" aria-label="Increase by 15 minutes">&#9650;</button>' +
            '<button class="wt-rem-step-btn" id="wt-rem-step-down" aria-label="Decrease by 15 minutes">&#9660;</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="wt-rem-card">' +
        '<div class="wt-rem-card-label">Start from time</div>' +
        '<div class="wt-rem-card-row">' +
          '<input class="wt-rem-time-input" id="wt-rem-starttime" type="time" value="08:00" aria-label="Reminder start time"/>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="wt-rem-presets" id="wt-rem-presets" role="group" aria-label="Reminder interval presets"></div>' +
    '<div class="wt-rem-actions">' +
      '<button class="wt-rem-save-btn" id="wt-rem-save-btn">Set Reminder</button>' +
      '<button class="wt-rem-skip-btn" id="wt-rem-skip-btn">Skip Next</button>' +
    '</div>' +
    '<div class="wt-rem-status" id="wt-rem-status" aria-live="polite">Set your reminder interval above</div>' +
  '</div>';
}


/* ── Notification bridge ── */

/**
 * Fires a water notification. Uses the notification system.
 * @private
 */
function _fireWaterNotification() {
  // In-app notification
  const el = document.getElementById('inapp-notif');
  if (el) {
    const iconEl = document.getElementById('inapp-icon');
    const titleEl = document.getElementById('inapp-title');
    const msgEl = document.getElementById('inapp-msg');
    if (iconEl) iconEl.textContent = '💧';
    if (titleEl) titleEl.textContent = 'Drink Water!';
    if (msgEl) msgEl.textContent = "Time for a glass — you're at " + state.water + '/' + WT_GOAL + ' glasses today.';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 7000);
  }

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('Drink Water!', {
        body: "Time for a glass — you're at " + state.water + '/' + WT_GOAL + ' glasses today.',
        icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E",
        tag: 'water_' + new Date().toISOString().slice(0, 16)
      });
    } catch (e) { /* ignore */ }
  }
}


/* ═══════════════════════════════════════════════════════════════
   HYDRATION INSIGHTS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Renders hydration insight cards (today's intake, goal completion, trends).
 */
export function renderHydrationInsights() {
  const container = document.getElementById('hydration-insights-wrap');
  if (!container) return;

  const goal = 3.3;
  const currentL = (state.water || 0) * 0.3;
  const completionPct = Math.min(100, Math.round((currentL / goal) * 100));

  if (!state.waterLog) state.waterLog = {};
  const today = new Date();
  let priorSum = 0, priorDays = 0;

  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const glasses = state.waterLog[key];
    if (glasses !== undefined && glasses > 0) {
      priorSum += glasses * 0.3;
      priorDays++;
    }
  }

  const lastWeekAvg = priorDays > 0 ? parseFloat((priorSum / priorDays).toFixed(1)) : null;
  const diffPct = lastWeekAvg !== null && lastWeekAvg > 0
    ? Math.round(((currentL - lastWeekAvg) / lastWeekAvg) * 100) : 0;
  const isUp = diffPct >= 0;

  let insightText = '';
  if (currentL === 0) insightText = 'You have not logged any water today. Start with a glass of lemon water!';
  else if (!lastWeekAvg) insightText = 'Great start! Keep logging water daily to see your weekly trend.';
  else if (currentL < lastWeekAvg) insightText = 'You are drinking ' + Math.abs(diffPct) + '% less than your recent average. Try adding 1 extra glass before lunch!';
  else if (currentL >= goal) insightText = 'Goal reached! You are fully hydrated. Your liver and skin will thank you!';
  else insightText = 'On track! You are matching your recent average. Keep going!';

  const avgDisplay = currentL.toFixed(1);
  const trendClass = isUp ? 'up' : 'down';
  const trendSymbol = isUp ? '↑' : '↓';

  container.innerHTML =
    '<div class="hydro-divider"></div>' +
    '<div class="hydro-header">HYDRATION INSIGHTS</div>' +
    '<div class="hydro-cards">' +

      // Card 1: Today's intake
      '<div class="hydro-card"><div class="hydro-card-top-bar"></div><div class="hydro-card-body">' +
        '<div class="hydro-icon-ring" aria-hidden="true">💧</div>' +
        '<div class="hydro-card-label">TODAY\'S INTAKE</div>' +
        '<div style="display:flex;align-items:baseline;gap:2px;"><span class="hydro-card-number">' + avgDisplay + '</span><span class="hydro-card-unit">L</span></div>' +
        (lastWeekAvg !== null
          ? '<div class="hydro-trend-pill ' + trendClass + '" aria-label="' + Math.abs(diffPct) + '% ' + (isUp ? 'more' : 'less') + ' than recent average">' + trendSymbol + ' ' + Math.abs(diffPct) + '% vs recent avg</div>'
          : '<div style="font-size:10px;color:#94a3b8;margin-top:6px;">Log daily to see trend</div>') +
      '</div></div>' +

      // Card 2: Goal completion
      '<div class="hydro-card"><div class="hydro-card-top-bar"></div><div class="hydro-card-body">' +
        '<div class="hydro-icon-ring" aria-hidden="true">📅</div>' +
        '<div class="hydro-card-label">GOAL COMPLETION</div>' +
        '<div style="display:flex;align-items:baseline;gap:2px;"><span class="hydro-card-number">' + completionPct + '</span><span class="hydro-card-unit">%</span></div>' +
        '<div class="hydro-bar-track" role="progressbar" aria-valuenow="' + completionPct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<div class="hydro-bar-fill" style="width:' + completionPct + '%"></div></div>' +
        '<div class="hydro-bar-label"><span>0%</span><span>100%</span></div>' +
      '</div></div>' +

      // Card 3: Daily goal
      '<div class="hydro-card"><div class="hydro-card-top-bar"></div><div class="hydro-card-body">' +
        '<div class="hydro-icon-ring" aria-hidden="true">🎯</div>' +
        '<div class="hydro-card-label">DAILY GOAL</div>' +
        '<div style="display:flex;align-items:baseline;gap:2px;"><span class="hydro-card-number">3.3</span><span class="hydro-card-unit">L</span></div>' +
        '<div style="font-size:10px;color:#64748b;margin-top:4px;">' + state.water + '/11 glasses</div>' +
      '</div></div>' +

    '</div>' +
    '<div class="hydro-insight"><div class="hydro-insight-text">' + sanitizeHTML(insightText) + '</div></div>';
}


/* ═══════════════════════════════════════════════════════════════
   EVENT BINDING (called once from init.js)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Binds water reminder button events via event delegation.
 * Should be called once after the water section is in the DOM.
 */
export function bindWaterEvents() {
  // Use event delegation on the app wrapper
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    if (target.id === 'wt-rem-save-btn' || target.closest('#wt-rem-save-btn')) {
      wtRemSave();
    } else if (target.id === 'wt-rem-skip-btn' || target.closest('#wt-rem-skip-btn')) {
      wtRemSkip();
    } else if (target.id === 'wt-rem-step-up' || target.closest('#wt-rem-step-up')) {
      wtRemStep(15);
    } else if (target.id === 'wt-rem-step-down' || target.closest('#wt-rem-step-down')) {
      wtRemStep(-15);
    }
  });

  // Input change events
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'wt-rem-interval') wtRemOnIntervalChange();
    if (e.target && e.target.id === 'wt-rem-starttime') wtRemOnTimeChange();
  });

  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'wt-rem-interval') wtRemOnIntervalChange();
  });
}

/**
 * Cleans up water tracker timers and animations.
 * Called on page switch away from Today and during factory reset.
 */
export function wtCleanup() {
  wtStopAnimation();
  if (flags.wtIdleTmr) { clearInterval(flags.wtIdleTmr); flags.wtIdleTmr = null; }
  if (flags.wtRemTimer) { clearInterval(flags.wtRemTimer); flags.wtRemTimer = null; }
  if (flags.wtRemNextTimeout) { clearTimeout(flags.wtRemNextTimeout); flags.wtRemNextTimeout = null; }
}
