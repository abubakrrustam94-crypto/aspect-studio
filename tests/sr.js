// Блок N: нейросетевое увеличение ×4 (Real-ESRGAN) на движке ONNX.
// Запуск: node tests/sr.js   (нужен http: воркеры не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8781/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
// сохраняет текущее фото в PNG и возвращает размеры и пиксели (RGBA)
const EXP = `async (o) => { Object.assign(S, o.g || {}); const it = items[0]; for (const k in (o.ov || {})) set(k, o.ov[k]); const bmp = await loadBitmap(it); let r, err = null;
  try { r = await exportBlob(it, bmp); } catch (e) { err = e.name + ':' + e.message; } finally { closeBmp(bmp); }
  if (err) return { err }; const m = await createImageBitmap(r.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, px: o.px ? Array.from(d) : null, type: r.blob.type }; }`;
(async () => {
  await new Promise(r => server.listen(8781, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const load = async f => { await p.evaluate(() => { items.length = 0; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
    await p.evaluate(() => { const it = items[0]; set('sizeMode', 'auto'); set('ratioW', it.w); set('ratioH', it.h); set('fit', 'fit'); set('enhOn', true); set('enhScale', 4); set('sharp', 0); set('denoise', 0); set('cutOn', false); set('srModel', 'off'); S.maxSide = 8192; S.format = 'png'; S.metaDpi = 0; }); };
  const exp = o => p.evaluate(`(${EXP})(${JSON.stringify(o)})`);
  const reg = await p.evaluate(() => ['srfast', 'srgen', 'srmax'].map(id => compById(id).files));
  ok(reg.every(fl => fl.every(([f, s]) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size === s)), 'три модели увеличения: файлы на месте, размеры в реестре верны');
  await load('sr_small.png');
  // без компонента не включается
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; set('srModel', 'fast'); });
  ok(await p.evaluate(() => cfgFor(items[0]).srModel === 'off') && /Нейро-увеличение/.test(await p.textContent('#toast')), 'без компонента нейро-увеличение не включается, показано предупреждение');
  const classic = await exp({ px: true }); ok(classic.w === 400 && classic.h === 300, 'обычное увеличение ×4 как раньше: ' + classic.w + '×' + classic.h);
  // быстрая модель
  await p.evaluate(() => compInstall('srfast')); ok(await p.evaluate(() => compInstalled('srfast') && compInstalled('ort')), 'скачались модель «быстрая» и движок');
  await p.evaluate(() => { window.__orc = 0; const o = window.ortRun; window.ortRun = (...a) => { window.__orc++; return o(...a); }; set('srModel', 'fast'); });
  ok(await p.evaluate(() => cfgFor(items[0]).srModel === 'fast'), 'с компонентом нейро-увеличение включается');
  ok((await p.textContent('#srNote')).includes('примерно'), 'подсказка показывает оценку времени: ' + (await p.textContent('#srNote')).slice(0, 80));
  const sr1 = await exp({ px: true }); const calls1 = await p.evaluate(() => window.__orc);
  ok(sr1.w === 400 && sr1.h === 300 && calls1 === 1, `нейро-результат ${sr1.w}×${sr1.h}, одна плитка (вызовов движка: ${calls1})`);
  // эталон: тот же кадр целиком одним проходом
  const whole = await p.evaluate(async () => {
    const it = items[0], bmp = await loadBitmap(it), c = document.createElement('canvas'); c.width = it.w; c.height = it.h; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); closeBmp(bmp);
    const d = x.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, f = new Float32Array(3 * n); for (let i = 0; i < n; i++) { f[i] = d[i * 4] / 255; f[n + i] = d[i * 4 + 1] / 255; f[2 * n + i] = d[i * 4 + 2] / 255; }
    const r = await ortRun('vendor/models/sr-fast-x4.onnx', { input: { data: f, dims: [1, 3, c.height, c.width], type: 'float32' } }), o = r[Object.keys(r)[0]], N = o.data.length / 3, out = [];
    for (let i = 0; i < N; i++) out.push(Math.round(Math.min(1, Math.max(0, o.data[i])) * 255), Math.round(Math.min(1, Math.max(0, o.data[N + i])) * 255), Math.round(Math.min(1, Math.max(0, o.data[2 * N + i])) * 255), 255);
    return out; });
  const mad = (a, c) => { let s = 0, m = 0, n = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - c[i + k]); s += d; n++; if (d > m) m = d; } return { mean: s / n, max: m }; };
  const dEq = mad(sr1.px, whole); ok(dEq.mean < 0.01 && dEq.max <= 1, `одна плитка совпадает с проходом целиком (ср. разница ${dEq.mean.toFixed(3)}, макс ${dEq.max})`);
  const dCl = mad(sr1.px, classic.px); ok(dCl.mean > 2, `результат нейросети заметно отличается от обычного увеличения (ср. разница ${dCl.mean.toFixed(1)})`);
  // кэш: повторное сохранение не считает заново
  const base = await p.evaluate(() => window.__orc);
  const t1 = Date.now(); const sr2 = await exp({ px: false, g: { format: 'png' } }); const dt = Date.now() - t1; const calls2 = await p.evaluate(() => window.__orc);
  ok(calls2 === base && sr2.w === 400, `повторное сохранение берёт готовый результат из кэша (новых вызовов: ${calls2 - base}, ${dt} мс)`);
  // много плиток: швы незаметны
  await p.evaluate(() => { srFree(); SR_MODELS.fast.tile = 40; window.__orc = 0; });
  const tl = await exp({ px: true }); const calls3 = await p.evaluate(() => window.__orc);
  const dT = mad(tl.px, whole); ok(calls3 === 6 && dT.mean < 3, `6 плиток: вызовов ${calls3}, средняя разница с проходом целиком ${dT.mean.toFixed(2)} (макс ${dT.max})`);
  // отмена
  await p.evaluate(() => { srFree(); SR_MODELS.fast.tile = 16; });
  const cres = await p.evaluate(`(async () => { cancelFlag = false; const it = items[0], bmp = await loadBitmap(it); setTimeout(() => { cancelFlag = true; }, 400); let r = 'нет ошибки'; try { await exportBlob(it, bmp); } catch (e) { r = e.name; } closeBmp(bmp); cancelFlag = false; return r; })()`);
  ok(cres === 'AbortError', 'отмена посреди нейро-увеличения: AbortError, без зависания');
  await p.evaluate(() => { SR_MODELS.fast.tile = 128; srFree(); });
  // слишком большое фото: пропуск с пояснением, экспорт идёт обычным способом
  await p.evaluate(() => { SR_MODELS.fast.maxPx = 1000; document.getElementById('toast').textContent = ''; window.__orc = 0; });
  const big = await exp({ px: false });
  ok(big.w === 400 && await p.evaluate(() => window.__orc === 0) && /больше предела/.test(await p.textContent('#toast')), 'фото больше предела модели: нейросеть пропущена, экспорт обычным способом');
  await p.evaluate(() => { SR_MODELS.fast.maxPx = 2.5e6; });
  // увеличение меньше 1,2: нейросеть не нужна
  const small = await exp({ px: false, ov: { enhScale: 1 } }); ok(small.w === 100 && await p.evaluate(() => window.__orc === 0), 'без увеличения нейросеть не запускается');
  await p.evaluate(() => set('enhScale', 4));
  // предпросмотр не запускает нейросеть
  await p.evaluate(() => { schedule && schedule(); }); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => window.__orc === 0), 'предпросмотр нейросеть не запускает');
  // компонент удалён, настройка осталась
  await p.evaluate(() => compRemove('srfast')); await p.evaluate(() => { compOnce.clear(); document.getElementById('toast').textContent = ''; });
  const gone = await exp({ px: false }); ok(gone.w === 400 && /Нейро-увеличение/.test(await p.textContent('#toast')), 'модель удалили, а настройка осталась: экспорт идёт обычным способом с предупреждением');
  // «обычная» и «максимум» (две части модели)
  await p.evaluate(() => { set('srModel', 'off'); }); await p.evaluate(() => compInstall('srgen')); await p.evaluate(() => set('srModel', 'general'));
  const g = await exp({ px: true }); ok(g.w === 400 && mad(g.px, classic.px).mean > 2, 'модель «обычная» работает');
  await load('sr_tiny.png'); await p.evaluate(() => set('srModel', 'off'));
  await p.evaluate(() => compInstall('srmax')); ok(await p.evaluate(() => compInstalled('srmax')), 'модель «максимум» скачана (две части)');
  await p.evaluate(() => set('srModel', 'max'));
  const t2 = Date.now(); const mx = await exp({ px: true, ov: { enhScale: 4 } }); ok(mx.w === 128 && mx.h === 96 && !mx.err, `модель «максимум» (две части склеились): ${mx.w}×${mx.h}, ${Date.now() - t2} мс`);
  const cl2 = await p.evaluate(() => { set('srModel', 'off'); return 1; }); const cl = await exp({ px: true }); ok(mad(mx.px, cl.px).mean > 2, 'результат «максимума» отличается от обычного увеличения');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
