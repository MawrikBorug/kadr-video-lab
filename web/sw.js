// Same URL/scope: preserve the migration, add only WebTorrent's local range bridge.
importScripts('./vendor/webtorrent.sw.min.js');
// All archived shells used this finite prefix and a 12-digit build hash.
const BASE = new URL('./', self.location.href);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  if (self.registration.scope !== BASE.href) return;
  for (const key of await caches.keys()) {
    if (!/^kadr-lab-[a-f0-9]{12}$/.test(key)) continue;
    const cache = await caches.open(key);
    const requests = await cache.keys();
    if (requests.length && requests.every(request => request.url.startsWith(BASE.href))) await caches.delete(key);
  }
  await self.clients.claim();
})()));
// The imported vendor worker handles only the scoped /webtorrent/ route.
// It streams browser-held pieces, not a remote backend, and does not cache media.
self.addEventListener('message', event => {
  if (event.data?.type === 'KADR_STREAM_PING') event.ports[0]?.postMessage('KADR_STREAM_lift-2');
});
