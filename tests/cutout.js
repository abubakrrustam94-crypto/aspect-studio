// Удаление фона (U²-Net-P в воркере): вырезает объект, заменяет фон, кэширует маску, переживает сбои и работает офлайн.
// Запуск: node tests/cutout.js   (нужен http: воркер и service worker не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8774/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
// экспорт в страницу: возвращает пиксели в заданных долях кадра (RGBA)
const EXPORT = `async ({ fmt, pts }) => {
  S.format = fmt; const it = items[0], bmp = await loadBitmap(it), res = await exportBlob(it, bmp); closeBmp(bmp);
  const m = await createImageBitmap(res.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  return { type: res.blob.type, w: m.width, h: m.height, px: pts.map(([fx, fy]) => [...x.getImageData(Math.min(m.width - 1, Math.floor(m.width * fx)), Math.min(m.height - 1, Math.floor(m.height * fy)), 1, 1).data]) };
}`;
(async () => {
  await new Promise(r => server.listen(8774, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const load = async f => { await p.evaluate(() => { items.length = 0; idx = 0; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(200); };
  const near = (a, b, t = 12) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
  const exp = (fmt, pts) => p.evaluate(`(${EXPORT})`, { fmt, pts }).then(f => f);
  const run = (fmt, pts) => p.evaluate(`(${EXPORT})({ fmt: ${JSON.stringify(fmt)}, pts: ${JSON.stringify(pts)} })`);
  await load('noface_coffee.jpg');
  await p.evaluate(() => { set('sizeMode', 'auto'); set('ratioW', 1); set('ratioH', 1); set('fit', 'fit'); set('enhOn', false); set('cutOn', true); set('cutBg', 'color'); set('cutColor', '#ff8800'); });
  const corners = [[.03, .03], [.97, .03], [.03, .97], [.97, .97]], mid = [[.5, .45]];
  let t0 = Date.now(); let r = await run('png', corners.concat(mid)); const first = Date.now() - t0;
  ok(r.px.slice(0, 4).every(v => near(v, [255, 136, 0], 3)), 'фон заменён выбранным цветом во всех углах ' + JSON.stringify(r.px.slice(0, 4).map(v => v.slice(0, 3))));
  ok(!near(r.px[4], [255, 136, 0], 40), 'объект (чашка) остался на месте: ' + r.px[4].slice(0, 3));
  ok(await p.evaluate(() => coBackend === 'wasm'), 'модель считает на WASM');
  // маска кэшируется
  t0 = Date.now(); const same = await p.evaluate(() => { const m = items[0].mask; return !!m; }); r = await run('png', corners); const second = Date.now() - t0;
  ok(same && second < first / 2, `повторный экспорт без пересчёта маски: ${first} мс → ${second} мс`);
  // белый и прозрачный фон
  await p.evaluate(() => set('cutBg', 'white')); r = await run('png', corners);
  ok(r.px.every(v => near(v, [255, 255, 255], 2) && v[3] === 255), 'белый фон');
  await p.evaluate(() => set('cutBg', 'transparent')); r = await run('png', corners.concat(mid));
  ok(r.type === 'image/png' && r.px.slice(0, 4).every(v => v[3] === 0) && r.px[4][3] === 255, 'прозрачный фон в PNG: углы прозрачны, объект непрозрачен');
  r = await run('webp', corners); ok(r.px.slice(0, 4).every(v => v[3] === 0), 'прозрачный фон в WebP');
  r = await run('jpg', corners); ok(r.type === 'image/jpeg' && r.px.every(v => near(v, [255, 255, 255], 6)), 'в JPG прозрачный фон становится белым');
  // режим «Заполнить»: фон тоже заменяется
  await p.evaluate(() => { set('cutBg', 'white'); set('fit', 'fill'); set('ratioW', 16); set('ratioH', 9); }); r = await run('png', [[.02, .5], [.98, .5]]);
  ok(r.px.every(v => near(v, [255, 255, 255], 10)), 'в режиме «Заполнить» фон по краям тоже белый (края кадра не пустые)') ;
  await p.evaluate(() => { set('fit', 'fit'); set('ratioW', 1); set('ratioH', 1); });
  // поворот пересчитывает маску
  const sig0 = await p.evaluate(() => items[0].mask.sig); await p.evaluate(() => { items[0].rot = 90; syncDims(items[0]); });
  r = await run('png', corners); const sig1 = await p.evaluate(() => items[0].mask.sig);
  ok(sig0 !== sig1 && r.px.every(v => near(v, [255, 255, 255], 2)), 'после поворота маска пересчитана, фон по-прежнему белый');
  await p.evaluate(() => { items[0].rot = 0; syncDims(items[0]); });
  // настройка «на этом фото»
  await p.evaluate(() => { items[0].ov = {}; OV_KEYS.forEach(k => { items[0].ov[k] = S[k]; }); items[0].ov.cutOn = false; });
  r = await run('png', [[.03, .03]]); ok(!near(r.px[0], [255, 255, 255], 2), 'настройка фото может отключить вырезание (ov.cutOn=false)');
  ok(await p.evaluate(() => cfgFor(items[0]).cutOn === false && S.cutOn === true), 'у фото своя настройка, общая не затронута');
  await p.evaluate(() => { items[0].ov = null; });
  // объект не найден → фон остаётся как был
  await p.evaluate(() => { set('cutOn', false); window.__cm = computeMask; computeMask = async () => ({ w: 8, h: 8, data: new Uint8Array(64), cover: 0.001 }); });
  await load('noface_rocket.jpg');
  await p.evaluate(() => { set('cutOn', true); });
  r = await run('png', [[.03, .03]]);
  ok(await p.evaluate(() => items[0].maskFail === 'empty'), 'если объект не найден, фото помечается и не вырезается');
  ok(!near(r.px[0], [255, 255, 255], 2), 'экспорт не падает');
  ok(await p.waitForFunction(() => /Не нашёл объект/.test(document.getElementById('toast').textContent), null, { timeout: 4000 }).then(() => true, () => false), 'пользователю сказано, что объект не найден');
  await p.evaluate(() => { computeMask = window.__cm; });
  // интерфейс
  await p.evaluate(() => { set('cutOn', false); }); await p.click('#settingsTabs [data-tab=bg]');
  ok(await p.evaluate(() => document.getElementById('cutFields').hidden), 'поля настроек скрыты, пока удаление фона выключено');
  await p.evaluate(() => { set('cutOn', true); set('cutBg', 'color'); });
  ok(await p.evaluate(() => !document.getElementById('cutFields').hidden && !document.getElementById('cutColorRow').hidden && document.getElementById('cutAlphaNote').hidden), 'для цвета показан выбор цвета');
  await p.evaluate(() => set('cutBg', 'transparent'));
  ok(await p.evaluate(() => document.getElementById('cutColorRow').hidden && !document.getElementById('cutAlphaNote').hidden && document.getElementById('afterCanvas').classList.contains('checker')), 'для прозрачного — пояснение и шахматка под результатом');
  // превью показывает вырезанный результат
  await load('noface_coffee.jpg'); await p.evaluate(() => { set('fit', 'fit'); set('cutBg', 'white'); set('ratioW', 1); set('ratioH', 1); });
  await p.waitForFunction(() => items[0].mask && items[0].mask.sig, null, { timeout: 30000 }); await p.waitForTimeout(1200);
  const pv = await p.evaluate(() => { const c = document.getElementById('afterCanvas'), x = c.getContext('2d'); return [...x.getImageData(2, 2, 1, 1).data]; });
  ok(near(pv, [255, 255, 255], 3), 'в окне предпросмотра фон уже белый: ' + pv.slice(0, 3));
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));

  // ---------- модель не скачалась ----------
  const c2 = await b.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' }); const q = await c2.newPage(); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto(URL_); await q.evaluate(SEEN); await q.reload(); await q.waitForTimeout(500);
  await q.route('**/vendor/cutout/**', r => r.abort());
  await q.setInputFiles('#fileInput', path.join(FX, 'noface_coffee.jpg')); await q.waitForFunction(() => items.length === 1);
  const bad = await q.evaluate(`(async () => { set('sizeMode','auto'); set('ratioW',1); set('ratioH',1); set('fit','fit'); set('enhOn',false); set('cutOn', true); set('cutBg','white'); const it = items[0], bmp = await loadBitmap(it), res = await exportBlob(it, bmp); return { fail: it.maskFail, size: res.blob.size, toast: document.getElementById('toast').textContent }; })()`);
  ok(bad.fail === 'load' && bad.size > 1000, 'модель не скачалась: фото всё равно экспортируется (без вырезания)');
  ok(/нужен интернет/.test(bad.toast), 'объяснено, что при первом запуске нужен интернет');
  await q.unroute('**/vendor/cutout/**'); await q.evaluate(() => { items[0].maskTry = 0; });
  const good = await q.evaluate(`(async () => { const it = items[0], bmp = await loadBitmap(it); await exportBlob(it, bmp); return { fail: it.maskFail, has: !!it.mask }; })()`);
  ok(good.has && !good.fail, 'сеть появилась: следующий экспорт вырезает без перезагрузки страницы');
  ok(!errs2.length, 'нет ошибок JS в сценарии без модели');

  // ---------- офлайн после первой загрузки ----------
  const c3 = await b.newContext({ viewport: { width: 1100, height: 900 } }); const o = await c3.newPage(); const errs3 = []; o.on('pageerror', e => errs3.push(e.message));
  await o.goto(URL_); await o.evaluate(SEEN); await o.evaluate(async () => { await navigator.serviceWorker.ready; }); await o.reload(); await o.waitForTimeout(800);
  await o.setInputFiles('#fileInput', path.join(FX, 'noface_coffee.jpg')); await o.waitForFunction(() => items.length === 1);
  const prep = `set('sizeMode','auto'); set('ratioW',1); set('ratioH',1); set('fit','fit'); set('enhOn',false); set('cutOn',true); set('cutBg','white');`;
  await o.evaluate(`(async () => { ${prep} const it = items[0], bmp = await loadBitmap(it); await exportBlob(it, bmp); })()`);
  await o.waitForTimeout(800); await c3.setOffline(true); await o.reload(); await o.waitForTimeout(800);
  await o.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await o.waitForFunction(() => items.length === 1);
  const off = await o.evaluate(`(async () => { ${prep} const it = items[0], bmp = await loadBitmap(it); await exportBlob(it, bmp); return { fail: it.maskFail, has: !!it.mask, cover: it.mask && it.mask.cover }; })()`);
  ok(off.has && !off.fail && off.cover > 0.2, 'без сети (после первой загрузки) фон удаляется: ' + JSON.stringify(off));
  ok(!errs3.length, 'нет ошибок JS в офлайне');
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
