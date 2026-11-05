// Блок E1 (v2.51.2): распознавание текста (тёмный фон, мелкий текст, неровный свет, поворот, режим «Надписи», .txt) и удаление объектов.
// Запуск: node tests/e1.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream', '.gz': 'application/gzip' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
// картинки с текстом рисуем в странице и отдаём как PNG
const MAKE = {
  dark: () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 500; const g = c.getContext('2d'); g.fillStyle = '#1b1f2a'; g.fillRect(0, 0, 1200, 500); g.fillStyle = '#f4f4f4'; g.font = 'bold 110px Arial, sans-serif'; g.fillText('HELLO WORLD', 80, 190); g.fillText('Order 2026', 80, 380); return c; },
  small: () => { const c = document.createElement('canvas'); c.width = 520; c.height = 220; const g = c.getContext('2d'); g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, 520, 220); g.fillStyle = '#4a4a4a'; g.font = '30px Arial, sans-serif'; g.fillText('Invoice number 4821', 24, 90); g.fillText('Total payment due', 24, 150); return c; },
  shade: () => { const c = document.createElement('canvas'); c.width = 1400; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1400, 600); g.fillStyle = '#111'; g.font = 'bold 120px Arial, sans-serif'; g.fillText('Quarterly report', 70, 230); g.fillText('Revenue growth', 70, 420); const gr = g.createLinearGradient(0, 0, 1400, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.62)'); g.fillStyle = gr; g.fillRect(0, 0, 1400, 600); return c; },
  rot: () => { const s = document.createElement('canvas'); s.width = 1400; s.height = 600; const g = s.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1400, 600); g.fillStyle = '#111'; g.font = 'bold 130px Arial, sans-serif'; g.fillText('Sideways text', 60, 260); g.fillText('Needs rotation', 60, 460); const c = document.createElement('canvas'); c.width = 600; c.height = 1400; const h = c.getContext('2d'); h.translate(300, 700); h.rotate(Math.PI / 2); h.drawImage(s, -700, -300); return c; },
  ru: () => { const c = document.createElement('canvas'); c.width = 1300; c.height = 520; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1300, 520); g.fillStyle = '#111'; g.font = 'bold 120px Arial, sans-serif'; g.fillText('Привет мир', 60, 190); g.fillText('Мама мыла раму', 60, 400); return c; },
  sign: () => { const c = document.createElement('canvas'); c.width = 1400; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#7aa05a'; g.fillRect(0, 0, 1400, 900); g.fillStyle = '#fff'; g.font = 'bold 120px Arial, sans-serif'; g.fillText('OPEN', 120, 200); g.fillStyle = '#222'; g.fillText('CAFE', 780, 700); return c; },
};
(async () => {
  await new Promise(r => server.listen(8852, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8852/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const imgs = {}; for (const k of Object.keys(MAKE)) { const f = '/tmp/e1_' + k + '.png'; fs.writeFileSync(f, Buffer.from(await p.evaluate(async src => { const c = (new Function('return (' + src + ')'))()(); const bl = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await bl.arrayBuffer())); }, MAKE[k].toString()))); imgs[k] = f; }
  await p.setInputFiles('#fileInput', Object.values(imgs)); await p.waitForFunction(n => items.length === n, Object.keys(imgs).length); await p.waitForTimeout(500);
  await p.click('#settingsTabs [data-tab=extra]'); await p.evaluate(() => compInstall('ocr')); ok(await p.evaluate(() => compInstalled('ocr')), 'компонент распознавания скачался');
  const read = async (idx, mode) => {
    await p.evaluate(([i, m]) => { select(i); set('ocrMode', m || 'auto'); document.querySelector('#ocrOut').hidden = true; }, [idx, mode]); await p.waitForTimeout(300);
    const t0 = Date.now(); await p.click('#ocrBtn'); await p.waitForFunction(() => !document.querySelector('#ocrOut').hidden && !document.querySelector('#ocrBtn').disabled, null, { timeout: 150000 });
    const r = await p.evaluate(() => ({ t: document.querySelector('#ocrText').value, info: document.querySelector('#ocrInfo').textContent, save: !document.querySelector('#ocrSave').hidden }));
    console.log(`  [${Object.keys(imgs)[idx]}] ${Date.now() - t0} мс:`, JSON.stringify(r.t), '|', r.info); return r;
  };
  let r = await read(0); ok(/hello/i.test(r.t) && /world/i.test(r.t) && /2026/.test(r.t), 'светлый текст на тёмном фоне прочитан');
  ok(r.save, 'кнопка «Сохранить в .txt» появилась');
  r = await read(1); ok(/invoice/i.test(r.t) && /4821/.test(r.t) && /payment/i.test(r.t), 'мелкий текст с низким контрастом прочитан');
  r = await read(2); ok(/quarterly/i.test(r.t) && /revenue/i.test(r.t) && /growth/i.test(r.t), 'текст в тени (неровный свет) прочитан целиком');
  r = await read(3); ok(/sideways/i.test(r.t) && /rotation/i.test(r.t), 'повёрнутое на 90° фото прочитано');
  const fo = await p.evaluate(() => { document.querySelector('#ocrFocus').click(); return { f: items[3].focus, m: items[3].manual }; });
  ok(fo.m && fo.f.x > 0.05 && fo.f.x < 0.95 && fo.f.y > 0.05 && fo.f.y < 0.95, `рамка текста пересчитана в координаты исходного кадра (${fo.f.x.toFixed(2)}, ${fo.f.y.toFixed(2)})`);
  r = await read(5, 'sparse'); ok(/open/i.test(r.t) && /cafe/i.test(r.t), 'режим «Надписи»: слова в разных углах кадра найдены');
  r = await read(4); ok(/привет/i.test(r.t) && /мир/i.test(r.t) && /раму/i.test(r.t) && !/[A-Za-z]{3}/.test(r.t), 'русский текст остался русским (проверка алфавита не портит слова вроде «Мама»)');
  // сохранение .txt
  const dl = p.waitForEvent('download'); await p.click('#ocrSave'); const d = await dl; ok(/\.txt$/.test(d.suggestedFilename()), 'файл .txt скачивается: ' + d.suggestedFilename());
  // ---------- удаление объектов ----------
  const ph = '/tmp/e1_photo.png';
  fs.writeFileSync(ph, Buffer.from(await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const g = c.getContext('2d'); const im = g.createImageData(1600, 1200); let sd = 12345; const rn = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    for (let y = 0; y < 1200; y++) for (let x = 0; x < 1600; x++) { const i = (y * 1600 + x) * 4, n = (rn() + rn() + rn() - 1.5) * 14, b = 110 + x / 1600 * 50; im.data[i] = b + n; im.data[i + 1] = b + 25 + n; im.data[i + 2] = b + 45 + n; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); g.fillStyle = '#d01818'; g.beginPath(); g.arc(800, 600, 90, 0, 7); g.fill(); g.fillStyle = '#18a030'; g.fillRect(200, 150, 160, 100);
    const bl = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await bl.arrayBuffer())); })));
  await p.setInputFiles('#fileInput', ph); await p.waitForFunction(() => items.length === 7); await p.evaluate(() => select(6)); await p.waitForTimeout(500);
  await p.evaluate(() => compInstall('erase')); ok(await p.evaluate(() => compInstalled('erase')), 'компонент удаления скачался');
  const stat = (x, y, w, h) => p.evaluate(async ([x, y, w, h]) => { const it = items[6], bmp = await loadBitmap(it), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); const d = c.getContext('2d').getImageData(x, y, w, h).data; let m = [0, 0, 0], n = 0, dev = []; const L = i => d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11;
    for (let j = 0; j < w * h; j++) { m[0] += d[j * 4]; m[1] += d[j * 4 + 1]; m[2] += d[j * 4 + 2]; n++; } for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) { const i = yy * w + xx; dev.push(Math.abs(L(i) - (L(i - 1) + L(i + 1) + L(i - w) + L(i + w)) / 4)); } dev.sort((a, b) => a - b); return { r: m[0] / n, g: m[1] / n, b: m[2] / n, noise: dev[dev.length >> 1] * 1.48 }; }, [x, y, w, h]);
  await p.click('#eraseBtn'); await p.waitForFunction(() => er.open);
  ok(await p.evaluate(() => !!document.querySelector('#erTool [data-t=rect]') && !!document.querySelector('#erTool [data-t=wand]')), 'в редакторе есть инструменты «Рамка» и «По цвету»');
  // «Рамка» вокруг круга
  await p.click('#erTool [data-t=rect]');
  const box = await p.evaluate(() => { const r = document.getElementById('erCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, W: er.dw, H: er.dh }; });
  const m = ([x, y]) => [box.x + x / 1600 * box.w, box.y + y / 1200 * box.h];
  await p.mouse.move(...m([690, 490])); await p.mouse.down(); await p.mouse.move(...m([910, 710]), { steps: 8 }); await p.mouse.up();
  const rs = await p.evaluate(() => ({ n: er.mask.reduce((a, b) => a + (b > 127), 0), info: document.getElementById('erInfo').textContent }));
  ok(rs.n > 10000 && /Областей: 1/.test(rs.info), 'рамка пометила область: ' + rs.info);
  // «По цвету» на зелёном прямоугольнике
  await p.click('#erTool [data-t=wand]'); await p.mouse.click(...m([280, 200]));
  const ws = await p.evaluate(() => document.getElementById('erInfo').textContent); ok(/Областей: 2/.test(ws), '«По цвету» выделил зелёный прямоугольник: ' + ws);
  await p.click('#erDone'); await p.waitForFunction(() => !busy && !er.open && items[6].erased && items[6].erased.length === 1, null, { timeout: 180000 });
  fs.writeFileSync('/tmp/e1_out.png', Buffer.from(await p.evaluate(async () => { const bl = items[6].file; return Array.from(new Uint8Array(await bl.arrayBuffer())); })));
  const around = await stat(500, 500, 60, 60), fill = await stat(770, 570, 60, 60), rect = await stat(240, 170, 80, 60), circleEdge = await stat(700, 600, 12, 12);
  console.log('  фон:', JSON.stringify(around), 'заливка:', JSON.stringify(fill), 'прямоугольник:', JSON.stringify(rect));
  ok(Math.abs(fill.r - 135) < 25 && fill.r < 190 && fill.g > 100, 'на месте круга фон, а не красное пятно');
  ok(Math.abs(rect.g - rect.r - 25) < 20 && rect.g < 200, 'зелёный прямоугольник убран');
  ok(fill.noise > around.noise * 0.45 && fill.noise < around.noise * 1.8, `зерно заливки близко к зерну снимка (${fill.noise.toFixed(1)} против ${around.noise.toFixed(1)})`);
  // шов по границе: разница соседних пикселей на краю заливки не больше, чем в обычном месте
  const seam = await p.evaluate(async () => { const it = items[6], bmp = await loadBitmap(it), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const L = d => d[0] * .3 + d[1] * .59 + d[2] * .11, mean = (x, y, w, h) => { const d = g.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < w * h; i++) s += L(d.subarray(i * 4, i * 4 + 4)); return s / (w * h); };
    let worst = 0; for (const x of [690, 910]) for (const [y0, y1] of [[500, 560], [560, 620], [620, 680]]) { const a = mean(x - 14, y0, 10, y1 - y0), b = mean(x + 4, y0, 10, y1 - y0); worst = Math.max(worst, Math.abs(a - b)); } return worst; });
  ok(seam < 9, 'на границе заливки нет заметного шва (разница яркости по обе стороны края ' + seam.toFixed(1) + ')');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
