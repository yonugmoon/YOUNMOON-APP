const CACHE_NAME = 'kt-inspection-v2';
const FILES = [
  '/YOUNMOON-APP/kt_MOS북부_v143 (4).html',
  '/YOUNMOON-APP/AR_설비점검.html',
  '/YOUNMOON-APP/lib/jsQR.js',
  '/YOUNMOON-APP/lib/qrcode.js',
  '/YOUNMOON-APP/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
