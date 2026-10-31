// Блок R4: тон и цвет, Автотон, цветовые стили, выравнивание горизонта.
// Запуск: node tests/r4.js
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
  await new Promise(r => server.listen(8794, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8794/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  ok(await p.$eval('#toneAuto', e => e.disabled) && await p.$eval('#tiltAuto', e => e.disabled), 'без фото «Автотон» и «Выровнять горизонт» неактивны');
  // --- чистая логика ---
  const logic = await p.evaluate(() => {
    const mk = (n, f) => { const d = new Uint8ClampedArray(n * n * 4); for (let i = 0; i < n * n; i++) { const [r, g, bl] = f(i, i % n, Math.floor(i / n)); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = bl; d[i * 4 + 3] = 255; } return d; };
    const dark = toneSuggest(toneAnalyze(mk(40, (i, x) => { const v = 40 + x * 2; return [v, v, v]; })));
    const lowKey = toneSuggest(toneAnalyze(mk(40, (i, x) => { const v = 10 + x * 1.2; return [v, v, v]; })));
    const clipped = toneSuggest(toneAnalyze(mk(40, (i, x) => { const v = x < 30 ? 30 + x * 2 : 255; return [v, v, v]; })));
    const green = toneSuggest(toneAnalyze(mk(40, (i, x) => { const v = 40 + x * 4; return [v * .4, v, v * .3]; })));
    const bright = toneSuggest(toneAnalyze(mk(40, (i, x) => { const v = 190 + x * 1.5; return [v, v, v]; })));
    const warmC = toneSuggest(toneAnalyze(mk(40, (i, x) => { const v = 40 + x * 4; return [Math.min(255, v * 1.12), v, v * 0.9]; })));
    const flat = toneSuggest(toneAnalyze(mk(40, () => [120, 120, 120])));
    const norm = toneSuggest(toneAnalyze(mk(40, (i, x, y) => { const v = 15 + (x / 39) * 225; return [v, v * 0.98 + 2, v]; })));
    // горизонт: граница неба и земли, повёрнутая на 4° (по часовой)
    const W = 320, H = 200, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.translate(W / 2, H / 2); g.rotate(4 * Math.PI / 180); g.fillStyle = '#ddd'; g.fillRect(-400, -400, 800, 400); g.fillStyle = '#333'; g.fillRect(-400, 0, 800, 400);
    const px = g.getImageData(0, 0, W, H).data, gray = new Float32Array(W * H); for (let i = 0; i < W * H; i++) gray[i] = px[i * 4];
    const tl = tiltFromGray(gray, W, H);
    const blank = tiltFromGray(new Float32Array(W * H).fill(100), W, H);
    return { dark, lowKey, clipped, green, bright, warmC, flat, norm, tl, blank };
  });
  ok(logic.dark.toneExp > 20, `тёмный кадр: экспозиция вверх (${logic.dark.toneExp})`);
  ok(logic.lowKey.toneExp <= 20, `тёмная сцена: осветляем сдержанно (${logic.lowKey.toneExp})`);
  ok(logic.clipped.toneExp <= 0, `пересвеченный кадр: не осветляем (${logic.clipped.toneExp})`);
  ok(logic.green.toneWarm === 0, `зелёная сцена без нейтральных пикселей: температуру не трогаем (${logic.green.toneWarm})`);
  ok(logic.bright.toneExp < -10, `светлый кадр: экспозиция вниз (${logic.bright.toneExp})`);
  ok(logic.warmC.toneWarm < -8, `жёлто-красный оттенок: температура к холодному (${logic.warmC.toneWarm})`);
  ok(Object.values(logic.flat).every(v => v === 0), 'однотонный кадр: ничего не меняется');
  ok(Math.abs(logic.norm.toneExp) <= 6 && Math.abs(logic.norm.toneWarm) <= 8 && Math.abs(logic.norm.toneCon) <= 10, `нормальный кадр почти не трогается (${JSON.stringify(logic.norm)})`);
  ok(Math.abs(logic.tl.angle - 4) < 0.7 && logic.tl.conf > .3, `горизонт: найдено ${logic.tl.angle.toFixed(2)}° при повороте на 4° (уверенность ${logic.tl.conf.toFixed(2)})`);
  ok(logic.blank.conf === 0, 'пустой кадр: горизонта нет');
  // --- файлы-образцы ---
  const mkFile = async (name, fn) => { const url = await p.evaluate(fn); const f = path.join(require('os').tmpdir(), name); fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); return f; };
  const tilted = await mkFile('r4_tilted.png', () => { const W = 800, H = 500, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.translate(W / 2, H / 2); g.rotate(4 * Math.PI / 180); g.fillStyle = '#9cc4f0'; g.fillRect(-900, -900, 1800, 900); g.fillStyle = '#3f5f2a'; g.fillRect(-900, 0, 1800, 900);
    g.fillStyle = '#eee'; for (let i = -6; i < 7; i++) g.fillRect(i * 110, -160, 40, 160); return c.toDataURL('image/png'); });
  const dark = await mkFile('r4_dark.png', () => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 400, 0); gr.addColorStop(0, '#080808'); gr.addColorStop(1, '#505050'); g.fillStyle = gr; g.fillRect(0, 0, 400, 300); return c.toDataURL('image/png'); });
  await p.setInputFiles('#fileInput', tilted); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'auto'); set('ratioW', 4); set('ratioH', 3); set('fit', 'fit'); S.format = 'png'; S.maxSide = 8192; });
  await p.click('#settingsTabs [data-tab=quality]');
  ok(!(await p.$eval('#tiltAuto', e => e.disabled)), 'с фото кнопка горизонта активна');
  await p.click('#tiltAuto'); await p.waitForFunction(() => items[0].tilt && Math.abs(items[0].tilt) > 0.5, null, { timeout: 15000 }); await p.waitForTimeout(500);
  const t1 = await p.evaluate(() => ({ t: items[0].tilt, w: items[0].w, h: items[0].h, ow: items[0].ow, oh: items[0].oh, exp: tiltDims(items[0]), out: $('#tiltOut').textContent, rng: Number($('#tiltRange').value) }));
  ok(Math.abs(t1.t + 4) < 0.7, `авто-выравнивание: наклон ${t1.t}° (ждали около −4°)`);
  ok(t1.w === t1.exp.tw && t1.h === t1.exp.th && t1.w < t1.ow && Math.abs(t1.w / t1.h - t1.ow / t1.oh) < 0.01, `кадр вписан без пустых углов: ${t1.w}×${t1.h} из ${t1.ow}×${t1.oh}, пропорция сохранена`);
  ok(t1.rng === t1.t && /°/.test(t1.out), `ползунок и подпись показывают наклон (${t1.out})`);
  const resid = await p.evaluate(async () => (await tiltDetect(items[0])).angle);
  ok(Math.abs(resid) < 0.6, `после выравнивания остаточный наклон ${resid.toFixed(2)}°`);
  const corners = await p.evaluate(async () => { const it = items[0], bmp = await loadBitmap(it); const { w, h } = dimsOf(bmp), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); closeBmp(bmp);
    const a = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => g.getImageData(x, y, 1, 1).data[3]); return a; });
  ok(corners.every(a => a === 255), 'во всех углах кадра есть изображение (прозрачных углов нет)');
  const ex = await p.evaluate(`(${EXP})({})`); ok(!ex.err && ex.w > 0, 'экспорт с наклоном работает');
  // кроппер работает в системе наклонённого кадра
  await p.evaluate(() => openCropper()); await p.waitForFunction(() => cp.open, null, { timeout: 5000 });
  ok(await p.evaluate(() => cp.sw === tiltDims(items[0]).tw && cp.sh === tiltDims(items[0]).th), 'обрезка открывается на выровненном кадре');
  await p.evaluate(() => closeCropper());
  // ручная установка и сброс
  await p.evaluate(() => { const r = $('#tiltRange'); r.value = 2.5; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => items[0].tilt === 2.5, null, { timeout: 5000 });
  await p.click('#tiltReset'); await p.waitForFunction(() => !items[0].tilt && items[0].w === items[0].ow, null, { timeout: 5000 });
  ok(true, 'ползунок вручную и «Сбросить наклон» возвращают исходный кадр');
  await p.evaluate(() => { items[0].tilt = 3; syncDims(items[0]); });
  await p.evaluate(async () => { await resetPhoto(); });
  ok(await p.evaluate(() => !items[0].tilt && items[0].w === items[0].ow), '«Сбросить фото» убирает и наклон');
  // --- тон и стили (экспорт) ---
  const base = await p.evaluate(`(${EXP})({ px: true })`);
  const mean = a => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 4) { s += a[i] + a[i + 1] + a[i + 2]; n += 3; } return s / n; };
  const bw = await p.evaluate(`(${EXP})({ px: true, ov: { toneStyle: 'bw' } })`);
  let maxd = 0; for (let i = 0; i < bw.px.length; i += 4) maxd = Math.max(maxd, Math.abs(bw.px[i] - bw.px[i + 1]), Math.abs(bw.px[i + 1] - bw.px[i + 2]));
  ok(maxd <= 2, `стиль «Ч/б»: каналы равны (макс. разница ${maxd})`);
  await p.evaluate(() => { set('toneStyle', 'none'); });
  const br = await p.evaluate(`(${EXP})({ px: true, ov: { toneExp: 60 } })`);
  ok(mean(br.px) > mean(base.px) + 10, `экспозиция +60 делает светлее (${mean(base.px).toFixed(0)} → ${mean(br.px).toFixed(0)})`);
  await p.evaluate(() => { set('toneExp', 0); set('toneWarm', 80); });
  const wm = await p.evaluate(`(${EXP})({ px: true })`);
  let dr = 0, db = 0; for (let i = 0; i < wm.px.length; i += 4) { dr += wm.px[i] - base.px[i]; db += wm.px[i + 2] - base.px[i + 2]; }
  ok(dr > 0 && db < 0, 'тёплая температура: красного больше, синего меньше');
  await p.evaluate(() => { set('toneWarm', 0); });
  const off = await p.evaluate(`(${EXP})({ px: true })`); let diff = 0; for (let i = 0; i < off.px.length; i++) diff = Math.max(diff, Math.abs(off.px[i] - base.px[i]));
  ok(diff === 0, 'при нулевых значениях картинка не меняется ни на пиксель');
  // стиль в интерфейсе
  await p.click('#cardTone [data-group=toneStyle] button[data-val=film]'); ok(await p.evaluate(() => (items[0].ov || S).toneStyle === 'film'), 'кнопка стиля меняет настройку');
  ok(!(await p.$eval('#toneReset', e => e.hidden)), '«Сбросить тон» появляется при включённом тоне');
  await p.click('#toneReset'); ok(await p.evaluate(() => { const t = items[0].ov || S; return t.toneStyle === 'none' && !t.toneExp; }), '«Сбросить тон» обнуляет значения');
  // --- Автотон на тёмном фото ---
  await p.setInputFiles('#fileInput', dark); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(400);
  await p.evaluate(() => { select(items.findIndex(x => x.ow === 400 && x.oh === 300)); });
  await p.waitForTimeout(400);
  await p.click('#toneAuto'); await p.waitForFunction(() => { const it = cur(); return it && it.ov && it.ov.toneExp > 0; }, null, { timeout: 15000 });
  const au = await p.evaluate(() => { const o = cur().ov; return { e: o.toneExp, c: o.toneCon, s: o.toneSat, w: o.toneWarm, other: items[0].ov ? items[0].ov.toneExp : S.toneExp }; });
  ok(au.e >= 15, `Автотон осветлил тёмное фото (экспозиция ${au.e}, контраст ${au.c})`);
  ok(!au.other, 'Автотон меняет только текущее фото');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
