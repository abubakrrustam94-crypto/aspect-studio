/* Aspect Studio — service worker (офлайн-режим) */
const VERSION = 'aspect-studio-v40';
const COMP_CACHE = 'aspect-studio-components';          // компоненты: кладёт страница по кнопке (js/components.js), здесь только отдаём
const COMP_DIR = 'aspect-components', COMP_BC = 'aspect-studio-comp';
const CTYPE = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', json: 'application/json' };
const scopePath = () => new URL(self.registration.scope).pathname;
const relPath = url => decodeURIComponent(new URL(url).pathname.slice(scopePath().length));
/* Файловая система сайта (OPFS): компоненты лежат тут, а не в Cache Storage */
async function opfsFile(path) {
  try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(COMP_DIR); return await (await d.getFileHandle(encodeURIComponent(path))).getFile(); } catch (e) { return null; }
}
async function opfsPut(path, resp, size) {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(COMP_DIR, { create: true }), name = encodeURIComponent(path);
  const w = await (await d.getFileHandle(name, { create: true })).createWritable(); let got = 0;
  try {
    const rd = resp.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; await w.write(value); got += value.length; }
    if (got !== size) throw new Error('size ' + path);
    await w.close();
  } catch (e) { try { await w.abort(); } catch (_) {} try { await d.removeEntry(name); } catch (_) {} throw e; }
}
const CORE = ['./', './index.html', './manifest.json', './css/style.css', './js/core.js', './js/formats.js', './js/render.js', './js/analyze.js', './js/components.js', './js/session.js', './js/maskedit.js', './js/ort.js', './js/detect.js', './js/ort-worker.js', './js/sr.js', './js/dn.js', './js/erase.js', './js/icc.js', './js/enc.js', './js/enc-worker.js', './js/metadata.js', './js/faces.js', './js/faces-worker.js', './js/cutout.js', './js/cutout-worker.js', './js/preview.js', './js/ui.js', './js/export.js', './js/features.js', './js/onboarding.js', './js/changelog.js', './js/main.js', './fonts/roboto-flex-latin.woff2', './fonts/roboto-flex-cyrillic.woff2', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== COMP_CACHE && k !== 'aspect-share').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Приём фото из системного меню «Поделиться»: кладём файлы во временный кэш и открываем приложение
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData(), files = fd.getAll('photos').filter(f => f && f.size), c = await caches.open('aspect-share');
        for (const k of await c.keys()) await c.delete(k);
        await Promise.all(files.map((f, i) => c.put(new URL('./share/' + i, self.registration.scope).href, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || ''), 'X-Modified': String(f.lastModified || Date.now()) } }))));
        return Response.redirect(new URL('./?shared=' + files.length, self.registration.scope).href, 303);
      } catch (err) { return Response.redirect(new URL('./', self.registration.scope).href, 303); }
    })());
    return;
  }
  if (req.method !== 'GET') return;

  // Страница: сначала сеть (чтобы обновления доходили), при отсутствии сети — кэш
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Компоненты (vendor/): только из кэша компонентов, иначе сеть; сами ничего не кэшируем — скачивание только по кнопке
  if (url.origin === location.origin && url.pathname.includes('/vendor/')) {
    e.respondWith((async () => {
      const f = await opfsFile(relPath(req.url));
      if (f) { const ext = f.name.split('.').pop().toLowerCase(); return new Response(f, { headers: { 'Content-Type': CTYPE[decodeURIComponent(f.name).split('.').pop().toLowerCase()] || 'application/octet-stream', 'Content-Length': String(f.size) } }); }
      const hit = await caches.open(COMP_CACHE).then(c => c.match(req, { ignoreVary: true }));
      return hit || fetch(req);
    })());
    return;
  }

  // Стили и скрипты приложения: сначала сеть, иначе новая страница получала бы старые файлы
  if (url.origin === location.origin && /\.(css|js)$/.test(url.pathname) && !url.pathname.includes('/vendor/')) {
    e.respondWith(
      fetch(req)
        .then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Остальные свои файлы и шрифты Google: stale-while-revalidate
  const sameOrigin = url.origin === location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  e.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(req).then(hit => {
        const net = fetch(req)
          .then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});

/* Фоновая загрузка компонентов (Background Fetch): браузер качает сам, мы дописываем файлы в OPFS */
self.addEventListener('backgroundfetchsuccess', e => {
  const bf = e.registration; let ok = true;
  e.waitUntil((async () => {
    try {
      const recs = await bf.matchAll();
      for (const r of recs) {
        const resp = await r.responseReady, u = new URL(r.request.url), size = +u.searchParams.get('sz');
        if (!resp || !resp.ok || !size) { ok = false; continue; }
        try { await opfsPut(relPath(u.href), resp, size); } catch (err) { ok = false; }
      }
    } catch (err) { ok = false; }
    try { const bc = new BroadcastChannel(COMP_BC); bc.postMessage({ t: 'done', bid: bf.id, ok }); bc.close(); } catch (err) {}
    try { await e.updateUI({ title: ok ? 'Компонент скачан' : 'Не удалось записать файлы' }); } catch (err) {}
  })());
});
self.addEventListener('backgroundfetchfail', e => { try { const bc = new BroadcastChannel(COMP_BC); bc.postMessage({ t: 'done', bid: e.registration.id, ok: false }); bc.close(); } catch (err) {} });
self.addEventListener('backgroundfetchclick', e => { e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow(self.registration.scope))); });
