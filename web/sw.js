const CACHE = 'kadr-lab-__BUILD_ID__';
const BASE = new URL('./', self.location.href);
const ASSETS = ['./', './index.html', './style.css', './app.js', './core.js', './providers.js', './catalog.js', './security.js', './measurement.js', './queue.js', './batch-ui.js', './build.js', './build-info.json', './data/registry.json', './data/samples.json', './manifest.webmanifest', './vendor/hls.mjs', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'].map(path => new URL(path, BASE).href);
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('kadr-lab-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  // Only a finite same-origin application shell. No API, iframe, CDN or media
  // request is intercepted or cached; a Service Worker cannot control their DOM.
  if (event.request.method !== 'GET' || !ASSETS.includes(event.request.url)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request).then(response => response || Response.error())));
});
