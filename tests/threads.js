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
  await new Promise(r => server.listen(8787, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'allow' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8787/'); await p.evaluate(SEEN); await p.reload(); await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(800);
  await p.reload(); await p.waitForTimeout(800);
  const hdr = await p.evaluate(async () => { const r = await fetch('/js/core.js'); return [r.headers.get('cross-origin-opener-policy'), r.headers.get('cross-origin-embedder-policy')]; });
  ok(hdr[0] === 'same-origin' && hdr[1] === 'credentialless', 'service worker добавляет заголовки изоляции: ' + hdr.join(' / '));
  ok(await p.evaluate(() => crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined'), 'после перезагрузки страница изолирована, SharedArrayBuffer доступен');
  const hc = await p.evaluate(() => navigator.hardwareConcurrency || 2);
  const th = await p.evaluate(() => ['auto', '1', '2', '4'].map(v => { S.nnThreads = v; return ortThreads(); }));
  ok(th[1] === 1 && th[2] === Math.min(2, hc) && th[3] === Math.min(4, hc) && th[0] === Math.min(4, hc), `число потоков по настройке: авто ${th[0]}, 1→${th[1]}, 2→${th[2]}, 4→${th[3]} (ядер ${hc})`);
  await p.evaluate(() => { S.nnThreads = 'auto'; syncUI(); });
  ok((await p.textContent("#nnNote")).includes("Многопоточный режим включён"), 'карточка «Скорость нейросетей» показывает состояние');
  await p.click('#settingsBtn').catch(() => {});
  await p.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  await p.evaluate(() => { const it = items[0]; set('sizeMode', 'auto'); set('ratioW', it.w); set('ratioH', it.h); set('fit', 'fit'); set('enhOn', true); set('enhScale', 1); set('sharp', 0); set('denoise', 0); set('cutOn', false); set('srModel', 'off'); S.maxSide = 8192; S.format = 'png'; S.metaDpi = 0; });
  await p.evaluate(() => compInstall('dnffd'));
  const run = async v => { await p.evaluate(v => { set('nnThreads', v); set('dnModel', 'ffd'); }, v); await p.waitForTimeout(200);
    const r = await p.evaluate(`(${EXP})(${JSON.stringify({ px: true })})`); const info = await p.evaluate(() => ortCall({ type: 'init' })); return { r, info }; };
  const a = await run('1'), c = await run('2');
  ok(a.info.threads === 1 && a.info.isolated === true, `на «1» воркер считает в 1 поток (isolated=${a.info.isolated})`);
  ok(c.info.threads === Math.min(2, hc), `на «2» воркер получил ${c.info.threads} потока (ядер ${hc})`);
  let d = 0; for (let i = 0; i < a.r.px.length; i++) d = Math.max(d, Math.abs(a.r.px[i] - c.r.px[i]));
  ok(!a.r.err && !c.r.err && a.r.w === c.r.w && d <= 2, `результат один и тот же на 1 и 2 потоках (макс. разница ${d})`);
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
