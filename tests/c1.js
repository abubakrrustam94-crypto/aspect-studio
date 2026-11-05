// Блок C (v2.56): планшет, окно «Как это работает», окно «Как это работает», лимит памяти.
// Запуск: node tests/c1.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8869, r));
  const b = await chromium.launch(); const errs = [];
  // --- планшет в портрете: две колонки, нет горизонтальной прокрутки ---
  const ctx = await b.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'deviceMemory', { value: 2 }); } catch (e) { /* ok */ } });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8869/'); await p.evaluate(SEEN); await p.reload();
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 });
  const lay = await p.evaluate(() => { const a = document.getElementById('previewCard').getBoundingClientRect(), s = document.querySelector('.col-settings').getBoundingClientRect(); return { side: s.left > a.left + 200 && Math.abs(s.top - a.top) < 400, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
  ok(lay.side, 'на 820 px превью и настройки стоят рядом');
  ok(lay.sw <= lay.iw, 'на планшете нет горизонтальной прокрутки');
  const pin = await p.evaluate(() => getComputedStyle(document.querySelector('#previewCard .pin-btn') || document.body).display);
  ok(pin === 'none', 'булавка скрыта там, где превью и так на виду');
  // --- окно «Как это работает» ---
  await p.waitForSelector('#howBtn', { state: 'attached', timeout: 8000 });
  await p.click('#settingsTabs [data-tab=about]'); await p.click('#howBtn');
  ok(await p.evaluate(() => !document.getElementById('howDlg').hidden && document.querySelectorAll('#howDlg .how-item').length === 4), 'окно «Как это работает» открылось, 4 блока');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.closest('#howDlg')), 'фокус внутри окна');
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => document.getElementById('howDlg').hidden), 'Esc закрывает окно');
  // --- память уже защищена лимитом площади: результат урезается и это видно в строке сведений ---
  await p.evaluate(() => { set('sizeMode', 'fixed'); set('outW', 4096); set('outH', 4096); });
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => /Уменьшено до лимита/.test(document.getElementById('infoRow').textContent)), 'на устройстве с 2 ГБ слишком большой результат урезается и об этом сказано');
  await ctx.close();
  // --- пример на пустом экране: ссылка на пояснение ---
  const c2 = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' }); const p2 = await c2.newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto('http://localhost:8869/'); await p2.evaluate(SEEN); await p2.reload(); await p2.waitForSelector('#howLink', { timeout: 8000 });
  await p2.click('#howLink'); ok(await p2.evaluate(() => !document.getElementById('howDlg').hidden), 'ссылка на стартовом экране открывает окно');
  ok(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'на телефоне нет горизонтальной прокрутки');
  ok(errs.length === 0, 'нет ошибок страницы' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
