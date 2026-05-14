/**
 * ═══════════════════════════════════════════════════════════════
 * tabs/settings.js — Settings page & habit management
 *
 * This module owns:
 * - Settings page shell HTML builder
 * - Dynamic settings page (habits list, sections list)
 * - Habit CRUD (add, edit, delete, reorder)
 * - Section CRUD (add, delete)
 * - Icon picker (emoji + image upload)
 * - Missed tasks alert time
 * - Factory reset
 * - Config sync rebuild handler
 * ═══════════════════════════════════════════════════════════════
 */

import {
  genId,
  sanitizeHTML,
  showToast,
  validateTimeString,
  formatTime12,
  validateHabitName,
  getTaskEmoji,
  getSectionEmoji,
  getHabitIconHtml,
  DB_KEY,
  DB_KEY_FIRED,
  DB_KEY_MIDNIGHT,
  safeLocalStorageSave,
  closeAudioContext,
  resetConfettiLock
} from '../core/utils.js';

import {
  state,
  flags,
  defaultState,
  replaceState,
  ensureDefaults
} from '../core/state.js';

import {
  debouncedSave,
  save,
  detachAllListeners,
  startRealtimeSync,
  clearMidnightTimer,
  initFirebase,
  getRtdb
} from '../core/firebase.js';

import {
  updateReward,
  updateSummaryCards,
  updateStatsBanner,
  updateFooterChips,
  applyTheme
} from '../shared/theme.js';

import { cancelBadgeCheck } from '../shared/badges.js';
import { wtCleanup } from '../shared/water.js';

import {
  onPageShow,
  onFullRefresh,
  applyChecks,
  updateProg,
  rebuildTodaySections,
  rebuildSection,
  refreshUI,
  showPage,
  renderHomeReminders,
  checkMissedTasksBanner
} from '../tabs/today.js';

import { renderReminderList } from '../tabs/reminders.js';
import { resetDailyLangFlags, renderLangUI } from '../tabs/english.js';


/* ═══════════════════════════════════════════════════════════════
   ICON PICKER CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const ICON_EMOJIS = [
  '🙏','💧','🌰','🥜','🍈','🥚','🍎','🥦','🥛','🌻',
  '📚','📰','🧴','💆','☀️','💊','🚿','😴','🛢️','🏃',
  '🍛','🌙','🍳','🌊','📦','🔔','🧹','✅','🍋','💪',
  '⚡','🎯','🔥','🌿','🧘','🍃','🎵','🎨','🏋️','🧠','❤️'
];


/* ═══════════════════════════════════════════════════════════════
   SETTINGS PAGE SHELL (static HTML, built once)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Builds the settings page shell HTML.
 * Called once during initialization.
 */
export function buildSettingsPageShell() {
  const page = document.getElementById('page-settings');
  if (!page || page.children.length > 0) return;

  page.innerHTML =
    // Hero
    '<div class="settings-hero" role="banner">' +
      '<div class="settings-hero-stars" id="settings-hero-stars" aria-hidden="true"></div>' +
      '<div class="settings-hero-icon" aria-hidden="true">⚙️</div>' +
      '<div class="settings-hero-label">MANAGE YOUR HABITS</div>' +
      '<div class="settings-hero-title">Settings</div>' +
      '<div class="settings-hero-sub">Customize routines, points and daily structure</div>' +
      '<div class="settings-hero-chips">' +
        '<span class="settings-hero-chip" id="sh-habits-chip">0 Habits</span>' +
        '<span class="settings-hero-chip gold" id="sh-pts-chip">0 XP total</span>' +
        '<span class="settings-hero-chip" id="sh-sections-chip">0 sections</span>' +
      '</div>' +
      '<button class="settings-add-btn" data-action="scroll-to-add-habit">+ Add New Habit</button>' +
    '</div>' +

    // Alert time card
    '<div class="alert-time-card">' +
      '<div class="alert-time-header">' +
        '<div class="alert-time-header-icon" aria-hidden="true">⏰</div>' +
        '<span class="alert-time-header-text">Missed Tasks Alert Time</span>' +
      '</div>' +
      '<div class="alert-time-body">' +
        '<p class="alert-time-desc">Set exactly when the <strong>missed tasks banner</strong> appears each day.</p>' +
        '<div class="alert-time-row">' +
          '<div class="alert-time-input-wrap">' +
            '<span class="alert-time-label">Pick your alert time</span>' +
            '<input type="time" id="missed-alert-time" class="alert-time-input" data-action="save-alert-time"/>' +
          '</div>' +
          '<div class="alert-active-wrap">' +
            '<span class="alert-active-label">Active setting</span>' +
            '<div class="alert-active-pill" id="missed-alert-display" aria-live="polite">9:00 PM</div>' +
          '</div>' +
        '</div>' +
        '<div class="alert-presets-label">Quick Presets</div>' +
        '<div class="alert-presets-grid" id="alert-presets-grid" role="group">' +
          _buildAlertPresetButtons() +
        '</div>' +
      '</div>' +
    '</div>' +

    // Manage routines card
    '<div class="sc">' +
      '<div class="sh"><span class="si">⚙️</span><span class="st">Manage Routines</span></div>' +
      '<div style="padding:9px 16px 5px;font-size:12px;color:var(--text-muted);">Add, edit, reorder or delete tasks instantly.</div>' +
      '<div class="section-labels" id="settings-section-labels" role="group"></div>' +
      '<div id="settings-habit-list" role="list"></div>' +
      '<div class="add-habit-form" id="add-habit-form-wrap">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:2px;">Add new habit</div>' +
        '<input class="settings-input" id="new-habit-name" placeholder="Habit name" maxlength="80"/>' +
        '<input class="settings-note" id="new-habit-note" placeholder="Sub-note (optional)" maxlength="100"/>' +
        '<div class="settings-row">' +
          '<select class="settings-select" id="new-habit-section"></select>' +
          '<input class="settings-pts" id="new-habit-pts" type="number" min="1" max="20" value="3" placeholder="pts"/>' +
        '</div>' +
        '<button class="add-habit-btn" data-action="add-new-habit">Add Habit</button>' +
      '</div>' +
    '</div>' +

    // Manage sections card
    '<div class="sc">' +
      '<div class="sh"><span class="si">🗂️</span><span class="st">Manage Sections</span></div>' +
      '<div id="settings-sections-list" role="list"></div>' +
      '<div class="add-habit-form">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:2px;">Add new section</div>' +
        '<div class="settings-row">' +
          '<input class="settings-input" id="new-section-name" placeholder="Section name" maxlength="40"/>' +
          '<input class="settings-note" id="new-section-icon" placeholder="Icon" style="width:64px;" maxlength="4"/>' +
        '</div>' +
        '<button class="add-habit-btn" data-action="add-new-section" style="margin-top:4px;">Add Section</button>' +
      '</div>' +
    '</div>' +

    // Firebase sync card
    '<div class="sc">' +
      '<div class="sh"><span class="si">☁️</span><span class="st">Firebase Sync</span></div>' +
      '<div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px;">' +
        '<div style="font-size:12px;color:var(--text-muted);">Connected to: <strong>shared_tracker</strong></div>' +
        '<div style="display:flex;align-items:center;gap:9px;" role="status" aria-live="polite">' +
          '<div class="fb-dot" id="settings-fb-dot"></div>' +
          '<span style="font-size:12px;font-weight:500;" id="settings-fb-text">Checking...</span>' +
        '</div>' +
        '<button class="rbtn" data-action="force-sync" style="background:var(--purple-100);border-color:var(--purple-200);color:var(--purple-600);font-weight:700;">Force Sync Now</button>' +
      '</div>' +
    '</div>' +

    // Reset buttons
    '<div class="reset-row">' +
      '<button class="rbtn" data-action="reset-today">Reset today\'s checklist</button>' +
    '</div>' +
    '<div class="reset-row" style="padding-top:0;">' +
      '<button class="rbtn danger" data-action="factory-reset">Factory reset all data</button>' +
    '</div>';
}

/**
 * @private Builds alert preset buttons HTML.
 * @returns {string}
 */
function _buildAlertPresetButtons() {
  const times = [
    '19:00','19:30','20:00','20:30','21:00',
    '21:30','22:00','22:30','23:00','23:30'
  ];
  return times.map(t =>
    '<button class="alert-preset-btn" data-action="set-alert-preset" data-time="' + t + '">' +
    formatTime12(t) + '</button>'
  ).join('');
}


/* ═══════════════════════════════════════════════════════════════
   SETTINGS DYNAMIC BUILDER
   ═══════════════════════════════════════════════════════════════ */

/**
 * Rebuilds the dynamic parts of the settings page.
 * Guarded by _settingsNeedRebuild flag.
 */
export function buildSettingsPage() {
  if (!flags._settingsNeedRebuild) {
    _updateSettingsHero();
    updateMissedAlertDisplay();
    return;
  }

  flags._settingsNeedRebuild = false;
  _updateSettingsHero();
  _buildSectionLabels();
  _buildSettingsHabitList();
  _buildSettingsSectionsList();
  _populateSectionSelect();
  updateMissedAlertDisplay();
  _buildSettingsStars();
}

function _updateSettingsHero() {
  const totalPts = (state.habits || []).reduce((s, h) => s + (h.pts || 0), 0);
  const hc = document.getElementById('sh-habits-chip');
  const pc = document.getElementById('sh-pts-chip');
  const sc = document.getElementById('sh-sections-chip');
  if (hc) hc.textContent = (state.habits || []).length + ' Habits';
  if (pc) pc.textContent = totalPts + ' XP total';
  if (sc) sc.textContent = (state.sections || []).filter(s => s.tag !== 'special').length + ' sections';
}

function _buildSectionLabels() {
  const w = document.getElementById('settings-section-labels');
  if (!w) return;
  w.innerHTML = '';

  // All filter
  const all = document.createElement('span');
  all.className = 'slabel' + (flags.settingsFilter === 'all' ? ' active' : '');
  all.textContent = 'All';
  all.setAttribute('role', 'button');
  all.setAttribute('tabindex', '0');
  all.setAttribute('aria-pressed', flags.settingsFilter === 'all' ? 'true' : 'false');
  all.dataset.action = 'settings-filter';
  all.dataset.filter = 'all';
  w.appendChild(all);

  // Section filters
  (state.sections || []).forEach(sec => {
    if (sec.tag === 'special') return;
    const btn = document.createElement('span');
    btn.className = 'slabel' + (flags.settingsFilter === sec.id ? ' active' : '');
    btn.textContent = getSectionEmoji(sec.id, sec.icon) + ' ' + sec.name;
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-pressed', flags.settingsFilter === sec.id ? 'true' : 'false');
    btn.dataset.action = 'settings-filter';
    btn.dataset.filter = sec.id;
    w.appendChild(btn);
  });
}

function _getSectionHeaderClass(secId) {
  if (secId === 'night') return 'sth-night';
  if (['morning', 'skin_am', 'breakfast'].includes(secId)) return 'sth-morning';
  if (secId === 'prep') return 'sth-prep';
  return 'sth-default';
}

function _getSectionHeaderDesc(secId, secName) {
  const map = {
    night: 'Wind down and prepare for deep rest',
    skin_am: 'Start glowing every morning',
    morning: 'Start strong, start intentional',
    breakfast: 'Fuel your body right',
    lunch: 'Midday nourishment',
    dinner: 'Light and healthy evenings',
    prep: 'Set yourself up for a great morning',
    water: 'Stay hydrated all day',
    evening: 'Evening wind-down'
  };
  return map[secId] || secName + ' habits';
}

function _buildSettingsHabitList() {
  const w = document.getElementById('settings-habit-list');
  if (!w) return;
  w.innerHTML = '';

  const filtered = (state.habits || [])
    .filter(h => flags.settingsFilter === 'all' || h.section === flags.settingsFilter)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  if (!filtered.length) {
    const e = document.createElement('div');
    e.className = 'tempty';
    e.textContent = 'No habits here yet.';
    w.appendChild(e);
    return;
  }

  const grouped = {};
  filtered.forEach(h => { if (!grouped[h.section]) grouped[h.section] = []; grouped[h.section].push(h); });

  Object.keys(grouped).forEach(secId => {
    const sec = (state.sections || []).find(s => s.id === secId);
    const secClass = _getSectionHeaderClass(secId);
    const secDesc = _getSectionHeaderDesc(secId, sec ? sec.name : secId);
    const habitCount = grouped[secId].length;

    const headerDiv = document.createElement('div');
    headerDiv.className = 'settings-sec-header ' + secClass;
    headerDiv.setAttribute('role', 'button');
    headerDiv.setAttribute('tabindex', '0');
    headerDiv.setAttribute('aria-expanded', 'true');
    headerDiv.dataset.action = 'toggle-section-collapse';
    headerDiv.innerHTML =
      '<div>' +
        '<div class="settings-sec-label">' + sanitizeHTML(sec ? sec.name.toUpperCase() : secId.toUpperCase()) + '</div>' +
        '<div class="settings-sec-desc">' + sanitizeHTML(secDesc) + '</div>' +
      '</div>' +
      '<span class="settings-sec-badge">' + habitCount + ' habit' + (habitCount !== 1 ? 's' : '') + '</span>';

    w.appendChild(headerDiv);

    const listDiv = document.createElement('div');
    listDiv.style.borderTop = '1px solid rgba(139,92,246,.06)';

    grouped[secId].forEach(h => {
      const iconContent = getHabitIconHtml(h);
      const safeName = sanitizeHTML(h.name || '');
      const safeNote = sanitizeHTML(h.note || '');

      const row = document.createElement('div');
      row.className = 'habit-item';
      row.innerHTML =
        '<div class="habit-icon-wrap" data-action="open-icon-picker" data-id="' + h.id + '" role="button" tabindex="0" aria-label="Change icon for ' + safeName + '">' +
          iconContent + '<div class="habit-icon-edit-dot" aria-hidden="true">✏</div></div>' +
        '<div class="habit-info"><div class="habit-name">' + safeName + '</div>' +
          (safeNote ? '<div class="habit-meta">' + safeNote + '</div>' : '') +
        '</div>' +
        '<span class="habit-pts-badge">+' + h.pts + ' pts</span>' +
        '<div class="habit-actions">' +
          '<button class="habit-edit-btn" aria-label="Move up" data-action="move-habit-up" data-id="' + h.id + '">&#9650;</button>' +
          '<button class="habit-edit-btn" aria-label="Move down" data-action="move-habit-down" data-id="' + h.id + '">&#9660;</button>' +
          '<button class="habit-edit-btn" aria-label="Edit" data-action="edit-habit" data-id="' + h.id + '">Edit</button>' +
          '<button class="habit-del-btn" aria-label="Delete" data-action="delete-habit" data-id="' + h.id + '">&times;</button>' +
        '</div>';
      listDiv.appendChild(row);
    });

    w.appendChild(listDiv);
  });
}

function _buildSettingsSectionsList() {
  const w = document.getElementById('settings-sections-list');
  if (!w) return;
  w.innerHTML = '';

  (state.sections || []).forEach(sec => {
    const hc = (state.habits || []).filter(h => h.section === sec.id).length;
    const row = document.createElement('div');
    row.className = 'habit-item';
    row.innerHTML =
      '<span class="si" aria-hidden="true">' + getSectionEmoji(sec.id, sec.icon) + '</span>' +
      '<div class="habit-info">' +
        '<div class="habit-name">' + sanitizeHTML(sec.name || '') + '</div>' +
        '<div class="habit-meta">' + hc + ' habit' + (hc !== 1 ? 's' : '') +
          (sec.tag && sec.tag !== 'special' ? ' · ' + sanitizeHTML(sec.tag) : '') +
        '</div>' +
      '</div>' +
      (sec.tag === 'special'
        ? '<span style="font-size:10px;color:var(--text-muted);">built-in</span>'
        : '<button class="habit-del-btn" aria-label="Delete section ' + sanitizeHTML(sec.name || '') + '" data-action="delete-section" data-id="' + sec.id + '">&times;</button>');
    w.appendChild(row);
  });
}

function _populateSectionSelect() {
  const sel = document.getElementById('new-habit-section');
  if (!sel) return;
  const saved = sel.value;
  sel.innerHTML = '';
  (state.sections || []).forEach(sec => {
    if (sec.tag === 'special') return;
    const opt = document.createElement('option');
    opt.value = sec.id;
    opt.textContent = getSectionEmoji(sec.id, sec.icon) + ' ' + sec.name;
    sel.appendChild(opt);
  });
  if (saved && sel.querySelector('option[value="' + saved + '"]')) sel.value = saved;
}

function _buildSettingsStars() {
  const c = document.getElementById('settings-hero-stars');
  if (!c || c.children.length > 0) return;
  [
    [8,22,1,0.6],[20,48,1.5,0.5],[35,15,1,0.7],[52,38,1.2,0.6],
    [68,20,1.5,0.5],[82,45,1,0.7],[90,18,2,0.6],[96,55,1,0.5],
    [14,72,1,0.4],[44,78,1.5,0.5],[72,68,1,0.4]
  ].forEach(a => {
    const s = document.createElement('div');
    s.className = 'settings-hero-star';
    s.style.cssText = 'left:' + a[0] + '%;top:' + a[1] + '%;width:' + (a[2] * 2) + 'px;height:' + (a[2] * 2) + 'px;opacity:' + a[3] + ';';
    c.appendChild(s);
  });
}


/* ═══════════════════════════════════════════════════════════════
   ALERT TIME
   ═══════════════════════════════════════════════════════════════ */

export function updateMissedAlertDisplay() {
  let val = state.missedTasksAlertTime || '21:00';
  if (!validateTimeString(val)) val = '21:00';
  const disp = document.getElementById('missed-alert-display');
  const inp = document.getElementById('missed-alert-time');
  if (disp) disp.textContent = formatTime12(val);
  if (inp) inp.value = val;
  _highlightActiveAlertPreset(val);
}

function saveMissedAlertTime(val) {
  if (!val || !validateTimeString(val)) return;
  state.missedTasksAlertTime = val;
  updateMissedAlertDisplay();
  debouncedSave();
  showToast('Alert set for ' + formatTime12(val));
  checkMissedTasksBanner();
}

function setMissedAlertPreset(val) {
  if (!validateTimeString(val)) return;
  state.missedTasksAlertTime = val;
  const inp = document.getElementById('missed-alert-time');
  if (inp) inp.value = val;
  updateMissedAlertDisplay();
  debouncedSave();
  showToast('Alert set for ' + formatTime12(val));
  checkMissedTasksBanner();
}

function _highlightActiveAlertPreset(val) {
  document.querySelectorAll('.alert-preset-btn').forEach(btn => {
    const t = btn.dataset.time;
    if (t) btn.classList.toggle('active-preset', t === val);
  });
}


/* ═══════════════════════════════════════════════════════════════
   HABIT MANAGEMENT
   ═══════════════════════════════════════════════════════════════ */

function addNewHabit() {
  const name = document.getElementById('new-habit-name');
  const note = document.getElementById('new-habit-note');
  const section = document.getElementById('new-habit-section');
  const pts = document.getElementById('new-habit-pts');

  const nameVal = name ? name.value.trim() : '';
  if (!validateHabitName(nameVal)) { showToast('Enter a valid habit name (1-80 characters)', 'yt'); return; }

  const secVal = section ? section.value : '';
  const ptsVal = Math.max(1, Math.min(20, +(pts ? pts.value : 3) || 3));
  const orders = (state.habits || []).filter(h => h.section === secVal).map(h => h.order || 0);
  const maxOrder = orders.length ? Math.max(...orders) : 0;

  if (!state.habits) state.habits = [];
  state.habits.push({ id: genId(), section: secVal, name: nameVal, note: note ? note.value.trim() : '', pts: ptsVal, order: maxOrder + 1 });
  state.habitsUpdatedAt = Date.now();
  flags._settingsNeedRebuild = true;

  debouncedSave();
  rebuildSection(secVal);
  applyChecks();
  updateProg();
  buildSettingsPage();

  if (name) name.value = '';
  if (note) note.value = '';
  showToast('Habit added!', 'gt');
}

function deleteHabit(id) {
  if (!confirm('Delete this habit?')) return;
  const habit = (state.habits || []).find(h => h.id === id);
  const sectionId = habit ? habit.section : null;

  state.habits = (state.habits || []).filter(h => h.id !== id);
  if (state.checks) delete state.checks[id];
  state.habitsUpdatedAt = Date.now();
  flags._settingsNeedRebuild = true;

  debouncedSave();
  if (sectionId) rebuildSection(sectionId);
  applyChecks();
  updateProg();
  buildSettingsPage();
  showToast('Deleted');
}

function openEditModal(id) {
  flags.editingHabitId = id;
  const h = (state.habits || []).find(x => x.id === id);
  if (!h) return;

  // Populate section select
  const editSel = document.getElementById('edit-habit-section');
  if (editSel) {
    editSel.innerHTML = '';
    (state.sections || []).forEach(sec => {
      if (sec.tag === 'special') return;
      const opt = document.createElement('option');
      opt.value = sec.id;
      opt.textContent = getSectionEmoji(sec.id, sec.icon) + ' ' + sec.name;
      editSel.appendChild(opt);
    });
  }

  const nm = document.getElementById('edit-habit-name');
  const nt = document.getElementById('edit-habit-note');
  const sec = document.getElementById('edit-habit-section');
  const p = document.getElementById('edit-habit-pts');

  if (nm) nm.value = h.name || '';
  if (nt) nt.value = h.note || '';
  if (sec) sec.value = h.section || '';
  if (p) p.value = h.pts;

  const modal = document.getElementById('edit-modal');
  if (modal) { modal.classList.add('open'); if (nm) nm.focus(); }
}

function saveEditHabit() {
  const capturedId = flags.editingHabitId;
  if (!capturedId) return;
  const h = (state.habits || []).find(x => x.id === capturedId);
  if (!h) return;

  const nm = document.getElementById('edit-habit-name');
  const nt = document.getElementById('edit-habit-note');
  const sec = document.getElementById('edit-habit-section');
  const p = document.getElementById('edit-habit-pts');

  const newName = nm ? nm.value.trim() : '';
  if (!validateHabitName(newName)) { showToast('Enter a valid habit name (1-80 characters)', 'yt'); return; }

  const oldSection = h.section;
  h.name = newName;
  if (nt) h.note = nt.value.trim();
  if (sec) h.section = sec.value;
  if (p) h.pts = Math.max(1, Math.min(20, +(p.value) || h.pts));
  state.habitsUpdatedAt = Date.now();
  flags._settingsNeedRebuild = true;

  debouncedSave();
  if (oldSection !== h.section) { rebuildSection(oldSection); rebuildSection(h.section); }
  else rebuildSection(h.section);
  applyChecks();
  updateProg();
  buildSettingsPage();
  closeEditModal();
  showToast('Updated!');
}

export function closeEditModal() {
  const m = document.getElementById('edit-modal');
  if (m) m.classList.remove('open');
  flags.editingHabitId = null;
}

function moveHabitUp(id) {
  const h = (state.habits || []).find(x => x.id === id);
  if (!h) return;
  const sib = state.habits.filter(x => x.section === h.section).sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sib.indexOf(h);
  if (idx <= 0) return;
  const tmp = h.order; h.order = sib[idx - 1].order; sib[idx - 1].order = tmp;
  state.habitsUpdatedAt = Date.now();
  debouncedSave();
  rebuildSection(h.section);
  flags._settingsNeedRebuild = true;
  const sp = document.getElementById('page-settings');
  if (sp && sp.classList.contains('active')) buildSettingsPage();
  showToast('Moved up');
}

function moveHabitDown(id) {
  const h = (state.habits || []).find(x => x.id === id);
  if (!h) return;
  const sib = state.habits.filter(x => x.section === h.section).sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sib.indexOf(h);
  if (idx >= sib.length - 1) return;
  const tmp = h.order; h.order = sib[idx + 1].order; sib[idx + 1].order = tmp;
  state.habitsUpdatedAt = Date.now();
  debouncedSave();
  rebuildSection(h.section);
  flags._settingsNeedRebuild = true;
  const sp = document.getElementById('page-settings');
  if (sp && sp.classList.contains('active')) buildSettingsPage();
  showToast('Moved down');
}


/* ═══════════════════════════════════════════════════════════════
   SECTION MANAGEMENT
   ═══════════════════════════════════════════════════════════════ */

function addNewSection() {
  const name = document.getElementById('new-section-name');
  const icon = document.getElementById('new-section-icon');
  const nameVal = name ? name.value.trim() : '';
  if (!nameVal) { showToast('Enter a name'); return; }
  const iconVal = icon ? (icon.value.trim() || '📌') : '📌';

  if (!state.sections) state.sections = [];
  state.sections.push({ id: genId(), icon: iconVal, name: nameVal, tag: '' });
  state.sectionsUpdatedAt = Date.now();
  flags._settingsNeedRebuild = true;

  debouncedSave();
  rebuildTodaySections();
  buildSettingsPage();
  if (name) name.value = '';
  if (icon) icon.value = '';
  showToast('Section added!', 'gt');
}

function deleteSection(id) {
  const habits = (state.habits || []).filter(h => h.section === id);
  if (habits.length && !confirm('Delete section and its ' + habits.length + ' habit(s)?')) return;

  if (flags.settingsFilter === id) flags.settingsFilter = 'all';
  state.sections = (state.sections || []).filter(s => s.id !== id);
  habits.forEach(h => {
    state.habits = state.habits.filter(x => x.id !== h.id);
    if (state.checks) delete state.checks[h.id];
  });
  state.sectionsUpdatedAt = Date.now();
  state.habitsUpdatedAt = Date.now();
  flags._settingsNeedRebuild = true;

  debouncedSave();
  rebuildTodaySections();
  applyChecks();
  updateProg();
  buildSettingsPage();
  showToast('Deleted');
}


/* ═══════════════════════════════════════════════════════════════
   ICON PICKER
   ═══════════════════════════════════════════════════════════════ */

function _buildIconEmojiGrid() {
  const grid = document.getElementById('icon-emoji-grid');
  if (!grid || grid.children.length > 0) return;

  ICON_EMOJIS.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'icon-emoji-btn';
    btn.textContent = e;
    btn.type = 'button';
    btn.setAttribute('aria-label', e + ' emoji');
    btn.setAttribute('role', 'option');
    btn.dataset.action = 'select-emoji';
    btn.dataset.emoji = e;
    grid.appendChild(btn);
  });
}

function openIconPicker(habitId) {
  flags.iconPickerHabitId = habitId;
  flags.selectedEmoji = null;
  flags.uploadedImageData = null;

  _buildIconEmojiGrid();

  // Clear previous selection
  document.querySelectorAll('.icon-emoji-btn').forEach(b => {
    b.classList.remove('sel');
    b.setAttribute('aria-selected', 'false');
  });

  // Reset upload preview
  const preview = document.getElementById('icon-upload-preview');
  if (preview) preview.innerHTML = '📤';
  const fileInput = document.getElementById('icon-file-input');
  if (fileInput) fileInput.value = '';

  switchIconMode('emoji');

  const overlay = document.getElementById('icon-picker-overlay');
  if (overlay) {
    overlay.classList.add('open');
    const first = overlay.querySelector('button,[tabindex="0"]');
    if (first) first.focus();
  }
}

function switchIconMode(mode) {
  flags.iconPickerMode = mode;
  const emPanel = document.getElementById('icon-emoji-panel');
  const upPanel = document.getElementById('icon-upload-panel');
  const emMode = document.getElementById('ipm-emoji');
  const upMode = document.getElementById('ipm-upload');
  if (emMode) emMode.classList.toggle('active', mode === 'emoji');
  if (upMode) upMode.classList.toggle('active', mode === 'upload');
  if (emPanel) emPanel.classList.toggle('active', mode === 'emoji');
  if (upPanel) upPanel.classList.toggle('active', mode === 'upload');
}

function handleIconUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    showToast('Please upload a JPG, PNG, GIF, or WebP image', 'rt');
    input.value = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image too large. Please use an image under 5MB', 'rt');
    input.value = '';
    return;
  }

  const MAX_SIZE = 64, MAX_BYTES = 50 * 1024;
  const img = new Image();
  img.onerror = () => { showToast('Could not read image file', 'rt'); input.value = ''; };
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    const canvas = document.createElement('canvas');
    canvas.width = MAX_SIZE; canvas.height = MAX_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.beginPath(); ctx.arc(MAX_SIZE / 2, MAX_SIZE / 2, MAX_SIZE / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    const scale = Math.max(MAX_SIZE / img.width, MAX_SIZE / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (MAX_SIZE - w) / 2, (MAX_SIZE - h) / 2, w, h);

    let dataUrl = canvas.toDataURL('image/webp', 0.7);
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    if (dataUrl.length > MAX_BYTES * 1.37) { showToast('Image too large even after compression', 'yt'); return; }

    flags.uploadedImageData = dataUrl;
    const preview = document.getElementById('icon-upload-preview');
    if (preview) preview.innerHTML = '<img src="' + dataUrl + '" alt="Selected icon"/>';
  };
  img.src = URL.createObjectURL(file);
}

function confirmIconPick() {
  if (!flags.iconPickerHabitId) return;
  const habit = (state.habits || []).find(h => h.id === flags.iconPickerHabitId);
  if (!habit) return;

  if (flags.iconPickerMode === 'emoji' && flags.selectedEmoji) {
    habit.customIcon = flags.selectedEmoji;
    habit.customIconType = 'emoji';
    showToast('Icon updated!', 'gt');
  } else if (flags.iconPickerMode === 'upload' && flags.uploadedImageData) {
    habit.customIcon = flags.uploadedImageData;
    habit.customIconType = 'image';
    showToast('Image set! Stored locally.', 'gt');
  } else {
    showToast('Select an emoji or upload an image first', 'yt');
    return;
  }

  state.habitsUpdatedAt = Date.now();
  flags._settingsNeedRebuild = true;
  flags.selectedEmoji = null;
  flags.uploadedImageData = null;

  debouncedSave();
  rebuildSection(habit.section);
  applyChecks();
  buildSettingsPage();
  closeIconPicker();
}

export function closeIconPicker() {
  const m = document.getElementById('icon-picker-overlay');
  if (m) m.classList.remove('open');
  flags.iconPickerHabitId = null;
}


/* ═══════════════════════════════════════════════════════════════
   CONFIG SYNC REBUILD
   ═══════════════════════════════════════════════════════════════ */

/**
 * Called when remote config is synced.
 * Determines if sections/habits need rebuilding on the Today page.
 */
export function handleConfigSyncRebuild() {
  const container = document.getElementById('today-sections');
  if (!container) return;

  const domSections = new Set();
  container.querySelectorAll('[id^="sec-"]').forEach(el => domSections.add(el.id.replace('sec-', '')));

  const expectedSections = new Set();
  (state.sections || []).forEach(sec => {
    if (sec.tag === 'special') return;
    const habits = (state.habits || []).filter(h => h.section === sec.id);
    if (habits.length > 0) expectedSections.add(sec.id);
  });

  let needsFullRebuild = false;
  expectedSections.forEach(id => { if (!domSections.has(id)) needsFullRebuild = true; });
  domSections.forEach(id => { if (!expectedSections.has(id)) needsFullRebuild = true; });

  if (needsFullRebuild) {
    rebuildTodaySections();
  } else {
    expectedSections.forEach(id => {
      const secEl = document.getElementById('sec-' + id);
      if (!secEl) return;
      const domCount = secEl.querySelectorAll('.ci').length;
      const stateCount = (state.habits || []).filter(h => h.section === id).length;
      if (domCount !== stateCount) rebuildSection(id);
    });
  }

  applyChecks();
}


/* ═══════════════════════════════════════════════════════════════
   FACTORY RESET
   ═══════════════════════════════════════════════════════════════ */

/**
 * Factory resets ALL data (state, localStorage, Firebase listeners, timers).
 * This is a destructive operation that cannot be undone.
 */
export function confirmFactoryReset() {
  if (!confirm('Delete ALL data including streaks, career progress and badges?')) return;

  // Detach all Firebase listeners
  detachAllListeners();

  // Clear all timers
  wtCleanup();
  cancelBadgeCheck();
  clearMidnightTimer();
  closeAudioContext();

  if (flags._ctCdInterval) { clearInterval(flags._ctCdInterval); flags._ctCdInterval = null; }
  if (flags.inAppTimeoutId) { clearTimeout(flags.inAppTimeoutId); flags.inAppTimeoutId = null; }
  if (flags.masterTimerId) { clearInterval(flags.masterTimerId); flags.masterTimerId = null; }
  if (flags._configSyncTimer) { clearTimeout(flags._configSyncTimer); flags._configSyncTimer = null; }
  if (flags.saveDebounceTimer) { clearTimeout(flags.saveDebounceTimer); flags.saveDebounceTimer = null; }

  // Reset all flags
  flags.wtSceneInitialized = false;
  flags.jnkSelected = {};
  flags.jnkGridBuilt = false;
  flags.saveFailCount = 0;
  flags.wtFilter = 'all';
  flags.wtDone = false;
  flags.ctPageBuilt = false;
  flags.ctActiveTag = 'All';
  flags.cachedSceneHeight = 0;
  flags._lastThemeKey = '';
  flags._reminderFirstCheck = true;
  flags._settingsNeedRebuild = true;
  flags._syncMergeInProgress = false;
  flags._lastSaveTimestamp = 0;
  flags._lastRemoteSavedAt = '';
  flags._lastEveningWasWeekend = null;
  flags._lastStreakMilestone = 0;
  flags._ctDayCompletedThisSession = false;
  flags._wtAppOpenTime = Date.now();
  flags.biryaniLogInFlight = false;
  resetConfettiLock();

  // Clear localStorage
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === DB_KEY || k.startsWith(DB_KEY_FIRED) || k.startsWith(DB_KEY_MIDNIGHT))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }

  // Reset state
  replaceState(defaultState());
  ensureDefaults();

  // Clear today sections
  const todaySections = document.getElementById('today-sections');
  if (todaySections) todaySections.innerHTML = '';

  // Reinitialize
  // Note: init() is imported dynamically to avoid circular dependency
  import('../core/init.js').then(mod => {
    mod.init().then(() => {
      showToast('Factory reset complete');
    });
  }).catch(e => {
    console.warn('Factory reset reinit failed:', e);
    refreshUI();
    showToast('Factory reset complete (partial reinit)');
  });
}


/* ═══════════════════════════════════════════════════════════════
   EVENT BINDING (called once from init.js)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Binds all settings-related event handlers via delegation.
 */
export function bindSettingsEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;

    switch (el.dataset.action) {
      // Habit management
      case 'add-new-habit': addNewHabit(); break;
      case 'edit-habit': openEditModal(el.dataset.id); break;
      case 'delete-habit': deleteHabit(el.dataset.id); break;
      case 'move-habit-up': moveHabitUp(el.dataset.id); break;
      case 'move-habit-down': moveHabitDown(el.dataset.id); break;

      // Section management
      case 'add-new-section': addNewSection(); break;
      case 'delete-section': deleteSection(el.dataset.id); break;

      // Settings filter
      case 'settings-filter':
        flags.settingsFilter = el.dataset.filter;
        flags._settingsNeedRebuild = true;
        buildSettingsPage();
        break;

      // Section collapse toggle
      case 'toggle-section-collapse': {
        const listDiv = el.nextElementSibling;
        if (!listDiv) break;
        const isHidden = listDiv.style.display === 'none';
        listDiv.style.display = isHidden ? '' : 'none';
        el.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
        break;
      }

      // Alert time
      case 'set-alert-preset': setMissedAlertPreset(el.dataset.time); break;

      // Icon picker
      case 'open-icon-picker': openIconPicker(el.dataset.id); break;
      case 'select-emoji': {
        document.querySelectorAll('.icon-emoji-btn').forEach(b => {
          b.classList.remove('sel'); b.setAttribute('aria-selected', 'false');
        });
        el.classList.add('sel'); el.setAttribute('aria-selected', 'true');
        flags.selectedEmoji = el.dataset.emoji;
        break;
      }

      // Icon picker modes
      case 'scroll-to-add-habit': {
        const form = document.getElementById('add-habit-form-wrap');
        if (form) form.scrollIntoView({ behavior: 'smooth' });
        break;
      }

      // Resets
      case 'reset-today': {
        // Import dynamically to access resetToday from today.js
        import('../tabs/today.js').then(mod => mod.resetToday());
        break;
      }
      case 'factory-reset': confirmFactoryReset(); break;

      // Force sync
      case 'force-sync': {
        import('../core/firebase.js').then(mod => mod.forceSyncAll());
        break;
      }
    }
  });

  // Alert time input change
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'missed-alert-time') {
      saveMissedAlertTime(e.target.value);
    }
  });

  // Edit modal save/cancel
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    if (target.closest('#edit-modal .edit-save')) saveEditHabit();
    if (target.closest('#edit-modal .edit-cancel')) closeEditModal();
    if (target.id === 'edit-modal' && target.classList.contains('open')) closeEditModal();
  });

  // Icon picker confirm/close/mode switch
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    if (target.closest('.icon-picker-confirm')) confirmIconPick();
    if (target.id === 'icon-picker-overlay' && target.classList.contains('open')) closeIconPicker();
    if (target.closest('#ipm-emoji')) switchIconMode('emoji');
    if (target.closest('#ipm-upload')) switchIconMode('upload');
  });

  // Icon file upload
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'icon-file-input') {
      handleIconUpload(e.target);
    }
  });

  // Upload area click
  document.addEventListener('click', e => {
    if (e.target && e.target.closest('.icon-upload-area')) {
      const input = document.getElementById('icon-file-input');
      if (input) input.click();
    }
  });

  // Keyboard support for section collapse
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset.action === 'toggle-section-collapse') {
      e.preventDefault();
      e.target.click();
    }
  });

  // Keyboard for icon picker emojis
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset.action === 'open-icon-picker') {
      e.preventDefault();
      openIconPicker(e.target.dataset.id);
    }
  });

  // Keyboard for settings filter
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset.action === 'settings-filter') {
      e.preventDefault();
      e.target.click();
    }
  });
}


/* ═══════════════════════════════════════════════════════════════
   PAGE INIT & REGISTRATION
   ═══════════════════════════════════════════════════════════════ */

function _initSettingsPage() {
  flags._settingsNeedRebuild = true;
  buildSettingsPage();
}

// Register with navigation system
onPageShow('settings', _initSettingsPage);
