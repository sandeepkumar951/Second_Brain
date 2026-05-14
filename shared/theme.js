/* ═══════════════════════════════════════════════════════════════
   shared/theme.js
   Theme system, XP / level reward, summary cards,
   stats banner, streak card, streak milestone notifications.
   Depends on: core/state.js, core/utils.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  LEVELS,
  DAILY_HOUR_GOAL,
  WT_GOAL,
  WT_ML,
  /* flags */
  _lastThemeKey, setLastThemeKey,
  _lastStreakMilestone, setLastStreakMilestone
} from '../core/state.js';

import {
  sanitizeHTML,
  showToast,
  confetti,
  currentMonthKey,
  todayKey,
  getLevel
} from '../core/utils.js';

/* ─────────────────────────────────────────────────────────────
   THEME DEFINITIONS
───────────────────────────────────────────────────────────────*/
const THEMES = {
  sunrise: {
    key:          'sunrise',
    bodyClass:    'theme-sunrise',
    timeLabel:    'GOOD MORNING',
    nameEmoji:    '🌤️',
    sub:          'The world is waking up with you. Make it count!',
    heroFrom:     '#fef9c3',
    heroMid:      '#fed7aa',
    heroTo:       '#fca5a5',
    progFrom:     '#fb923c',
    progTo:       '#fde047',
    horizonBg:    'linear-gradient(90deg,#f97316,#fbbf24)',
    progWrapBg:   '#fff8f0',
    progLabelColor:'#f97316',
    progRightColor:'#ea580c',
    footerBg:     '#fff7ed',
    footerBorder: '#fed7aa',
    footerText:   '#92400e',
    footerChipBg: '#fed7aa',
    xpPillBg:     'linear-gradient(90deg,#f97316,#fbbf24)',
    datePillColor:'#92400e',
    nameColor:    '#7c2d12',
    labelColor:   '#c2410c',
    subColor:     '#9a3412',
    showSun:      true,
    showMoon:     false,
    showStars:    false,
    showClouds:   true,
    cloudOpacity: 0.4,
    quote:        '"Rise up, start fresh — see the bright opportunity in each new day."',
    themeColor:   '#f97316'
  },
  afternoon: {
    key:          'afternoon',
    bodyClass:    'theme-afternoon',
    timeLabel:    'GOOD AFTERNOON',
    nameEmoji:    '⛅',
    sub:          'Peak hours — stay sharp, stay focused!',
    heroFrom:     '#bae6fd',
    heroMid:      '#7dd3fc',
    heroTo:       '#38bdf8',
    progFrom:     '#0284c7',
    progTo:       '#22d3ee',
    horizonBg:    'linear-gradient(90deg,#0284c7,#06b6d4)',
    progWrapBg:   '#f0f9ff',
    progLabelColor:'#0284c7',
    progRightColor:'#0284c7',
    footerBg:     '#f0f9ff',
    footerBorder: '#bae6fd',
    footerText:   '#0369a1',
    footerChipBg: '#bae6fd',
    xpPillBg:     'linear-gradient(90deg,#0284c7,#06b6d4)',
    datePillColor:'#0c4a6e',
    nameColor:    '#0c4a6e',
    labelColor:   '#0284c7',
    subColor:     '#0369a1',
    showSun:      true,
    showMoon:     false,
    showStars:    false,
    showClouds:   true,
    cloudOpacity: 0.45,
    quote:        '"Focus on being productive instead of busy."',
    themeColor:   '#0284c7'
  },
  night: {
    key:          'night',
    bodyClass:    'theme-night',
    timeLabel:    'GOOD EVENING',
    nameEmoji:    '🌙',
    sub:          'Wind down and reflect — you did great today!',
    heroFrom:     '#0f0c29',
    heroMid:      '#302b63',
    heroTo:       '#24243e',
    progFrom:     '#6366f1',
    progTo:       '#a855f7',
    horizonBg:    'linear-gradient(90deg,#818cf8,#c084fc)',
    progWrapBg:   '#1a1730',
    progLabelColor:'#818cf8',
    progRightColor:'#818cf8',
    footerBg:     '#1a1730',
    footerBorder: '#2e2b5e',
    footerText:   '#818cf8',
    footerChipBg: '#2e2b5e',
    xpPillBg:     'linear-gradient(90deg,#818cf8,#c084fc)',
    datePillColor:'#c7d2fe',
    nameColor:    '#e0e7ff',
    labelColor:   '#a5b4fc',
    subColor:     '#818cf8',
    showSun:      false,
    showMoon:     true,
    showStars:    true,
    showClouds:   false,
    cloudOpacity: 0,
    quote:        '"Rest when you\'re weary. Refresh and renew yourself."',
    themeColor:   '#302b63'
  }
};

/* ─────────────────────────────────────────────────────────────
   GET CURRENT THEME
───────────────────────────────────────────────────────────────*/

/**
 * Returns the theme object matching the current hour.
 * 05:00–10:59 → sunrise
 * 11:00–17:59 → afternoon
 * 18:00–04:59 → night
 */
export function getTheme() {
  const h = new Date().getHours();
  if (h >= 5  && h < 11) return THEMES.sunrise;
  if (h >= 11 && h < 18) return THEMES.afternoon;
  return THEMES.night;
}

/* ─────────────────────────────────────────────────────────────
   APPLY THEME
───────────────────────────────────────────────────────────────*/

/**
 * Applies the current theme to the hero section.
 * Only writes the date pill text when it actually changes.
 * Skips the full DOM rewrite when the theme key is unchanged.
 */
export function applyTheme() {
  const t   = getTheme();
  const now = new Date();

  /* ── Date pill (updates every minute) ── */
  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mths  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h     = now.getHours();
  const mi    = String(now.getMinutes()).padStart(2, '0');
  const h12   = (h % 12) || 12;
  const ampm  = h < 12 ? 'AM' : 'PM';
  const tEmoji= t.showMoon ? '🌙' : (h < 11 ? '🌅' : '☀️');

  const newDateText =
    tEmoji + ' ' + days[now.getDay()] + ', ' +
    now.getDate() + ' ' + mths[now.getMonth()] +
    ' · ' + h12 + ':' + mi + ' ' + ampm;

  const datePill = document.getElementById('theme-date-pill');
  if (datePill && datePill.textContent !== newDateText) {
    datePill.textContent    = newDateText;
    datePill.style.color    = t.datePillColor;
  }

  /* ── Skip full DOM rewrite if theme unchanged ── */
  if (_lastThemeKey === t.key) return;
  setLastThemeKey(t.key);

  /* ── Hero background ── */
  const heroBg = document.getElementById('theme-hero-bg');
  if (heroBg)
    heroBg.style.background =
      'linear-gradient(135deg,' + t.heroFrom + ' 0%,' +
      t.heroMid + ' 50%,' + t.heroTo + ' 100%)';

  /* ── Sun / moon / stars / clouds ── */
  const sun   = document.getElementById('theme-hero-sun');
  const moon  = document.getElementById('theme-hero-moon');
  const stars = document.getElementById('theme-hero-stars');

  if (sun) {
    sun.style.opacity   = t.showSun ? '0.35' : '0';
    sun.style.background=
      'radial-gradient(circle,#FFFDE7 0%,#FFD740 40%,transparent 70%)';
  }
  if (moon) {
    moon.style.opacity  = t.showMoon ? '1' : '0';
    if (t.showMoon) {
      moon.style.background = '#fefce8';
      moon.style.boxShadow  = '10px -5px 0 4px ' + t.heroFrom;
    }
  }
  if (stars) {
    stars.style.opacity = t.showStars ? '1' : '0';
    if (t.showStars && !stars.children.length) _buildThemeStars(stars);
  }

  ['a','b','c','d'].forEach(c => {
    const el = document.getElementById('theme-cloud-' + c);
    if (el) el.style.opacity = t.showClouds ? String(t.cloudOpacity) : '0';
  });

  /* ── Horizon ── */
  const horizon = document.getElementById('theme-horizon');
  if (horizon) horizon.style.background = t.horizonBg;

  /* ── Progress bar ── */
  const progWrap  = document.getElementById('theme-prog-wrap');
  const progLabel = document.getElementById('theme-prog-label');
  const progFill  = document.getElementById('theme-prog-fill');
  const progRight = document.getElementById('theme-prog-right');
  if (progWrap)  progWrap.style.background  = t.progWrapBg;
  if (progLabel) progLabel.style.color      = t.progLabelColor;
  if (progFill)  progFill.style.background  =
    'linear-gradient(90deg,' + t.progFrom + ',' + t.progTo + ')';
  if (progRight) progRight.style.color      = t.progRightColor;

  /* ── Greeting text ── */
  const greetLabel = document.getElementById('theme-greeting-label');
  const greetName  = document.getElementById('theme-greeting-name');
  const greetSub   = document.getElementById('theme-greeting-sub');
  if (greetLabel) { greetLabel.textContent  = t.timeLabel; greetLabel.style.color = t.labelColor; }
  if (greetName)  { greetName.textContent   = t.nameEmoji + ' Sandy!'; greetName.style.color = t.nameColor; }
  if (greetSub)   { greetSub.textContent    = t.sub; greetSub.style.color = t.subColor; }

  /* ── XP pill + grow pill ── */
  const xpPill   = document.getElementById('theme-xp-pill');
  const growPill = document.getElementById('theme-grow-pill');
  if (xpPill)   xpPill.style.background   = t.xpPillBg;
  if (growPill) growPill.style.background =
    t.bodyClass === 'theme-night'
      ? 'linear-gradient(90deg,#14532d,#166534)'
      : '';

  /* ── Footer bar ── */
  const footerBar   = document.getElementById('theme-footer-bar');
  const footerQuote = document.getElementById('theme-footer-quote');
  if (footerBar) {
    footerBar.style.background  = t.footerBg;
    footerBar.style.borderColor = t.footerBorder;
  }
  if (footerQuote) {
    footerQuote.textContent  = t.quote;
    footerQuote.style.color  = t.footerText;
  }
  document.querySelectorAll('.theme-footer-chip').forEach(c => {
    c.style.background  = t.footerChipBg;
    c.style.color       = t.footerText;
    c.style.borderColor = t.footerBorder;
  });

  /* ── Body class ── */
  document.body.className = t.bodyClass || '';

  /* ── Theme-color meta tag ── */
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta      = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = t.themeColor;

  /* Trigger reward update whenever theme changes */
  updateReward();
}

/* ─────────────────────────────────────────────────────────────
   BUILD THEME STARS
───────────────────────────────────────────────────────────────*/
function _buildThemeStars(container) {
  [
    [8,22,1.5,0.9],[16,45,1,0.8],[28,18,2,0.7],[42,55,1.2,0.8],
    [55,15,1.5,0.6],[68,42,1,0.9],[78,22,2,0.7],[88,50,1.2,0.8],
    [95,18,1.5,0.9],[12,70,1,0.6],[45,80,1.5,0.7],[72,75,1,0.5],
    [88,85,1.5,0.6],[35,35,1,0.7],[62,28,1.2,0.8]
  ].forEach(a => {
    const s = document.createElement('div');
    s.className  = 'theme-star';
    s.style.cssText =
      'left:'    + a[0] + '%;' +
      'top:'     + a[1] + '%;' +
      'width:'   + (a[2]*2) + 'px;' +
      'height:'  + (a[2]*2) + 'px;' +
      'opacity:' + a[3] + ';' +
      'position:absolute;border-radius:50%;background:#fff;';
    container.appendChild(s);
  });
}

/* ─────────────────────────────────────────────────────────────
   XP / LEVEL REWARD
───────────────────────────────────────────────────────────────*/

/**
 * Updates the level progress bar, XP pill, level badge,
 * and grow pill from state.totalPts.
 */
export function updateReward() {
  const pts      = state.totalPts || 0;
  const lv       = getLevel(pts);
  const range    = lv.next - lv.min;
  const progress = range > 0 ? Math.min(100, Math.round((pts - lv.min) / range * 100)) : 100;
  const t        = getTheme();

  /* Progress bar */
  const tpf = document.getElementById('theme-prog-fill');
  if (tpf) {
    tpf.style.background = 'linear-gradient(90deg,' + t.progFrom + ',' + t.progTo + ')';
    tpf.style.width      = progress + '%';
    const track = tpf.closest('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', progress);
  }

  /* Progress label */
  const tpl = document.getElementById('theme-prog-label');
  if (tpl) {
    tpl.style.color  = t.progLabelColor;
    tpl.textContent  = 'LEVEL PROGRESS — ' + pts + ' XP';
  }

  /* Progress right hint */
  const tpr = document.getElementById('theme-prog-right');
  if (tpr) {
    const msgs = [
      'Complete tasks to level up!',
      'Keep going!',
      'Halfway to next level!',
      'Almost there!',
      'Level up soon!'
    ];
    tpr.textContent  = msgs[Math.min(4, Math.floor(progress / 25))];
    tpr.style.color  = t.progRightColor;
  }

  /* Level badge */
  const tlb = document.getElementById('theme-prog-level-badge');
  if (tlb) tlb.textContent = lv.label;

  /* XP pill in hero */
  const xpPill = document.getElementById('theme-xp-pill');
  if (xpPill)  xpPill.textContent = pts + ' XP';

  /* Grow pill shows current level label */
  const growPill = document.getElementById('theme-grow-pill');
  if (growPill)  growPill.textContent = lv.label;

  /* Trigger badge and summary checks */
  import('../shared/badges.js').then(m => {
    if (m.checkBadgesDebounced) m.checkBadgesDebounced();
  });
  updateSummaryCards();
}

/* ─────────────────────────────────────────────────────────────
   UPDATE PROGRESS (alias used by today.js)
───────────────────────────────────────────────────────────────*/
export function updateProg() {
  updateSummaryCards();
}

/* ─────────────────────────────────────────────────────────────
   FOOTER CHIPS UPDATE
───────────────────────────────────────────────────────────────*/

/**
 * Updates the three footer chips — streak, tasks, XP.
 * Exported so any module can call it after changing pts.
 */
export function _updateFooterChips() {
  const all      = document.querySelectorAll('.ci[data-key]');
  const doneItems= document.querySelectorAll('.ci[data-key].done');

  const sc = document.getElementById('footer-chip-streak');
  const tc = document.getElementById('footer-chip-tasks');
  const xc = document.getElementById('footer-chip-xp');

  if (sc) sc.textContent = (state.ctStreakDays || 0) + ' Day Streak';
  if (tc) tc.textContent = doneItems.length + '/' + all.length + ' Tasks';
  if (xc) xc.textContent = (state.totalPts   || 0) + ' XP';
}

/* ─────────────────────────────────────────────────────────────
   STREAK CARD
───────────────────────────────────────────────────────────────*/

function _getStreakStage(days) {
  if (days <= 0)  return 0;
  if (days <= 3)  return 1;
  if (days <= 14) return 2;
  if (days <= 29) return 3;
  return 4;
}

function _getTreeSVG(stage) {
  const trees = {
    0: '<svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">' +
       '<path d="M18,62 L21,74 L43,74 L46,62 Z" fill="#B45309"/>' +
       '<rect x="15" y="57" width="34" height="7" rx="3.5" fill="#D97706"/>' +
       '<rect x="31" y="36" width="2.5" height="21" rx="1.2" fill="#9CA3AF" opacity="0.6"/>' +
       '</svg>',
    1: '<svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">' +
       '<path d="M18,62 L21,74 L43,74 L46,62 Z" fill="#B45309"/>' +
       '<rect x="15" y="57" width="34" height="7" rx="3.5" fill="#D97706"/>' +
       '<rect x="31" y="30" width="3" height="27" rx="1.5" fill="#16A34A"/>' +
       '<ellipse cx="23" cy="40" rx="10" ry="5" fill="#4ADE80" transform="rotate(-35 23 40)"/>' +
       '<ellipse cx="41" cy="37" rx="10" ry="5" fill="#4ADE80" transform="rotate(35 41 37)"/>' +
       '<circle cx="32" cy="27" r="7" fill="#86EFAC"/>' +
       '</svg>',
    2: '<svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">' +
       '<path d="M18,64 L21,74 L43,74 L46,64 Z" fill="#B45309"/>' +
       '<rect x="30" y="30" width="5" height="29" rx="2.5" fill="#92400E"/>' +
       '<circle cx="32" cy="22" r="14" fill="#22C55E"/>' +
       '<circle cx="20" cy="30" r="10" fill="#4ADE80" opacity="0.9"/>' +
       '<circle cx="44" cy="30" r="10" fill="#4ADE80" opacity="0.9"/>' +
       '</svg>',
    3: '<svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">' +
       '<path d="M16,65 L20,74 L44,74 L48,65 Z" fill="#92400E"/>' +
       '<rect x="30" y="24" width="6" height="36" rx="3" fill="#78350F"/>' +
       '<circle cx="32" cy="16" r="16" fill="#16A34A"/>' +
       '<circle cx="18" cy="26" r="11" fill="#22C55E" opacity="0.92"/>' +
       '<circle cx="46" cy="26" r="11" fill="#22C55E" opacity="0.92"/>' +
       '<circle cx="12" cy="20" r="8"  fill="#4ADE80" opacity="0.85"/>' +
       '</svg>',
    4: '<svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg">' +
       '<path d="M14,66 L18,75 L46,75 L50,66 Z" fill="#92400E"/>' +
       '<rect x="29" y="18" width="8" height="42" rx="4" fill="#78350F"/>' +
       '<circle cx="32" cy="12" r="18" fill="#15803D"/>' +
       '<circle cx="16" cy="22" r="13" fill="#16A34A" opacity="0.95"/>' +
       '<circle cx="48" cy="22" r="13" fill="#16A34A" opacity="0.95"/>' +
       '<circle cx="20" cy="6"  r="9"  fill="#4ADE80" opacity="0.82"/>' +
       '<circle cx="44" cy="4"  r="9"  fill="#4ADE80" opacity="0.82"/>' +
       '</svg>'
  };
  return trees[stage] || trees[0];
}

function updateStreakCard() {
  const days  = state.ctStreakDays || 0;
  const stage = _getStreakStage(days);

  const grads = {
    0: 'linear-gradient(135deg,#6B7280,#4B5563)',
    1: 'linear-gradient(135deg,#7C3AED,#4F46E5)',
    2: 'linear-gradient(135deg,#059669,#0284C7)',
    3: 'linear-gradient(135deg,#D97706,#EA580C)',
    4: 'linear-gradient(135deg,#15803D,#065F46)'
  };
  const subs = {
    0: 'Start today! Plant the seed',
    1: days === 1 ? 'Day 1! Come back tomorrow' : days + ' days! Sprouting',
    2: days + ' days strong! Growing',
    3: days + ' days! Flourishing',
    4: days + ' days! Unstoppable!'
  };

  const card     = document.getElementById('streak-card');
  const treeArea = document.getElementById('streak-tree-area');
  const numEl    = document.getElementById('streak-number');
  const subEl    = document.getElementById('streak-sub');
  const dotsRow  = document.getElementById('streak-dots-row');

  if (!card) return;

  card.style.background = grads[stage];
  if (treeArea) treeArea.innerHTML = _getTreeSVG(stage);
  if (numEl)    numEl.textContent  = days;
  if (subEl)    subEl.textContent  = subs[stage];

  if (dotsRow) {
    dotsRow.innerHTML = '';
    const stageMins = { 0:0, 1:1,  2:4,  3:15, 4:30  };
    const stageMaxs = { 0:1, 1:3,  2:14, 3:29, 4:365 };
    const stageMin  = stageMins[stage] || 0;
    const stageMax  = stageMaxs[stage] || 1;
    const litCount  = Math.min(12,
      Math.round(((days - stageMin) / (stageMax - stageMin)) * 12)
    );
    for (let i = 0; i < 12; i++) {
      const dot = document.createElement('div');
      dot.className = 'streak-dot' + (i < litCount ? ' lit' : '');
      dotsRow.appendChild(dot);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   SUMMARY CARDS
───────────────────────────────────────────────────────────────*/

/**
 * Updates all three summary cards — streak, tasks, badges —
 * plus the footer chips and stats banner.
 */
export function updateSummaryCards() {
  updateStreakCard();

  /* Tasks card */
  const all      = document.querySelectorAll('.ci[data-key]');
  const doneItems= document.querySelectorAll('.ci[data-key].done');
  const total    = all.length;
  const doneCount= doneItems.length;
  const pct      = total > 0 ? Math.round(doneCount / total * 100) : 0;

  const tn  = document.getElementById('sum-tasks-num');
  const tl  = document.getElementById('sum-tasks-label');
  const ts  = document.getElementById('sum-tasks-sub');
  const tb  = document.getElementById('sum-task-bar-fill');
  const tp  = document.getElementById('sum-task-pct');
  const tdr = document.getElementById('tasks-dots-row');

  if (tn) tn.textContent = doneCount;
  if (tl) tl.textContent = '/ ' + total + ' Tasks Done';
  if (ts) ts.textContent =
    doneCount === 0     ? 'Start checking off tasks!'    :
    doneCount === total ? 'All done! Amazing!'            :
                          'Morning routine in progress';
  if (tb) tb.style.width = pct + '%';
  if (tp) tp.textContent =
    pct + '% done' + (pct === 100 ? ' 🎉' : pct > 0 ? ' — keep going!' : '');

  const taskBar = tb ? tb.closest('[role="progressbar"]') : null;
  if (taskBar) taskBar.setAttribute('aria-valuenow', pct);

  if (tdr) {
    tdr.innerHTML = '';
    const filled = Math.round((pct / 100) * 12);
    for (let i = 0; i < 12; i++) {
      const d = document.createElement('div');
      d.className = 'tasks-dot' + (i < filled ? ' lit' : '');
      tdr.appendChild(d);
    }
  }

  /* Badges card */
  const earned      = (state.earnedBadges || []).length;
  let   totalBadges = 20;

  /* Try to get the real badge count from the badges module */
  import('../shared/badges.js').then(m => {
    if (m.BADGES) totalBadges = m.BADGES.length;
    _updateBadgesCard(earned, totalBadges);
  }).catch(() => _updateBadgesCard(earned, totalBadges));

  /* Footer chips */
  _updateFooterChips();

  /* Stats banner */
  updateStatsBanner();
}

function _updateBadgesCard(earned, totalBadges) {
  const bs  = document.getElementById('sum-badges-sub');
  const br  = document.getElementById('sum-badges-row');
  const bdr = document.getElementById('badges-dots-row');

  if (bs) bs.textContent = earned + ' earned · ' + (totalBadges - earned) + ' locked';

  if (br) {
    br.innerHTML = '';
    import('../shared/badges.js').then(m => {
      if (!m.BADGES) return;
      const ids = state.earnedBadges || [];

      /* Show earned badges */
      m.BADGES.forEach(b => {
        if (ids.includes(b.id)) {
          const ic = document.createElement('div');
          ic.className = 'badge-circle';
          ic.textContent = b.icon;
          ic.title       = b.name;
          ic.setAttribute('aria-label', b.name + ' badge earned');
          br.appendChild(ic);
        }
      });

      /* Show up to 4 locked badges as placeholders */
      m.BADGES
        .filter(b => !ids.includes(b.id))
        .slice(0, Math.max(0, 4 - earned))
        .forEach(b => {
          const ic = document.createElement('div');
          ic.className = 'badge-circle locked';
          ic.textContent = b.icon;
          ic.setAttribute('aria-label', b.name + ' badge locked');
          br.appendChild(ic);
        });
    });
  }

  if (bdr) {
    bdr.innerHTML = '';
    const filledB = Math.min(12, earned);
    for (let j = 0; j < 12; j++) {
      const bd = document.createElement('div');
      bd.className = 'badges-dot' + (j < filledB ? ' lit' : '');
      bdr.appendChild(bd);
    }
  }

  /* Footer chips */
  const sc = document.getElementById('footer-chip-streak');
  const tc = document.getElementById('footer-chip-tasks');
  const xc = document.getElementById('footer-chip-xp');

  const all       = document.querySelectorAll('.ci[data-key]');
  const doneItems = document.querySelectorAll('.ci[data-key].done');

  if (sc) sc.textContent = (state.ctStreakDays || 0) + ' Day Streak';
  if (tc) tc.textContent = doneItems.length + '/' + all.length + ' Tasks';
  if (xc) xc.textContent = (state.totalPts   || 0) + ' XP';
}

/* ─────────────────────────────────────────────────────────────
   STATS BANNER
───────────────────────────────────────────────────────────────*/

/**
 * Updates the four stats banner items:
 * water, sugar (weekly), study hours, junk (monthly).
 */
export function updateStatsBanner() {
  const curMk    = currentMonthKey();
  const junkCount= (state.junkLog || []).filter(e => e.monthKey === curMk).length;
  const water    = state.water     || 0;
  const sugar    = state.weeklyGrams || 0;
  const study    = state.ctStudyHrs  || 0;

  /* Water */
  const wVal = document.getElementById('sb-water-val');
  const wBar = document.getElementById('sb-water-bar');
  const wSub = document.getElementById('sb-water-sub');
  if (wVal) wVal.textContent   = water + '/11';
  if (wBar) { wBar.style.width = Math.min(100, (water / 11) * 100) + '%'; wBar.style.background = '#0284c7'; }
  if (wSub) {
    wSub.textContent = (water * WT_ML) + 'ml';
    wSub.style.cssText = 'background:#eff6ff;color:#0284c7;border-color:#bfdbfe;' +
      'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';
  }

  /* Sugar */
  const sVal  = document.getElementById('sb-sugar-val');
  const sBar  = document.getElementById('sb-sugar-bar');
  const sSub  = document.getElementById('sb-sugar-sub');
  const sItem = document.querySelector('.stats-banner-item.sugar-item');

  let sc2  = '#22c55e';
  let scls = '';
  let sss  = 'background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;' +
             'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';

  if (sugar > 50) {
    sc2  = '#ef4444'; scls = 'danger';
    sss  = 'background:#fef2f2;color:#dc2626;border-color:#fecaca;' +
           'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';
  } else if (sugar > 25) {
    sc2  = '#f59e0b'; scls = 'warn';
    sss  = 'background:#fffbeb;color:#d97706;border-color:#fde68a;' +
           'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';
  }

  if (sVal)  sVal.textContent   = sugar + 'g';
  if (sBar)  { sBar.style.width = Math.min(100, (sugar / 50) * 100) + '%'; sBar.style.background = sc2; }
  if (sSub)  { sSub.textContent = sugar + '/50g'; sSub.style.cssText = sss; }
  if (sItem) sItem.className    = 'stats-banner-item sugar-item ' + scls;

  /* Study */
  const stVal  = document.getElementById('sb-study-val');
  const stBar  = document.getElementById('sb-study-bar');
  const stSub  = document.getElementById('sb-study-sub');
  const stItem = document.querySelector('.stats-banner-item.study-item');

  let stc  = '#f59e0b';
  let stcls= '';
  let stss = 'background:#fffbeb;color:#d97706;border-color:#fde68a;' +
             'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';

  if (study >= DAILY_HOUR_GOAL) {
    stc  = '#22c55e'; stcls = 'done';
    stss = 'background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;' +
           'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';
  }

  if (stVal)  stVal.textContent   = study + 'h';
  if (stBar)  { stBar.style.width = Math.min(100, (study / DAILY_HOUR_GOAL) * 100) + '%'; stBar.style.background = stc; }
  if (stSub)  { stSub.textContent = study + '/4 hrs'; stSub.style.cssText = stss; }
  if (stItem) stItem.className    = 'stats-banner-item study-item ' + stcls;

  /* Junk */
  const jVal  = document.getElementById('sb-junk-val');
  const jBar  = document.getElementById('sb-junk-bar');
  const jSub  = document.getElementById('sb-junk-sub');
  const jItem = document.querySelector('.stats-banner-item.junk-item');

  let jc  = '#22c55e';
  let jcls= '';
  let jst = 'Clean';
  let jss = 'background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;' +
            'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';

  if (junkCount >= 4) {
    jc  = '#ef4444'; jcls = 'danger'; jst = 'Limit!';
    jss = 'background:#fef2f2;color:#dc2626;border-color:#fecaca;' +
          'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';
  } else if (junkCount >= 3) {
    jc  = '#f59e0b'; jcls = 'warn'; jst = 'Caution';
    jss = 'background:#fffbeb;color:#d97706;border-color:#fde68a;' +
          'font-size:9px;font-weight:600;padding:2px 8px;border-radius:var(--r-pill);border:1px solid;';
  }

  if (jVal)  jVal.textContent   = junkCount + '/4';
  if (jBar)  { jBar.style.width = Math.min(100, (junkCount / 4) * 100) + '%'; jBar.style.background = jc; }
  if (jSub)  { jSub.textContent = jst; jSub.style.cssText = jss; }
  if (jItem) jItem.className    = 'stats-banner-item junk-item ' + jcls;
}

/* ─────────────────────────────────────────────────────────────
   STREAK MILESTONE NOTIFICATIONS
───────────────────────────────────────────────────────────────*/

/**
 * Fires a toast + confetti when the user hits a streak milestone.
 * _lastStreakMilestone persists through daily resets so it only
 * fires once per milestone.
 */
export function checkStreakMilestone() {
  const streak = state.ctStreakDays || 0;
  if (streak <= _lastStreakMilestone) return;

  const milestones = [3, 7, 14, 21, 30, 60, 90, 100, 150, 200, 365];
  const hit = milestones.find(m => m > _lastStreakMilestone && m <= streak);

  if (!hit) { setLastStreakMilestone(streak); return; }
  setLastStreakMilestone(streak);

  const msgs = {
    3:   '3-day streak! You are building a habit!',
    7:   'One full week! Week Warrior achieved!',
    14:  'Two weeks straight! Incredible!',
    21:  '21 days — habit locked in!',
    30:  '30 days! Monthly Legend unlocked!',
    60:  '60 days! You are unstoppable!',
    90:  '90 days! Three months of dedication!',
    100: '100 day streak! Century achieved!',
    150: '150 days! Elite level consistency!',
    200: '200 days! You are a legend!',
    365: 'ONE FULL YEAR! Absolute champion!'
  };

  if (msgs[hit]) { showToast(msgs[hit], 'gt'); confetti(); }
}
