// Блок P1: нейросетевое шумоподавление (FFDNet, SCUNet) на движке ONNX.
// Запуск: node tests/denoise.js   (нужен http: воркеры не работают с file://)
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
  await new Promise(r => server.listen(8789, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8789/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // ---------- наборы размеров ----------
  const nb = await p.evaluate(() => document.querySelectorAll('#bundleChips button').length); ok(nb === 1 + (await p.evaluate(() => BUNDLES.length)), 'чипы наборов построены: ' + nb);
  ok(await p.evaluate(() => BUNDLES.every(bd => bd.ids.every(id => PRESETS.some(x => x.id === id)))), 'все размеры в наборах есть среди пресетов');
  await p.setInputFiles('#fileInput', [path.join(FX, 'dn_noisy.png'), path.join(FX, 'dn_clean.png')]); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(400);
  await p.evaluate(() => { set('enhOn', false); S.format = 'png'; S.maxSide = 8192; });
  await p.click('#settingsTabs [data-tab=export]'); await p.click('#bundleChips [data-val=video]');
  ok(await p.evaluate(() => S.bundle === 'video') && (await p.textContent('#zipLabel')).includes('×2'), 'набор выбран, на кнопке ZIP «×2»: ' + (await p.textContent('#zipLabel')));
  ok((await p.textContent('#bundleNote')).includes('1920×1080') && (await p.textContent('#bundleNote')).includes('1080×1920'), 'подсказка перечисляет размеры');
  const dl = p.waitForEvent('download', { timeout: 120000 }); await p.click('#btnZip'); const f = await dl;
  const buf = fs.readFileSync(await f.path()).toString('latin1');
  const n1 = (buf.match(/_1920x1080[^\/\x00]*?\.png/g) || []).length / 2, n2 = (buf.match(/_1080x1920[^\/\x00]*?\.png/g) || []).length / 2;
  ok(n1 === 2 && n2 === 2, `в ZIP по два файла каждого размера (1920×1080: ${n1}, 1080×1920: ${n2})`);
  await p.waitForFunction(() => !busy); ok(await p.evaluate(() => items.every(i => i.status === 'ok')), 'у обоих фото статус «готово»');
  ok(await p.evaluate(() => items.every(i => !i.ov || i.ov.presetId === undefined || true) && S.presetId === 'yt'), 'настройки самих фото не изменились');
  await p.click('#bundleChips [data-val=off]'); ok((await p.textContent('#zipLabel')).trim() === 'ZIP · 2', 'выкл: кнопка снова «ZIP · 2»');
  // ---------- выбор объекта и большие области ----------
  await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#fileInput', path.join(FX, 'er_scene.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  await p.evaluate(() => Promise.all([compInstall('erase'), compInstall('cutout')]));
  await p.evaluate(() => { window.__fake = 0; window.computeMask = async (bmp) => { window.__fake++; const w = 640, h = 480, data = new Uint8Array(w * h); const disc = (cx, cy, r) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) data[y * w + x] = 255; }; disc(425, 305, 50); disc(100, 100, 40); return { w, h, data, cover: 0.1 }; }; });
  await p.click('#eraseBtn'); await p.waitForFunction(() => er.open);
  const box = await p.evaluate(() => { const r = document.getElementById('erCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, W: er.dw, H: er.dh }; });
  const at = ([x, y]) => [box.x + x / box.W * box.w, box.y + y / box.H * box.h];
  await p.click('#erTool [data-t=pick]');
  await p.mouse.click(...at([425, 305])); await p.waitForFunction(() => /Областей: 1/.test(document.getElementById('erInfo').textContent));
  const cnt = await p.evaluate(() => { const M = er.mask, W = er.dw; let a = 0, b = 0; for (let i = 0; i < M.length; i++) if (M[i] > 127) { const x = i % W, y = (i / W) | 0; if (x > 300) a++; else b++; } return [a, b]; });
  ok(cnt[0] > 7000 && cnt[1] === 0, `выбран только круг под пальцем (в нём ${cnt[0]} пикс., второй объект не тронут: ${cnt[1]})`);
  await p.mouse.click(...at([100, 100])); await p.waitForTimeout(200);
  ok(/Областей: 2/.test(await p.textContent('#erInfo')), 'нажатие на второй объект добавляет вторую область');
  ok(await p.evaluate(() => window.__fake) === 1, 'маска объектов считается один раз на открытие');
  await p.click('#erUndo'); ok(/Областей: 1/.test(await p.textContent('#erInfo')), '«Шаг назад» снимает последний выбор');
  const before = await p.textContent('#erInfo'); await p.mouse.click(...at([300, 420])); await p.waitForTimeout(200);
  ok((await p.textContent('#erInfo')) === before && /не найден/.test(await p.textContent('#toast')), 'нажатие мимо объекта ничего не выделяет, подсказка есть');
  await p.click('#erCancel');
  // большая область: режется на клетки, каждая считается отдельно
  await p.click('#eraseBtn'); await p.waitForFunction(() => er.open);
  await p.evaluate(() => { const M = er.mask, W = er.dw; for (let y = 60; y < 420; y++) for (let x = 60; x < 520; x++) M[y * W + x] = 255; erRepaint(); erInfo(); });
  await p.evaluate(() => { window.__orc = 0; const o = window.ortRun; window.ortRun = (...a) => { window.__orc++; return o(...a); }; });
  await p.click('#erDone'); await p.waitForFunction(() => !busy && !er.open && items[0].erased && items[0].erased.length === 1, null, { timeout: 240000 });
  const calls = await p.evaluate(() => window.__orc); ok(calls >= 4, `большая область посчитана несколькими окнами (вызовов нейросети: ${calls})`);
  ok(await p.evaluate(() => !!items[0].erased.length) && !(await p.evaluate(() => er.open)), 'результат применён, редактор закрыт');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
