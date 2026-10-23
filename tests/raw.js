// Блок M: полное проявление RAW через LibRaw (компонент «RAW»).
// Запуск: node tests/raw.js   (нужен http: воркеры не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8780/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const PIX = `async (pts) => { const it = items[0], bmp = await loadBitmap(it), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); closeBmp(bmp);
  return { w: c.width, h: c.height, px: pts.map(([fx, fy]) => [...x.getImageData(Math.min(c.width - 1, Math.floor(c.width * fx)), Math.min(c.height - 1, Math.floor(c.height * fy)), 1, 1).data]) }; }`;
(async () => {
  await new Promise(r => server.listen(8780, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const vreq = []; p.on('request', r => { if (/\/vendor\/raw\//.test(r.url())) vreq.push(r.url()); });
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const add = async f => { await p.evaluate(() => { items.length = 0; document.getElementById('toast').textContent = ''; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForTimeout(2500); return p.evaluate(() => ({ n: items.length, toast: document.getElementById('toast').textContent })); };
  const reg = await p.evaluate(() => compById('raw').files);
  ok(reg.every(([f, s]) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size === s), 'компонент RAW: файлы на месте, размеры в реестре верны');
  // без компонента: у DNG без превью понятное сообщение, сеть не трогается
  let r = await add('raw_quad.dng');
  ok(r.n === 0 && /RAW: полное проявление/.test(r.toast) && !vreq.length, 'без компонента DNG без превью не открывается, подсказка называет компонент: ' + r.toast.slice(0, 90));
  await p.evaluate(() => compInstall('raw')); ok(await p.evaluate(() => compInstalled('raw')), 'компонент RAW скачан');
  r = await add('raw_quad.dng');
  ok(r.n === 1, 'DNG открылся через LibRaw ' + r.toast.slice(0, 120));
  const q = await p.evaluate(`(${PIX})(${JSON.stringify([[.15, .15], [.85, .15], [.15, .85], [.85, .85]])})`);
  ok(q.w === 160 && q.h === 120, `размер проявленного кадра ${q.w}×${q.h}`);
  const [R, B, G, Y] = q.px;
  ok(R[0] > 170 && R[1] < 70 && R[2] < 70, 'красный квадрант красный ' + R.slice(0, 3));
  ok(B[2] > 170 && B[0] < 70 && B[1] < 70, 'синий квадрант синий ' + B.slice(0, 3));
  ok(G[1] > 100 && G[0] < 70 && G[2] < 70, 'зелёный квадрант зелёный ' + G.slice(0, 3));
  ok(Y[0] > 170 && Y[1] > 170 && Y[2] < 90, 'жёлтый квадрант жёлтый ' + Y.slice(0, 3));
  ok(vreq.some(u => /worker\.js/.test(u)) && vreq.some(u => /libraw\.wasm/.test(u)), 'воркер и wasm взяты из vendor/raw');
  // ориентация из файла
  r = await add('raw_quad_rot6.dng');
  const q2 = await p.evaluate(`(${PIX})(${JSON.stringify([[.15, .15]])})`);
  ok(r.n === 1 && q2.w === 120 && q2.h === 160, `ориентация учтена: 160×120 → ${q2.w}×${q2.h}`);
  // режим «Превью»: LibRaw не используется, у DNG без превью — ошибка
  await p.evaluate(() => set('rawMode', 'preview')); const cnt = vreq.length;
  r = await add('raw_quad.dng');
  ok(r.n === 0 && vreq.length === cnt, 'режим «Превью»: LibRaw не запускается');
  await p.evaluate(() => set('rawMode', 'full'));
  // повреждённый файл: понятная ошибка, сайт не падает
  const bad = path.join(FX, '_bad.dng'); fs.writeFileSync(bad, Buffer.concat([fs.readFileSync(path.join(FX, 'raw_quad.dng')).subarray(0, 900), Buffer.alloc(300, 7)]));
  r = await add('_bad.dng'); fs.unlinkSync(bad);
  ok(r.n === 0 && /проявить его не удалось/.test(r.toast), 'повреждённый RAW: не открылся, ошибка показана: ' + r.toast.slice(0, 100));
  r = await add('raw_quad.dng'); ok(r.n === 1, 'после ошибки следующий RAW открывается нормально');
  // экспорт проявленного
  const out = await p.evaluate(async () => { S.format = 'jpg'; const it = items[0], bmp = await loadBitmap(it); const x = await exportBlob(it, bmp); closeBmp(bmp); return { type: x.blob.type, size: x.blob.size, name: x.name }; });
  ok(out.type === 'image/jpeg' && out.size > 500, `экспорт проявленного RAW: ${out.name}, ${out.size} Б`);
  // интерфейс
  ok(await p.evaluate(() => !!document.querySelector('#cardRaw [data-group=rawMode]') && !!document.querySelector('#cardRaw [data-group=rawWb]')), 'в «Ещё» есть карточка «RAW-снимки»');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
