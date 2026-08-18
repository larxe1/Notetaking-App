// ═══════════════════════════════════════════════
// LEGAL ANNOTATOR SERVICE WORKER
// Network-First with Cache Fallback for Offline Study
// ═══════════════════════════════════════════════

const CACHE_NAME = 'legal-annotator-shell-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './thinking.gif',
  './src/style.css',
  './src/main.js',
  './src/annotate.js',
  './src/viewer.js',
  './src/db.js',
  './src/drive.js',
  './src/library.js',
  './src/ui.js',
  './src/state.js',
  './src/dict.js',
  './src/colors.js',
  './src/draw.js',
  './src/dualview.js',
  './src/sync.js',
  './src/backup.js',
  './src/quiz.js',
  './src/search.js',
  './src/tablepicker.js',
  './src/notepad.js',
  './src/pdfcache.js'
];

// ── Install: Pre-cache core app shell & activate immediately ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: Purge old cache versions ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-First with Cache Fallback ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Never intercept Google OAuth or Supabase backend API calls
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('supabase.co')
  ) {
    return; // Pass through to network
  }

  // 2. Non-GET requests (e.g. POST, PUT, DELETE) pass directly
  if (event.request.method !== 'GET') {
    return;
  }

  // 3. Network-First for app code & assets
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // If response is valid, update the cache in background
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Network failed (device is offline) — serve from cache
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // If navigating to a page offline, fallback to index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('./');
        }
        return new Response('Offline and resource not cached.', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      })
  );
});
