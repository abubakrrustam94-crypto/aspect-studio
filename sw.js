/* Aspect Studio — service worker (офлайн-режим) */
const VERSION = 'aspect-studio-v32';
const COMP_CACHE = 'aspect-studio-components';          // компоненты: кладёт страница по кнопке (js/components.js), здесь только отдаём
const CORE = ['./', './index.html', './manifest.json', './css/style.css', './js/core.js', './js/formats.js', './js/render.js', './js/analyze.js', './js/components.js', './js/session.js', './js/maskedit.js', './js/ort.js', './js/ort-worker.js', './js/enc.js', './js/enc-worker.js', './js/metadata.js', './js/faces.js', './js/faces-worker.js', './js/cutout.js', './js/cutout-worker.js', './js/preview.js', './js/ui.js', './js/export.js', './js/features.js', './js/onboarding.js', './js/changelog.js', './js/main.js', './fonts/roboto-flex-latin.woff2', './fonts/roboto-flex-cyrillic.woff2', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

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
    e.respondWith(caches.open(COMP_CACHE).then(c => c.match(req, { ignoreVary: true })).then(hit => hit || fetch(req)));
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
