// Koe のオフライン用。通信できるときは常に最新を取り、できないときだけ保存分を返す
const CACHE = 'koe-shell-v1';
const SHELL = ['./', 'index.html', 'style.css', 'themes.css', 'techo.css', 'notes.css', 'config.js', 'parse.js', 'rokuyo.js', 'js/native.js', 'js/core.js', 'js/view.js', 'js/sheet.js', 'js/menu.js', 'js/data.js', 'js/form.js', 'js/tasks.js', 'js/edit.js', 'js/input.js', 'js/boot.js', 'icons/icon-192.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('version.json')) return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? caches.match('index.html', { ignoreSearch: true }) : Response.error())));
});
