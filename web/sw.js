// 서비스워커: 웹 주소로 열 때 오프라인에서도 실행되게 함.
// 인터넷이 되면 항상 최신 파일을 받고(받은 것은 저장), 안 되면 저장해 둔 파일로 연다. 근무 데이터(localStorage)와는 무관.
const CACHE = 'worktime-app';
const FILES = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const fromNet = fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  });
  // 인터넷이 느리면 4초 뒤 저장해 둔 파일로
  const timeout = new Promise((_, no) => setTimeout(no, 4000));
  e.respondWith(Promise.race([fromNet, timeout]).catch(() =>
    caches.match(e.request, { ignoreSearch: true }).then((c) => c || fromNet)));
});
