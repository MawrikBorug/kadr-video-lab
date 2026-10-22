// Migration worker at the old, exact URL and scope. It never caches API or iframe.
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
// No fetch handler: online responses pass straight through to the browser.
