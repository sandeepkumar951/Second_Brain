/**
 * ═══════════════════════════════════════════════════════════════
 * shared/pwa.js — Progressive Web App support
 *
 * This module owns:
 * - Service worker source code (inline)
 * - Service worker registration (file-based + blob fallback)
 * - PWA manifest injection
 * - Apple/meta tags
 * - Install banner / beforeinstallprompt
 * - Notification permission request after SW ready
 *
 * REGISTRATION STRATEGY:
 * 1. Try registering /sw.js (works when served from a real server)
 * 2. Fall back to Blob URL registration (works for local/file hosting)
 * 3. Gracefully degrade if neither works
 * ═══════════════════════════════════════════════════════════════
 */

import { showToast } from '../core/utils.js';
import { flags } from '../core/state.js';


/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER SOURCE (inline)
   ═══════════════════════════════════════════════════════════════ */

const SW_CACHE_NAME = 'sandy-brain-v6';

const SW_SOURCE = `
'use strict';

const CACHE_NAME = '${SW_CACHE_NAME}';
const ASSETS = ['/'];

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
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
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
            '<!DOCTYPE html><html><body><h2>Sandy Brain</h2><p>You are offline.</p></body></html>',
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
      body: data.body || '',
      icon: data.icon || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E",
      badge: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E",
      tag: data.tag || 'sandy-reminder'
    })
  );
});
`;


/* ═══════════════════════════════════════════════════════════════
   SVG ICON DATA URI (used in manifest + Apple tags)
   ═══════════════════════════════════════════════════════════════ */

const ICON_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%237C3AED'/%3E%3Ctext x='50%25' y='55%25' font-size='110' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";

const APPLE_ICON_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Crect width='180' height='180' rx='40' fill='%237C3AED'/%3E%3Ctext x='50%25' y='55%25' font-size='100' text-anchor='middle' dominant-baseline='middle'%3E%F0%9F%A7%A0%3C/text%3E%3C/svg%3E";


/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
   ═══════════════════════════════════════════════════════════════ */

/**
 * @private Attaches SW lifecycle listeners (update found, message relay).
 * @param {ServiceWorkerRegistration} reg
 */
function _setupSWListeners(reg) {
  // Listen for updates
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    if (nw) {
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('Update available — refresh for latest version', 'gt');
        }
      });
    }
  });

  // Relay CHECK_REMINDERS messages from SW to main thread
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'CHECK_REMINDERS') {
      // Dispatch custom event so reminders module can listen
      window.dispatchEvent(new CustomEvent('sw-check-reminders'));
    }
  });
}

/**
 * @private Requests notification permission after SW registration.
 * Waits 4 seconds to avoid overwhelming the user on first load.
 */
function _requestNotifAfterSWReady() {
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          showToast('Notifications enabled!', 'gt');
          // Dispatch event so reminders module can update UI
          window.dispatchEvent(new CustomEvent('notif-permission-changed'));
        }
      } catch (e) { /* ignore */ }
    }, 4000);
  }
}

/**
 * Registers the service worker.
 * Tries /sw.js first, falls back to inline Blob URL.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(reg => {
      console.log('Sandy Brain: SW registered via /sw.js');
      _setupSWListeners(reg);
      _requestNotifAfterSWReady();
    })
    .catch(() => {
      // Fallback: register via Blob URL
      try {
        const blob = new Blob([SW_SOURCE], { type: 'application/javascript' });
        const swURL = URL.createObjectURL(blob);

        navigator.serviceWorker.register(swURL)
          .then(reg => {
            console.log('Sandy Brain: SW registered via blob');
            _setupSWListeners(reg);
            setTimeout(() => URL.revokeObjectURL(swURL), 30000);
            _requestNotifAfterSWReady();
          })
          .catch(err => {
            console.log('Sandy Brain: SW not available on this host — running without service worker');
            try { URL.revokeObjectURL(swURL); } catch (_) { /* ignore */ }
          });
      } catch (e) {
        console.log('Sandy Brain: SW blob not supported on this host');
      }
    });
}


/* ═══════════════════════════════════════════════════════════════
   PWA MANIFEST (injected at runtime)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Injects a web app manifest via Blob URL.
 * Uses absolute URLs based on current window location.
 */
export function injectManifest() {
  // Remove existing manifest link
  const existing = document.querySelector('link[rel="manifest"]');
  if (existing) existing.remove();

  const BASE_URL = window.location.href.split('#')[0].split('?')[0];

  const manifest = {
    name: "Sandy's Second Brain",
    short_name: 'Sandy Brain',
    description: 'Personal health, habit and career tracker',
    start_url: BASE_URL,
    display: 'standalone',
    background_color: '#F4F0FF',
    theme_color: '#7C3AED',
    orientation: 'portrait-primary',
    categories: ['health', 'productivity', 'lifestyle'],
    icons: [
      { src: ICON_SVG, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: ICON_SVG, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
    ],
    shortcuts: [
      { name: "Today's Habits", short_name: 'Today', url: BASE_URL + '#today', description: "View today's habits" },
      { name: 'Career Tracker', short_name: 'Career', url: BASE_URL + '#study', description: 'Track your journey' },
      { name: 'Junk Tracker', short_name: 'Junk', url: BASE_URL + '#junk', description: 'Log junk food' }
    ],
    prefer_related_applications: false
  };

  try {
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = url;
    document.head.appendChild(link);
    // Revoke after browser has had time to read it
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (e) {
    console.warn('Sandy Brain: manifest injection failed', e);
  }
}


/* ═══════════════════════════════════════════════════════════════
   APPLE / META TAGS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Injects Apple-specific meta tags for iOS PWA support.
 */
export function injectAppleTags() {
  const head = document.head;

  // Apple touch icon
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const link = document.createElement('link');
    link.rel = 'apple-touch-icon';
    link.href = APPLE_ICON_SVG;
    head.appendChild(link);
  }

  // Viewport (ensure viewport-fit=cover for notch support)
  let viewport = document.querySelector('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    head.appendChild(viewport);
  }
  viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover';
}


/* ═══════════════════════════════════════════════════════════════
   INSTALL BANNER / PROMPT
   ═══════════════════════════════════════════════════════════════ */

/**
 * Shows the PWA install banner if conditions are met.
 * Auto-dismisses after 10 seconds.
 */
export function showPWAInstallBanner() {
  const existing = document.getElementById('pwa-install-banner');
  if (existing) existing.remove();

  // Don't show if already in standalone mode
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  // Don't show if no deferred prompt
  if (!flags.deferredInstallPrompt) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.setAttribute('role', 'alert');
  banner.setAttribute('aria-live', 'polite');

  banner.innerHTML =
    '<span aria-hidden="true">📲</span>' +
    '<span>Install for real notifications!</span>' +
    '<button class="pwa-install-btn" id="pwa-install-btn">Install</button>' +
    '<button class="pwa-install-close" id="pwa-install-close">&times;</button>';

  document.body.appendChild(banner);

  // Auto-dismiss after 10s
  setTimeout(() => {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  }, 10000);
}

/**
 * Triggers the PWA install prompt.
 */
export async function installPWA() {
  if (!flags.deferredInstallPrompt) {
    showToast('Tap Chrome menu → Add to Home Screen', 'gt');
    return;
  }

  try {
    await flags.deferredInstallPrompt.prompt();
    const result = await flags.deferredInstallPrompt.userChoice;
    if (result.outcome === 'accepted') {
      showToast('App installed!', 'gt');
    }
  } catch (e) {
    showToast('Tap Chrome menu → Add to Home Screen', 'gt');
  }

  flags.deferredInstallPrompt = null;
  const b = document.getElementById('pwa-install-banner');
  if (b) b.remove();
}


/* ═══════════════════════════════════════════════════════════════
   EVENT BINDINGS (called once from init.js)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Registers all PWA-related event listeners.
 * Must be called once during app initialization.
 */
export function bindPWAEvents() {
  // ── beforeinstallprompt: capture the install prompt ──
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    flags.deferredInstallPrompt = event;

    if (!window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(showPWAInstallBanner, 5000);
    }
  });

  // ── appinstalled: cleanup after install ──
  window.addEventListener('appinstalled', () => {
    showToast("Sandy Brain installed successfully!", 'gt');
    flags.deferredInstallPrompt = null;
    const b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  });

  // ── Install/close button clicks via delegation ──
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    if (target.id === 'pwa-install-btn' || target.closest('#pwa-install-btn')) {
      installPWA();
    } else if (target.id === 'pwa-install-close' || target.closest('#pwa-install-close')) {
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.remove();
    }
  });
}


/* ═══════════════════════════════════════════════════════════════
   INIT — Call all PWA setup functions
   ═══════════════════════════════════════════════════════════════ */

/**
 * Complete PWA initialization sequence.
 * Call once from core/init.js.
 */
export function initPWA() {
  injectManifest();
  injectAppleTags();
  bindPWAEvents();
  registerServiceWorker();
}
