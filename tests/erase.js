// Блок P2: «Убрать лишнее» (MI-GAN) на движке ONNX.
// Запуск: node tests/erase.js   (нужен http: воркеры не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8784, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8784/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#fileInput', path.join(FX, 'er_scene.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  // пиксель результата: текущий файл фото после поворота и обрезки
  const pix = (x, y) => p.evaluate(async ([x, y]) => { const it = items[0], bmp = await loadBitmap(it), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); closeBmp(bmp); return Array.from(g.getImageData(x, y, 1, 1).data); }, [x, y]);
  const isRed = v => v[0] > 200 && v[1] < 60 && v[2] < 60;
  // мазок по холсту редактора в координатах исходного кадра
  const paint = async (pts, r = 40) => {
    const box = await p.evaluate(() => { const r = document.getElementById('erCanvas').getBoundingClientRect(), W = er.dw, H = er.dh; return { x: r.left, y: r.top, w: r.width, h: r.height, W, H }; });
    await p.fill('#erSize', String(r)); await p.dispatchEvent('#erSize', 'input');
    const m = ([x, y]) => [box.x + x / box.W * box.w, box.y + y / box.H * box.h];
    await p.mouse.move(...m(pts[0])); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...m(q), { steps: 6 }); await p.mouse.up();
  };
  ok(isRed(await pix(425, 305)), 'исходник: красный круг на месте');
  ok(fs.existsSync(path.join(ROOT, 'vendor/models/migan.onnx')) && fs.statSync(path.join(ROOT, 'vendor/models/migan.onnx')).size === (await p.evaluate(() => compById('erase').files[0][1])), 'модель MI-GAN на месте, размер в реестре верен');
  // без компонента
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; }); await p.click('#eraseBtn');
  ok(!(await p.evaluate(() => er.open)) && /Убрать лишнее/.test(await p.textContent('#toast')), 'без компонента редактор не открывается, показано предупреждение');
  await p.evaluate(() => compInstall('erase')); ok(await p.evaluate(() => compInstalled('erase') && compInstalled('ort')), 'скачались модель и движок');
  // открыть, закрасить, отменить
  await p.click('#eraseBtn'); await p.waitForFunction(() => er.open);
  ok(await p.evaluate(() => document.getElementById('erDone').disabled), 'пока ничего не закрашено, «Убрать» неактивна');
  await paint([[425, 305]], 60); ok(!(await p.evaluate(() => document.getElementById('erDone').disabled)) && /Областей: 1/.test(await p.textContent('#erInfo')), 'после мазка: «Областей: 1», кнопка активна');
  await p.click('#erUndo'); ok(await p.evaluate(() => document.getElementById('erDone').disabled), '«Шаг назад» снимает метку');
  await p.click('#erCancel'); ok(!(await p.evaluate(() => er.open)) && await p.evaluate(() => items[0].file.type !== 'image/png' || !items[0].erased), 'отмена закрывает редактор, фото не меняется');
  // поворот до удаления: результат запекается
  await p.evaluate(async () => { const it = items[0]; it.rot = 90; await commitXform(it); });
  const dims0 = await p.evaluate(() => [items[0].w, items[0].h]); ok(dims0[0] === 480 && dims0[1] === 640, 'перед удалением фото повёрнуто: ' + dims0);
  await p.click('#eraseBtn'); await p.waitForFunction(() => er.open);
  // после поворота на 90° по часовой точка (425,305) стала (480-1-305, 425) ≈ (174, 425)
  await paint([[174, 425]], 120); console.log('  маска:', await p.evaluate(() => [er.dw, er.dh, er.mask.reduce((a, b) => a + (b > 127), 0), document.getElementById('erCanvas').getBoundingClientRect().width])); await p.click('#erDone');
  await p.waitForFunction(() => !busy && !er.open && items[0].erased && items[0].erased.length === 1, null, { timeout: 120000 });
  const st = await p.evaluate(() => { const it = items[0]; return { w: it.w, h: it.h, rot: it.rot, type: it.file.type, name: it.name, undoShown: !document.getElementById('eraseUndoBtn').hidden, ex: !!it.exifSrc }; });
  ok(st.w === 480 && st.h === 640 && st.rot === 0 && st.type === 'image/png' && st.ex, `результат запечён: ${st.w}×${st.h}, поворот сброшен, PNG, имя ${st.name}`);
  ok(st.undoShown, 'появилась кнопка «Вернуть как было»');
  const after = await pix(174, 425); ok(!isRed(after) && Math.abs(after[2] - 150) < 80, 'красный круг убран, на месте фон: ' + after);
  const keep = await pix(110, 480 - 100 + 0 > 0 ? 100 : 100); // зелёный прямоугольник после поворота: (480-1-100, 110)
  const green = await pix(379, 110); ok(green[1] > 120 && green[0] < 80, 'остальное не тронуто (зелёный прямоугольник цел): ' + green);
  // экспорт работает на новом файле
  const ex = await p.evaluate(async () => { Object.assign(S, { format: 'png' }); const it = items[0], bmp = await loadBitmap(it); try { const r = await exportBlob(it, bmp); return r.blob.size > 100; } finally { closeBmp(bmp); } });
  ok(ex, 'экспорт после удаления работает');
  // вернуть как было
  await p.click('#eraseUndoBtn'); await p.waitForFunction(() => !busy && items[0].erased.length === 0, null, { timeout: 30000 });
  const back = await p.evaluate(() => [items[0].w, items[0].h, items[0].file.type]); ok(back[0] === 480 && back[1] === 640 && await p.evaluate(() => items[0].rot === 90 && items[0].file.size > 0), 'вернулось прежнее состояние (файл и поворот на 90°): ' + back);
  ok(isRed(await pix(174, 425)) && await p.evaluate(() => document.getElementById('eraseUndoBtn').hidden), 'красный круг снова на месте, кнопка скрыта');
  await p.evaluate(async () => { const it = items[0]; it.rot = 0; await commitXform(it); });
  // две отдельные области
  await p.click('#eraseBtn'); await p.waitForFunction(() => er.open);
  await paint([[400, 285], [450, 285], [450, 330], [400, 330], [425, 305]], 120); await paint([[110, 100], [150, 100], [70, 100]], 120);
  ok(/Областей: 2/.test(await p.textContent('#erInfo')), 'два далёких мазка = две области');
  await p.click('#erDone'); await p.waitForFunction(() => !busy && !er.open && items[0].erased.length === 1, null, { timeout: 120000 });
  const r2 = await pix(425, 305), g2 = await pix(110, 100); ok(!isRed(r2) && !(g2[1] > 140 && g2[0] < 70), `убраны обе области: круг ${r2}, прямоугольник ${g2}`);
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
