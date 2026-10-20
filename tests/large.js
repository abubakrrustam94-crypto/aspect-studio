// Очень большие фото: открываются уменьшенными, ориентация и цвета верные, при нехватке памяти — ещё меньше.  Запуск: node tests/large.js
const { chromium } = require('playwright');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const path = require('path'), http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise(r => server.listen(8769, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8769/'); await p.waitForTimeout(500);
  // большой JPEG с квадрантами и EXIF Orientation=6 собираем прямо в браузере (в репозитории не храним)
  await p.evaluate(async () => {
    const W = Math.ceil(Math.sqrt(LOAD_AREA * 2 * 4 / 3) / 8) * 8, H = Math.round(W * 3 / 4 / 8) * 8;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    [['#f00', 0, 0], ['#00f', 1, 0], ['#00c800', 0, 1], ['#ff0', 1, 1]].forEach(([col, i, j]) => { x.fillStyle = col; x.fillRect(i * W / 2, j * H / 2, W / 2, H / 2); });
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .4)); c.width = c.height = 0;
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];   // IFD0 с одним тегом Orientation=6
    const app1 = [0xff, 0xe1, 0, 2 + 6 + tiff.length, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const out = new Uint8Array(u8.length + app1.length); out.set(u8.subarray(0, 2)); out.set(app1, 2); out.set(u8.subarray(2), 2 + app1.length);
    window.__big = new File([out], 'big_rot6.jpg', { type: 'image/jpeg' }); window.__bigDims = [W, H];
  });
  const dims = await p.evaluate(() => window.__bigDims);
  ok(dims[0] * dims[1] > (await p.evaluate(() => LOAD_AREA)), `тестовое фото ${dims[0]}×${dims[1]} больше лимита загрузки`);
  const add = () => p.evaluate(async () => { items.length = 0; idx = 0; document.querySelector('.toast').textContent = ''; await addFiles([window.__big]); return { n: items.length, it: items[0] && { ow: items[0].ow, oh: items[0].oh, reduced: items[0].reduced, load: items[0].load } }; });
  let r = await add();
  const LA = await p.evaluate(() => LOAD_AREA);
  ok(r.n === 1 && r.it.reduced && r.it.ow * r.it.oh <= LA * 1.02 && r.it.ow * r.it.oh > LA * 0.8, `открыто уменьшенным: ${r.it.reduced.from.w}×${r.it.reduced.from.h} → ${r.it.ow}×${r.it.oh}`);
  ok(r.it.reduced.from.w === dims[1] && r.it.reduced.from.h === dims[0], 'размеры исходника даны с учётом EXIF-ориентации (портрет)');
  ok(r.it.oh > r.it.ow, 'после уменьшения ориентация сохранена');
  await p.waitForFunction(() => /уменьшенном виде/.test(document.body.textContent), null, { timeout: 5000 }).then(() => ok(true, 'пользователь видит сообщение про уменьшение')).catch(() => ok(false, 'нет сообщения про уменьшение'));
  await p.waitForFunction(() => /МП открыт уменьшенным/.test(document.getElementById('infoRow').textContent), null, { timeout: 8000 }).then(() => ok(true, 'в строке информации есть пометка про уменьшенный исходник')).catch(() => ok(false, 'нет пометки в строке информации'));
  // экспорт: верх-лево после поворота — зелёный; размер в пределах лимитов
  const px = () => p.evaluate(async () => {
    S.sizeMode = 'auto'; S.format = 'png'; S.bg = 'color'; S.fit = 'fit'; S.enhOn = false; S.ratioW = 1; S.ratioH = 1;
    const it = items[0], bmp = await loadBitmap(it), res = await exportBlob(it, bmp); closeBmp(bmp);
    const m = await createImageBitmap(res.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
    const g = (fx, fy) => [...x.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data].slice(0, 3);
    return { w: m.width, h: m.height, tl: g(.2, .1), tr: g(.8, .1), bl: g(.2, .9), br: g(.8, .9), area: m.width * m.height };
  });
  let e = await px();
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 60);
  ok(near(e.tl, [0, 200, 0]) && near(e.tr, [255, 0, 0]) && near(e.bl, [255, 255, 0]) && near(e.br, [0, 0, 255]), `экспорт большого фото верный по цветам и повороту (${e.w}×${e.h})`);
  ok(e.area <= (await p.evaluate(() => MAX_AREA)) * 1.01, 'результат не превышает лимит площади');
  // обычное фото не трогаем
  await p.evaluate(() => { items.length = 0; });
  await p.setInputFiles('#fileInput', path.join(FX, 'quad.jpg')); await p.waitForFunction(() => items.length === 1);
  ok(await p.evaluate(() => items[0].reduced === null && items[0].load === null), 'обычное фото открывается как раньше, без уменьшения');
  // нехватка памяти: createImageBitmap падает на больших размерах → пробуем меньше
  await p.evaluate(() => { window.__cib = createImageBitmap; window.createImageBitmap = (f, o) => (o && o.resizeWidth * o.resizeHeight > 9e6) ? Promise.reject(new Error('oom')) : window.__cib(f, o); });
  r = await add();
  ok(r.n === 1 && r.it.ow * r.it.oh <= 9e6 && r.it.ow * r.it.oh > 2e6, `при нехватке памяти фото открылось ещё меньше: ${r.it.ow}×${r.it.oh}`);
  e = await px(); ok(near(e.tl, [0, 200, 0]) && e.w > 0, 'и экспорт после этого работает');
  await p.evaluate(() => { window.createImageBitmap = () => Promise.reject(new Error('oom')); });
  r = await add(); ok(r.n === 0, 'если не открывается даже уменьшенным — файл отклоняется без падения');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
