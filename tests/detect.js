// Блок O: точный поиск лиц (SCRFD, 5 точек) и объектов (YOLOX) на движке ONNX; глаза на линии третей.
// Запуск: node tests/detect.js   (нужен http: воркеры не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8782/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const near = (a, b, t) => Math.abs(a - b) <= t;
(async () => {
  await new Promise(r => server.listen(8782, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const analyze = async f => { await p.evaluate(() => { items.length = 0; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(200);
    return p.evaluate(async () => { items[0].an = undefined; const an = await ensureAnalysis(items[0]); return an ? { ...an } : null; }); };
  const reg = await p.evaluate(() => ['facex', 'objx', 'objx2'].map(id => compById(id).files));
  ok(reg.every(fl => fl.every(([f, s]) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size === s)), 'три компонента (лица, объекты, объекты точно): файлы на месте, размеры в реестре верны');
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; set('faceEngine', 'scrfd'); set('objEngine', 'nano'); });
  ok(await p.evaluate(() => S.faceEngine === 'blaze' && S.objEngine === 'off') && /Поиск/.test(await p.textContent('#toast')), 'без компонентов точный поиск лиц и объекты не включаются, показано предупреждение');
  // точный поиск лиц
  await p.evaluate(() => compInstall('facex')); await p.evaluate(() => set('faceEngine', 'scrfd')); ok(await p.evaluate(() => S.faceEngine === 'scrfd'), 'с компонентом SCRFD включается');
  let an = await analyze('face_two.jpg');
  ok(an.faces === 2 && near(an.faceBox.x0, 0.156, 0.03) && near(an.faceBox.x1, 0.7475, 0.03) && near(an.faceBox.y0, 0.34, 0.04), `face_two: найдено 2 лица, общая рамка ${JSON.stringify(Object.values(an.faceBox).map(v => +v.toFixed(2)))}`);
  ok(an.eyes && an.eyes.y > an.faceBox.y0 && an.eyes.y < an.faceBox.y1 && an.eyes.x > an.faceBox.x0, 'есть точка глаз внутри рамки лиц');
  an = await analyze('face_astronaut.jpg');
  ok(an.faces === 1 && near((an.faceBox.x0 + an.faceBox.x1) / 2, 226 / 512, 0.04) && near((an.faceBox.y0 + an.faceBox.y1) / 2, 120 / 512, 0.04), `astronaut: одно лицо на своём месте (${an.faceBox.x0.toFixed(2)}–${an.faceBox.x1.toFixed(2)})`);
  const astro = an;
  an = await analyze('face_small.jpg'); ok(an.faces === 1 && an.faceBox.x0 > 0.65, `face_small: мелкое лицо на большом кадре найдено (x ${an.faceBox.x0.toFixed(2)}–${an.faceBox.x1.toFixed(2)})`);
  an = await analyze('noface_coffee.jpg'); ok(an.faces === 0 && !an.faceFail, 'кадр без лиц: лиц нет, без ошибок');
  // глаза на линии третей
  const eye = await p.evaluate(() => {
    const it = items[0]; it.an = { subject: { x: .5, y: .6 }, faces: 1, faceBox: { x0: .4, x1: .6, y0: .48, y1: .72 }, eyes: { x: .5, y: .53, roll: 0, size: .2 } };
    const iw = 1000, ih = 1000, cw = 1000, ch = 500, dw = iw, dh = ih, fy = dh - ch; const f = focusOf(it, dw, dh, cw, ch);
    const line1 = (.53 * dh - f.y * fy) / ch; S.faceEyes = false; const g = focusOf(it, dw, dh, cw, ch); const line2 = (.53 * dh - g.y * fy) / ch; S.faceEyes = true; return { line1, line2 }; });
  ok(near(eye.line1, 0.36, 0.03), `глаза встают на линию третей: ${eye.line1.toFixed(3)} высоты кадра (цель 0.36)`);
  ok(Math.abs(eye.line2 - 0.36) > 0.03, `без этой настройки работает прежняя логика (глаза на ${eye.line2.toFixed(2)})`);
  // объекты
  await p.evaluate(() => compInstall('objx')); await p.evaluate(() => set('objEngine', 'nano')); ok(await p.evaluate(() => S.objEngine === 'nano'), 'с компонентом поиск объектов включается');
  an = await analyze('noface_coffee.jpg');
  ok(an.objMain === 'чашка' && an.objects.some(o => o.name === 'чашка'), `кофе: главный объект «${an.objMain}», найдено: ${an.objects.map(o => o.name).join(', ')}`);
  ok(an.objBox && near((an.objBox.x0 + an.objBox.x1) / 2, 0.49, 0.06) && near((an.objBox.y0 + an.objBox.y1) / 2, 0.39, 0.08), `рамка объекта на месте: ${Object.values(an.objBox).map(v => +v.toFixed(2))}`);
  ok(near(an.subject.x, 0.49, 0.06), 'без лиц кадр смотрит на найденный объект');
  an = await analyze('face_two.jpg'); ok(an.objects.some(o => o.name === 'человек'), 'на фото с людьми найден «человек»; лица остаются главными: subject по лицам ' + an.subject.x.toFixed(2));
  // две маленькие модели живут вместе
  const st = await p.evaluate(() => ortCall({ type: 'stat' })); ok(st.small === 2, `модели лиц и объектов остались в памяти вместе (сессий: ${st.small})`);
  // кадр «Заполнить» реально смотрит на объект
  await analyze('noface_coffee.jpg');
  const fl = await p.evaluate(() => { const it = items[0]; set('sizeMode', 'fixed'); set('outW', 300); set('outH', 400); set('fit', 'fill'); const s = Math.max(300 / it.w, 400 / it.h) * it.zoom, dw = it.w * s, dh = it.h * s, f = focusOf(it, dw, dh, 300, 400); return { fx: f.x, cx: (f.x * (dw - 300) + 150) / dw }; });
  ok(near(fl.cx, 0.49, 0.08), `вертикальный кадр центрируется на чашке (центр кадра на ${fl.cx.toFixed(2)} ширины)`);
  // точная модель объектов
  await p.evaluate(() => compInstall('objx2')); await p.evaluate(() => set('objEngine', 'small'));
  an = await analyze('noface_coffee.jpg'); ok(an.objMain === 'чашка', `модель «точно» тоже находит чашку (${an.objects.map(o => o.name).join(', ')})`);
  // смена настройки перезапускает анализ
  ok(await p.evaluate(() => { set('objEngine', 'nano'); return items[0].an === undefined; }), 'смена поиска объектов перезапускает анализ');
  // компонент удалён, настройка осталась
  await p.evaluate(() => compRemove('facex')); await p.evaluate(() => compRemove('objx2')); await p.evaluate(() => { S.objEngine = 'small'; });
  an = await analyze('face_two.jpg');
  ok(an && an.faceXMissing && an.objMissing, 'компоненты удалены, а настройки остались: анализ не падает, помечено «не скачан»');
  await p.evaluate(() => { cur() && renderAnalysis(); }); await p.waitForTimeout(300);
  ok(/не скачан компонент/.test(await p.textContent('#anAdvice')), 'в «Анализе фото» подсказка называет недостающий компонент');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
