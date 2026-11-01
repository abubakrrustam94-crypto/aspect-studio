// Блок C3: «Ночной свет» (Zero-DCE++).
// Запуск: node tests/c3.js
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
  await new Promise(r => server.listen(8804, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8804/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // --- чистая математика ---
  const m = await p.evaluate(() => {
    const n = 4, mk = v => ({ n, r: new Float32Array(3 * n * n).fill(v) });
    const d0 = new Uint8ClampedArray([30, 60, 90, 255, 250, 250, 250, 255]), z = d0.slice(); lowApplyData(z, 2, 1, 0, 0, 2, 1, mk(0), 1);
    const u = d0.slice(); lowApplyData(u, 2, 1, 0, 0, 2, 1, mk(-0.6), 1);
    const h = d0.slice(); lowApplyData(h, 2, 1, 0, 0, 2, 1, mk(-0.6), 0.5);
    return { same: Array.from(z).join() === Array.from(d0).join(), dark: [d0[0], u[0], d0[1], u[1], d0[2], u[2]], hi: [d0[4], u[4]], half: [u[0], h[0]] };
  });
  ok(m.same, 'нулевые кривые не меняют картинку');
  ok(m.dark[1] > m.dark[0] + 40 && m.dark[3] > m.dark[2] + 40 && m.dark[5] > m.dark[4] + 40, `тёмные значения светлеют (${m.dark.join(', ')})`);
  ok(m.hi[1] >= m.hi[0] - 1 && m.hi[1] <= 255, `света не выжигаются и не тускнеют (${m.hi.join(' → ')})`);
  ok(m.half[1] > m.dark[0] + 40 && m.half[1] < m.half[0], `половинная сила светлит заметно, но меньше полной (${m.half.join(' и ')})`);
  // --- тёмное фото ---
  const os = require('os'), dark = path.join(os.tmpdir(), 'c3_dark.png');
  fs.writeFileSync(dark, Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 480; c.height = 320; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 480, 0); gr.addColorStop(0, '#0a0c14'); gr.addColorStop(1, '#2a2f44'); g.fillStyle = gr; g.fillRect(0, 0, 480, 320);
    g.fillStyle = '#ffe9a0'; g.fillRect(360, 40, 70, 50); g.fillStyle = '#1c2236'; g.fillRect(60, 120, 160, 120); return c.toDataURL('image/png'); })).split(',')[1], 'base64'));
  await p.setInputFiles('#fileInput', dark); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'auto'); set('ratioW', 3); set('ratioH', 2); set('fit', 'fill'); S.format = 'png'; S.maxSide = 8192; });
  await p.evaluate(() => set('lowOn', true));
  ok(await p.evaluate(() => !S.lowOn && !compInstalled('lowlight')), 'без компонента переключатель не включается');
  await p.click('#settingsTabs [data-tab=quality]');
  await p.evaluate(() => compInstall('lowlight')); ok(await p.evaluate(() => compInstalled('lowlight') && compInstalled('ort')), 'компонент и движок скачались');
  const mean = px => { let s = 0, n = 0; for (let i = 0; i < px.length; i += 4) { s += px[i] + px[i + 1] + px[i + 2]; n += 3; } return s / n; };
  const base = await p.evaluate(`(${EXP})({ px: true })`);
  await p.evaluate(() => { set('lowOn', true); set('lowAmt', 80); });
  ok(await p.evaluate(() => S.lowOn && !document.querySelector('#lowFields').hidden), 'переключатель включился, поле силы показано');
  const t0 = Date.now(); const lo = await p.evaluate(`(${EXP})({ px: true })`); const t1 = Date.now() - t0;
  ok(!lo.err && lo.w === base.w && lo.h === base.h, `экспорт с ночным светом работает (${lo.w}×${lo.h}, ${t1} мс)`);
  const mb = mean(base.px), ml = mean(lo.px);
  ok(ml > mb + 25, `кадр стал светлее (средняя яркость ${mb.toFixed(0)} → ${ml.toFixed(0)})`);
  let clip = 0; for (let i = 0; i < lo.px.length; i += 4) if (lo.px[i] >= 254 && lo.px[i + 1] >= 254 && lo.px[i + 2] >= 254) clip++;
  ok(clip / (lo.px.length / 4) < 0.02, `света не выжжены (${(clip / (lo.px.length / 4) * 100).toFixed(2)}% белых пикселей)`);
  const half = await p.evaluate(`(${EXP})({ px: true, ov: { lowAmt: 30 } })`);
  ok(mean(half.px) > mb && mean(half.px) < ml, 'слабая сила светлит меньше');
  const hasMap = await p.evaluate(() => !!(items[0].low && items[0].low.n === 256 && items[0].low.r.length === 3 * 256 * 256 && !items[0].lowFail));
  ok(hasMap, 'карта кривых посчитана и сохранена');
  const t2 = Date.now(); await p.evaluate(`(${EXP})({})`); const t3 = Date.now() - t2;
  ok(t3 < t1 || t3 < 1500, `повторный экспорт использует кэш карты (${t3} мс против ${t1} мс)`);
  // отмена
  const canc = await p.evaluate(async () => { const it = items[0]; it.low = null; it.lowP = null; set('lowOn', true); const bmp = await loadBitmap(it);
    const pr = ensureLow(it, bmp); document.querySelector('#busyCancel').click(); const r = await pr; closeBmp(bmp); return { r, on: S.lowOn || (cfgFor(it).lowOn) }; });
  ok(canc.r === null && !canc.on, 'отмена выключает ночной свет и не оставляет результат');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
