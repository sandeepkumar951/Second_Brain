/* ═══════════════════════════════════════
   Sandy's Second Brain — Service Worker
   Enables real background notifications
   like WhatsApp even when app is closed
═══════════════════════════════════════ */

const CACHE_NAME = 'sandy-brain-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html'
];

/* ── Install: cache app shell ── */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

/* ── Fetch: serve from cache when offline ── */
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request).catch(() => {
                return caches.match('/index.html');
            });
        })
    );
});

/* ── Push: show notification even when app is closed ── */
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch(e) {
        data = {
            title: 'Sandy\'s Brain',
            body: event.data ? event.data.text() : 'New reminder!'
        };
    }

    const options = {
        body: data.body || 'Time for your reminder!',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        tag: data.tag || 'sandy-reminder',
        renotify: true,
        requireInteraction: false,
        data: {
            url: data.url || '/',
            timestamp: Date.now()
        },
        actions: [
            {action: 'open', title: '✅ Open App'},
            {action: 'dismiss', title: '✕ Dismiss'}
        ]
    };

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Sandy\'s Brain 🧠',
            options
        )
    );
});

/* ── Notification click handler ── */
self.addEventListener('notificationclick', event => {
    event.notification.close();
    if (event.action === 'dismiss') return;
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(list => {
            for (const client of list) {
                if (client.url.includes(self.location.origin)) {
                    return client.focus();
                }
            }
            return clients.openWindow('/');
        })
    );
});

/* ── Background sync: checks reminders ── */
self.addEventListener('sync', event => {
    if (event.tag === 'reminder-check') {
        event.waitUntil(checkScheduledReminders());
    }
});

async function checkScheduledReminders() {
    const allClients = await clients.matchAll();
    allClients.forEach(client => {
        client.postMessage({type: 'CHECK_REMINDERS'});
    });
}
