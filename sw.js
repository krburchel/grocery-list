// Service worker for the Kevin & Chey grocery list.
// Goal: the app shell opens instantly and even on dead grocery-store wifi.
// Firestore traffic is deliberately NOT cached here — the Firestore SDK has its
// own IndexedDB offline layer (persistentLocalCache) that queues writes and
// serves cached reads. We only cache the static shell + SDK modules + fonts.

const VERSION = 'v1';
const SHELL = 'grocery-shell-' + VERSION;
const RUNTIME = 'grocery-runtime-' + VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const host = url.hostname;

  // Let the Firebase SDK manage its own network (Firestore listen/write channels,
  // auth, installations). Fonts are on *.googleapis.com too, so allow those.
  if (host.endsWith('googleapis.com') && !host.startsWith('fonts.')) return;
  if (host.endsWith('firebaseio.com')) return;
  // Recipe search / CORS proxies are live API calls — don't serve them stale.
  if (/themealdb\.com|allorigins\.win|corsproxy\.io/.test(host)) return;

  // Navigations: network-first so updates ship, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Everything else (app code, Firebase SDK modules, fonts, icons):
  // cache-first, populating the runtime cache as resources are fetched.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
