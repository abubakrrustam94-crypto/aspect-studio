// Блок P3: цветовые профили ICC (LittleCMS). Запуск: node tests/icc.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
// экспорт текущего фото: возвращает пиксели (как их видит браузер с учётом профиля), наличие и байты встроенного профиля, список чанков PNG
const EXP = `async (o) => { Object.assign(S, o.g || {}); const it = items[0]; const bmp = await loadBitmap(it); let r, err = null;
  try { r = await exportBlob(it, bmp, o.fmt); } catch (e) { err = e.name + ':' + e.message; } finally { closeBmp(bmp); }
  if (err) return { err }; const buf = new Uint8Array(await r.blob.arrayBuffer()); const m = await createImageBitmap(r.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  const pts = o.pts.map(([px, py]) => Array.from(x.getImageData(px, py, 1, 1).data)); let icc = null, chunks = [];
  if (buf[0] === 0xFF) { const parts = []; for (let p = 2; p + 4 < buf.length && buf[p] === 0xFF;) { const mk = buf[p + 1], len = (buf[p + 2] << 8) | buf[p + 3]; if (mk === 0xDA) break; if (mk === 0xE2 && String.fromCharCode(...buf.subarray(p + 4, p + 15)) === 'ICC_PROFILE') parts.push(buf.slice(p + 18, p + 2 + len)); p += 2 + len; } if (parts.length) icc = Array.from(parts[0]); }
  else if (buf[0] === 0x89) { const dv = new DataView(buf.buffer); for (let p = 8; p + 12 <= buf.length;) { const len = dv.getUint32(p), nm = String.fromCharCode(...buf.subarray(p + 4, p + 8)); chunks.push(nm); if (nm === 'iCCP') { let z = p + 8; while (buf[z]) z++; const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(buf.slice(z + 2, p + 8 + len)); w.close(); icc = Array.from(new Uint8Array(await new Response(ds.readable).arrayBuffer())); } if (nm === 'IDAT') break; p += 12 + len; } }
  return { type: r.blob.type, w: m.width, h: m.height, pts, icc, chunks }; }`;
const same = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
(async () => {
  await new Promise(r => server.listen(8785, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8785/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const load = async f => { await p.evaluate(() => { items.length = 0; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
    await p.evaluate(() => { const it = items[0]; set('sizeMode', 'auto'); set('ratioW', it.w); set('ratioH', it.h); set('fit', 'fit'); set('enhOn', false); set('cutOn', false); S.maxSide = 8192; S.quality = 100; S.metaDpi = 0; S.colorSpace = 'srgb'; S.format = 'png'; }); };
  const exp = o => p.evaluate(`(${EXP})(${JSON.stringify({ pts: [[30, 30], [110, 80], [10, 10], [140, 100]], ...o })})`);
  const reg = await p.evaluate(() => compById('icc').files); ok(reg.every(([f, s]) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size === s), 'файлы компонента ICC на месте, размеры в реестре верны');
  await load('icc_plain.png');
  const base = await exp({ fmt: 'png' }); ok(base.icc === null && base.w === 160, 'sRGB как раньше: профиля в файле нет');
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; set('colorSpace', 'adobe'); });
  ok(await p.evaluate(() => S.colorSpace === 'srgb') && /Цветовые профили/.test(await p.textContent('#toast')), 'без компонента Adobe RGB не включается, показано предупреждение');
  await p.evaluate(() => compInstall('icc')); ok(await p.evaluate(() => compInstalled('icc')), 'компонент ICC скачан');
  const adobeFile = [...fs.readFileSync(path.join(ROOT, 'vendor/icc/adobe-rgb.icc'))];
  await p.evaluate(() => set('colorSpace', 'adobe')); ok(await p.evaluate(() => S.colorSpace === 'adobe'), 'с компонентом Adobe RGB включается');
  const aj = await exp({ fmt: 'jpg' }); ok(aj.type === 'image/jpeg' && aj.icc && aj.icc.length === adobeFile.length && aj.icc.every((v, i) => v === adobeFile[i]), 'JPG: в файле лежит профиль Adobe RGB (байт в байт)');
  ok(aj.pts.every((v, i) => same(v.slice(0, 3), base.pts[i].slice(0, 3), 6)), 'JPG: браузер с учётом профиля показывает те же цвета, что и в sRGB-версии: ' + JSON.stringify(aj.pts[0]) + ' ≈ ' + JSON.stringify(base.pts[0]));
  const ap = await exp({ fmt: 'png' }); ok(ap.icc && ap.icc.length === adobeFile.length && ap.icc.every((v, i) => v === adobeFile[i]) && ap.chunks.includes('iCCP') && !ap.chunks.includes('sRGB') && !ap.chunks.includes('gAMA'), 'PNG: чанк iCCP с профилем Adobe RGB, лишних sRGB/gAMA нет (' + ap.chunks.join(',') + ')');
  ok(ap.pts.every((v, i) => same(v.slice(0, 3), base.pts[i].slice(0, 3), 3)), 'PNG: цвета сохранены после перевода и обратного показа браузером');
  // числа в файле другие: красный в Adobe RGB «менее насыщен» (значения меньше)
  const raw = await p.evaluate(async () => { const it = items[0], bmp = await loadBitmap(it); const r = await exportBlob(it, bmp, 'png'); closeBmp(bmp); const m = await createImageBitmap(r.blob, { colorSpaceConversion: 'none' }), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0); return Array.from(x.getImageData(30, 30, 1, 1).data); });
  ok(raw[0] < 200 && raw[0] > 150, 'числа в файле действительно Adobe RGB (красный 200 → ' + raw[0] + ')');
  for (const k of ['rec2020', 'prophoto']) {
    await p.evaluate(k => set('colorSpace', k), k); const r = await exp({ fmt: 'png' });
    ok(r.icc && r.icc.length > 300 && r.pts.every((v, i) => same(v.slice(0, 3), base.pts[i].slice(0, 3), 5)), `${k}: профиль записан, цвета на показе те же`);
  }
  // широкий рабочий холст (Display P3) → Adobe RGB
  await p.evaluate(() => { set('colorSpace', 'adobe'); items[0].p3 = true; });
  const wide = await exp({ fmt: 'png' }); await p.evaluate(() => { items[0].p3 = false; });
  ok(wide.icc && wide.pts.every((v, i) => same(v.slice(0, 3), base.pts[i].slice(0, 3), 4)), 'холст в Display P3 → Adobe RGB: цвета те же');
  // WebP: профиль не пишется, предупреждение
  await p.evaluate(() => { set('colorSpace', 'adobe'); document.getElementById('toast').textContent = ''; });
  const wp = await exp({ fmt: 'webp' }); ok(wp.type === 'image/webp' && /только в JPG и PNG/.test(await p.textContent('#toast')), 'WebP: сохранён обычный цвет с предупреждением');
  // «Как у фото»
  await load('icc_adobe.jpg'); await p.evaluate(() => set('colorSpace', 'source'));
  const srcBytes = [...fs.readFileSync(path.join(FX, 'icc_adobe.jpg'))];
  const sj = await exp({ fmt: 'png' }); ok(sj.icc && sj.icc.length === adobeFile.length && sj.icc.every((v, i) => v === adobeFile[i]), '«Как у фото»: в результат записан профиль исходного JPG');
  const sjj = await exp({ fmt: 'jpg' }); ok(sjj.icc && sjj.icc.length === adobeFile.length, '«Как у фото»: то же для JPG');
  ok(sj.pts.every((v, i) => same(v.slice(0, 3), sjj.pts[i].slice(0, 3), 6)), 'PNG и JPG выглядят одинаково');
  await load('icc_plain.png'); await p.evaluate(() => { set('colorSpace', 'source'); document.getElementById('toast').textContent = ''; });
  const np = await exp({ fmt: 'png' }); ok(np.icc === null && /нет встроенного профиля/.test(await p.textContent('#toast')), 'у фото без профиля: сохранён sRGB, показано пояснение');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
