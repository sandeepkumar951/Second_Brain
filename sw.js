'use strict';
/* ============================================================
   Sandy's Second Brain -- Service Worker
   v114  (background push notifications)

   Runs INDEPENDENTLY of the page. This is what makes reminders
   arrive when the app is in the background or fully closed.

   Three wake-up sources, in order of reliability:
     1. 'push'         -- server-sent Web Push (works when closed)
     2. 'periodicsync' -- browser's own timer (best effort, >=12h)
     3. 'message'      -- the page asking us to re-check (foreground)

   In every case we re-read the live data from Firebase RTDB over
   REST (no SDK in here) and decide what is due, so the SW never
   depends on the page being alive.
============================================================ */

const SW_VERSION  = 'v183';
const CACHE_NAME  = 'sandy-brain-proto-v183';
const NOTIF_STORE = 'ssb-notif-state-v1';
const ASSETS      = ['./', 'manifest.json'];

const DB_URL  = 'https://sandyhealthtracker-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_ROOT = 'sandy_shared';

/* v182: PNG pictures embedded as data: URIs (no extra files to upload).
   BADGE = one-colour brain mask (Android paints it in a single colour).
   ICONS = the big picture on the right of a notification, per kind. */
const ICONS = {
  app: 'data:image/png;base64,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',
  wat: 'data:image/png;base64,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',
  rem: 'data:image/png;base64,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'
};
const ICON  = ICONS.app;
const BADGE = 'data:image/png;base64,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';

/* ============================================================
   1. LIFECYCLE
============================================================ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== CACHE_NAME && k !== NOTIF_STORE).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* Network-first, cache as offline fallback. Unchanged behaviour. */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || new Response(
          '<!DOCTYPE html><html><body><h2>Second Brain</h2><p>You are offline.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        ))
      )
  );
});

/* ============================================================
   2. "FIRED TODAY" LEDGER  (shared by page + SW)
   Cache API is the only storage guaranteed available to a SW
   that woke from a terminated state. One record per day.
============================================================ */
const LEDGER_URL = 'https://ssb.local/fired-today';

async function ledgerRead() {
  try {
    const c = await caches.open(NOTIF_STORE);
    const r = await c.match(LEDGER_URL);
    if (!r) return { day: '', tags: {} };
    const o = await r.json();
    return (o && typeof o === 'object') ? { day: o.day || '', tags: o.tags || {} } : { day: '', tags: {} };
  } catch (e) { return { day: '', tags: {} }; }
}

async function ledgerWrite(o) {
  try {
    const c = await caches.open(NOTIF_STORE);
    await c.put(LEDGER_URL, new Response(JSON.stringify(o), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (e) {}
}

/* Small ring buffer of wake-ups. Purely diagnostic, but it is the only
   way to tell "the worker woke and nothing was due" apart from "the
   worker never woke at all". Read it with ssbWakeLog() from the page. */
const WAKELOG_URL = 'https://ssb.local/wake-log';

async function wakeLog(reason, fired, extra) {
  try {
    const c = await caches.open(NOTIF_STORE);
    const r = await c.match(WAKELOG_URL);
    let arr = r ? await r.json() : [];
    if (!Array.isArray(arr)) arr = [];
    arr.push({
      at: new Date().toISOString(),
      local: new Date().toString().slice(0, 24),
      reason: reason,
      fired: (typeof fired === 'number') ? fired : null,
      note: extra || ''
    });
    if (arr.length > 25) arr = arr.slice(-25);
    await c.put(WAKELOG_URL, new Response(JSON.stringify(arr), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (e) {}
}

async function wakeLogRead() {
  try {
    const c = await caches.open(NOTIF_STORE);
    const r = await c.match(WAKELOG_URL);
    return r ? await r.json() : [];
  } catch (e) { return []; }
}

function dayKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

/* Show a notification at most once per tag per calendar day.
   opt (v180, all optional): actions[<=2], sticky, silent, kind, ids, slot,
   ml, also[] (extra tags to mark fired, used by grouped pop-ups),
   icon (v182: 'app' | 'wat' | 'rem', default 'app'). */
async function fireOnce(tag, title, body, opt) {
  opt = opt || {};
  const today = dayKey();
  const led = await ledgerRead();
  if (led.day !== today) { led.day = today; led.tags = {}; }
  if (led.tags[tag]) return false;
  const acts = Array.isArray(opt.actions) ? opt.actions.slice(0, 2) : [];
  try {
    const o = {
      body: body || '',
      badge: BADGE,
      tag: tag,
      renotify: true,
      requireInteraction: !!opt.sticky,
      silent: !!opt.silent,
      timestamp: Date.now(),
      data: { tag: tag, url: './', at: Date.now(), kind: opt.kind || '', ids: opt.ids || [],
              slot: opt.slot || '', ml: opt.ml || 0, body: body || '', actions: acts, sticky: !!opt.sticky,
              icon: ICONS[opt.icon] ? opt.icon : 'app' }
    };
    o.icon = ICONS[opt.icon] || ICON;
    if (!opt.silent) o.vibrate = [90, 50, 90];
    if (acts.length) o.actions = acts;
    await self.registration.showNotification(title, o);
  } catch (e) { return false; }
  (Array.isArray(opt.also) ? opt.also : []).forEach(t => { led.tags[t] = 1; });
  /* mark fired only AFTER a successful show, so a transient show failure retries on the next wake instead of burning the tag for the whole day */
  led.tags[tag] = 1;
  await ledgerWrite(led);
  /* tell any live page so its in-app toast + ledger stay in step */
  try {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach(c => c.postMessage({ type: 'NOTIF_FIRED', tag: tag, title: title, body: body }));
  } catch (e) {}
  return true;
}

/* ============================================================
   3. DATA (Firebase RTDB REST -- no SDK needed inside a SW)
============================================================ */
async function getJSON(path) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(DB_URL + '/' + path + '.json', {
      signal: ctl.signal, cache: 'no-store'
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

/* ============================================================
   4. DUE LOGIC -- mirrors checkReminders() in the page
   Window is 0..15 minutes past the scheduled time, so a push
   that lands a few minutes late still delivers.
============================================================ */
const WINDOW_MIN = 30;   /* primary catch-up (min). Fire on the FIRST wake 0..30 min after the scheduled time. Contiguous with the retry window below, so a push delayed by Android Doze is never dropped into a dead gap. The daily ledger still guarantees one notification per tag per day. */
const DAY_ABBR   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* hydRollPlan v1 -- rolling hydration schedule (shared, byte-identical copy in
   the pool, the shell banner/notifier and sw.js). Pure: reads a pool record and
   a clock, never writes. Rules:
   - GRACE: a slot at T is "due" from T through the whole minute T+30, and
     "missed" from minute T+31 on (minute resolution, local clock).
   - DONE: the next slot is (completion minute) + gap. The completion stays
     filed under its ORIGINAL slot time.
   - MISSED: the next slot is T + 30 + gap (gap after the grace deadline).
   - Slots past endTime are not created (same rule as the old fixed grid).
   - Records without doneAt (pre-rolling history) count as done at their
     scheduled time, which reproduces the old fixed grid exactly.
   - Extra (custom) slots are fixed times with the same 30-minute window; they
     do not move the rolling chain. */
function hydRollPlan(rec,nowMs){
  var G=30,M=60000,d=new Date(nowMs),Y=d.getFullYear(),Mo=d.getMonth(),D=d.getDate();
  rec=rec||{};
  var p2=function(n){return (n<10?'0':'')+n;};
  var day=Y+'-'+p2(Mo+1)+'-'+p2(D);
  var ok=function(t){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));};
  var mn=function(t){var p=String(t).split(':');return (+p[0]||0)*60+(+p[1]||0);};
  var at=function(t){var m=mn(t);return new Date(Y,Mo,D,Math.floor(m/60),m%60,0,0).getTime();};
  var lb=function(ms){var x=new Date(ms);return p2(x.getHours())+':'+p2(x.getMinutes());};
  var fl=function(ms){var x=new Date(ms);x.setSeconds(0,0);return x.getTime();};
  var now=fl(nowMs),st0=ok(rec.startTime)?rec.startTime:'08:00',en0=ok(rec.endTime)?rec.endTime:'21:00';
  var st=mn(st0),en=mn(en0),gap,one=false;
  if(+rec.perGlass>0){var n=Math.min(24,Math.max(1,Math.ceil((+rec.goal||3000)/+rec.perGlass)));
    if(n===1)one=true;gap=one?0:Math.max(15,Math.round((en-st)/(n-1)/5)*5);}
  else gap=+rec.intervalMin||90;
  var out={v:1,date:day,grace:G,gap:gap,slots:[],next:null,nextAt:null,nextEnd:null};
  var stat=function(T){return now<T?'upcoming':now<=T+G*M?'due':'missed';};
  var custom=(Array.isArray(rec.customSlots)?rec.customSlots:[]).filter(ok);
  var doneL=((rec.doneSlots||{})[day]);doneL=Array.isArray(doneL)?doneL:[];
  var log=((rec.slotLog||{})[day]);log=(log&&typeof log==='object')?log:{};
  var seen={},chain=[],extraDone={};
  doneL.forEach(function(t){
    if(!ok(t)||seen[t])return;seen[t]=1;
    var L=log[t]&&typeof log[t]==='object'?log[t]:{};
    var sa=+L.schedAt>0?+L.schedAt:at(t),da=+L.doneAt>0?+L.doneAt:0;
    var r={t:t,at:sa,doneAt:da||sa,legacy:!da,kind:(L.kind==='extra'||L.kind==='roll')?L.kind:(custom.indexOf(t)>=0?'extra':'roll')};
    if(r.kind==='extra')extraDone[t]=r;else chain.push(r);
  });
  chain.sort(function(a,b){return a.doneAt-b.doneAt;});
  var slots=[],i=0,k=0,T=at(st0),endMs=at(en0),pend=false;
  var doneSlot=function(r){return {t:r.t,at:r.at,end:r.at+G*M,kind:r.kind,status:'done',done:true,doneAt:r.doneAt,legacy:r.legacy};};
  if(en>st&&(one||gap>=15)){
    while(k++<300&&T<=endMs){
      var r=chain[i];
      if(!pend&&r&&(r.t===lb(T)||fl(r.doneAt)<=T+G*M)){slots.push(doneSlot(r));T=fl(r.doneAt)+gap*M;i++;if(one)break;continue;}
      var s=pend?'upcoming':stat(T);
      slots.push({t:lb(T),at:T,end:T+G*M,kind:'roll',status:s,done:false,projected:pend});
      if(s==='missed'){T=T+(G+gap)*M;}else{pend=true;T=T+gap*M;}
      if(one)break;
    }
  }
  for(;i<chain.length;i++)slots.push(doneSlot(chain[i]));
  var have={};slots.forEach(function(x){have[x.t]=1;});
  custom.forEach(function(t){
    if(have[t])return;have[t]=1;
    if(extraDone[t]){slots.push(doneSlot(extraDone[t]));return;}
    var A=at(t);slots.push({t:t,at:A,end:A+G*M,kind:'extra',status:stat(A),done:false});
  });
  Object.keys(extraDone).forEach(function(t){if(!have[t]){have[t]=1;slots.push(doneSlot(extraDone[t]));}});
  var uniq={},fin=[];
  slots.forEach(function(x){var j=uniq[x.t];if(j===undefined){uniq[x.t]=fin.length;fin.push(x);}else if(x.done&&!fin[j].done)fin[j]=x;});
  fin.sort(function(a,b){return a.at-b.at||(a.t<b.t?-1:1);});
  for(var q=0;q<fin.length;q++){var x=fin[q];if(!x.done&&x.status!=='missed'){out.next=x.t;out.nextAt=x.at;out.nextEnd=x.end;break;}}
  out.slots=fin;
  return out;
}

function hhmmToMin(x) {
  const p = String(x || '').split(':');
  return (+p[0] || 0) * 60 + (+p[1] || 0);
}
function minToHHMM(t) {
  const hh = Math.floor(t / 60), mm = t % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
function isDue(nowMin, hhmm) {
  if (!/^\d\d:\d\d$/.test(String(hhmm))) return false;
  const d = nowMin - hhmmToMin(hhmm);
  return d >= 0 && d <= WINDOW_MIN;
}
/* Second call: the same item again ~30 min after its time, but only if it
   is STILL not ticked off in Firebase (every caller filters done items
   before it gets here). Separate tag suffix so the daily ledger does not
   swallow it as a duplicate of the first notification. */
const RETRY_MIN = 30;
const RETRY_MAX = 120;
function isDueRetry(nowMin, hhmm) {
  if (!/^\d\d:\d\d$/.test(String(hhmm))) return false;
  const d = nowMin - hhmmToMin(hhmm);
  return d >= RETRY_MIN && d <= RETRY_MAX;
}

function remDueToday(r, today) {
  if (!r || r.enabled === false) return false;
  if (r.date) return r.date === today;
  const d = Array.isArray(r.days) ? r.days : [];
  return !d.length || d.indexOf(new Date().getDay()) >= 0;
}
function remDoneToday(r, today) {
  return !!(r && Array.isArray(r.completedDates) && r.completedDates.indexOf(today) >= 0);
}

/* ============================================================
   4x. v180 NOTIFICATION COMPOSER
   - Titles carry the item itself (no emoji: Android already shows the
     app badge next to every notification, an emoji doubled it).
   - v182: no jokes. Title = the thing, body = one line of facts
     ('Due 8:00 AM \u00b7 +3 pts'). Big icon per kind (app / water / bell).
   - Timed habits due within GROUP_MIN of each other become ONE pop-up;
     every member's tag is marked fired so none of them repeats alone.
   - Untimed sections get one nudge at SECTION_NUDGE[section].
   - Morning brief 04:15 and evening wrap-up 19:00 replace the 9 AM /
     7 PM digests. Weekly plan Mon 04:20, check Wed 16:00, score Sun 18:00.
   - Buttons: 'done' / 'log' are handed to the page (its own save path,
     so the service worker never writes to Firebase); 'snzNN' snoozes
     inside the worker and re-fires on a later wake if still open.
============================================================ */
const GROUP_MIN = 10;
const BRIEF_AT  = '04:15';
const WRAP_AT   = '19:00';
const WEEK_PLAN = { day: 1, at: '04:20' };
const WEEK_MID  = { day: 3, at: '16:00' };
const WEEK_END  = { day: 0, at: '18:00' };
const SECTION_NUDGE = { skin_am: '03:40', prep: '20:15', night: '21:15' };
const STICKY_RX = /tablet|medicine|meds|\bpill/i;

function t12(hhmm) {
  const m = hhmmToMin(hhmm);
  const h = Math.floor(m / 60), mm = m % 60;
  return ((h % 12) || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}
function nfmt(n) { return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function andList(a, max) {
  max = max || 3;
  const x = a.slice(0, max), more = a.length - x.length;
  let s = x.length <= 1 ? (x[0] || '') : x.slice(0, -1).join(', ') + ' and ' + x[x.length - 1];
  if (more > 0) s = x.join(', ') + ' +' + more;
  return s;
}
function tShort(hhmm) { return t12(hhmm).replace(/ [AP]M$/, ''); }
function doneLabel(n) { return n <= 1 ? 'Done' : n === 2 ? 'Both done' : 'All done'; }
function minsSince(nowMin, hhmm) { return nowMin - hhmmToMin(hhmm); }
function inFirst(nowMin, hhmm) { const d = minsSince(nowMin, hhmm); return d >= 0 && d <= WINDOW_MIN; }
function inRetry(nowMin, hhmm) { const d = minsSince(nowMin, hhmm); return d > WINDOW_MIN && d <= RETRY_MAX; }
function okTime(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')); }
function asList(v) { return Array.isArray(v) ? v.filter(Boolean) : (v && typeof v === 'object' ? Object.values(v).filter(Boolean) : []); }

/* Group items that are due in this wake. items: [{key,time,...}] sorted by
   time. Returns [{lead, mem[]}] where mem includes lead. `fired` is the
   ledger snapshot; an item whose tag already fired never leads or joins. */
function clusterDue(items, nowMin, phase, tagOf, fired) {
  const out = [], used = {};
  const inWin = phase === 'retry' ? inRetry : inFirst;
  for (const it of items) {
    if (used[it.key] || fired[tagOf(it)]) continue;
    if (!inWin(nowMin, it.time)) continue;
    const T = hhmmToMin(it.time);
    const mem = items.filter(x => !used[x.key] && !fired[tagOf(x)] &&
      hhmmToMin(x.time) >= T && hhmmToMin(x.time) - T <= GROUP_MIN);
    mem.forEach(x => { used[x.key] = 1; });
    out.push({ lead: it, mem: mem });
  }
  return out;
}

/* ---- snoozes (Cache API, survives the worker being killed) ---- */
const SNOOZE_URL = 'https://ssb.local/snooze';
async function snzRead() {
  try {
    const c = await caches.open(NOTIF_STORE);
    const r = await c.match(SNOOZE_URL);
    const a = r ? await r.json() : [];
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
async function snzWrite(a) {
  try {
    const c = await caches.open(NOTIF_STORE);
    await c.put(SNOOZE_URL, new Response(JSON.stringify(a.slice(-30)), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) {}
}
async function snoozeAdd(n, mins) {
  const d = (n && n.data) || {};
  const a = await snzRead();
  a.push({
    at: Date.now() + mins * 60000,
    base: d.tag || n.tag || 'ssb',
    title: n.title || 'Second Brain',
    body: n.body || d.body || '',
    kind: d.kind || '', ids: d.ids || [], slot: d.slot || '', ml: d.ml || 0,
    day: dayKey(),
    actions: (d.actions || []).slice(0, 2),
    sticky: !!d.sticky, icon: d.icon || 'app'
  });
  await snzWrite(a);
}

async function runCheck(reason) {
  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const today   = dayKey(now);
  const abbr    = DAY_ABBR[now.getDay()];

  const [cfg, daily, health] = await Promise.all([
    getJSON(DB_ROOT + '/config'),
    getJSON(DB_ROOT + '/daily_' + today),
    getJSON(DB_ROOT + '/permanent/health')
  ]);
  if (!cfg && !daily) return 0;

  const checks = (daily && daily.checks) || {};
  const led0   = await ledgerRead();
  const fired0 = led0.day === today ? (led0.tags || {}) : {};
  let fired = 0;

  const habits   = asList(cfg && cfg.habits);
  const sections = asList(cfg && cfg.sections);
  const secName  = id => { const s = sections.filter(x => x && x.id === id)[0]; return (s && s.name) || ''; };
  const openHab  = h => h && checks[h.id] !== true;
  const ptsOf    = h => parseInt(h && h.pts, 10) || 0;
  const rems     = asList(cfg && cfg.reminders).filter(r => remDueToday(r, today) && !remDoneToday(r, today));

  /* hydration record (shared by 4c, the brief and the snooze re-check) */
  let ws = null;
  try {
    if (daily && daily.hydrationPool) { try { ws = JSON.parse(daily.hydrationPool); } catch (e) { ws = null; } }
    if (!ws) {
      const w = await getJSON(DB_ROOT + '/ssb/water');
      if (w && w.date === today) ws = { date: w.date, amount: +w.ml || 0, goal: +w.goal || 3300 };
    }
  } catch (e) { ws = null; }
  const wAmt  = ws && ws.date === today ? (+ws.amount || 0) : 0;
  const wGoal = (ws && +ws.goal) || 3300;
  const wPlan = ws ? hydRollPlan(ws, now.getTime()) : null;
  const slotMl = () => {
    if (ws && +ws.perGlass > 0) return +ws.perGlass;
    const n = (wPlan && wPlan.slots.length) || 1;
    return Math.max(50, Math.round(wGoal / n / 10) * 10);
  };

  /* --- 4.0 snoozed notifications whose time has come --- */
  try {
    const sz = await snzRead();
    if (sz.length) {
      const keep = [];
      for (const s of sz) {
        if (s.day !== today) continue;                     /* yesterday's snoozes die */
        if (s.at > now.getTime()) { keep.push(s); continue; }
        let still = true;
        if (s.kind === 'hab') still = (s.ids || []).some(id => checks[id] !== true);
        if (s.kind === 'rem') still = (s.ids || []).some(id => rems.some(r => String(r.id) === String(id)));
        if (s.kind === 'wat') {
          const ps = wPlan && wPlan.slots.filter(x => x.t === s.slot)[0];
          still = wAmt < wGoal && !!ps && !ps.done && ps.status === 'due';
        }
        if (!still) continue;
        const ok = await fireOnce(s.base + '_sz' + Math.floor(s.at / 60000), s.title, s.body,
          { kind: s.kind, ids: s.ids, slot: s.slot, ml: s.ml, actions: s.actions, sticky: s.sticky, icon: s.icon });
        if (ok) fired++;
      }
      await snzWrite(keep);
    }
  } catch (e) {}

  /* --- 4a. reminders: name is the title, grouped when due together --- */
  try {
    const timed = rems.filter(r => okTime(r.time)).map(r => ({ key: String(r.id), time: r.time, r: r }))
      .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
    /* v183: the 30-min "Still open" repeat is kept only for sticky items (tablets, high priority) */
    const remSticky = it => it.r.priority === 'high' || STICKY_RX.test(it.r.title || '');
    for (const phase of ['first', 'retry']) {
      const tagOf = it => 'rem_' + it.key + (phase === 'retry' ? '_r30' : '');
      const pool = phase === 'retry' ? timed.filter(remSticky) : timed;
      for (const c of clusterDue(pool, nowMin, phase, tagOf, fired0)) {
        const m = c.mem, ids = m.map(x => x.key), L = c.lead;
        const sticky = m.some(x => x.r.priority === 'high' || STICKY_RX.test(x.r.title || ''));
        const due = phase === 'retry' ? 'Still open \u00b7 due ' + t12(L.time) : 'Due ' + t12(L.time);
        let title, body, btn;
        if (m.length === 1) {
          const r = L.r, msg = r.msg ? String(r.msg).replace(/[.!\s]+$/, '') : '';
          title = r.title || 'Reminder';
          body = phase === 'retry' ? [due, msg].filter(Boolean).join(' \u00b7 ')
                                   : (msg || due) + (sticky ? ' \u00b7 stays here until you tap' : '');
          btn = STICKY_RX.test(r.title || '') ? 'Taken' : 'Done';
        } else {
          title = m.length + ' reminders';
          body = andList(m.map(x => x.r.title || 'Reminder'), 4) + ' \u00b7 ' + due.charAt(0).toLowerCase() + due.slice(1);
          btn = doneLabel(m.length);
        }
        const ok = await fireOnce(tagOf(L), title, body, {
          kind: 'rem', ids: ids, sticky: sticky, icon: 'rem',
          actions: [{ action: 'done', title: btn }, { action: 'snz15', title: 'Snooze 15 min' }],
          also: m.map(tagOf)
        });
        if (ok) { fired++; m.forEach(x => { fired0[tagOf(x)] = 1; }); }
      }
    }
  } catch (e) {}

  /* --- 4b. timed habits, grouped; silent once ticked off --- */
  try {
    const timed = habits.filter(h => openHab(h) && okTime(h.time))
      .map(h => ({ key: String(h.id), time: h.time, h: h }))
      .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
    const habSticky = it => STICKY_RX.test((it.h.name || '') + ' ' + (it.h.note || ''));
    for (const phase of ['first', 'retry']) {
      const tagOf = it => 'hab_' + it.key + (phase === 'retry' ? '_r30' : '');
      const pool = phase === 'retry' ? timed.filter(habSticky) : timed;
      for (const c of clusterDue(pool, nowMin, phase, tagOf, fired0)) {
        const m = c.mem, L = c.lead, hs = m.map(x => x.h);
        const pts = hs.reduce((s, h) => s + ptsOf(h), 0);
        const names = hs.map(h => h.name || 'Habit');
        const sticky = hs.some(h => STICKY_RX.test((h.name || '') + ' ' + (h.note || '')));
        const title = andList(names);
        const note = m.length === 1 ? (hs[0].note || '') : '';
        const body = [(phase === 'retry' ? 'Still open \u00b7 due ' : 'Due ') + t12(L.time),
                      pts ? '+' + pts + ' pts' : '', note].filter(Boolean).join(' \u00b7 ');
        const btn = m.length === 1 && sticky ? 'Taken' : doneLabel(m.length);
        const ok = await fireOnce(tagOf(L), title, body, {
          kind: 'hab', ids: m.map(x => x.key), sticky: sticky, icon: sticky ? 'rem' : 'app',
          actions: [{ action: 'done', title: btn }, { action: 'snz15', title: 'Snooze 15 min' }],
          also: m.map(tagOf)
        });
        if (ok) { fired++; m.forEach(x => { fired0[tagOf(x)] = 1; }); }
      }
    }
  } catch (e) {}

  /* --- 4b2. untimed sections: one nudge per section --- */
  try {
    for (const sid of Object.keys(SECTION_NUDGE)) {
      const at = SECTION_NUDGE[sid];
      if (!inFirst(nowMin, at)) continue;
      const all = habits.filter(h => h && h.section === sid && !okTime(h.time));
      const open = all.filter(openHab);
      if (!open.length) continue;
      const pts = open.reduce((s, h) => s + ptsOf(h), 0);
      const ok = await fireOnce('sec_' + sid,
        (secName(sid) || sid) + ' \u00b7 ' + (all.length - open.length) + ' of ' + all.length + ' done',
        andList(open.map(h => h.name || 'Habit'), 4) + (pts ? ' \u00b7 +' + pts + ' pts' : ''),
        { kind: 'hab', ids: open.map(h => String(h.id)), icon: 'app',
          actions: [{ action: 'done', title: doneLabel(open.length) }, { action: 'snz15', title: 'Snooze 15 min' }] });
      if (ok) fired++;
    }
  } catch (e) {}

  /* --- 4c. hydration slots (rolling plan) --- */
  try {
    if (ws && wPlan) {
      if (wAmt < wGoal) {
        for (const ps of wPlan.slots) {
          const sl = ps.t;
          if (ps.done || ps.projected || ps.status === 'missed') continue;
          if (!isDue(nowMin, sl)) continue;
          const ml = slotMl();
          const after = wPlan.slots.filter(x => !x.done && hhmmToMin(x.t) > hhmmToMin(sl))[0];
          const ok = await fireOnce('wat_' + sl,
            'Water \u00b7 ' + ml + ' ml',
            nfmt(wAmt) + ' of ' + nfmt(wGoal) + ' ml today' + (after ? ' \u00b7 next at ' + t12(after.t) : ''),
            { kind: 'wat', slot: sl, ml: ml, icon: 'wat',
              actions: [{ action: 'log', title: 'Log ' + ml + ' ml' }, { action: 'snz10', title: 'In 10 min' }] });
          if (ok) fired++;
        }
      } else if (ws.date === today && nowMin >= hhmmToMin('04:00')) {
        const ok = await fireOnce('wat_goal', 'Water goal reached', nfmt(wAmt) + ' ml today',
          { silent: true, icon: 'wat' });
        if (ok) fired++;
      }
    }
  } catch (e) {}

  /* --- 4d. post-meal walks + lipid retest --- */
  try {
    const walksToday = ((health && health.walks) || {})[today] || [];
    const WLK = [
      { k: 'lunch',  label: 'after lunch',  ping: '14:00' },
      { k: 'dinner', label: 'after dinner', ping: '20:30' }
    ];
    for (const s of WLK) {
      if (walksToday.indexOf(s.k) >= 0) continue;
      const retryK = false;   /* v183: no walk repeat */
      if (!isDue(nowMin, s.ping) && !retryK) continue;
      const ok = await fireOnce('walk_' + s.k + (retryK ? '_r30' : ''),
        '10-min walk \u00b7 ' + s.label,
        (retryK ? 'Still open \u00b7 ' : '') + 'Triglycerides drop fastest right after meals',
        { kind: 'walk', icon: 'app', actions: [{ action: 'snz15', title: 'Snooze 15 min' }] });
      if (ok) fired++;
    }
    const nx = health && health.bm && health.bm.nx;
    if (nx && nowMin >= 540 && nowMin <= 600) {
      const left = Math.round((new Date(nx + 'T00:00:00') - now) / 864e5);
      if (left <= 3) {
        const ok = await fireOnce('bmretest',
          'Lipid retest ' + (left <= 0 ? 'is due' : 'in ' + left + ' day' + (left === 1 ? '' : 's')),
          'Book the blood test \u00b7 planned for ' + nx, { icon: 'rem' });
        if (ok) fired++;
      }
    }
  } catch (e) {}

  /* --- 4e. morning brief + evening wrap-up --- */
  try {
    const tasksAll = asList(daily && daily.weeklyTasks);
    const tDays = t => Array.isArray(t && t.days) ? t.days : String((t && t.day) || '').split(',').map(s => s.trim()).filter(Boolean);
    const tDone = t => Array.isArray(t && t.doneDays) ? t.doneDays : (t && t.done ? tDays(t) : []);
    const onDay = (t, d) => { const ds = tDays(t); return ds.indexOf(d) >= 0 || ds.indexOf('Anytime') >= 0 || ds.indexOf('Today') >= 0; };
    const openTasks = tasksAll.filter(t => onDay(t, abbr) && tDone(t).indexOf(abbr) < 0);
    const allHab = habits.filter(Boolean);
    const openH = allHab.filter(openHab);
    const ptsAll = allHab.reduce((s, h) => s + ptsOf(h), 0);
    const ptsDone = allHab.filter(h => !openHab(h)).reduce((s, h) => s + ptsOf(h), 0);
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

    if (inFirst(nowMin, BRIEF_AT) && (openH.length || openTasks.length || rems.length)) {
      const nextUp = openH.filter(h => okTime(h.time) && hhmmToMin(h.time) >= nowMin)
        .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
      const parts = [plural(openH.length, 'habit')];
      if (rems.length) parts.push(plural(rems.length, 'reminder'));
      if (openTasks.length) parts.push(plural(openTasks.length, 'task'));
      const head = 'Today \u00b7 ' + parts.join(', ');
      const lines = [];
      if (nextUp.length) lines.push('First up: ' + nextUp.slice(0, 2).map(h => h.name + ' ' + tShort(h.time)).join(', '));
      if (wPlan && wAmt < wGoal) {
        const wl = wPlan.slots.filter(x => !x.done);
        const anyDone = wPlan.slots.some(x => x.done);
        if (wl.length) lines.push('Water ' + (anyDone ? 'next ' : 'starts ') + tShort(wl[0].t) + ' \u00b7 ' + plural(wl.length, 'drink') + (anyDone ? ' left' : ''));
      }
      if (openTasks.length) lines.push('Tasks: ' + andList(openTasks.map(t => t.name).filter(Boolean), 3));
      const ok = await fireOnce('brief_am', head, lines.join('\n') || 'Nothing timed today',
        { kind: 'open', icon: 'app', actions: [{ action: 'open', title: 'Open today' }, { action: 'snz30', title: 'Snooze 30 min' }] });
      if (ok) fired++;
    }

    if (inFirst(nowMin, WRAP_AT) && allHab.length && (openH.length || openTasks.length)) {
      const doneN = allHab.length - openH.length;
      const left = openH.map(h => h.name).filter(Boolean);
      const lines = [];
      if (left.length) lines.push('Open: ' + left.slice(0, 3).join(', ') + (left.length > 3 ? ' +' + (left.length - 3) + ' more' : ''));
      if (openTasks.length) lines.push('Tasks: ' + andList(openTasks.map(t => t.name).filter(Boolean), 3));
      const ok = await fireOnce('wrap_pm', doneN + ' of ' + allHab.length + ' done \u00b7 ' + ptsDone + ' of ' + ptsAll + ' pts', lines.join('\n'),
        { kind: 'open', icon: 'app', actions: [{ action: 'open', title: 'Review' }] });
      if (ok) fired++;
    }

    /* --- 4f. weekly: plan, midweek check, score --- */
    const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const inst = [];   /* one entry per task-day */
    tasksAll.forEach(t => {
      const ds = tDays(t), dn = tDone(t);
      ds.forEach(d => { if (WD.indexOf(d) >= 0 || d === 'Anytime') inst.push({ t: t, d: d, done: dn.indexOf(d) >= 0 || (d === 'Anytime' && dn.length > 0) }); });
    });
    const total = inst.length, doneW = inst.filter(x => x.done).length;
    const crit = tasksAll.filter(t => t && t.priority === 'critical').length;
    if (total && now.getDay() === WEEK_PLAN.day && inFirst(nowMin, WEEK_PLAN.at)) {
      const per = WD.map(d => inst.filter(x => x.d === d).length);
      const bi = per.indexOf(Math.max.apply(null, per));
      const ok = await fireOnce('week_plan', 'This week \u00b7 ' + plural(total, 'task'),
        'Busiest day ' + WD[bi] + ' (' + per[bi] + ')' + (crit ? ' \u00b7 ' + crit + ' critical' : ''),
        { kind: 'open', icon: 'app', actions: [{ action: 'open', title: 'Plan my week' }] });
      if (ok) fired++;
    }
    if (total && now.getDay() === WEEK_MID.day && inFirst(nowMin, WEEK_MID.at)) {
      const past = WD.slice(0, WD.indexOf(abbr));
      const late = inst.filter(x => !x.done && past.indexOf(x.d) >= 0).map(x => x.t.name).filter(Boolean);
      const ok = await fireOnce('week_mid', 'Weekly check \u00b7 ' + doneW + ' of ' + total + ' done',
        late.length ? late.length + ' slipped: ' + andList(late, 3) : 'Nothing slipped so far',
        { kind: 'open', icon: 'app', actions: [{ action: 'open', title: 'Review' }] });
      if (ok) fired++;
    }
    if (total && now.getDay() === WEEK_END.day && inFirst(nowMin, WEEK_END.at)) {
      const pct = Math.round(doneW * 100 / total);
      const ok = await fireOnce('week_end', 'Week done \u00b7 ' + doneW + ' of ' + total + ' (' + pct + '%)',
        total - doneW ? (total - doneW) + ' left over' : 'Clean sweep',
        { kind: 'open', icon: 'app', actions: [{ action: 'open', title: 'See summary' }] });
      if (ok) fired++;
    }
  } catch (e) {}

  return fired;
}

/* ============================================================
   5. PUSH  -- the only path that works when the app is closed
   Payload is optional. A data-less push simply means "wake up
   and check", which keeps the sender dead simple (no payload
   encryption required at all).
============================================================ */
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = null;
    try { if (event.data) data = event.data.json(); } catch (e) { data = null; }

    /* explicit payload: show exactly what the sender asked for */
    if (data && (data.title || data.body)) {
      await wakeLog('push-payload', 1, String(data.title || '').slice(0, 40));
      await self.registration.showNotification(data.title || 'Second Brain', {
        body: data.body || '',
        icon: data.icon || ICON,
        badge: BADGE,
        tag: data.tag || ('push_' + Date.now()),
        renotify: true,
        vibrate: [90, 50, 90],
        data: { url: data.url || './', tag: data.tag || '' }
      });
      return;
    }

    /* no payload: figure out what is due ourselves */
    const n = await runCheck('push');
    await wakeLog('push', n, n === 0 ? 'nothing was due' : 'fired ' + n);

    /* A push MUST result in a visible notification or the browser
       may revoke the push subscription. If nothing was due, show a
       quiet keep-alive that closes itself. */
    if (n === 0) {
      await self.registration.showNotification('Second Brain', {
        body: 'Nothing due right now.',
        icon: ICON, badge: BADGE, tag: 'ssb-keepalive',
        silent: true, requireInteraction: false
      });
      await new Promise(r => setTimeout(r, 1500));
      const ns = await self.registration.getNotifications({ tag: 'ssb-keepalive' });
      ns.forEach(x => x.close());
    }
  })());
});

/* subscription rotated by the browser: re-register and re-publish */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const old = event.oldSubscription || await self.registration.pushManager.getSubscription();
      const opts = (event.oldSubscription && event.oldSubscription.options) ||
                   (old && old.options) || null;
      if (!opts || !opts.applicationServerKey) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: opts.applicationServerKey
      });
      await publishSubscription(sub);
    } catch (e) {}
  })());
});

/* store the subscription in RTDB so the sender can find it */
async function publishSubscription(sub) {
  try {
    const j = sub.toJSON ? sub.toJSON() : sub;
    const id = 'k' + (j.keys && j.keys.p256dh ? j.keys.p256dh.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) : Date.now());
    await fetch(DB_URL + '/' + DB_ROOT + '/ssb/pushSubs/' + id + '.json', {
      method: 'PUT',
      body: JSON.stringify({
        endpoint: j.endpoint,
        keys: j.keys || {},
        expirationTime: j.expirationTime || null,
        ua: 'sw',
        tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ''),
        /* the sender groups devices by this, so it must survive a
           pushsubscriptionchange re-publish, not just the page path */
        tzOffsetMin: -new Date().getTimezoneOffset(),
        updatedAt: Date.now()
      })
    });
  } catch (e) {}
}

/* ============================================================
   6. PERIODIC BACKGROUND SYNC -- free fallback, no server.
   Chromium only, installed PWA only, browser picks the timing
   (often 12h+). Not a substitute for push, but it costs nothing
   and catches some misses.
============================================================ */
self.addEventListener('periodicsync', event => {
  if (event.tag === 'ssb-reminders')
    event.waitUntil(runCheck('periodicsync').then(n => wakeLog('periodicsync', n)));
});
self.addEventListener('sync', event => {
  if (event.tag === 'ssb-reminders-once') event.waitUntil(runCheck('sync'));
});

/* ============================================================
   7. MESSAGES FROM THE PAGE
============================================================ */
self.addEventListener('message', event => {
  const d = event.data || {};
  /* reply on the MessageChannel port when one was supplied, otherwise
     straight back to the client that asked -- both callers exist. */
  const reply = msg => {
    if (event.ports && event.ports[0]) { try { event.ports[0].postMessage(msg); } catch (e) {} }
    if (event.source) { try { event.source.postMessage(msg); } catch (e) {} }
  };

  if (d.type === 'CHECK_REMINDERS') {
    event.waitUntil(runCheck('message'));
    return;
  }
  /* page asks US to show it, so dedupe lives in exactly one place */
  if (d.type === 'FIRE') {
    event.waitUntil(fireOnce(d.tag, d.title, d.body));
    return;
  }
  if (d.type === 'PUBLISH_SUB' && d.sub) {
    event.waitUntil(publishSubscription(d.sub));
    return;
  }
  if (d.type === 'GET_VERSION') {
    reply({ type: 'SW_VERSION', version: SW_VERSION, cache: CACHE_NAME });
    return;
  }
  if (d.type === 'WAKELOG') {
    event.waitUntil(wakeLogRead().then(a =>
      reply({ type: 'WAKELOG_RESULT', log: a })));
    return;
  }
  if (d.type === 'DIAG') {
    event.waitUntil((async () => {
      const now = new Date();
      const today = dayKey(now);
      const [cfg, daily, health] = await Promise.all([
        getJSON(DB_ROOT + '/config'),
        getJSON(DB_ROOT + '/daily_' + today),
        getJSON(DB_ROOT + '/permanent/health')
      ]);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const checks = (daily && daily.checks) || {};
      const due = [];
      ((cfg && cfg.reminders) || []).forEach(r => {
        if (remDueToday(r, today) && !remDoneToday(r, today) && isDue(nowMin, r.time))
          due.push('reminder:' + (r.title || r.id));
      });
      ((cfg && cfg.habits) || []).forEach(h => {
        if (h && h.time && checks[h.id] !== true && isDue(nowMin, h.time))
          due.push('habit:' + (h.name || h.id));
      });
      reply({
        type: 'DIAG_RESULT',
        version: SW_VERSION,
        now: now.toString(),
        nowMin: nowMin,
        today: today,
        readConfig: !!cfg,
        reminders: ((cfg && cfg.reminders) || []).length,
        habits: ((cfg && cfg.habits) || []).length,
        readDaily: !!daily,
        checks: Object.keys(checks).length,
        readHealth: !!health,
        hydrationPool: !!(daily && daily.hydrationPool),
        dueNow: due,
        ledger: await ledgerRead(),
        wakeLog: await wakeLogRead()
      });
    })());
    return;
  }
  if (d.type === 'PING_TEST') {
    event.waitUntil(fireOnce('selftest_' + Date.now(),
      '\u2705 Background notifications work',
      'Fired by the service worker, not the page. Close the app and try again to confirm.'));
    return;
  }
});

/* ============================================================
   8. CLICK / CLOSE
============================================================ */
self.addEventListener('notificationclick', event => {
  const n = event.notification;
  const act = event.action || '';
  const d = (n && n.data) || {};
  n.close();
  /* Snooze stays inside the worker: no window, no Firebase write. */
  const sm = /^snz(\d+)$/.exec(act);
  if (sm) { event.waitUntil(snoozeAdd(n, Math.min(180, +sm[1] || 15))); return; }
  /* Done / Log: handed to the page so the tick goes through the app's own
     save path (the worker never writes app data to Firebase). */
  const msg = (act === 'done' || act === 'log')
    ? { type: 'NOTIF_ACTION', action: act, kind: d.kind || '', ids: d.ids || [], slot: d.slot || '', date: dayKey(), tag: n.tag }
    : null;
  let target = d.url || './';
  if (msg) target = './?ssbact=' + encodeURIComponent(JSON.stringify(msg));
  else if (d.kind === 'wat') target = './#hydration';
  event.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        try { c.postMessage(msg || { type: 'NOTIF_CLICK', tag: n.tag }); } catch (e) {}
        try { return await c.focus(); } catch (e) { return; }
      }
    }
    return self.clients.openWindow(target);
  })());
});
