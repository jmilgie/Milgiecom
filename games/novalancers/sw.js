// Nova Lancers service worker — network-first for same-origin GETs, cache fallback.
// Always prefers fresh files (so updates land immediately) and keeps a copy of whatever
// was loaded so solo play still works offline / on flaky mobile connections.
const CACHE = 'nova-lancers-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('nova-lancers-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // fonts, signaling, brokers: untouched
  if (!url.pathname.includes('/novalancers/')) return;
  if (url.pathname.includes('/dev/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('.html') });
      if (hit) return hit;
      throw err;
    }
  })());
});
