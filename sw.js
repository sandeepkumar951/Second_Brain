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

const SW_VERSION  = 'v118';
const CACHE_NAME  = 'sandy-brain-proto-v119';
const NOTIF_STORE = 'ssb-notif-state-v1';
const ASSETS      = ['./'];

const DB_URL  = 'https://sandyhealthtracker-default-rtdb.asia-southeast1.firebasedatabase.app';
const DB_ROOT = 'sandy_shared';

const ICON  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%237C3AED'/%3E%3Ctext x='50%25' y='55%25' font-size='110' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";
const BADGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";

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

/* Show a notification at most once per tag per calendar day. */
async function fireOnce(tag, title, body) {
  const today = dayKey();
  const led = await ledgerRead();
  if (led.day !== today) { led.day = today; led.tags = {}; }
  if (led.tags[tag]) return false;
  led.tags[tag] = 1;
  await ledgerWrite(led);
  try {
    await self.registration.showNotification(title, {
      body: body || '',
      icon: ICON,
      badge: BADGE,
      tag: tag,
      renotify: true,
      requireInteraction: false,
      silent: false,
      vibrate: [90, 50, 90],
      timestamp: Date.now(),
      data: { tag: tag, url: './', at: Date.now() }
    });
  } catch (e) { return false; }
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
const WINDOW_MIN = 15;
const DAY_ABBR   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
function isDueRetry(nowMin, hhmm) {
  if (!/^\d\d:\d\d$/.test(String(hhmm))) return false;
  const d = nowMin - hhmmToMin(hhmm) - RETRY_MIN;
  return d >= 0 && d <= WINDOW_MIN;
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
  let fired = 0;

  /* --- 4a. reminders at their own time --- */
  const rems = ((cfg && cfg.reminders) || []).filter(r => remDueToday(r, today) && !remDoneToday(r, today));
  for (const r of rems) {
    const retryR = !isDue(nowMin, r.time) && isDueRetry(nowMin, r.time);
    if (!isDue(nowMin, r.time) && !retryR) continue;
    const ok = await fireOnce(
      'rem_' + r.id + (retryR ? '_r30' : ''),
      retryR
        ? '\uD83D\uDD01 ' + pick(['Still not done, Sandy', 'Second call. Same thing.', 'You missed this 30 minutes ago'])
        : '\u23F0 ' + pick(['Hey. Thing. Now.', 'Aw geez, incoming thing', '*burp* Reminder alert, Sandy']),
      (r.title || 'Reminder') + (r.msg ? ' \u2014 ' + r.msg : '') + '. ' +
      pick(["I'm a genius, not your secretary.", 'Reality does not pause for anyone.',
            'Do it before I change my mind about caring.']) + ' \u00b7 ' + r.time
    );
    if (ok) fired++;
  }

  /* --- 4b. timed habits, silent once ticked off --- */
  const habits = (cfg && cfg.habits) || [];
  for (const h of habits) {
    if (!h || !h.time || checks[h.id] === true) continue;
    const retryH = !isDue(nowMin, h.time) && isDueRetry(nowMin, h.time);
    if (!isDue(nowMin, h.time) && !retryH) continue;
    const ok = await fireOnce(
      'hab_' + h.id + (retryH ? '_r30' : ''),
      retryH
        ? '\uD83D\uDD01 ' + pick(['That habit is still waiting', 'Round two, Sandy', '30 minutes late and counting'])
        : '\uD83D\uDD52 ' + pick(['Feet on the floor, Sandy', 'Move it, meatbag', 'Get up. Science demands it.']),
      (h.name || 'Habit') + (h.note ? ' \u2014 ' + h.note : '') + '. ' +
      pick(["Your triglycerides aren't gonna walk themselves.",
            'Do it before I change my mind about caring.', 'Reality does not do it for you.']) +
      ' \u00b7 ' + h.time
    );
    if (ok) fired++;
  }

  /* --- 4c. hydration slots --- */
  try {
    let ws = null;
    if (daily && daily.hydrationPool) {
      try { ws = JSON.parse(daily.hydrationPool); } catch (e) { ws = null; }
    }
    if (!ws) {
      const w = await getJSON(DB_ROOT + '/ssb/water');
      if (w && w.date === today) ws = { date: w.date, amount: +w.ml || 0, goal: +w.goal || 3300 };
    }
    if (ws) {
      const amt  = (ws.date === today) ? (+ws.amount || 0) : 0;
      const goal = +ws.goal || 3300;
      if (amt < goal) {
        const start = hhmmToMin(ws.startTime || '08:00');
        const end   = hhmmToMin(ws.endTime   || '21:00');
        const step  = +ws.intervalMin || 120;
        const slots = {};
        if (end > start && step >= 15) for (let t = start; t <= end; t += step) slots[minToHHMM(t)] = 1;
        (Array.isArray(ws.customSlots) ? ws.customSlots : []).forEach(c => { slots[c] = 1; });
        const done = ((ws.doneSlots || {})[today]) || [];
        for (const sl of Object.keys(slots)) {
          if (done.indexOf(sl) >= 0) continue;
          const retryW = !isDue(nowMin, sl) && isDueRetry(nowMin, sl);
          if (!isDue(nowMin, sl) && !retryW) continue;
          const ok = await fireOnce(
            'wat_' + sl + (retryW ? '_r30' : ''),
            retryW
              ? '\uD83D\uDD01 ' + pick(['Water. Still. Waiting.', 'That glass is not going to drink itself', 'Second hydration call'])
              : '\uD83E\uDD64 ' + pick(['Hydrate or diedrate', 'Sip, you sack of cells', 'Squanch some water']),
            Math.round(amt) + ' / ' + goal + ' ml. ' +
            pick(["You're basically a raisin right now.", 'Do it for science. And your kidneys.',
                  'A glass now or a headache later, your call.']) + ' \u00b7 ' + sl
          );
          if (ok) fired++;
        }
      }
    }
  } catch (e) {}

  /* --- 4d. post-meal walks (triglyceride plan) --- */
  try {
    const walksToday = ((health && health.walks) || {})[today] || [];
    const WLK = [
      { k: 'lunch',  label: 'After lunch',  ping: '14:00' },
      { k: 'dinner', label: 'After dinner', ping: '20:30' }
    ];
    for (const s of WLK) {
      if (walksToday.indexOf(s.k) >= 0) continue;
      const retryK = !isDue(nowMin, s.ping) && isDueRetry(nowMin, s.ping);
      if (!isDue(nowMin, s.ping) && !retryK) continue;
      const ok = await fireOnce('walk_' + s.k + (retryK ? '_r30' : ''),
        retryK ? '\uD83D\uDD01 Walk still pending' : '\uD83D\uDEB6 10-min walk time',
        s.label + ' \u00b7 triglycerides drop fastest right after meals');
      if (ok) fired++;
    }
    /* lipid retest reminder */
    const nx = health && health.bm && health.bm.nx;
    if (nx && nowMin >= 540 && nowMin <= 555) {
      const left = Math.round((new Date(nx + 'T00:00:00') - now) / 864e5);
      if (left <= 3) {
        const ok = await fireOnce('bmretest',
          '\uD83E\uDE78 Lipid retest ' + (left <= 0 ? 'is due' : 'in ' + left + ' day' + (left === 1 ? '' : 's')),
          'Book the blood test \u00b7 planned for ' + nx);
        if (ok) fired++;
      }
    }
  } catch (e) {}

  /* --- 4e. morning + evening digest --- */
  try {
    const openTasks = ((daily && daily.weeklyTasks) || []).filter(t => {
      const days = Array.isArray(t && t.days) ? t.days : String((t && t.day) || '').split(',').map(s => s.trim());
      const dd   = Array.isArray(t && t.doneDays) ? t.doneDays : (t && t.done ? days : []);
      const onToday = days.indexOf(abbr) >= 0 || days.indexOf('Anytime') >= 0 || days.indexOf('Today') >= 0;
      return onToday && dd.indexOf(abbr) < 0;
    });
    const openHabits = habits.filter(h => h && checks[h.id] !== true).length;
    if (openTasks.length || rems.length || openHabits) {
      let head = openTasks.length + ' task' + (openTasks.length === 1 ? '' : 's') +
                 ' \u00b7 ' + rems.length + ' reminder' + (rems.length === 1 ? '' : 's');
      if (openHabits) head += ' \u00b7 ' + openHabits + ' habit' + (openHabits === 1 ? '' : 's');
      const names = openTasks.slice(0, 3).map(t => t.name).filter(Boolean).join(', ');
      if (nowMin >= 540 && nowMin <= 555) {
        const ok = await fireOnce('digest_am',
          pick(['Wake up, we have a schedule', 'Rise and grind, Sandy', 'Morning. Universe waits for no one.']),
          head + '. ' + pick(['Reality does not pause for anyone.', 'Try not to screw it up.',
                              'Infinite timelines, still gotta do these.']) + (names ? ' \u2014 ' + names : ''));
        if (ok) fired++;
      }
      if (nowMin >= 1140 && nowMin <= 1155) {
        const ok = await fireOnce('digest_pm',
          pick(['Still open, genius', 'Not done yet, huh', 'Tick tock, Sandy']),
          head + '. ' + pick(["Clock's ticking on this dimension too.",
                              'Wrap it up before the day squanches out.',
                              'Future you is judging present you.']) + (names ? ' \u2014 ' + names : ''));
        if (ok) fired++;
      }
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
      await self.registration.showNotification('Sandy Brain', {
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
  n.close();
  const target = (n.data && n.data.url) || './';
  event.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if (c.url.indexOf(self.registration.scope) === 0) {
        try { c.postMessage({ type: 'NOTIF_CLICK', tag: n.tag }); } catch (e) {}
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
