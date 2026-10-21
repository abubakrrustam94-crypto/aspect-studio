// Блок J: метка веса в превью, проверенные пресеты, ручная правка маски.
// Запуск: node tests/quality.js   (нужен http: воркер и service worker не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8777/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const PIX = `async (pts) => { S.format = 'png'; const it = items[0], bmp = await loadBitmap(it), res = await exportBlob(it, bmp); closeBmp(bmp);
  const m = await createImageBitmap(res.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  return pts.map(([fx, fy]) => [...x.getImageData(Math.min(m.width - 1, Math.floor(m.width * fx)), Math.min(m.height - 1, Math.floor(m.height * fy)), 1, 1).data]); }`;
(async () => {
  await new Promise(r => server.listen(8777, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const pix = pts => p.evaluate(`(${PIX})(${JSON.stringify(pts)})`);
  // ---------- пресеты (сверено с источниками, октябрь 2026) ----------
  const pr = await p.evaluate(() => Object.fromEntries(PRESETS.map(x => [x.id, [x.w, x.h]])));
  const has = (id, w, h) => pr[id] && pr[id][0] === w && pr[id][1] === h;
  ok(has('wb', 900, 1200) && has('ozon', 1200, 1600) && has('ym', 900, 1200) && has('avito', 1600, 1200) && has('ozf', 1000, 1000), 'пресеты Wildberries, Ozon, Яндекс Маркет, Авито, Ozon Fresh: 3:4 и 4:3 с размерами не меньше требуемых');
  ok(has('ig34', 1080, 1440), 'есть пресет Instagram 3:4 (сетка профиля)');
  ok(await p.evaluate(() => PRESETS.every(x => x.w >= 100 && x.h >= 100 && PRESETS.filter(y => y.id === x.id).length === 1)), 'id пресетов уникальны');
  // ---------- вес файла ----------
  await p.setInputFiles('#fileInput', path.join(FX, 'noface_coffee.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('format', 'jpg'); set('enhOn', false); set('fit', 'fit'); });
  await p.waitForFunction(() => /≈/.test(document.querySelector('.info-weight')?.textContent || ''), null, { timeout: 8000 });
  const est = await p.textContent('.info-weight'); ok(/Вес ≈ \d+ (КБ|МБ)/.test(est), 'в превью есть ориентировочный вес: «' + est + '»');
  await p.click('.info-weight'); await p.waitForFunction(() => /^Вес \d/.test(document.querySelector('.info-weight')?.textContent || ''), null, { timeout: 15000 });
  const exact = await p.textContent('.info-weight'); const real = await p.evaluate(async () => { const it = items[0], bmp = await loadBitmap(it), r = await exportBlob(it, bmp); closeBmp(bmp); return r.blob.size; });
  ok(exact === 'Вес ' + await p.evaluate(s => fmtSize(s), real), 'после нажатия вес точный и равен реальному файлу: ' + exact);
  const num = t => { const m = t.match(/(\d+(?:[.,]\d+)?) (КБ|МБ)/); return m ? parseFloat(m[1].replace(',', '.')) * (m[2] === 'МБ' ? 1024 : 1) : 0; };
  ok(Math.abs(num(est) - real / 1024) / (real / 1024) < 0.6, `оценка (${est}) недалека от реального веса (${Math.round(real / 1024)} КБ)`);
  await p.evaluate(() => set('quality', 40)); await p.waitForFunction(() => /≈|считаю/.test(document.querySelector('.info-weight')?.textContent || ''), null, { timeout: 8000 });
  ok(await p.evaluate(() => !document.querySelector('.info-weight').disabled), 'после смены настроек точное значение сбрасывается');
  await p.evaluate(() => { set('targetOn', true); set('targetKB', 120); }); await p.waitForTimeout(500);
  ok(/до 120 КБ/.test(await p.textContent('.info-weight')), 'в режиме «уложить в размер» показан лимит');
  await p.evaluate(() => { set('targetOn', false); set('quality', 92); });
  // ---------- ручная правка маски ----------
  await p.evaluate(() => compInstall('cutout'));
  await p.evaluate(() => { const it = items[0]; set('sizeMode', 'auto'); set('ratioW', it.w); set('ratioH', it.h); set('fit', 'fit'); set('format', 'png'); set('cutOn', true); set('cutBg', 'color'); set('cutColor', '#ff8800'); });
  await p.click('#settingsTabs [data-tab=bg]');
  ok(await p.evaluate(() => !document.getElementById('maskEditBtn').closest('#cutFields').hidden), 'кнопка «Править вручную» видна при включённом удалении фона');
  const near = (a, c, t = 14) => a.slice(0, 3).every((v, i) => Math.abs(v - c[i]) <= t);
  const base = await pix([[.03, .03], [.5, .5]]);
  ok(near(base[0], [255, 136, 0], 3) && !near(base[1], [255, 136, 0], 40), 'до правки: фон оранжевый, объект в центре сохранён');
  await p.click('#maskEditBtn'); await p.waitForSelector('#maskEd.show', { timeout: 20000 });
  ok(true, 'редактор маски открылся');
  const box = await p.locator('#meCanvas').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await p.click('#meTool [data-t=erase]'); await p.fill('#meSize', '90'); await p.evaluate(() => document.getElementById('meSize').dispatchEvent(new Event('input')));
  let [sx, sy] = at(.42, .5); await p.mouse.move(sx, sy); await p.mouse.down(); [sx, sy] = at(.58, .5); await p.mouse.move(sx, sy, { steps: 8 }); await p.mouse.up();
  ok(await p.evaluate(() => !document.getElementById('meUndo').disabled), 'после мазка доступен «Шаг назад»');
  await p.click('#meUndo'); ok(await p.evaluate(() => document.getElementById('meUndo').disabled), '«Шаг назад» вернул маску');
  [sx, sy] = at(.42, .5); await p.mouse.move(sx, sy); await p.mouse.down(); [sx, sy] = at(.58, .5); await p.mouse.move(sx, sy, { steps: 8 }); await p.mouse.up();
  await p.click('#meCancel'); ok(await p.evaluate(() => !document.getElementById('maskEd').classList.contains('show') && !items[0].mask.edited), '«Отмена» закрывает окно и ничего не сохраняет');
  const still = await pix([[.5, .5]]); ok(!near(still[0], [255, 136, 0], 40), 'после отмены объект на месте');
  await p.click('#maskEditBtn'); await p.waitForSelector('#maskEd.show');
  await p.click('#meTool [data-t=erase]'); await p.fill('#meSize', '90'); await p.evaluate(() => document.getElementById('meSize').dispatchEvent(new Event('input')));
  [sx, sy] = at(.42, .5); await p.mouse.move(sx, sy); await p.mouse.down(); [sx, sy] = at(.58, .5); await p.mouse.move(sx, sy, { steps: 8 }); await p.mouse.up();
  await p.click('#meDone'); await p.waitForTimeout(600);
  const erased = await pix([[.5, .5]]); ok(near(erased[0], [255, 136, 0], 14), 'стёртое кистью место в результате стало фоном: ' + erased[0].slice(0, 3));
  ok(await p.evaluate(() => items[0].mask.edited === true), 'правка сохранена в маске фото');
  // «оставить»: возвращаем угол
  await p.click('#maskEditBtn'); await p.waitForSelector('#maskEd.show'); const box2 = await p.locator('#meCanvas').boundingBox();
  await p.click('#meTool [data-t=keep]'); await p.fill('#meSize', '110'); await p.evaluate(() => document.getElementById('meSize').dispatchEvent(new Event('input')));
  await p.mouse.move(box2.x + box2.width * .06, box2.y + box2.height * .06); await p.mouse.down(); await p.mouse.move(box2.x + box2.width * .1, box2.y + box2.height * .1, { steps: 5 }); await p.mouse.up();
  await p.click('#meDone'); await p.waitForTimeout(600);
  const kept = await pix([[.08, .08]]); ok(!near(kept[0], [255, 136, 0], 10), 'кисть «Оставить» вернула кусок фона фото: ' + kept[0].slice(0, 3));
  // сброс к нейросети
  await p.click('#maskEditBtn'); await p.waitForSelector('#maskEd.show'); await p.click('#meReset'); await p.click('#meDone'); await p.waitForTimeout(600);
  const back = await pix([[.5, .5], [.08, .08]]); ok(!near(back[0], [255, 136, 0], 40) && near(back[1], [255, 136, 0], 5), '«Как у нейросети» возвращает исходную маску');
  await p.click('#maskEditBtn'); await p.waitForSelector('#maskEd.show'); await p.keyboard.press('Escape'); ok(await p.evaluate(() => !document.getElementById('maskEd').classList.contains('show')), 'Esc закрывает редактор');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
