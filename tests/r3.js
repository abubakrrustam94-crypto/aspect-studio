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
  await new Promise(r => server.listen(8792, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8792/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  ok(await p.$eval('#fmtCmpBtn', e => e.disabled), 'без фото кнопка «Сравнить форматы» неактивна');
  await p.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(400);
  await p.evaluate(() => { set('enhOn', false); S.format = 'png'; S.maxSide = 8192; S.quality = 80; S.targetOn = false; });
  await p.click('#settingsTabs [data-tab=export]'); ok(!(await p.$eval('#fmtCmpBtn', e => e.disabled)), 'с фото кнопка активна');
  const rows = () => p.evaluate(() => fc.rows.map(r => ({ f: r.fmt, s: r.state, size: r.size, psnr: r.psnr, q: r.q, met: r.met })));
  await p.click('#fmtCmpBtn'); await p.waitForFunction(() => fc.open && fc.rows.length === 5 && fc.rows.every(r => r.state !== 'wait' && r.state !== 'run'), null, { timeout: 120000 });
  let r = await rows(); const by = Object.fromEntries(r.map(x => [x.f, x]));
  ok(by.png.s === 'ok' && by.jpg.s === 'ok' && by.webp.s === 'ok', 'PNG, JPG и WebP посчитаны: ' + r.map(x => x.f + ':' + x.s).join(' '));
  ok(by.jxl.s === 'na' && /компонент/.test(await p.textContent('#fmtRows')), 'JXL без компонента: объяснено, что нужен компонент');
  ok(by.png.psnr === Infinity && by.jpg.psnr > 20 && by.jpg.psnr < 60 && by.webp.psnr > 20, `точность считается: JPG ${by.jpg.psnr.toFixed(1)} дБ, WebP ${by.webp.psnr.toFixed(1)} дБ, PNG без потерь`);
  ok(by.jpg.size < by.png.size && by.webp.size < by.png.size, `сжатые форматы легче PNG (PNG ${by.png.size}, JPG ${by.jpg.size}, WebP ${by.webp.size})`);
  const real = await p.evaluate(async () => { const it = items[0], bmp = await loadBitmap(it); try { const x = await exportBlob(it, bmp, 'jpg'); return x.blob.size; } finally { closeBmp(bmp); } });
  ok(Math.abs(real - by.jpg.size) / real < 0.1, `размер в сравнении сходится с настоящим экспортом (${by.jpg.size} и ${real})`);
  ok(await p.evaluate(() => document.querySelectorAll('#fmtRows .fc-row.best').length === 1 && !document.querySelector('#fmtRows .fc-row.best').textContent.includes('PNG')), 'отмечен один лучший вариант, это не PNG');
  await p.evaluate(() => [...document.querySelectorAll('#fmtRows .fc-row')].find(r => r.textContent.includes('WebP')).querySelector('button').click());
  ok(await p.evaluate(() => S.format === 'webp' && !fc.open), 'кнопка «Выбрать» ставит формат и закрывает окно');
  // под лимит веса
  await p.evaluate(() => { S.targetOn = true; S.targetKB = 20; S.format = 'jpg'; });
  await p.click('#fmtCmpBtn'); await p.waitForFunction(() => fc.open && fc.rows.length === 5 && fc.rows.every(r => r.state !== 'wait' && r.state !== 'run'), null, { timeout: 120000 });
  r = await rows(); const jj = r.find(x => x.f === 'jpg'), ww = r.find(x => x.f === 'webp');
  ok(jj.size <= 20 * 1024 + 1600 && ww.size <= 20 * 1024 && (jj.met && ww.met), `при лимите 20 КБ сжатые форматы укладываются (JPG ${jj.size}, WebP ${ww.size})`);
  ok((await p.textContent('#fmtInfo')).includes('лимит 20'), 'в шапке указан лимит');
  await p.keyboard.press('Escape'); ok(!(await p.evaluate(() => fc.open)) && !(await p.evaluate(() => busy)), 'Esc закрывает окно, интерфейс свободен');
  // AVIF с компонентом
  await p.evaluate(() => { S.targetOn = false; return compInstall('encavif'); });
  await p.click('#fmtCmpBtn'); await p.waitForFunction(() => fc.open && fc.rows.length === 5 && fc.rows.every(r => r.state !== 'wait' && r.state !== 'run'), null, { timeout: 240000 });
  r = await rows(); const av = r.find(x => x.f === 'avif'); ok(av.s === 'ok' && av.size > 0 && av.psnr > 20, `AVIF с компонентом: ${av.size} байт, ${av.psnr && av.psnr.toFixed(1)} дБ`);
  await p.click('#fmtDone');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
