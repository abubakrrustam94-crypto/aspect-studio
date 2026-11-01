// Блок PERF: ленивая загрузка, defer, проверка скорости, лёгкий старт.
// Запуск: node tests/perf.js
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
  await new Promise(r => server.listen(8806, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 384, height: 781 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = [], reqs = []; p.on('pageerror', e => errs.push(e.message)); p.on('request', r => reqs.push(new URL(r.url()).pathname));
  await p.goto('http://localhost:8806/'); await p.evaluate(SEEN); reqs.length = 0; await p.reload(); await p.waitForTimeout(1200);
  const LAZY = ['depth', 'lowlight', 'ocr', 'changelog-data', 'speed'];
  ok(LAZY.every(n => !reqs.some(u => u.endsWith('/js/' + n + '.js'))), 'при старте редкие модули не запрашиваются: ' + LAZY.join(', '));
  ok(/<script defer src="js\/main\.js">/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) && !/<script src="js\//.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'все скрипты сайта подключены с defer');
  const t = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, ver: typeof APP_VERSION, upload: !!document.querySelector('#uploadZone') }; });
  ok(t.ver === 'string' && t.upload && t.dcl < 6000, `страница собралась (DOMContentLoaded ${Math.round(t.dcl)} мс, порог 6000)`);
  // «Что нового» подгружает список при открытии
  await p.evaluate(() => wnOpen()); await p.waitForFunction(() => document.querySelectorAll('#wnList h3').length > 5, null, { timeout: 8000 });
  ok(reqs.some(u => u.endsWith('/js/changelog-data.js')), 'список изменений подгрузился при открытии окна');
  ok(await p.evaluate(() => /^v\d+\.\d+\.\d+/.test(document.querySelector('#wnList h3').textContent) && document.querySelector('#wnList h3').textContent.includes(APP_VERSION)), 'вверху списка текущая версия ' + await p.evaluate(() => APP_VERSION));
  await p.evaluate(() => $('#wnClose').click());
  // сбой ленивой загрузки: понятная ошибка, потом повтор работает
  await p.route('**/js/speed.js', r => r.abort());
  const lf = await p.evaluate(async () => { const ok = await lazyOk('speed'); return { ok, toast: document.querySelector('#toast').textContent }; });
  ok(!lf.ok && /speed\.js/.test(lf.toast), 'при сбое загрузки модуля показана понятная ошибка');
  await p.unroute('**/js/speed.js');
  await p.click('#settingsTabs [data-tab=about]'); await p.click('#speedBtn');
  await p.waitForFunction(() => document.querySelectorAll('#speedOut .sp-row').length >= 4 && document.querySelector('#speedOut .sp-sum'), null, { timeout: 15000 });
  const sp = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#speedOut .sp-row')].map(r => r.textContent), sum: document.querySelector('#speedOut .sp-sum').textContent }));
  ok(sp.rows.length >= 6 && sp.rows.every(r => /\S/.test(r)) && sp.sum.length > 10, 'проверка скорости: ' + sp.rows.length + ' замеров и вывод «' + sp.sum.slice(0, 24) + '…»');
  ok(await p.evaluate(() => !document.querySelector('#speedBtn').disabled), 'кнопка снова активна после замера');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
