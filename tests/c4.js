// Блок C4: «Умная ретушь» (Image-Adaptive-3DLUT).
// Запуск: node tests/c4.js
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
  await new Promise(r => server.listen(8807, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8807/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  await p.evaluate(() => lazyLoad('retouch'));
  // --- таблицы из файла: точки против эталона (numpy по исходному ядру) ---
  const m = await p.evaluate(async () => {
    const a = new Float32Array(await (await fetch('vendor/models/retouch-paired-lut.bin')).arrayBuffer());
    const lut = rtFuse(a, [1.5, -0.2, -0.9]);
    const cols = [[0, 0, 0], [255, 255, 255], [128, 128, 128], [200, 60, 40], [40, 120, 200], [230, 200, 150], [20, 30, 25]];
    const d = new Uint8ClampedArray(cols.length * 4); cols.forEach((c, i) => { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; });
    const d2 = d.slice(); rtApplyData(d, lut, 1); rtApplyData(d2, lut, 0);
    // тождественная таблица
    const id = new Float32Array(33 * 33 * 33 * 3); for (let bi = 0; bi < 33; bi++) for (let g = 0; g < 33; g++) for (let r = 0; r < 33; r++) { const o = (bi * 1089 + g * 33 + r) * 3; id[o] = r / 32; id[o + 1] = g / 32; id[o + 2] = bi / 32; }
    const t = new Uint8ClampedArray(256 * 4); for (let i = 0; i < 256; i++) { t[i * 4] = i; t[i * 4 + 1] = 255 - i; t[i * 4 + 2] = (i * 7) & 255; t[i * 4 + 3] = 255; }
    const t0 = t.slice(); rtApplyData(t, id, 1);
    let maxd = 0; for (let i = 0; i < t.length; i++) if (i % 4 !== 3) maxd = Math.max(maxd, Math.abs(t[i] - t0[i]));
    return { res: cols.map((_, i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]), zero: Array.from(d2.slice(0, 4)), len: a.length, maxd };
  });
  const want = [[0, 0, 0], [249, 249, 249], [158, 158, 159], [211, 63, 27], [47, 140, 205], [227, 206, 168], [0, 12, 4]];
  const worst = Math.max(...m.res.flatMap((r, i) => r.map((v, k) => Math.abs(v - want[i][k]))));
  ok(m.len === 3 * 35937 * 3, 'файл таблиц: три таблицы 33³ × 3 канала');
  ok(worst <= 1, `трилинейная интерполяция совпадает с эталоном исходного ядра (макс. разница ${worst} из 255)`);
  ok(m.maxd <= 1, `тождественная таблица ничего не меняет (макс. разница ${m.maxd})`);
  ok(m.zero[0] === 0 && m.zero[1] === 0, 'с силой 0 цвет остаётся прежним');
  // --- фото ---
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'auto'); set('ratioW', 1); set('ratioH', 1); set('fit', 'fill'); S.format = 'png'; S.maxSide = 8192; });
  await p.evaluate(() => set('retouchOn', true));
  ok(await p.evaluate(() => !S.retouchOn && !compInstalled('retouch')), 'без компонента переключатель не включается');
  await p.click('#settingsTabs [data-tab=quality]');
  await p.evaluate(() => compInstall('retouch')); ok(await p.evaluate(() => compInstalled('retouch') && compInstalled('ort')), 'компонент (4 файла) и движок скачались');
  const mean = px => { let s = 0, n = 0; for (let i = 0; i < px.length; i += 4) { s += px[i] + px[i + 1] + px[i + 2]; n += 3; } return s / n; };
  const base = await p.evaluate(`(${EXP})({ px: true })`);
  await p.evaluate(() => { set('retouchOn', true); });
  ok(await p.evaluate(() => S.retouchOn && !document.querySelector('#retouchFields').hidden), 'переключатель включился, поля показаны');
  const t0 = Date.now(); const re = await p.evaluate(`(${EXP})({ px: true })`); const t1 = Date.now() - t0;
  ok(!re.err && re.w === base.w && re.h === base.h, `экспорт с ретушью работает (${re.w}×${re.h}, ${t1} мс)`);
  let diff = 0, bad = 0; for (let i = 0; i < re.px.length; i++) { if (i % 4 === 3) { if (re.px[i] !== 255) bad++; continue; } diff += Math.abs(re.px[i] - base.px[i]); } diff /= re.px.length * .75;
  ok(diff > 3 && diff < 40 && !bad, `картинка изменилась в разумных пределах (средняя разница ${diff.toFixed(1)} из 255)`);
  const w = await p.evaluate(() => items[0].rt && items[0].rt.exp);
  ok(w && w.length === 3 && Math.abs(w[0] - 1.557) < 0.35 && Math.abs(w[1] + 0.239) < 0.45 && Math.abs(w[2] + 1.153) < 0.45, `веса классификатора близки к эталону Python (${w && w.map(v => v.toFixed(2))} при эталоне 1.56, −0.24, −1.15)`);
  const half = await p.evaluate(`(${EXP})({ px: true, ov: { retouchAmt: 40 } })`); let dh = 0; for (let i = 0; i < half.px.length; i++) if (i % 4 !== 3) dh += Math.abs(half.px[i] - base.px[i]); dh /= half.px.length * .75;
  ok(dh > 0.5 && dh < diff * .8, `слабая сила меняет меньше (${dh.toFixed(1)} против ${diff.toFixed(1)})`);
  await p.evaluate(() => set('retouchStyle', 'vivid')); const vv = await p.evaluate(`(${EXP})({ px: true })`);
  let dv = 0; for (let i = 0; i < vv.px.length; i++) if (i % 4 !== 3) dv += Math.abs(vv.px[i] - re.px[i]); dv /= vv.px.length * .75;
  ok(dv > 1 && !vv.err && await p.evaluate(() => items[0].rt.vivid && items[0].rt.vivid.length === 3), `стиль «Ярче» даёт другой результат (разница со стилем «Как у эксперта» ${dv.toFixed(1)})`);
  await p.evaluate(() => set('retouchStyle', 'exp'));
  const t2 = Date.now(); await p.evaluate(`(${EXP})({})`); const t3 = Date.now() - t2;
  ok(t3 < t1 || t3 < 3000, `повторный экспорт использует кэш весов (${t3} мс против ${t1} мс)`);
  ok(await p.evaluate(() => !items[0].rtFail), 'сбоев модели нет');
  // отмена
  const canc = await p.evaluate(async () => { const it = items[0]; it.rt = null; set('retouchOn', true); const bmp = await loadBitmap(it);
    const pr = ensureRetouch(it, bmp, 'exp'); document.querySelector('#busyCancel').click(); const r = await pr; closeBmp(bmp); return { r, on: cfgFor(it).retouchOn }; });
  ok(canc.r === null && !canc.on, 'отмена выключает ретушь и не оставляет результат');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
