/**
 * Bangron Virtual Office - Service Worker
 * Offline caching, background sync, push notifications ready
 */

const CACHE_NAME = 'bangron-vo-v2';
const STATIC_ASSETS = [
  '/', '/index.html', '/manifest.json', '/assets/css/office.css',
  '/assets/js/core/api.js', '/assets/js/core/store.js',
  '/assets/js/core/toast.js', '/assets/js/core/skeleton.js',
  '/assets/js/core/empty-state.js', '/assets/js/core/confirm-dialog.js',
  '/assets/js/core/theme-manager.js', '/assets/js/app.js',
  '/assets/js/views/office-view.js', '/assets/js/views/dashboard-view.js',
  '/assets/js/views/agents-view.js', '/assets/js/views/tasks-view.js',
  '/assets/js/views/approvals-view.js', '/assets/js/views/activities-view.js',
  '/assets/js/views/projects-view.js', '/assets/js/views/deliverables-view.js',
  '/assets/js/views/settings-view.js', '/assets/js/views/login-view.js',
  '/assets/js/office/topdown-renderer.js', '/assets/js/office/camera.js',
  '/assets/js/office/movement-engine.js', '/assets/js/office/pixi-agents.js',
  '/assets/js/realtime/websocket-client.js'
];

const API_CACHE_NAME = 'bangron-api-v1';
const API_CACHE_DURATION = 5 * 60 * 1000;

// Install - cache static assets.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS.map(
        (url) => new Request(url, { credentials: 'same-origin' })
      )))
      .then(() => self.skipWaiting())
  );
});

// Activate - retain only current application and public API caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch - cache only explicitly public, session-independent API responses.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // CSRF tokens are session-bound and MUST remain network-only.
  // Do not broaden this allowlist without verifying that an endpoint is
  // public, session-independent, and safe to share between sessions.
  const isPublicHealth = url.pathname === '/api/health';
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      isPublicHealth
        ? networkFirstThenCache(request, API_CACHE_NAME)
        : fetch(request)
    );
    return;
  }

  event.respondWith(cacheFirstThenNetwork(request, CACHE_NAME));
});

async function networkFirstThenCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && !response.headers.has('set-cookie')) {
      const cacheControl = response.headers.get('cache-control') || '';
      if (!/\b(private|no-store)\b/i.test(cacheControl)) {
        const headers = new Headers(response.headers);
        headers.set('sw-cached-at', String(Date.now()));
        const body = await response.clone().blob();
        await cache.put(request, new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers
        }));
      }
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const cachedAtRaw = cached.headers.get('sw-cached-at');
      const cachedAt = cachedAtRaw === null ? NaN : Number(cachedAtRaw);
      const age = Date.now() - cachedAt;
      if (Number.isFinite(cachedAt) && age >= 0 && age < API_CACHE_DURATION) {
        return cached;
      }
      // Expired or malformed entries are deleted and NEVER served stale.
      await cache.delete(request);
    }
    return new Response(JSON.stringify({
      error: 'OFFLINE',
      message: 'Tidak ada koneksi internet. Data kesehatan layanan tidak tersedia.'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
}

async function cacheFirstThenNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    fetchAndCache(request, cacheName);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') return caches.match('/index.html');
    throw new Error('Network unavailable and no cached asset exists');
  }
}

async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
  } catch {
    // Background refresh is best-effort; cached static assets remain usable.
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-approvals') event.waitUntil(syncApprovals());
  if (event.tag === 'sync-tasks') event.waitUntil(syncTasks());
});

async function syncApprovals() {
  console.log('[SW] Approval sync is not implemented; no action taken.');
}
async function syncTasks() {
  console.log('[SW] Task sync is not implemented; no action taken.');
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || 'Notifikasi baru dari Bangron Virtual Office',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/badge-72.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Bangron VO', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (!event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) return client.focus();
        }
        return clients.openWindow('/');
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearCache') {
    event.waitUntil(Promise.all([
      caches.delete(CACHE_NAME), caches.delete(API_CACHE_NAME)
    ]));
  }
  if (event.data === 'logout' || event.data?.type === 'logout') {
    event.waitUntil(caches.delete(API_CACHE_NAME));
  }
});

console.log('[SW] Service Worker loaded');
