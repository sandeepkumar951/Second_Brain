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

const SW_VERSION  = 'v180';
const CACHE_NAME  = 'sandy-brain-proto-v180';
const NOTIF_STORE = 'ssb-notif-state-v1';
const ASSETS      = ['./'];

const DB_URL  = 'https://sandyhealthtracker-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_ROOT = 'sandy_shared';

const ICON  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%237C3AED'/%3E%3Ctext x='50%25' y='55%25' font-size='110' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";
/* v180: a real silhouette badge. Android paints the badge as a one-colour
   mask, so the old emoji badge became a blob. Brain = two lobes + a split. */
const BADGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Cpath fill='%23fff' d='M45 14c-8-6-21-2-23 8-9 2-14 12-10 20-6 6-5 17 3 21 0 10 10 17 19 14 3 5 7 6 11 5zM51 14c8-6 21-2 23 8 9 2 14 12 10 20 6 6 5 17-3 21 0 10-10 17-19 14-3 5-7 6-11 5z'/%3E%3C/svg%3E";
/* Android shows `icon` as a second, large picture on the right of every
   card, next to the badge. That doubled the icon, so Android gets none. */
const IS_ANDROID = /Android/i.test((self.navigator && self.navigator.userAgent) || '');

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
          '<!DOCTYPE html><html><body><h2>Sandy Brain</h2><p>You are offline.</p></body></html>',
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
   ml, also[] (extra tags to mark fired, used by grouped pop-ups). */
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
              slot: opt.slot || '', ml: opt.ml || 0, body: body || '', actions: acts, sticky: !!opt.sticky }
    };
    if (!IS_ANDROID) o.icon = ICON;
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
function pick(a) {
  if (!a || !a.length) return '';
  return a[new Date().getDate() % a.length];
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
  let s = x.length <= 1 ? (x[0] || '') : x.slice(0, -1).join(', ') + ' & ' + x[x.length - 1];
  if (more > 0) s = x.join(', ') + ' +' + more;
  return s;
}
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
    title: n.title || 'Sandy Brain',
    body: n.body || d.body || '',
    kind: d.kind || '', ids: d.ids || [], slot: d.slot || '', ml: d.ml || 0,
    day: dayKey(),
    actions: (d.actions || []).slice(0, 2),
    sticky: !!d.sticky
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
          { kind: s.kind, ids: s.ids, slot: s.slot, ml: s.ml, actions: s.actions, sticky: s.sticky });
        if (ok) fired++;
      }
      await snzWrite(keep);
    }
  } catch (e) {}

  /* --- 4a. reminders: name is the title, grouped when due together --- */
  try {
    const timed = rems.filter(r => okTime(r.time)).map(r => ({ key: String(r.id), time: r.time, r: r }))
      .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
    for (const phase of ['first', 'retry']) {
      const tagOf = it => 'rem_' + it.key + (phase === 'retry' ? '_r30' : '');
      for (const c of clusterDue(timed, nowMin, phase, tagOf, fired0)) {
        const m = c.mem, ids = m.map(x => x.key), L = c.lead;
        const sticky = m.some(x => x.r.priority === 'high' || STICKY_RX.test(x.r.title || ''));
        let title, body;
        if (m.length === 1) {
          const r = L.r;
          title = phase === 'retry' ? 'Still pending \u00b7 ' + (r.title || 'Reminder')
                                    : (r.title || 'Reminder') + ' \u00b7 ' + t12(r.time);
          body = phase === 'retry'
            ? 'Was due ' + t12(r.time) + '. ' + pick(['Second call, last call.', 'Do it before I change my mind about caring.', 'Reality does not pause for anyone.'])
            : (r.msg ? String(r.msg).replace(/[.!\s]+$/, '') + '. ' : '') + pick(["I'm a genius, not your secretary.", 'Reality does not pause for anyone.', 'Do it before I change my mind about caring.']);
        } else {
          title = (phase === 'retry' ? 'Still pending \u00b7 ' : '') + m.length + ' reminders \u00b7 ' + t12(L.time);
          body = andList(m.map(x => x.r.title || 'Reminder'), 4) + '. ' + pick(['Chop chop.', 'Reality does not pause for anyone.', 'All of them, Sandy.']);
        }
        const ok = await fireOnce(tagOf(L), title, body, {
          kind: 'rem', ids: ids, sticky: sticky,
          actions: [{ action: 'done', title: doneLabel(m.length) }, { action: 'snz15', title: 'Snooze 15 min' }],
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
    for (const phase of ['first', 'retry']) {
      const tagOf = it => 'hab_' + it.key + (phase === 'retry' ? '_r30' : '');
      for (const c of clusterDue(timed, nowMin, phase, tagOf, fired0)) {
        const m = c.mem, L = c.lead, hs = m.map(x => x.h);
        const pts = hs.reduce((s, h) => s + ptsOf(h), 0);
        const names = hs.map(h => h.name || 'Habit');
        const sec = hs.every(h => h.section && h.section === hs[0].section) ? secName(hs[0].section) : '';
        const sticky = hs.some(h => STICKY_RX.test((h.name || '') + ' ' + (h.note || '')));
        let title, body;
        if (phase === 'retry') {
          title = 'Still open \u00b7 ' + andList(names);
          body = 'Was due ' + t12(L.time) + (pts ? ' \u00b7 +' + pts + ' pts' : '') + '. ' +
                 pick(['Round two, Sandy.', '30 minutes late and counting.', 'Reality does not do it for you.']);
        } else if (m.length === 1) {
          const h = hs[0];
          title = (h.name || 'Habit') + ' \u00b7 ' + t12(h.time);
          body = [h.note, pts ? '+' + pts + ' pts' : ''].filter(Boolean).join(' \u00b7 ') + '. ' +
                 pick(['Science demands it.', 'Do it before I change my mind about caring.', "Your triglycerides aren't gonna walk themselves."]);
        } else {
          title = (sec ? sec + ' \u00b7 ' : '') + andList(names) + (sec ? '' : ' \u00b7 ' + t12(L.time));
          const notes = hs.map(h => h.note ? (h.name || 'Habit') + ' (' + h.note + ')' : (h.name || 'Habit'));
          body = notes.join(' \u00b7 ') + ' \u00b7 +' + pts + ' pts. ' + pick(['Stop scrolling.', 'Science demands it.', 'Move it, Sandy.']);
        }
        const ok = await fireOnce(tagOf(L), title, body.replace(/^\.\s*/, ''), {
          kind: 'hab', ids: m.map(x => x.key), sticky: sticky,
          actions: [{ action: 'done', title: doneLabel(m.length) }, { action: 'snz15', title: 'Snooze 15 min' }],
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
        (secName(sid) || sid) + ' \u00b7 ' + (all.length - open.length) + ' of ' + all.length,
        open.map(h => h.name + (h.note ? ' (' + h.note + ')' : '')).join(' \u00b7 ') + (pts ? ' \u00b7 +' + pts + ' pts' : '') + '.',
        { kind: 'hab', ids: open.map(h => String(h.id)),
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
          const ok = await fireOnce('wat_' + sl,
            'Water due \u00b7 ' + t12(sl),
            ml + ' ml now \u00b7 ' + nfmt(wAmt) + ' of ' + nfmt(wGoal) + ' ml. ' +
              pick(["You're basically a raisin.", 'Do it for science. And your kidneys.', 'A glass now or a headache later.']),
            { kind: 'wat', slot: sl, ml: ml,
              actions: [{ action: 'log', title: 'Log ' + ml + ' ml' }, { action: 'snz10', title: 'Remind in 10 min' }] });
          if (ok) fired++;
        }
      } else if (ws.date === today && nowMin >= hhmmToMin('04:00')) {
        const n = wPlan.slots.filter(x => x.done).length;
        const ok = await fireOnce('wat_goal', 'Goal reached \u00b7 ' + nfmt(wGoal) + ' ml',
          (n ? n + ' glasses logged' : 'Done for today') + ' \u00b7 no more water reminders today.', { silent: true });
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
      const retryK = !isDue(nowMin, s.ping) && isDueRetry(nowMin, s.ping);
      if (!isDue(nowMin, s.ping) && !retryK) continue;
      const ok = await fireOnce('walk_' + s.k + (retryK ? '_r30' : ''),
        retryK ? 'Walk still pending \u00b7 ' + s.label : '10-min walk \u00b7 ' + s.label,
        'Triglycerides drop fastest right after meals.',
        { kind: 'walk', actions: [{ action: 'snz15', title: 'Snooze 15 min' }] });
      if (ok) fired++;
    }
    const nx = health && health.bm && health.bm.nx;
    if (nx && nowMin >= 540 && nowMin <= 600) {
      const left = Math.round((new Date(nx + 'T00:00:00') - now) / 864e5);
      if (left <= 3) {
        const ok = await fireOnce('bmretest',
          'Lipid retest ' + (left <= 0 ? 'is due' : 'in ' + left + ' day' + (left === 1 ? '' : 's')),
          'Book the blood test \u00b7 planned for ' + nx + '.');
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

    if (inFirst(nowMin, BRIEF_AT) && (openH.length || openTasks.length || rems.length)) {
      const nextUp = openH.filter(h => okTime(h.time) && hhmmToMin(h.time) >= nowMin)
        .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
      let head = 'Today \u00b7 ' + openH.length + ' habit' + (openH.length === 1 ? '' : 's') +
                 ' \u00b7 ' + (ptsAll - ptsDone) + ' pts';
      if (openTasks.length) head += ' \u00b7 ' + openTasks.length + ' task' + (openTasks.length === 1 ? '' : 's');
      const lines = [];
      if (nextUp[0]) lines.push('First up: ' + nextUp[0].name + ' at ' + t12(nextUp[0].time) + '. ' + pick(['Try not to screw it up.', 'Reality does not pause for anyone.', 'Infinite timelines, still gotta do these.']));
      nextUp.slice(1, 5).forEach(h => lines.push(t12(h.time) + '  ' + h.name));
      if (openTasks.length) lines.push('Tasks: ' + andList(openTasks.map(t => t.name).filter(Boolean), 3));
      const remT = rems.filter(r => okTime(r.time)).sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time));
      if (remT.length) lines.push('Reminders: ' + andList(remT.map(r => (r.title || 'Reminder') + ' ' + t12(r.time)), 2));
      const ok = await fireOnce('brief_am', head, lines.join('\n') || 'Nothing timed today.',
        { kind: 'open', actions: [{ action: 'open', title: 'Open today' }, { action: 'snz30', title: 'Snooze 30 min' }] });
      if (ok) fired++;
    }

    if (inFirst(nowMin, WRAP_AT) && allHab.length && (openH.length || openTasks.length)) {
      const doneN = allHab.length - openH.length;
      const left = openH.map(h => h.name).filter(Boolean);
      let body = left.length ? 'Still open: ' + andList(left, 4) + '.' : 'All habits done.';
      if (openTasks.length) body += '\nTasks: ' + andList(openTasks.map(t => t.name).filter(Boolean), 3) + '.';
      body += ' ' + pick(['Future you is judging present you.', "Clock's ticking on this dimension too.", 'Wrap it up before the day squanches out.']);
      const ok = await fireOnce('wrap_pm', doneN + ' of ' + allHab.length + ' done \u00b7 ' + ptsDone + ' of ' + ptsAll + ' pts', body,
        { kind: 'open', actions: [{ action: 'open', title: 'Review' }] });
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
      const ok = await fireOnce('week_plan', 'This week \u00b7 ' + total + ' task' + (total === 1 ? '' : 's'),
        'Busiest day ' + WD[bi] + ' (' + per[bi] + ')' + (crit ? ' \u00b7 ' + crit + ' critical' : '') + '. Infinite timelines, still gotta do these.',
        { kind: 'open', actions: [{ action: 'open', title: 'Plan my week' }] });
      if (ok) fired++;
    }
    if (total && now.getDay() === WEEK_MID.day && inFirst(nowMin, WEEK_MID.at)) {
      const past = WD.slice(0, WD.indexOf(abbr));
      const late = inst.filter(x => !x.done && past.indexOf(x.d) >= 0).map(x => x.t.name).filter(Boolean);
      const ok = await fireOnce('week_mid', 'Weekly check \u00b7 ' + doneW + ' of ' + total + ' done',
        late.length ? late.length + ' slipped: ' + andList(late, 3) + '. Clock is ticking.' : 'Nothing slipped so far. Keep it that way.',
        { kind: 'open', actions: [{ action: 'open', title: 'Review' }] });
      if (ok) fired++;
    }
    if (total && now.getDay() === WEEK_END.day && inFirst(nowMin, WEEK_END.at)) {
      const pct = Math.round(doneW * 100 / total);
      const ok = await fireOnce('week_end', 'Week done \u00b7 ' + doneW + ' of ' + total + ' (' + pct + '%)',
        (total - doneW ? (total - doneW) + ' left over. ' : 'Clean sweep. ') + 'Not bad, for a human.',
        { kind: 'open', actions: [{ action: 'open', title: 'See summary' }] });
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
      await self.registration.showNotification(data.title || 'Sandy Brain', {
        body: data.body || '',
        icon: IS_ANDROID ? undefined : (data.icon || ICON),
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
      await self.registration.showNotification('Sandy Brain', {
        body: 'Nothing due right now.',
        badge: BADGE, tag: 'ssb-keepalive',
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
