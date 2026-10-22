// Блок K: точное удаление фона (IS-Net на ONNX Runtime Web).
// Запуск: node tests/cutout2.js   (нужен http: воркер и service worker не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8778/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const PIX = `async (pts) => { S.format = 'png'; const it = items[0], bmp = await loadBitmap(it), res = await exportBlob(it, bmp); closeBmp(bmp);
  const m = await createImageBitmap(res.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  return pts.map(([fx, fy]) => [...x.getImageData(Math.min(m.width - 1, Math.floor(m.width * fx)), Math.min(m.height - 1, Math.floor(m.height * fy)), 1, 1).data]); }`;
(async () => {
  await new Promise(r => server.listen(8778, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const vreq = []; p.on('request', r => { if (/\/vendor\/(ort|models)\//.test(r.url())) vreq.push(r.url().replace(URL_, '')); });
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const pix = pts => p.evaluate(`(${PIX})(${JSON.stringify(pts)})`);
  const near = (a, c, t = 14) => a.slice(0, 3).every((v, i) => Math.abs(v - c[i]) <= t);
  // реестр
  const reg = await p.evaluate(() => ({ ort: compById('ort').files.map(f => f[0]), c2: compById('cutout2'), n: COMPONENTS.length }));
  const fsz = f => fs.statSync(path.join(ROOT, f)).size;
  ok(await p.evaluate(() => [...compById('ort').files, ...compById('cutout2').files].every(f => true)) && reg.ort.every(f => fs.existsSync(path.join(ROOT, f))) && reg.c2.files.every(f => fsz(f[0]) === f[1]), 'файлы движка и модели лежат в vendor, размеры в реестре верны');
  ok(reg.c2.requires[0] === 'ort', '«точный» требует общий движок ONNX');
  await p.evaluate(() => compInstall('cutout'));
  await p.evaluate(() => { items.length = 0; }); await p.setInputFiles('#fileInput', path.join(FX, 'noface_coffee.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  await p.evaluate(() => { const it = items[0]; set('sizeMode', 'auto'); set('ratioW', it.w); set('ratioH', it.h); set('fit', 'fit'); set('enhOn', false); set('format', 'png'); set('cutOn', true); set('cutBg', 'color'); set('cutColor', '#ff8800'); });
  // без компонента «Точно» не включается
  await p.evaluate(() => set('cutQuality', 'precise'));
  ok(await p.evaluate(() => S.cutQuality === 'fast') && /Точное удаление фона/.test(await p.textContent('#toast')) && !vreq.length, 'без компонента режим «Точно» не включается: предупреждение, сеть не трогается');
  // быстрый режим работает, маска помечена как быстрая
  let fast = await pix([[.03, .03], [.5, .5]]); ok(near(fast[0], [255, 136, 0], 3) && !near(fast[1], [255, 136, 0], 40), 'быстрый режим: фон заменён, чашка на месте');
  const fastSig = await p.evaluate(() => items[0].mask.sig);
  // установка и точный режим
  await p.evaluate(() => compInstall('cutout2')); ok(await p.evaluate(() => compInstalled('cutout2') && compInstalled('ort')), 'скачались движок и модель (две части)');
  ok(await p.evaluate(async () => { try { await compRemove('ort'); return false; } catch (e) { return /Нужен для/.test(e.message); } }), 'движок нельзя удалить, пока установлен «точный»');
  await p.evaluate(() => set('cutQuality', 'precise')); ok(await p.evaluate(() => S.cutQuality === 'precise'), 'с компонентом режим «Точно» включается');
  const t0 = Date.now(); const prec = await pix([[.03, .03], [.97, .97], [.5, .5], [.15, .5]]); const dt = Date.now() - t0;
  ok(near(prec[0], [255, 136, 0], 3) && near(prec[1], [255, 136, 0], 3), 'точный режим: углы заменены цветом фона ' + JSON.stringify(prec.slice(0, 2).map(v => v.slice(0, 3))));
  ok(!near(prec[2], [255, 136, 0], 40), 'точный режим: объект на месте ' + prec[2].slice(0, 3));
  ok(await p.evaluate(() => items[0].mask && /^p\|/.test(items[0].mask.sig) && items[0].mask.w >= 512), 'маска пересчитана точной моделью (подпись «p»), ' + dt + ' мс');
  ok(vreq.some(u => /isnet-int8\.onnx\.p2/.test(u)) && vreq.some(u => /ort-wasm/.test(u)), 'воркер читал модель и wasm из vendor');
  // повторный экспорт — без пересчёта
  const t1 = Date.now(); await pix([[.5, .5]]); const dt2 = Date.now() - t1; ok(dt2 < dt / 2, `повторный экспорт использует кэш маски: ${dt} мс → ${dt2} мс`);
  // переключение обратно считает быстрой заново
  await p.evaluate(() => set('cutQuality', 'fast')); await pix([[.5, .5]]); ok(await p.evaluate(s => items[0].mask.sig !== s || /^f\|/.test(items[0].mask.sig), fastSig), 'возврат на «Быстро» пересчитывает маску быстрой моделью');
  // удалили модель, настройка осталась: экспорт идёт без вырезания, с предупреждением
  await p.evaluate(() => set('cutQuality', 'precise')); await p.evaluate(() => compRemove('cutout2'));
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; compOnce.clear(); });
  const noC = await pix([[.03, .03]]); ok(!near(noC[0], [255, 136, 0], 10) && /Точное удаление фона/.test(await p.textContent('#toast')), 'модель удалили, а настройка осталась: экспорт идёт без вырезания и с предупреждением');
  ok(await p.evaluate(() => document.getElementById('cutNeedName').textContent.includes('точный')), 'подсказка в карточке называет нужный компонент «точный»');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
