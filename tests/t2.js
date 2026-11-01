// Блок T2: тон — дизеринг против полос, плёночные стили, зерно.
// Запуск: node tests/t2.js
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
  await new Promise(r => server.listen(8805, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8805/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const run = (c, W, H, f, y0 = 0, cell = 1) => { const d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { const [r, g, bl] = f(i % W, (i / W | 0)); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = bl; d[i * 4 + 3] = 255; }
      const P = toneParams(c), L = toneLUTs(P); toneApplyData(d, P, L, W, y0, cell); return { d, L, P }; };
    // 1) полосы: узкий градиент 100…140 с сильным растяжением
    const W = 320, H = 8, grad = (x) => { const v = 100 + Math.floor(x / 8); return [v, v, v]; };
    const t = run({ toneExp: 40, toneCon: 50 }, W, H, grad);
    let eD = 0, eU = 0, n = 0;
    for (let x = 16; x < W - 16; x += 8) {                        // середина каждой ступеньки: среднее по 8×8 против «идеального» дробного значения
      const v = 100 + Math.floor(x / 8), ideal = t.L[1][v]; let s = 0; for (let y = 0; y < H; y++) for (let k = 0; k < 8; k++) s += t.d[(y * W + (Math.floor(x / 8) * 8 + k)) * 4 + 1];
      eD += Math.abs(s / 64 - ideal); eU += Math.abs(Math.round(ideal) - ideal); n++;
    }
    // 2) полосы и целое одним куском = по частям
    const whole = run({ toneExp: 20, toneGrain: 30 }, 40, 8, (x, y) => [90 + x, 120, 60], 0, 2).d;
    const top = run({ toneExp: 20, toneGrain: 30 }, 40, 4, (x, y) => [90 + x, 120, 60], 0, 2).d, bot = run({ toneExp: 20, toneGrain: 30 }, 40, 4, (x, y) => [90 + x, 120, 60], 4, 2).d;
    let same = true; for (let i = 0; i < top.length; i++) { if (top[i] !== whole[i] || bot[i] !== whole[top.length + i]) same = false; }
    const again = run({ toneExp: 20, toneGrain: 30 }, 40, 8, (x, y) => [90 + x, 120, 60], 0, 2).d; let det = true; for (let i = 0; i < whole.length; i++) if (whole[i] !== again[i]) det = false;
    // 3) зерно
    const sd = (arr) => { let s = 0, q = 0, c = 0; for (let i = 0; i < arr.length; i += 4) { s += arr[i + 1]; q += arr[i + 1] * arr[i + 1]; c++; } const mu = s / c; return { mu, sd: Math.sqrt(q / c - mu * mu) }; };
    const gm = run({ toneGrain: 50 }, 128, 128, () => [128, 128, 128]).d, gd = run({ toneGrain: 50 }, 128, 128, () => [22, 22, 22]).d, g0 = run({ toneGrain: 0, toneExp: 1 }, 128, 128, () => [128, 128, 128]).d;
    const c3 = run({ toneGrain: 50 }, 64, 4, () => [128, 128, 128], 0, 3).d; let near = 0, pairs = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 63; x++) { if (Math.floor(x / 3) === Math.floor((x + 1) / 3)) { pairs++; if (Math.abs(c3[(y * 64 + x) * 4 + 1] - c3[(y * 64 + x + 1) * 4 + 1]) <= 1) near++; } }
    // 4) стили
    const px = (st, v) => { const r = run({ toneStyle: st }, 4, 4, () => [v, v, v]).d; return [r[0], r[1], r[2]]; };
    const bwf = run({ toneStyle: 'bwfilm' }, 16, 16, (x, y) => [x * 15, y * 15, 100]).d; let mono = true; for (let i = 0; i < bwf.length; i += 4) if (bwf[i] !== bwf[i + 1] || bwf[i + 1] !== bwf[i + 2]) mono = false;
    return { eD: eD / n, eU: eU / n, same, det, gm: sd(gm), gd: sd(gd), g0: sd(g0), near, pairs, kodakMid: px('kodak', 128), cineDark: px('cine', 30), cineLight: px('cine', 220), mono };
  });
  ok(m.eD < m.eU * .7 && m.eD < .22, `дизеринг: ошибка относительно точной кривой ${m.eD.toFixed(3)} против ${m.eU.toFixed(3)} без него`);
  ok(m.same, 'полосами и целиком — одинаковый результат (предпросмотр и экспорт совпадают)');
  ok(m.det, 'повторный расчёт даёт ровно те же пиксели');
  ok(m.gm.sd > 2.5 && m.gm.sd < 14 && Math.abs(m.gm.mu - 128) < 2, `зерно 50: разброс ${m.gm.sd.toFixed(1)}, средняя яркость не уехала (${m.gm.mu.toFixed(1)})`);
  ok(m.gd.sd < m.gm.sd * .8, `в тёмных тонах зерна меньше (${m.gd.sd.toFixed(1)} против ${m.gm.sd.toFixed(1)})`);
  ok(m.g0.sd < 1, `без зерна шума нет (${m.g0.sd.toFixed(2)})`);
  ok(m.near === m.pairs, 'зерно размером 3 px: соседи внутри клетки совпадают');
  ok(m.kodakMid[0] > m.kodakMid[2] + 8, `«Кодак» тёплый: R ${m.kodakMid[0]} > B ${m.kodakMid[2]}`);
  ok(m.cineDark[2] > m.cineDark[0] + 6 && m.cineLight[0] > m.cineLight[2] + 6, `«Кино»: тени холоднее (${m.cineDark}), света теплее (${m.cineLight})`);
  ok(m.mono, '«Ч/б плёнка»: каналы равны, зерно не красит');
  // --- интерфейс ---
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.click('#settingsTabs [data-tab=quality]');
  ok(await p.evaluate(() => ['kodak', 'cine', 'bwfilm'].every(v => document.querySelector(`[data-group=toneStyle] [data-val=${v}]`))), 'кнопки новых стилей есть');
  await p.click('[data-group=toneStyle] [data-val=kodak]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => cfgFor(items[0]).toneStyle === 'kodak'), 'стиль «Кодак» выбирается');
  await p.evaluate(() => { const r = document.querySelector('[data-key=toneGrain]'); r.value = 40; r.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => cfgFor(items[0]).toneGrain === 40 && !document.querySelector('#toneReset').hidden), 'ползунок зерна меняет настройку, «Сбросить тон» появляется');
  await p.click('#toneReset'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !cfgFor(items[0]).toneGrain && cfgFor(items[0]).toneStyle === 'none'), '«Сбросить тон» убирает зерно и стиль');
  const ex = await p.evaluate(async () => { set('toneStyle', 'film'); set('toneGrain', 30); S.format = 'png'; const it = items[0], bmp = await loadBitmap(it); try { const r = await exportBlob(it, bmp); return r.blob.size > 1000; } finally { closeBmp(bmp); } });
  ok(ex, 'экспорт со стилем и зерном работает');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
