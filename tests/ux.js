// Блок UX: интерфейс на телефоне — сворачиваемые карточки, вкладки, индикатор «занято», компактная загрузка.
// Запуск: node tests/ux.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const EXP = `async (o) => { Object.assign(S, o.g || {}); const it = items[0]; for (const k in (o.ov || {})) set(k, o.ov[k]); const bmp = await loadBitmap(it); let r, err = null;
  try { r = await exportBlob(it, bmp); } catch (e) { err = e.name + ':' + e.message; } finally { closeBmp(bmp); }
  if (err) return { err }; const m = await createImageBitmap(r.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, px: o.px ? Array.from(d) : null }; }`;
(async () => {
  await new Promise(r => server.listen(8803, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 384, height: 781 }, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8803/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // --- вкладки: подсказка о прокрутке ---
  ok(await p.$eval('#settingsTabs', t => t.scrollWidth > t.clientWidth && t.classList.contains('fade-r')), 'вкладки не помещаются — справа затухание-подсказка');
  await p.click('#settingsTabs [data-tab=extra]'); await p.waitForTimeout(700);
  ok(await p.$eval('#settingsTabs', t => t.scrollLeft > 0 && t.classList.contains('fade-l')), 'после выбора дальней вкладки список прокручен, слева тоже затухание');
  // --- сворачиваемые карточки ---
  await p.click('#settingsTabs [data-tab=quality]');
  const fold = await p.evaluate(() => {
    const c = document.querySelector('#cardTone'), b = c.querySelector('.card-fold'); const body = c.querySelector('.card-title').nextElementSibling;
    const was = getComputedStyle(body).display !== 'none'; b.click();
    return { was, hidden: getComputedStyle(body).display === 'none', exp: b.getAttribute('aria-expanded'), saved: localStorage.getItem('aspect-studio-fold') };
  });
  ok(fold.was && fold.hidden && fold.exp === 'false' && /cardTone/.test(fold.saved), 'карточка сворачивается, состояние запоминается');
  await p.reload(); await p.waitForTimeout(600); await p.click('#settingsTabs [data-tab=quality]');
  ok(await p.evaluate(() => document.querySelector('#cardTone').classList.contains('folded')), 'после перезагрузки карточка осталась свёрнутой');
  await p.fill('#setSearch', 'экспозиция'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => { const c = document.querySelector('#cardTone'), body = c.querySelector('.card-title').nextElementSibling; return c.classList.contains('match') && getComputedStyle(body).display !== 'none'; }), 'поиск показывает содержимое свёрнутой карточки');
  await p.fill('#setSearch', ''); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('#cardTone .card-fold').click());
  ok(await p.evaluate(() => !document.querySelector('#cardTone').classList.contains('folded')), 'повторное нажатие разворачивает карточку');
  // --- индикатор «занято» ---
  const bz = await p.evaluate(async () => {
    let cancelled = 0; const h = window.busy('Считаю…', () => { cancelled++; }); const shown = !document.querySelector('#busy').hidden;
    document.querySelector('#busyCancel').click(); const gone = document.querySelector('#busy').hidden;
    const h2 = window.busy('Без отмены'); const noBtn = document.querySelector('#busyCancel').hidden; h2.done();
    return { shown, gone, cancelled, noBtn, after: document.querySelector('#busy').hidden };
  });
  ok(bz.shown && bz.gone && bz.cancelled === 1, 'индикатор показывается, «Отмена» вызывает обработчик и закрывает его');
  ok(bz.noBtn && bz.after, 'без обработчика отмены кнопки нет, done() скрывает индикатор');
  // --- компактная загрузка с фото ---
  const before = await p.evaluate(() => document.querySelector('#uploadZone').getBoundingClientRect().height);
  ok(before > 80, 'без фото большая зона загрузки есть');
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(900);
  const lay = await p.evaluate(() => { const r = id => document.querySelector(id).getBoundingClientRect(); const z = getComputedStyle(document.querySelector('#uploadZone')).display;
    return { pv: r('#previewCard'), up: r('#uploadCard'), z, add: getComputedStyle(document.querySelector('#addMoreBtn')).display, vh: innerHeight, hint: !document.querySelector('#uiHint').hidden, ow: document.documentElement.scrollWidth }; });
  ok(lay.pv.top < lay.up.top, 'превью выше карточки загрузки');
  ok(lay.pv.bottom <= lay.vh && lay.pv.height > 150, `превью целиком на первом экране (низ ${Math.round(lay.pv.bottom)} из ${lay.vh})`);
  ok(lay.z === 'none' && lay.add !== 'none', 'большая зона скрыта, вместо неё кнопка «＋ Добавить»');
  ok(lay.ow <= 384, 'нет горизонтальной прокрутки страницы');
  ok(lay.hint, 'разовая подсказка про A/B и закрепление показана');
  await p.click('#uiHintOk');
  await p.reload(); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(500);
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(700);
  ok(await p.evaluate(() => document.querySelector('#uiHint').hidden), 'после «Понятно» подсказка больше не появляется');
  // --- зоны нажатия ---
  const small = await p.evaluate(() => [...document.querySelectorAll('#orderRow button:not([hidden]), #addMoreBtn, .card-fold')].filter(e => e.offsetParent && (e.getBoundingClientRect().height < 40)).map(e => e.id || e.className));
  ok(!small.length, 'кнопки в карточке фото не ниже 40 px' + (small.length ? ': ' + small.join(',') : ''));
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
