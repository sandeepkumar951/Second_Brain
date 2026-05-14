/* ═══════════════════════════════════════════════════════════════
   shared/pwa.js
   Progressive Web App setup — service worker registration,
   PWA manifest injection, install banner, Apple meta tags.
   Depends on: core/state.js, core/utils.js
═══════════════════════════════════════════════════════════════ */

'use strict';

import {
  deferredInstallPrompt,
  setDeferredInstallPrompt
} from '../core/state.js';

import {
  showToast
} from '../core/utils.js';

/* ─────────────────────────────────────────────────────────────
   SERVICE WORKER SOURCE
   Inlined as a string so it can be registered as a blob URL
   when /sw.js is not available (e.g. file:// or hosted paths).
───────────────────────────────────────────────────────────────*/
const SW_CACHE_NAME = 'sandy-brain-v6';

const SW_SOURCE = `
'use strict';

const CACHE_NAME = '${SW_CACHE_NAME}';
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
          keys
            .filter(k => k !== CACHE_NAME)
            .map(k => caches.delete(k))
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
        caches.match(event.request)
          .then(cached => cached || new Response(
            '<!DOCTYPE html><html><body>' +
            '<h2>Sandy Brain</h2>' +
            '<p>You are offline. Please reconnect to sync your data.</p>' +
            '</body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          ))
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

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Sandy Brain', {
      body:  data.body  || '',
      icon:  data.icon  ||
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
        "viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E" +
        "%F0%9F%A7%A0%3C/text%3E%3C/svg%3E",
      badge:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
        "viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E" +
        "%F0%9F%A7%A0%3C/text%3E%3C/svg%3E",
      tag: data.tag || 'sandy-reminder'
    })
  );
});
`;

/* ─────────────────────────────────────────────────────────────
   SERVICE WORKER REGISTRATION
───────────────────────────────────────────────────────────────*/

/**
 * Registers the service worker.
 * Tries /sw.js first (production), falls back to an inline
 * blob URL (development / file hosting).
 */
export function registerInlineServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(reg => {
      console.log('Sandy Brain: SW registered via /sw.js');
      _setupSWListeners(reg);
      _requestNotifAfterSWReady();
    })
    .catch(() => {
      /* Fallback — register from blob URL */
      try {
        const blob  = new Blob([SW_SOURCE], { type: 'application/javascript' });
        const swURL = URL.createObjectURL(blob);

        navigator.serviceWorker
          .register(swURL)
          .then(reg => {
            console.log('Sandy Brain: SW registered via blob');
            _setupSWListeners(reg);
            setTimeout(() => URL.revokeObjectURL(swURL), 30000);
            _requestNotifAfterSWReady();
          })
          .catch(err => {
            console.log(
              'Sandy Brain: SW not available on this host — running without service worker.',
              err.message
            );
            try { URL.revokeObjectURL(swURL); } catch (_) {}
          });

      } catch (e) {
        console.log('Sandy Brain: SW blob not supported on this host.');
      }
    });
}

/* ─────────────────────────────────────────────────────────────
   SW EVENT LISTENERS
───────────────────────────────────────────────────────────────*/

/**
 * Attaches update-found and message listeners to a SW registration.
 */
function _setupSWListeners(reg) {
  /* Notify user when an update is available */
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (nw) {
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('Update available — refresh for the latest version', 'gt');
        }
      });
    }
  });

  /* Listen for CHECK_REMINDERS messages from the SW */
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'CHECK_REMINDERS') {
      import('../tabs/reminders.js').then(m => {
        if (m.checkReminders) m.checkReminders();
      });
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   NOTIFICATION PERMISSION (post SW ready)
───────────────────────────────────────────────────────────────*/

/**
 * Requests notification permission 4 seconds after the SW
 * is ready — only if permission has not been granted or denied yet.
 */
function _requestNotifAfterSWReady() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;

  setTimeout(async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        showToast('Notifications enabled!', 'gt');
        import('../tabs/reminders.js').then(m => {
          if (m.updateNotifStatusUI) m.updateNotifStatusUI();
        });
      }
    } catch (e) {}
  }, 4000);
}

/* ─────────────────────────────────────────────────────────────
   PWA MANIFEST
───────────────────────────────────────────────────────────────*/

/**
 * Injects a dynamically-generated PWA manifest as a blob URL.
 * Uses absolute start_url derived from window.location so
 * shortcuts work regardless of hosting path.
 */
export function injectPWAManifest() {
  /* Remove any existing manifest link */
  const existing = document.querySelector('link[rel="manifest"]');
  if (existing) existing.remove();

  const BASE_URL = window.location.href.split('#')[0].split('?')[0];

  const ICON_SVG =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
    "viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' " +
    "fill='%237C3AED'/%3E%3Ctext x='50%25' y='55%25' font-size='110' " +
    "text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";

  const manifest = {
    name:             "Sandy's Second Brain",
    short_name:       'Sandy Brain',
    description:      'Personal health, habit and career tracker',
    start_url:        BASE_URL,
    display:          'standalone',
    background_color: '#F4F0FF',
    theme_color:      '#7C3AED',
    orientation:      'portrait-primary',
    categories:       ['health', 'productivity', 'lifestyle'],
    icons: [
      { src: ICON_SVG, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: ICON_SVG, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
    ],
    shortcuts: [
      {
        name:        "Today's Habits",
        short_name:  'Today',
        url:         BASE_URL + '#today',
        description: "View today's habits"
      },
      {
        name:        'Career Tracker',
        short_name:  'Career',
        url:         BASE_URL + '#study',
        description: 'Track your journey'
      },
      {
        name:        'Junk Tracker',
        short_name:  'Junk',
        url:         BASE_URL + '#junk',
        description: 'Log junk food'
      }
    ],
    prefer_related_applications: false
  };

  try {
    const blob = new Blob(
      [JSON.stringify(manifest)],
      { type: 'application/manifest+json' }
    );
    const url  = URL.createObjectURL(blob);

    const link = document.createElement('link');
    link.rel   = 'manifest';
    link.href  = url;
    document.head.appendChild(link);

    /* Revoke after 15 s — long enough for the browser to read it */
    setTimeout(() => URL.revokeObjectURL(url), 15000);

  } catch (e) {
    console.warn('Sandy Brain: manifest injection failed', e);
  }
}

/* ─────────────────────────────────────────────────────────────
   APPLE / META TAGS
───────────────────────────────────────────────────────────────*/

/**
 * Injects Apple-specific PWA meta tags and touch icon.
 * Safe to call multiple times — guards against duplicates.
 */
export function injectAppleTags() {
  const head = document.head;

  /* Apple touch icon */
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const link = document.createElement('link');
    link.rel   = 'apple-touch-icon';
    link.href  =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
      "viewBox='0 0 180 180'%3E%3Crect width='180' height='180' rx='40' " +
      "fill='%237C3AED'/%3E%3Ctext x='50%25' y='55%25' font-size='100' " +
      "text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";
    head.appendChild(link);
  }

  /* Viewport — ensure viewport-fit=cover for safe areas */
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport      = document.createElement('meta');
    viewport.name = 'viewport';
    head.appendChild(viewport);
  }
  viewport.content =
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover';
}

/* ─────────────────────────────────────────────────────────────
   PWA INSTALL BANNER
───────────────────────────────────────────────────────────────*/

/**
 * Shows the PWA install prompt banner at the bottom of the screen.
 * Only shown if the browser has a deferred install prompt available
 * and the app is not already running in standalone mode.
 */
export function showPWAInstallBanner() {
  const existing = document.getElementById('pwa-install-banner');
  if (existing) existing.remove();

  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (!deferredInstallPrompt) return;

  const banner = document.createElement('div');
  banner.id    = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.setAttribute('role',      'alert');
  banner.setAttribute('aria-live', 'polite');

  banner.innerHTML =
    '<span aria-hidden="true">📲</span>' +
    '<span>Install for real notifications!</span>' +
    '<button class="pwa-install-btn" onclick="installPWA()">Install</button>' +
    '<button class="pwa-install-close" ' +
      'onclick="document.getElementById(\'pwa-install-banner\').remove()" ' +
      'aria-label="Dismiss install banner">×</button>';

  document.body.appendChild(banner);

  /* Auto-dismiss after 10 s */
  setTimeout(() => {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  }, 10000);
}

/**
 * Triggers the browser's native PWA install prompt.
 * Falls back to a manual instruction toast if unavailable.
 */
export async function installPWA() {
  if (!deferredInstallPrompt) {
    showToast('Tap Chrome menu → Add to Home Screen', 'gt');
    return;
  }

  try {
    await deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    if (result.outcome === 'accepted') showToast('App installed!', 'gt');
  } catch (e) {
    showToast('Tap Chrome menu → Add to Home Screen', 'gt');
  }

  setDeferredInstallPrompt(null);

  const b = document.getElementById('pwa-install-banner');
  if (b) b.remove();
}

/* ─────────────────────────────────────────────────────────────
   CSS INJECTOR
───────────────────────────────────────────────────────────────*/

/**
 * Injects the install banner CSS once.
 */
function _injectPWACSS() {
  if (document.getElementById('pwa-css')) return;
  const s = document.createElement('style');
  s.id    = 'pwa-css';
  s.textContent = `
    .pwa-install-banner {
      position: fixed;
      bottom: calc(40px + var(--safe-bottom, 0px));
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg,#7c3aed,#4f46e5);
      color: white;
      padding: 12px 20px;
      border-radius: 99px;
      font-size: 13px;
      font-weight: 700;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 8px 32px rgba(124,58,237,0.4);
      white-space: nowrap;
      font-family: var(--font, system-ui, sans-serif);
      max-width: calc(100vw - 32px);
    }
    .pwa-install-btn {
      background: rgba(255,255,255,0.2);
      border: 1px solid rgba(255,255,255,0.4);
      color: white;
      border-radius: 99px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      font-family: var(--font, system-ui, sans-serif);
      transition: background 0.2s;
    }
    .pwa-install-btn:hover {
      background: rgba(255,255,255,0.35);
    }
    .pwa-install-close {
      background: none;
      border: none;
      color: rgba(255,255,255,0.7);
      font-size: 18px;
      cursor: pointer;
      line-height: 1;
      padding: 0 2px;
      flex-shrink: 0;
    }
    .pwa-install-close:hover {
      color: #fff;
    }
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────────────────────
   AUTO-INIT ON MODULE LOAD
───────────────────────────────────────────────────────────────*/
document.addEventListener('DOMContentLoaded', () => {
  _injectPWACSS();
  injectPWAManifest();
  injectAppleTags();
});
