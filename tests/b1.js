// Блок B (v2.55): цвет/тень/отступ водяного знака, ярлык «Сохранить как набор», приём фото из «Поделиться».
// Запуск: node tests/b1.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8865, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8865/'); await p.evaluate(SEEN);
  // --- приём фото из «Поделиться»: кладём файл в кэш так же, как это делает sw.js ---
  const png = fs.readFileSync(path.join(FX, 'face_astronaut.jpg')).toString('base64');
  await p.evaluate(async b64 => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const c = await caches.open('aspect-share'); await c.put(new URL('./share/0', document.baseURI).href, new Response(new Blob([bin], { type: 'image/jpeg' }), { headers: { 'Content-Type': 'image/jpeg', 'X-Name': encodeURIComponent('из-галереи.jpg') } })); }, png);
  await p.goto('http://localhost:8865/?shared=1'); await p.waitForFunction(() => items.length === 1, null, { timeout: 15000 });
  ok(await p.evaluate(() => items[0].name === 'из-галереи.jpg' && location.search === ''), 'фото из «Поделиться» добавлено, адрес очищен');
  ok(await p.evaluate(async () => (await (await caches.open('aspect-share')).keys()).length === 0), 'временный кэш очищен');
  // --- водяной знак ---
  await p.waitForSelector('#presetShortcut', { state: 'attached', timeout: 8000 });
  await p.click('#settingsTabs [data-tab=extra]');
  await p.evaluate(() => { set('wmOn', true); set('wmText', 'TEST'); set('wmSize', 40); set('wmPos', 'c'); set('wmShadow', false); });
  const px = async col => { await p.evaluate(c => { set('wmColor', c); }, col); await p.waitForTimeout(600); return p.evaluate(() => { const c = document.getElementById('afterCanvas'), x = c.getContext('2d'), w = c.width, h = c.height; const d = x.getImageData(0, 0, w, h).data; let r = 0, g = 0, bl = 0, n = 0; for (let y = Math.round(h * .42); y < h * .58; y += 2) for (let xx = Math.round(w * .3); xx < w * .7; xx += 2) { const i = (y * w + xx) * 4; if (d[i] > 235 && d[i + 1] < 40 && d[i + 2] < 40) r++; if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) g++; n++; } return { red: r, white: g }; }); };
  const red = await px('#ff0000');
  ok(red.red > 20, 'цвет текста знака применяется (красные пиксели: ' + red.red + ')');
  const defaults = await p.evaluate(() => DEFAULTS.wmColor === '#ffffff' && DEFAULTS.wmShadow === true && DEFAULTS.wmPad === 3);
  ok(defaults, 'значения по умолчанию совпадают со старым видом');
  ok(await p.evaluate(() => sanitizeSettings({ wmColor: 'javascript:1', wmPad: 9999, wmShadow: 'x' }).wmColor === undefined && (sanitizeSettings({ wmPad: 9999 }).wmPad === undefined || sanitizeSettings({ wmPad: 9999 }).wmPad <= 15)), 'чужие значения цвета и отступа отсекаются');
  await p.evaluate(() => { set('wmPos', 'tl'); set('wmPad', 0); }); await p.waitForTimeout(500);
  const a = await p.evaluate(() => { const c = document.getElementById('afterCanvas'); return c.width; });
  ok(a > 0, 'отступ 0 рисуется без ошибок');
  ok(await p.evaluate(() => !document.getElementById('wmPadBox').hidden), 'ползунок отступа виден для одного знака');
  await p.evaluate(() => set('wmMode', 'tile')); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById('wmPadBox').hidden), 'в режиме мозаики ползунок отступа скрыт');
  await p.evaluate(() => set('wmMode', 'single'));
  // --- шаблон знака хранит цвет ---
  ok(await p.evaluate(() => WMTPL_KEYS.includes('wmColor') && WMTPL_KEYS.includes('wmShadow') && WMTPL_KEYS.includes('wmPad')), 'шаблон знака запоминает цвет, тень и отступ');
  // --- ярлык набора ---
  await p.click('#settingsTabs [data-tab=export]'); await p.click('#presetShortcut'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.getElementById('settingsTabs').querySelector('[data-tab=extra]').getAttribute('aria-selected') === 'true' && document.activeElement && document.activeElement.id === 'presetName'), 'ярлык открыл «Мои наборы» и поставил курсор в поле имени');
  ok(errs.length === 0, 'нет ошибок страницы' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
