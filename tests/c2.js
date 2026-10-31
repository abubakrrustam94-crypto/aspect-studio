// Блок C2: размытие по глубине (MiDaS).
// Запуск: node tests/c2.js
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
  await new Promise(r => server.listen(8797, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8797/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  await p.setInputFiles('#fileInput', path.join(FX, 'noface_coffee.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'auto'); set('ratioW', 1); set('ratioH', 1); set('fit', 'fill'); S.format = 'png'; S.maxSide = 8192; });
  await p.evaluate(() => set('depthOn', true));
  ok(await p.evaluate(() => !S.depthOn && !compInstalled('depth')), 'без компонента «Глубина кадра» переключатель не включается');
  await p.click('#settingsTabs [data-tab=bg]');
  await p.evaluate(() => compInstall('depth')); ok(await p.evaluate(() => compInstalled('depth') && compInstalled('ort')), 'компонент и движок скачались (две части)');
  const base = await p.evaluate(`(${EXP})({ px: true })`);
  await p.evaluate(() => { set('depthOn', true); set('depthBlur', 70); });
  ok(await p.evaluate(() => S.depthOn && !document.querySelector('#depthFields').hidden), 'переключатель включился, поля силы показаны');
  const t0 = Date.now();
  const dep = await p.evaluate(`(${EXP})({ px: true })`); const t1 = Date.now() - t0;
  ok(!dep.err && dep.w === base.w && dep.h === base.h, `экспорт с глубиной работает (${dep.w}×${dep.h}, ${t1} мс)`);
  const info = await p.evaluate(() => { const D = items[0].depth; if (!D) return null; let mn = 1, mx = 0, s = 0; for (const v of D.d) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; } return { n: D.n, mn, mx, mean: s / D.d.length, fail: items[0].depthFail }; });
  ok(info && info.n === 256 && info.mx - info.mn > 0.8 && info.mean > 0.1 && info.mean < 0.9 && !info.fail, `карта глубины осмысленная (min ${info && info.mn.toFixed(2)}, max ${info && info.mx.toFixed(2)}, среднее ${info && info.mean.toFixed(2)})`);
  const W = base.w, H = base.h; let diff = 0, nan = 0; const energy = (a, x0, y0, x1, y1) => { let e = 0, n = 0; for (let y = y0; y < y1 - 1; y++) for (let x = x0; x < x1 - 1; x++) { const o = (y * W + x) * 4; e += Math.abs(a[o] - a[o + 4]) + Math.abs(a[o] - a[o + W * 4]); n++; } return e / n; };
  for (let i = 0; i < base.px.length; i++) { const d = Math.abs(base.px[i] - dep.px[i]); diff += d; if (Number.isNaN(dep.px[i])) nan++; }
  diff /= base.px.length;
  const eB = energy(base.px, 0, 0, W, H), eD = energy(dep.px, 0, 0, W, H);
  ok(diff > 0.5 && !nan, `картинка изменилась (средняя разница ${diff.toFixed(2)} из 255)`);
  ok(eD < eB * 0.95, `резкость деталей кадра в целом снизилась (${eB.toFixed(2)} → ${eD.toFixed(2)})`);
  const half = await p.evaluate(`(${EXP})({ px: true, ov: { depthBlur: 15 } })`); let dh = 0; for (let i = 0; i < base.px.length; i++) dh += Math.abs(base.px[i] - half.px[i]); dh /= base.px.length;
  ok(dh < diff, `слабая сила меняет картинку меньше (${dh.toFixed(2)} против ${diff.toFixed(2)})`);
  // тот же результат из кэша быстрее и не считает глубину заново
  const t2 = Date.now(); await p.evaluate(`(${EXP})({})`); const t3 = Date.now() - t2;
  ok(t3 < t1, `повторный экспорт быстрее: карта глубины взята из кэша (${t3} мс против ${t1} мс)`);
  // после поворота карта пересчитывается
  const sig = await p.evaluate(async () => { const a = items[0].depth.sig; items[0].rot = 90; syncDims(items[0]); if (cache.id === items[0].id) releaseCache(); return a !== dpSig(items[0]); });
  ok(sig, 'подпись карты глубины меняется при повороте кадра');
  // --- OCR ---
  const os = require('os');
  const txtImg = path.join(os.tmpdir(), 'c2_text.png');
  fs.writeFileSync(txtImg, Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 1400; c.height = 700; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1400, 700); g.fillStyle = '#111'; g.font = 'bold 110px sans-serif'; g.fillText('Hello World 2026', 60, 200); g.fillText('Привет мир', 60, 420); g.font = '70px sans-serif'; g.fillText('Aspect Studio', 60, 600); return c.toDataURL('image/png'); })).split(',')[1], 'base64'));
  await p.setInputFiles('#fileInput', txtImg); await p.waitForFunction(() => items.length === 2); await p.evaluate(() => select(1)); await p.waitForTimeout(600);
  await p.click('#settingsTabs [data-tab=extra]');
  ok(!(await p.$eval('#ocrBtn', e => e.disabled)), 'с фото кнопка «Распознать текст» активна');
  await p.click('#ocrBtn'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.querySelector('#ocrOut').hidden), 'без компонента текст не распознаётся (показано предупреждение)');
  await p.evaluate(() => compInstall('ocr')); ok(await p.evaluate(() => compInstalled('ocr')), 'компонент OCR скачался (5 файлов)');
  const t0o = Date.now(); await p.click('#ocrBtn'); await p.waitForFunction(() => !document.querySelector('#ocrOut').hidden, null, { timeout: 90000 }); const tO = Date.now() - t0o;
  const res = await p.evaluate(() => ({ t: document.querySelector('#ocrText').value, info: document.querySelector('#ocrInfo').textContent, btn: document.querySelector('#ocrBtn').textContent, f: !document.querySelector('#ocrFocus').hidden }));
  console.log('  распознано за ' + tO + ' мс:', JSON.stringify(res.t));
  ok(/hello/i.test(res.t) && /world/i.test(res.t) && /2026/.test(res.t), 'английский текст прочитан');
  ok(/привет/i.test(res.t) && /мир/i.test(res.t), 'русский текст прочитан');
  ok(/Слов: \d+/.test(res.info) && res.btn === 'Распознать текст' && res.f, 'показаны число слов и уверенность, кнопка вернулась в исходный вид');
  await p.click('#ocrFocus');
  const fo = await p.evaluate(() => ({ m: items[1].manual, f: items[1].focus }));
  ok(fo.m && fo.f.x > 0.1 && fo.f.x < 0.9 && fo.f.y > 0.2 && fo.f.y < 0.8, `фокус переведён на текст (${fo.f.x.toFixed(2)}, ${fo.f.y.toFixed(2)})`);
  await p.evaluate(() => select(0)); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelector('#ocrOut').hidden), 'при переходе к другому фото результат скрывается');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
