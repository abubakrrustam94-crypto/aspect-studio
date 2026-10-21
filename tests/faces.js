// Определение лиц (BlazeFace в воркере): находит лица, не выдумывает их, управляет кадром, работает офлайн после первой загрузки.
// Запуск: node tests/faces.js   (нужен http: воркер и service worker не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8771/';
(async () => {
  await new Promise(r => server.listen(8771, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); }); await p.reload(); await p.waitForTimeout(600);
  const analyse = async f => {
    await p.evaluate(() => { items.length = 0; idx = 0; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForFunction(() => items.length === 1);
    await p.evaluate(() => { items[0].an = undefined; ensureAnalysis(items[0]); });
    await p.waitForFunction(() => items[0].an !== undefined, null, { timeout: 30000 });
    return p.evaluate(() => { const a = items[0].an; return a && { faces: a.faces, box: a.faceBox, fail: a.faceFail, missing: a.faceMissing, subject: a.subject }; });
  };
  // без компонента лица не ищутся и ничего не скачивается
  const vreq = []; p.on('request', r => { if (/\/vendor\/(tfjs|blazeface)\//.test(r.url())) vreq.push(r.url()); });
  let a = await analyse('face_astronaut.jpg');
  ok(a.faces === 0 && a.missing && !vreq.length, 'компонент не скачан: лица не ищутся, сеть не трогается, анализ помечен');
  ok(await p.waitForFunction(() => /не скачан компонент «Поиск лиц»/.test(document.getElementById('anAdvice').textContent), null, { timeout: 5000 }).then(() => true, () => false), 'в «Анализе фото» сказано, какой компонент скачать');
  await p.evaluate(() => compInstall('faces'));
  ok(await p.evaluate(() => compInstalled('faces') && compInstalled('tfjs')), 'после скачивания компонент (с движком) установлен');
  a = await analyse('face_astronaut.jpg');
  ok(a.faces === 1 && a.box.x0 > 0.25 && a.box.x1 < 0.65 && a.box.y0 < 0.3 && a.box.y1 > 0.25, `одно лицо найдено, рамка ${[a.box.x0, a.box.y0, a.box.x1, a.box.y1].map(v => v.toFixed(2))}`);
  ok(await p.evaluate(() => /лиц: 1/.test(document.getElementById('anStats').textContent)) || (await p.waitForFunction(() => /лиц: 1/.test(document.getElementById('anStats').textContent), null, { timeout: 5000 }).then(() => true, () => false)), 'в «Анализе фото» написано «лиц: 1»');
  a = await analyse('face_two.jpg'); ok(a.faces === 2 && a.box.x0 < 0.2 && a.box.x1 > 0.7, `два лица, общая рамка x ${a.box.x0.toFixed(2)}–${a.box.x1.toFixed(2)}`);
  a = await analyse('face_small.jpg'); ok(a.faces === 1 && a.box.x0 > 0.6, 'мелкое лицо в большом кадре найдено (фрагменты)');
  a = await analyse('noface_coffee.jpg'); ok(a.faces === 0 && !a.fail, 'кофе без лиц: лиц нет, ложных срабатываний нет');
  a = await analyse('noface_rocket.jpg'); ok(a.faces === 0 && !a.fail, 'ракета без лиц: лиц нет');
  ok(await p.evaluate(() => bfBackend === 'wasm'), 'модель считает на WASM (быстро), не на CPU');
  // кадр смотрит на лицо: узкий вертикальный кадр из широкого фото
  await analyse('face_small.jpg');
  const win = await p.evaluate(() => {
    set('sizeMode', 'auto'); set('ratioW', 9); set('ratioH', 16); set('fit', 'fill'); set('autoCenter', true);
    const it = items[0], c = cfgFor(it), ex = computeSize(it.w, it.h, 0, c), L = layout(it.w, it.h, ex.cw, ex.ch, it, c), U = it.an.faceBox;
    return { left: -L.dx, right: -L.dx + ex.cw, fa: U.x0 * L.dw, fb: U.x1 * L.dw, top: -L.dy, bottom: -L.dy + ex.ch, ta: U.y0 * L.dh, tb: U.y1 * L.dh };
  });
  ok(win.left <= win.fa && win.right >= win.fb && win.top <= win.ta && win.bottom >= win.tb, 'в режиме «Заполнить» лицо целиком внутри кадра 9:16');
  const two = await analyse('face_two.jpg');
  const win2 = await p.evaluate(() => {
    set('ratioW', 1); set('ratioH', 1);
    const it = items[0], c = cfgFor(it), ex = computeSize(it.w, it.h, 0, c), L = layout(it.w, it.h, ex.cw, ex.ch, it, c), U = it.an.faceBox;
    return { left: -L.dx, right: -L.dx + ex.cw, fa: U.x0 * L.dw, fb: U.x1 * L.dw };
  });
  ok(win2.left <= win2.fa && win2.right >= win2.fb, 'квадрат из панорамы: оба лица остаются в кадре');
  // выключатель
  await p.evaluate(() => set('faceAI', false)); await p.waitForFunction(() => items[0].an === undefined || true);
  await p.evaluate(() => { items[0].an = undefined; return ensureAnalysis(items[0]); });
  await p.waitForFunction(() => items[0].an !== undefined);
  ok(await p.evaluate(() => items[0].an.faces === 0 && !items[0].an.faceFail), 'при выключенном поиске лица не ищутся');
  await p.evaluate(() => set('faceAI', true)); await p.waitForFunction(() => items[0].an === undefined);
  await p.evaluate(() => ensureAnalysis(items[0])); await p.waitForFunction(() => items[0].an !== undefined, null, { timeout: 20000 });
  ok(await p.evaluate(() => items[0].an.faces === 2), 'после повторного включения анализ перезапускается и лица находятся');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));

  // ---------- сбой при скачивании компонента: ничего не остаётся, повтор работает ----------
  const c2 = await b.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' }); const q = await c2.newPage(); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto(URL_); await q.evaluate(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); }); await q.reload(); await q.waitForTimeout(500);
  await q.route('**/vendor/blazeface/**', r => r.abort());
  const bad = await q.evaluate(async () => { try { await compInstall('faces'); return 'ok'; } catch (e) { return 'fail'; } });
  ok(bad === 'fail' && await q.evaluate(() => !compInstalled('faces') && compFiles.faces === false), 'скачивание оборвалось: компонент не считается установленным');
  ok(await q.evaluate(async () => { const c = await caches.open(COMP_CACHE); const ks = (await c.keys()).map(r => r.url); return !ks.some(u => u.includes('blazeface')); }), 'недокачанные файлы не остались в кэше');
  await q.unroute('**/vendor/blazeface/**');
  await q.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await q.waitForFunction(() => items.length === 1);
  await q.evaluate(() => compInstall('faces'));
  await q.evaluate(() => { items[0].an = undefined; ensureAnalysis(items[0]); }); await q.waitForFunction(() => items[0].an !== undefined, null, { timeout: 30000 });
  ok(await q.evaluate(() => items[0].an.faces === 1 && !items[0].an.faceFail), 'повторное скачивание удалось, лицо находится без перезагрузки');

  // ---------- офлайн после первой загрузки ----------
  const c3 = await b.newContext({ viewport: { width: 1100, height: 900 } }); const o = await c3.newPage(); const errs3 = [];
  o.on('pageerror', e => errs3.push(e.message));
  await o.goto(URL_); await o.evaluate(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); });
  await o.evaluate(async () => { await navigator.serviceWorker.ready; }); await o.reload(); await o.waitForTimeout(800);
  ok(await o.evaluate(() => !!navigator.serviceWorker.controller), 'service worker управляет страницей');
  await o.evaluate(() => compInstall('faces'));
  await o.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await o.waitForFunction(() => items.length === 1);
  await o.waitForFunction(() => items[0].an !== undefined && items[0].an.faces === 1, null, { timeout: 30000 });
  await o.waitForTimeout(800);                                   // даём service worker дописать кэш
  await c3.setOffline(true);
  await o.reload(); await o.waitForTimeout(800);
  await o.setInputFiles('#fileInput', path.join(FX, 'face_two.jpg')); await o.waitForFunction(() => items.length === 1);
  const off = await o.waitForFunction(() => items[0].an !== undefined, null, { timeout: 30000 }).then(() => o.evaluate(() => ({ faces: items[0].an.faces, fail: items[0].an.faceFail })), () => null);
  ok(off && off.faces === 2 && !off.fail, 'без сети (после первой загрузки) лица находятся: ' + JSON.stringify(off));
  ok(!errs2.length && !errs3.length, 'нет ошибок JS в сценариях без сети');
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
