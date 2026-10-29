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
  await new Promise(r => server.listen(8791, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window.__clip = 'image'; navigator.clipboard.read = async () => window.__clip === 'image' ? [{ types: ['text/plain', 'image/png'], getType: async t => t === 'image/png' ? await (await fetch('/tests/fixtures/dn_clean.png')).blob() : new Blob(['x']) }] : [{ types: ['text/plain'], getType: async () => new Blob(['x']) }]; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8791/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // ---------- вставка из буфера ----------
  ok(!(await p.$eval('#pasteRow', e => e.hidden)), 'кнопка «Вставить из буфера» есть');
  await p.evaluate(() => { window.__clip = 'text'; }); await p.click('#pasteBtn'); await p.waitForTimeout(300);
  ok((await p.evaluate(() => items.length)) === 0 && /нет изображения/.test(await p.textContent('#toast')), 'в буфере нет картинки: фото не добавлено, понятное сообщение');
  await p.evaluate(() => { window.__clip = 'image'; }); await p.click('#pasteBtn'); await p.waitForFunction(() => items.length === 1, null, { timeout: 8000 });
  ok(await p.evaluate(() => /^Из буфера 1\.png$/.test(items[0].name)), 'картинка из буфера добавлена: ' + await p.evaluate(() => items[0].name));
  // ---------- края ----------
  await p.evaluate(() => { items.length = 0; idx = 0; }); await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#fileInput', path.join(FX, 'er_scene.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'fixed'); set('outW', 300); set('outH', 300); set('fit', 'fit'); set('blur', 5); set('dim', 0); S.format = 'png'; S.maxSide = 8192; S.metaDpi = 0; });
  const exp = o => p.evaluate(`(${EXP})(${JSON.stringify(o)})`);
  ok(await p.evaluate(() => document.querySelectorAll('#colSettings [data-group=bg] [data-val=mirror], #colSettings [data-group=bg] [data-val=inpaint]').length === 2), 'в списке фонов есть «Зеркальные края» и «Дорисовать края»');
  await p.evaluate(() => set('bg', 'mirror'));
  ok(!(await p.evaluate(() => document.querySelector('[data-bgpanel~=mirror]').hidden)) && await p.evaluate(() => document.querySelector('[data-bgpanel=inpaint]').hidden), 'панель настроек «Зеркальные края» показана, чужая скрыта');
  const m = await exp({ px: true }); const W = m.w;
  const px = (a, x, y) => { const i = (y * W + x) * 4; return [a[i], a[i + 1], a[i + 2]]; };
  const L = await p.evaluate(() => { const c = cfgFor(items[0]), { cw, ch } = computeSize(items[0].w, items[0].h, 0, c); return layout(items[0].w, items[0].h, cw, ch, items[0], c); });
  const dy = Math.round(L.dy); let diff = 0, n = 0;
  for (let x = 50; x < 250; x += 2) { const a = px(m.px, x, dy - 1 - 15), c = px(m.px, x, dy + 15); for (let k = 0; k < 3; k++) { diff += Math.abs(a[k] - c[k]); n++; } }
  ok(m.w === 300 && m.h === 300 && diff / n < 30, `зеркальные края: полоса отражает фото (средняя разница ${(diff / n).toFixed(1)})`);
  // ---------- дорисовать ----------
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; set('bg', 'inpaint'); });
  ok(await p.evaluate(() => cfgFor(items[0]).bg === 'mirror') && /Дорисовать края/.test(await p.textContent('#toast')), 'без компонента «Убрать лишнее» режим не включается, показано предупреждение');
  await p.evaluate(() => compInstall('erase'));
  await p.evaluate(() => { window.__orc = 0; const o = window.ortRun; window.ortRun = (...a) => { window.__orc++; return o(...a); }; set('bg', 'inpaint'); });
  ok(await p.evaluate(() => cfgFor(items[0]).bg === 'inpaint'), 'с компонентом режим включается');
  await p.waitForTimeout(1500); ok(await p.evaluate(() => window.__orc) === 0, 'предпросмотр нейросеть не запускает (там зеркальные края)');
  const t0 = Date.now(); const ip = await exp({ px: true }); const calls = await p.evaluate(() => window.__orc);
  ok(!ip.err && ip.w === 300 && ip.h === 300 && calls >= 2, `экспорт дорисовал края: размер ${ip.w}×${ip.h}, вызовов нейросети ${calls}, ${Date.now() - t0} мс`);
  let same = 0, tot = 0; for (let y = dy + 3; y < dy + Math.round(L.dh) - 3; y += 3) for (let x = 5; x < 295; x += 3) { const a = px(ip.px, x, y), c = px(m.px, x, y); for (let k = 0; k < 3; k++) { same += Math.abs(a[k] - c[k]); tot++; } }
  ok(same / tot < 2, `само фото осталось как было (средняя разница ${(same / tot).toFixed(2)})`);
  let mean = [0, 0, 0], cnt = 0, mn = 255, mx = 0; for (let y = 2; y < dy - 3; y++) for (let x = 5; x < 295; x += 3) { const a = px(ip.px, x, y); for (let k = 0; k < 3; k++) { mean[k] += a[k]; } mn = Math.min(mn, a[0]); mx = Math.max(mx, a[0]); cnt++; }
  ok(ip.px[3] === 255 && mx - mn > 6, `верхняя полоса заполнена, не плоская заливка (разброс красного ${mn}–${mx})`);
  // стык: разница между строкой полосы у фото и первой строкой фото
  let seam = 0, sn = 0; for (let x = 20; x < 280; x += 2) { const a = px(ip.px, x, dy - 2), c = px(ip.px, x, dy + 1); for (let k = 0; k < 3; k++) { seam += Math.abs(a[k] - c[k]); sn++; } }
  ok(seam / sn < 40, `стык с фото плавный (средняя разница ${(seam / sn).toFixed(1)})`);
  const c0 = await p.evaluate(() => window.__orc); await exp({ px: false }); ok(await p.evaluate(() => window.__orc) === c0, 'повторное сохранение берёт готовый фон из кэша');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
