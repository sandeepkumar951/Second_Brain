// sw.js — place in root folder alongside index.html
'use strict';

const CACHE_NAME = 'sandy-brain-v6';
const ASSETS     = ['/'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached =>
          cached || new Response(
            '<!DOCTYPE html><html><body>' +
            '<h2>Sandy Brain</h2>' +
            '<p>You are offline.</p>' +
            '</body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          )
        )
      )
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_REMINDERS') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'CHECK_REMINDERS' }))
      )
    );
  }
});
