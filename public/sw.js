/**
 * Bangron Virtual Office - Service Worker
 * Offline caching, background sync, push notifications ready
 */

const CACHE_NAME = 'bangron-vo-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/office.css',
  '/assets/js/core/api.js',
  '/assets/js/core/store.js',
  '/assets/js/core/toast.js',
  '/assets/js/core/skeleton.js',
  '/assets/js/core/empty-state.js',
  '/assets/js/core/confirm-dialog.js',
  '/assets/js/core/theme-manager.js',
  '/assets/js/app.js',
  '/assets/js/views/office-view.js',
  '/assets/js/views/dashboard-view.js',
  '/assets/js/views/agents-view.js',
  '/assets/js/views/tasks-view.js',
  '/assets/js/views/approvals-view.js',
  '/assets/js/views/activities-view.js',
  '/assets/js/views/projects-view.js',
  '/assets/js/views/deliverables-view.js',
  '/assets/js/views/settings-view.js',
  '/assets/js/views/login-view.js',
  '/assets/js/office/topdown-renderer.js',
  '/assets/js/office/camera.js',
  '/assets/js/office/movement-engine.js',
  '/assets/js/office/pixi-agents.js',
  '/assets/js/realtime/websocket-client.js'
];

const API_CACHE_NAME = 'bangron-api-v1';
const API_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { credentials: 'same-origin' })));
      })
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch - network first for API, cache first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin
  if (url.origin !== location.origin) return;

  // API requests - NEVER cache authenticated responses by default
  // Only GET /api/health and /api/auth/csrf are safe to cache (no session data)
  const safeApiPaths = ['/api/health', '/api/auth/csrf'];
  const isSafeApi = safeApiPaths.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'));

  if (url.pathname.startsWith('/api/')) {
    if (isSafeApi) {
      event.respondWith(networkFirstThenCache(request, API_CACHE_NAME));
    } else {
      // Network-only for all other API endpoints (auth, sessions, user data, etc.)
      event.respondWith(fetch(request));
    }
    return;
  }

  // Static assets - cache first
  event.respondWith(cacheFirstThenNetwork(request, CACHE_NAME));
});

// Network first, then cache (for API)
async function networkFirstThenCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Clone response before caching
      const responseClone = response.clone();
      // Add timestamp header for cache expiration
      const headers = new Headers(responseClone.headers);
      headers.set('sw-cached-at', Date.now().toString());
      const cachedResponse = new Response(await responseClone.blob(), {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers
      });
      cache.put(request, cachedResponse);
    }
    return response;
  } catch (error) {
    // Network failed - try cache
    const cached = await caches.match(request);
    if (cached) {
      const cachedAt = cached.headers.get('sw-cached-at');
      if (cachedAt && Date.now() - parseInt(cachedAt) < API_CACHE_DURATION) {
        return cached;
      }
      // Expired - delete and return anyway (stale-while-revalidate would be better)
      // await caches.delete(cacheName); // Don't delete, serve stale
    }
    // Return offline response for API
    return new Response(JSON.stringify({ 
      error: 'OFFLINE', 
      message: 'Tidak ada koneksi internet. Menampilkan data tersimpan.' 
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Cache first, then network (for static assets)
async function cacheFirstThenNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) {
    // Serve from cache, update in background
    fetchAndCache(request, cacheName);
    return cached;
  }

  // Not in cache - fetch and cache
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    throw error;
  }
}

// Background fetch and cache
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
  } catch (error) {
    // Ignore background update failures
  }
}

// Background Sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-approvals') {
    event.waitUntil(syncApprovals());
  }
  if (event.tag === 'sync-tasks') {
    event.waitUntil(syncTasks());
  }
});

async function syncApprovals() {
  // TODO: Implement offline approval queue sync
  console.log('[SW] Syncing approvals...');
}

async function syncTasks() {
  // TODO: Implement offline task queue sync
  console.log('[SW] Syncing tasks...');
}

// Push notifications (for future Hermes alerts)
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
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bangron VO', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action) {
    // Handle action buttons
    console.log('[SW] Notification action:', event.action);
  } else {
    // Default click - open app
    event.waitUntil(
      clients.matchAll({ type: 'window' })
        .then((clientList) => {
          for (const client of clientList) {
            if (client.url === '/' && 'focus' in client) {
              return client.focus();
            }
          }
          return clients.openWindow('/');
        })
    );
  }
});

// Message from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'clearCache') {
    caches.delete(CACHE_NAME);
    caches.delete(API_CACHE_NAME);
  }
  if (event.data === 'logout') {
    // Clear all API cache on logout to prevent cross-account data leakage
    caches.delete(API_CACHE_NAME).then(() => {
      console.log('[SW] API cache cleared on logout');
    });
  }
});

console.log('[SW] Service Worker loaded');