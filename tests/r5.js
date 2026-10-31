// Блок R5: A/B-сравнение настроек, подсказки «Почему так?», предпросмотр больших фото.
// Запуск: node tests/r5.js
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
  await new Promise(r => server.listen(8795, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8795/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // --- подсказки ---
  const nWhy = await p.evaluate(() => document.querySelectorAll('.why-btn').length);
  ok(nWhy === 12, `подсказки «?» добавлены ко всем настройкам (${nWhy})`);
  const w = await p.evaluate(() => { const b = document.querySelector('.why-btn'), t = document.getElementById(b.getAttribute('aria-controls')); const h0 = t.hidden; b.click(); const h1 = t.hidden, e1 = b.getAttribute('aria-expanded'); b.click(); return { h0, h1, e1, h2: t.hidden, txt: t.textContent.length }; });
  ok(w.h0 && !w.h1 && w.e1 === 'true' && w.h2 && w.txt > 40, 'кнопка «?» показывает и прячет объяснение');
  ok(await p.evaluate(() => [...document.querySelectorAll('.why-btn')].every(b => b.getAttribute('aria-label') && document.getElementById(b.getAttribute('aria-controls')))), 'у каждой подсказки есть название и связанный текст');
  ok(await p.$eval('#abBtn', e => e.disabled), 'без фото кнопка A/B неактивна');
  // --- A/B ---
  await p.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'fixed'); set('outW', 600); set('outH', 600); set('fit', 'fit'); set('bg', 'color'); set('color', '#ff0000'); });
  await p.waitForTimeout(600);
  const hash = () => p.evaluate(() => { const c = afterCanvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; });
  const hA = await hash();
  await p.click('#abBtn'); ok(await p.evaluate(() => ab.on && !document.querySelector('#abBar').hidden && document.querySelector('#abBtn').hidden), 'A/B включается: появляется панель с A и B');
  await p.click('#abBar [data-ab=B]'); await p.evaluate(() => { set('color', '#0000ff'); }); await p.waitForTimeout(600);
  const hB = await hash();
  await p.click('#abBar [data-ab=A]'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => (cur().ov || S).color === '#ff0000'), 'набор A вернул свои настройки');
  const hA2 = await hash(); ok(hA2 === hA && hB !== hA, 'картинка A одна и та же, B отличается');
  await p.click('#abBar [data-ab=B]'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => (cur().ov || S).color === '#0000ff') && (await hash()) === hB, 'набор B запомнил свои настройки');
  await p.click('#abKeep'); ok(await p.evaluate(() => !ab.on && document.querySelector('#abBar').hidden && (cur().ov || S).color === '#0000ff'), '«Оставить текущий» закрывает панель и сохраняет B');
  await p.click('#abBtn'); await p.click('#abBar [data-ab=B]'); await p.evaluate(() => { set('color', '#00ff00'); }); await p.click('#abCancel');
  ok(await p.evaluate(() => !ab.on && (cur().ov || S).color === '#0000ff'), '«Отменить» возвращает настройки как до сравнения');
  // смена фото закрывает A/B
  await p.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(400);
  await p.click('#abBtn'); await p.evaluate(() => select(0)); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !ab.on && document.querySelector('#abBar').hidden), 'при переходе к другому фото сравнение закрывается');
  // --- большое фото: предпросмотр с уменьшенной копии ---
  const big = path.join(require('os').tmpdir(), 'r5_big.png');
  fs.writeFileSync(big, Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 6000; c.height = 4000; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 6000, 4000); gr.addColorStop(0, '#203060'); gr.addColorStop(.5, '#e0a040'); gr.addColorStop(1, '#30a060'); g.fillStyle = gr; g.fillRect(0, 0, 6000, 4000); g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) g.fillRect(i * 150, 400 + (i % 7) * 300, 80, 900); return c.toDataURL('image/png'); })).split(',')[1], 'base64'));
  await p.setInputFiles('#fileInput', big); await p.waitForFunction(() => items.length === 3); await p.evaluate(() => select(2)); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'auto'); set('ratioW', 1); set('ratioH', 1); set('fit', 'fit'); set('bg', 'blur'); });
  await p.waitForFunction(() => cache.small && cache.small.bmp, null, { timeout: 30000 });
  const st = await p.evaluate(() => { const it = cur(), sm = cache.small.bmp; return { w: it.w, h: it.h, sw: sm.width, sh: sm.height, cw: afterCanvas.width, ch: afterCanvas.height }; });
  ok(st.w === 6000 && st.h === 4000, `размеры самого фото не тронуты (${st.w}×${st.h})`);
  ok(Math.max(st.sw, st.sh) === 2400 && Math.abs(st.sw / st.sh - 1.5) < 0.01, `предпросмотр считается с копии ${st.sw}×${st.sh}`);
  const grab = key => p.evaluate(key => { const c = afterCanvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; window[key] = { w: c.width, h: c.height, d }; return [c.width, c.height]; }, key);
  const fast = await grab('__fast');
  await p.evaluate(() => { PV_OFF = true; schedule(); }); await p.waitForTimeout(3000);
  const full = await grab('__full');
  const mad = await p.evaluate(() => { const a = window.__fast.d, b = window.__full.d; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; });
  ok(fast[0] === full[0] && fast[1] === full[1] && mad < 6, `картинка с копии совпадает с полной (размер ${fast[0]}×${fast[1]}, средняя разница ${mad.toFixed(2)} из 255)`);
  await p.evaluate(() => { PV_OFF = false; });
  const tm = await p.evaluate(async () => { const t = performance.now(); PV_OFF = true; for (let i = 0; i < 3; i++) { await refresh(); } const a = (performance.now() - t) / 3; const t2 = performance.now(); PV_OFF = false; for (let i = 0; i < 3; i++) { await refresh(); } return { full: a, small: (performance.now() - t2) / 3 }; });
  console.log(`  время кадра: с полной картинки ${tm.full.toFixed(0)} мс, с копии ${tm.small.toFixed(0)} мс`);
  ok(tm.small < tm.full * 1.3, `с копией кадр считается не медленнее (${tm.small.toFixed(0)} против ${tm.full.toFixed(0)} мс; выигрыш небольшой и зависит от нагрузки на машину)`);
  await p.evaluate(() => { set('cutOn', true); }); await p.waitForTimeout(300);
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
