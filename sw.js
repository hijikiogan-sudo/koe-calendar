// Koe のオフライン用と、すぐ開くための控え
// ・版番号付きのファイル（?v=…）は中身が変わらないので、控えからすぐ返す
// ・ページ本体も控えからすぐ返し、裏で最新を取っておく。新しい版は checkNewVersion が見つけて開き直す
//   （そのときは ?v= を付けて開くので、ここでは通信を優先する）
// ・bump.sh で版番号を変えないと、変更が届かないので注意
const CACHE = 'koe-shell-v2';
const PAGE = './';

const assetsOf = (html) => [...html.matchAll(/(?:href|src)="([^":]+\?v=\d+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);

// 最新のページ本体と、それが読むファイルを控える。古い版のファイルは消す
async function saveShell(res) {
  const c = await caches.open(CACHE);
  const html = await res.clone().text();
  const assets = assetsOf(html);
  await Promise.all(assets.map(async (u) => {
    if (await c.match(u)) return;
    const r = await fetch(u);
    if (r.ok) await c.put(u, r);
  }));
  await c.put(PAGE, res);
  const keys = await c.keys();
  await Promise.all(keys.filter((k) => new URL(k.url).search.includes('v=') && !assets.includes(k.url)).map((k) => c.delete(k)));
}
async function refreshShell() {
  const res = await fetch(PAGE, { cache: 'no-cache' });
  if (res.ok) await saveShell(res);
}

self.addEventListener('install', (e) => { e.waitUntil(refreshShell().catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('version.json')) return;

  // ページ本体
  const scopePath = new URL(self.registration.scope).pathname;
  if (e.request.mode === 'navigate' && (url.pathname === scopePath || url.pathname === `${scopePath}index.html`)) {
    if (url.searchParams.has('v')) { // 新しい版を開き直すとき
      e.respondWith(fetch(PAGE, { cache: 'reload' }).then((res) => {
        if (res.ok) e.waitUntil(saveShell(res.clone()).catch(() => {}));
        return res;
      }).catch(() => caches.match(PAGE).then((r) => r || Response.error())));
      return;
    }
    e.respondWith(caches.match(PAGE).then((hit) => {
      if (hit) { e.waitUntil(refreshShell().catch(() => {})); return hit; }
      return fetch(e.request);
    }));
    return;
  }

  // 版番号付きのファイル
  if (/[?&]v=\d+/.test(url.search)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy))); }
      return res;
    }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || Response.error())));
    return;
  }

  // そのほか（アイコンなど）：通信を優先し、できないときは控え
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy))); }
    return res;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || Response.error()));
});
