// Водяной знак мозаикой и шаблоны знака.  Запуск: node tests/watermark.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
(async () => {
  await new Promise(r => server.listen(8768, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const open = async () => { await p.goto('http://localhost:8768/'); await p.waitForTimeout(500); };
  await open();
  await p.setInputFiles('#fileInput', path.join(FX, 'quad.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  await p.click('#settingsTabs [data-tab=extra]');
  // чёрный кадр 4:3 без полей, чтобы всё не-чёрное было знаком
  await p.evaluate(() => { set('sizeMode', 'fixed'); set('outW', 800); set('outH', 600); set('fit', 'fill'); set('bg', 'color'); set('color', '#000000'); set('enhOn', false); set('format', 'png'); set('wmOn', true); set('wmText', 'ASPECT'); set('wmSize', 12); set('wmOpacity', 100); });
  // подменяем фото чёрным, чтобы считать только знак
  await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 800, 600); const blob = await new Promise(r => c.toBlob(r)); const f = new File([blob], 'black.png', { type: 'image/png' }); items.length = 0; idx = 0; await addFiles([f]); });
  await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(400);
  const cover = () => p.evaluate(async () => {
    const it = items[0], bmp = await loadBitmap(it), r = await exportBlob(it, bmp); closeBmp(bmp);
    const m = await createImageBitmap(r.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, q = [0, 0, 0, 0]; let tot = 0;
    for (let y = 0; y < c.height; y += 2) for (let xx = 0; xx < c.width; xx += 2) { const o = (y * c.width + xx) * 4; if (d[o] + d[o + 1] + d[o + 2] > 60) { q[(y >= c.height / 2 ? 2 : 0) + (xx >= c.width / 2 ? 1 : 0)]++; tot++; } }
    return { q, tot, w: c.width, h: c.height };
  });
  await p.evaluate(() => { set('wmMode', 'single'); set('wmPos', 'br'); });
  let s = await cover();
  ok(s.w === 800 && s.h === 600, 'размер кадра ' + s.w + '×' + s.h);
  ok(s.q[3] > 50 && s.q[0] === 0 && s.q[1] === 0 && s.q[2] === 0, 'один знак: только в правом нижнем углу ' + s.q);
  await p.evaluate(() => { set('wmMode', 'tile'); set('wmAngle', -30); set('wmGap', 80); });
  const t = await cover();
  ok(t.q.every(v => v > 80), 'мозаика: знаки во всех четырёх четвертях ' + t.q);
  ok(await p.evaluate(() => !document.getElementById('wmTileBox').hidden && document.getElementById('wmPosBox').hidden), 'в режиме мозаики видны шаг и наклон, сетка положения скрыта');
  await p.evaluate(() => set('wmGap', 250));
  const sparse = await cover(); ok(sparse.tot < t.tot * 0.8, `больший шаг — знаков меньше (${sparse.tot} < ${t.tot})`);
  await p.evaluate(() => { set('wmGap', 80); set('wmAngle', 0); });
  const flat = await cover(); await p.evaluate(() => set('wmAngle', -45)); const tilted = await cover();
  ok(flat.tot > 0 && tilted.tot > 0 && JSON.stringify(flat.q) !== JSON.stringify(tilted.q), 'угол меняет раскладку знаков');
  await p.evaluate(() => { set('wmGap', 0); set('wmSize', 5); });
  const t0 = performance.now(); const dense = await cover();
  ok(dense.q.every(v => v > 80) && performance.now() - t0 < 8000, 'очень мелкий знак без шага не вешает экспорт');
  await p.evaluate(() => { set('wmGap', 80); set('wmSize', 12); set('wmAngle', -30); });
  // ---------- логотип в мозаике ----------
  await p.setInputFiles('#wmLogoInput', path.join(FX, 'quad.jpg')); await p.waitForFunction(() => !!wmLogo);
  const lg = await cover(); ok(lg.q.every(v => v > 200), 'логотип тоже повторяется мозаикой ' + lg.q);
  ok(await p.evaluate(() => !/undefined|NaN/.test(document.getElementById('pills') ? document.getElementById('pills').textContent : document.body.textContent)), 'в плашках размеров нет undefined/NaN');
  // ---------- шаблоны ----------
  await p.fill('#wmTplName', 'Мой знак'); await p.click('#wmTplSave'); await p.waitForTimeout(200);
  ok(await p.locator('#wmTpls .chip').count() === 1, 'шаблон сохранён и показан');
  await p.evaluate(() => { set('wmMode', 'single'); set('wmText', 'XXX'); set('wmSize', 40); }); await p.click('#wmLogoClear');
  await open();                                     // перезагрузка страницы: шаблон должен пережить её
  await p.click('#settingsTabs [data-tab=extra]');
  ok(await p.locator('#wmTpls .chip').count() === 1, 'шаблон сохранился после перезагрузки');
  await p.evaluate(() => set('wmOn', true));
  await p.click('#wmTpls .chip'); await p.waitForTimeout(500);
  const st = await p.evaluate(() => ({ mode: S.wmMode, text: S.wmText, size: S.wmSize, angle: S.wmAngle, gap: S.wmGap, logo: !!wmLogo, on: S.wmOn }));
  ok(st.mode === 'tile' && st.size === 12 && st.angle === -30 && st.gap === 80 && st.on, 'шаблон вернул режим, размер, угол и шаг ' + JSON.stringify(st));
  ok(st.logo, 'шаблон вернул логотип');
  await p.click('#wmTpls .mp-x'); ok(await p.locator('#wmTpls .chip').count() === 0, 'шаблон удаляется');
  // повреждённое хранилище не ломает страницу
  await p.evaluate(() => localStorage.setItem('aspect-studio-wmtpl', '{bad')); const e0 = errs.length; await open();
  ok(errs.length === e0 && await p.locator('#wmTpls .chip').count() === 0, 'повреждённые шаблоны игнорируются');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
