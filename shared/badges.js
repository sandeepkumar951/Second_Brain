/* ═══════════════════════════════════════════════════════════════
   shared/badges.js
   Badge definitions and the debounced badge checker.
   Each badge has an id, icon, name, desc, and a condition
   function that receives the full state object.
   Depends on: core/state.js, core/utils.js, core/firebase.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  state,
  /* flags */
  badgeCheckTimer, setBadgeCheckTimer
} from '../core/state.js';

import {
  todayKey,
  showToast,
  confetti,
  safeLocalStorageSave,
  DB_KEY
} from '../core/utils.js';

import {
  userRef,
  debouncedSave
} from '../core/firebase.js';

/* ─────────────────────────────────────────────────────────────
   BADGE DEFINITIONS
   condition(state) → boolean
   Keep conditions pure — no side effects, no async.
───────────────────────────────────────────────────────────────*/
export const BADGES = [

  /* ── Daily habits ── */
  {
    id:   'first_step',
    icon: '👣',
    name: 'First Step',
    desc: 'Complete your first task',
    condition: s => (s.totalPts || 0) >= 3
  },
  {
    id:   'early_bird',
    icon: '🐦',
    name: 'Early Bird',
    desc: 'Complete morning routine',
    condition: s =>
      ['lemon','almonds','walnuts','amla']
        .every(k => s.checks && s.checks[k] === true)
  },
  {
    id:   'skin_care',
    icon: '✨',
    name: 'Glow Up',
    desc: 'Complete skin care routine',
    condition: s =>
      ['facewash_am','moisturizer','sunscreen']
        .every(k => s.checks && s.checks[k] === true)
  },
  {
    id:   'night_owl',
    icon: '🌃',
    name: 'Night Owl',
    desc: 'Complete full night routine',
    condition: s =>
      ['facewash_pm','hair_tablets','revision','sleep']
        .every(k => s.checks && s.checks[k] === true)
  },

  /* ── Water ── */
  {
    id:   'hydrated',
    icon: '💧',
    name: 'Pool Master',
    desc: 'Fill the water pool!',
    condition: s => (s.water || 0) >= 11
  },
  {
    id:   'water_week',
    icon: '🌊',
    name: 'Hydration Hero',
    desc: 'Hit the water goal 3 days in a row',
    condition: s => {
      if (!s.waterLog) return false;
      const now = new Date();
      let run   = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const k =
          d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        if ((s.waterLog[k] || 0) >= 11) {
          run++;
          if (run >= 3) return true;
        } else if (i > 0) {
          break;
        }
      }
      return run >= 3;
    }
  },

  /* ── Study streaks ── */
  {
    id:   'streak3',
    icon: '🔥',
    name: '3-Day Streak',
    desc: 'Study 3 days in a row',
    condition: s => (s.ctStreakDays || 0) >= 3
  },
  {
    id:   'streak7',
    icon: '💪',
    name: 'Week Warrior',
    desc: 'Study 7 days in a row',
    condition: s => (s.ctStreakDays || 0) >= 7
  },
  {
    id:   'streak14',
    icon: '🚀',
    name: 'Fortnight Fire',
    desc: 'Study 14 days in a row',
    condition: s => (s.ctStreakDays || 0) >= 14
  },
  {
    id:   'streak30',
    icon: '🏆',
    name: 'Monthly Legend',
    desc: 'Study 30 days in a row',
    condition: s => (s.ctStreakDays || 0) >= 30
  },

  /* ── XP milestones ── */
  {
    id:   'pts100',
    icon: '⭐',
    name: 'Century',
    desc: 'Earn 100 total XP',
    condition: s => (s.totalPts || 0) >= 100
  },
  {
    id:   'pts500',
    icon: '🌟',
    name: '500 Club',
    desc: 'Earn 500 total XP',
    condition: s => (s.totalPts || 0) >= 500
  },

  /* ── Career readiness ── */
  {
    id:   'career25',
    icon: '📊',
    name: 'Quarter Way',
    desc: 'Reach 25% career readiness',
    condition: s => _ctOverallPct(s) >= 25
  },
  {
    id:   'career50',
    icon: '🎯',
    name: 'Halfway There',
    desc: 'Reach 50% career readiness',
    condition: s => _ctOverallPct(s) >= 50
  },
  {
    id:   'career100',
    icon: '🏅',
    name: 'Job Ready!',
    desc: 'Reach 100% career readiness',
    condition: s => _ctOverallPct(s) >= 100
  },

  /* ── Language ── */
  {
    id:   'lang_hi',
    icon: '🇮🇳',
    name: 'Hindi Hero',
    desc: 'Complete all 3 Hindi tasks today',
    condition: s => !!(s.hiReadDone && s.hiSpeakDone && s.hiLearnDone)
  },
  {
    id:   'lang_en',
    icon: '🇬🇧',
    name: 'English Star',
    desc: 'Complete all 3 English tasks today',
    condition: s => !!(s.engReadDone && s.engSpeakDone && s.engLearnDone)
  },

  /* ── Sugar control ── */
  {
    id:   'sugar_ctrl',
    icon: '🍬',
    name: 'Sugar Boss',
    desc: 'Keep weekly sugar under 25g with at least 1 entry',
    condition: s =>
      (s.weeklyGrams || 0) <= 25 &&
      (s.sugarLog || []).filter(e => e.weekStart === s.sugarWeekStart).length >= 1
  },

  /* ── Weekly planner ── */
  {
    id:   'weekly5',
    icon: '📅',
    name: 'Weekly Planner',
    desc: 'Complete 5 weekly tasks',
    condition: s =>
      (s.weeklyTasks || []).filter(t => t.done).length >= 5
  }
];

/* ─────────────────────────────────────────────────────────────
   BADGE CHECKER
───────────────────────────────────────────────────────────────*/

/**
 * Debounced badge check — runs 150 ms after the last call.
 * Iterates all badges, evaluates conditions, awards new ones,
 * persists to localStorage and Firebase.
 */
export function checkBadgesDebounced() {
  if (badgeCheckTimer) clearTimeout(badgeCheckTimer);

  setBadgeCheckTimer(setTimeout(async () => {
    setBadgeCheckTimer(null);

    let newBadge = false;

    for (const b of BADGES) {
      if ((state.earnedBadges || []).includes(b.id)) continue;

      try {
        if (b.condition(state)) {
          if (!state.earnedBadges) state.earnedBadges = [];
          state.earnedBadges.push(b.id);
          showToast('New badge: ' + b.name + ' ' + b.icon);
          confetti();
          newBadge = true;
        }
      } catch (e) {
        /* Swallow condition errors — never crash the app */
      }
    }

    if (newBadge) {
      /* Persist locally */
      try {
        safeLocalStorageSave('htrack_v20', JSON.stringify(state));
      } catch (e) {}

      /* Push earnedBadges to Firebase directly */
      try {
        await userRef('daily_' + todayKey() + '/earnedBadges')
          .set(state.earnedBadges);
      } catch (e) {}
    }
  }, 150));
}

/* ─────────────────────────────────────────────────────────────
   PRIVATE HELPERS
───────────────────────────────────────────────────────────────*/

/**
 * Calculates career readiness percentage from skills.
 * Defined locally to avoid circular imports with career.js.
 */
function _ctOverallPct(s) {
  const skills = (s || state).ctSkills || {};
  return Math.round(
    ((skills.sql   || 0) +
     (skills.tools || 0) +
     (skills.proj  || 0) +
     (skills.intv  || 0)) / 4
  );
}
