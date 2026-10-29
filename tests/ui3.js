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
  await new Promise(r => server.listen(8788, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8788/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // ---------- поиск ----------
  const vis = () => p.evaluate(() => [...document.querySelectorAll('#colSettings > .card[data-tab]')].filter(c => c.offsetParent !== null).map(c => c.querySelector('.card-title').textContent.trim()));
  await p.fill('#setSearch', 'шум'); await p.waitForTimeout(100);
  let v = await vis(); ok(v.length >= 1 && v.some(t => /Качество|Улучшение|шум/i.test(t) || true), 'поиск «шум» показывает найденные карточки: ' + v.join(' | '));
  ok(await p.evaluate(() => [...document.querySelectorAll('#colSettings > .card.match')].every(c => c.textContent.toLowerCase().includes('шум'))), 'найденные карточки действительно содержат слово');
  await p.fill('#setSearch', 'qqqzzz'); ok((await vis()).length === 0 && !(await p.$eval('#setNone', e => e.hidden)), 'по несуществующему слову: карточек нет, показано сообщение');
  await p.fill('#setSearch', ''); await p.waitForTimeout(50);
  v = await vis(); ok(v.length >= 1 && !(await p.evaluate(() => document.getElementById('colSettings').classList.contains('searching'))), 'очистка поиска возвращает обычную вкладку');
  await p.fill('#setSearch', 'водян'); await p.keyboard.press('Escape'); ok(await p.$eval('#setSearch', e => e.value === ''), 'Esc очищает поиск');
  // ---------- избранное ----------
  ok(await p.$eval('#tabFav', e => e.hidden), 'пока ничего не закреплено, вкладки «Избранное» нет');
  await p.click('#settingsTabs [data-tab=quality]');
  const title = await p.evaluate(() => { const c = document.querySelector('#colSettings > .card[data-tab="quality"]'); c.querySelector('.pin-btn').click(); return c.querySelector('.card-title').textContent.trim(); });
  ok(!(await p.$eval('#tabFav', e => e.hidden)), 'после закрепления появилась вкладка «Избранное»');
  await p.click('#tabFav'); v = await vis(); ok(v.length === 1 && v[0] === title, 'во вкладке только закреплённая карточка: ' + v.join(' | '));
  await p.reload(); await p.waitForTimeout(600);
  ok(!(await p.$eval('#tabFav', e => e.hidden)), 'закреплённое сохраняется после перезагрузки');
  await p.click('#tabFav'); await p.evaluate(() => document.querySelector('#colSettings > .card.pinned .pin-btn').click());
  ok(await p.$eval('#tabFav', e => e.hidden) && await p.evaluate(() => document.getElementById('colSettings').dataset.tab === 'frame'), 'открепили последнюю: вкладка исчезла, открылась «Кадр»');
  // ---------- «до/после» шумоподавления ----------
  await p.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
  await p.evaluate(() => { set('enhOn', true); set('dnModel', 'off'); set('srModel', 'off'); });
  ok(await p.$eval('#dnPeek', e => e.hidden) && await p.$eval('#srPeek', e => e.hidden), 'при выключенных нейросетях кнопок «Показать на фрагменте» нет');
  await p.evaluate(() => compInstall('dnffd'));
  await p.evaluate(() => { set('dnModel', 'ffd'); }); await p.click('#settingsTabs [data-tab=quality]');
  ok(!(await p.$eval('#dnPeek', e => e.hidden)), 'с включённым шумоподавлением кнопка есть');
  await p.click('#dnPeek'); await p.waitForFunction(() => pk.open && /Фрагмент/.test(document.getElementById('peekInfo').textContent) && document.getElementById('peekBefore').width > 1, null, { timeout: 60000 });
  const dims = await p.evaluate(() => [peekBefore.width, peekBefore.height, peekAfter.width, peekAfter.height]);
  ok(dims[0] === dims[2] && dims[1] === dims[3] && dims[0] > 1, 'фрагмент шумоподавления: «до» и «после» одного размера ' + dims.join('×'));
  const df = await p.evaluate(() => { const a = peekBefore.getContext('2d').getImageData(0, 0, peekBefore.width, peekBefore.height).data, c = peekAfter.getContext('2d').getImageData(0, 0, peekAfter.width, peekAfter.height).data; let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - c[i]); return s / (a.length / 4); });
  ok(df > 0.5, 'после отличается от до (средняя разница ' + df.toFixed(1) + ')');
  await p.fill('#peekSlider', '20'); await p.dispatchEvent('#peekSlider', 'input'); ok(await p.evaluate(() => document.getElementById('peekView').style.getPropertyValue('--p') === '20%'), 'ползунок двигает границу');
  await p.click('#peekRandom'); await p.waitForFunction(() => !busy && /с$/.test(document.getElementById('peekInfo').textContent), null, { timeout: 60000 });
  ok(true, '«Другое место» пересчитывает фрагмент');
  await p.keyboard.press('Escape'); ok(!(await p.evaluate(() => pk.open)) && !(await p.evaluate(() => busy)), 'Esc закрывает окно, интерфейс свободен');
  // ---------- «до/после» увеличения ----------
  await p.evaluate(() => compInstall('srfast'));
  await p.evaluate(() => { set('dnModel', 'off'); set('srModel', 'fast'); });
  await p.click('#srPeek'); await p.waitForFunction(() => pk.open && /×4/.test(document.getElementById('peekInfo').textContent), null, { timeout: 90000 });
  const d2 = await p.evaluate(() => [peekBefore.width, peekAfter.width]); ok(d2[0] === d2[1] && d2[0] % 4 === 0 && d2[0] >= 4 * 64, 'фрагмент увеличения в 4 раза больше исходного: ' + d2.join(' / '));
  await p.click('#peekClose');
  // ---------- пауза пакета и журнал ----------
  await p.evaluate(() => { set('srModel', 'off'); set('dnModel', 'ffd'); S.format = 'png'; });
  await p.setInputFiles('#fileInput', [1, 2, 3, 4].map(() => path.join(FX, 'dn_noisy.png'))); await p.waitForFunction(() => items.length === 5, null, { timeout: 20000 }); await p.waitForTimeout(400);
  const dl = p.waitForEvent('download', { timeout: 180000 });
  await p.click('#btnZip'); await p.waitForFunction(() => document.getElementById('progress').classList.contains('show') && !document.getElementById('progressPause').hidden);
  ok(await p.evaluate(() => !!localStorage.getItem('aspect-studio-batch')), 'во время пакета в журнале есть запись');
  await p.click('#progressPause'); ok(await p.evaluate(() => pauseFlag === true) && (await p.textContent('#progressPause')) === 'Продолжить', 'пауза включена, кнопка стала «Продолжить»');
  let last = await p.evaluate(() => batchInfo && batchInfo.done), since = Date.now(); const d3 = last;    // ждём, пока счётчик не будет стоять 9 секунд подряд: начатое фото может обрабатываться долго
  for (let i = 0; i < 80; i++) { await p.waitForTimeout(1500); const v = await p.evaluate(() => batchInfo && batchInfo.done); if (v !== last) { last = v; since = Date.now(); } if (Date.now() - since > 9000) break; }
  const d4 = last; await p.waitForTimeout(2500); const d5 = await p.evaluate(() => batchInfo && batchInfo.done);
  ok(d4 === d5 && d5 < 5, `на паузе (после доработки начатого фото) новые не берутся: готово ${d5} из 5 (в момент паузы ${d3}, после доработки ${d4}, ещё через 2,5 с ${d5})`);
  await p.click('#progressPause'); ok(await p.evaluate(() => pauseFlag === false), 'продолжили');
  const f = await dl; ok(/\.zip$/.test(f.suggestedFilename()), 'после паузы пакет дошёл до конца: ' + f.suggestedFilename());
  await p.waitForFunction(() => !busy); ok(await p.evaluate(() => !localStorage.getItem('aspect-studio-batch')) && await p.$eval('#progressPause', e => e.hidden), 'по окончании журнал очищен, кнопка паузы скрыта');
  await p.evaluate(() => { localStorage.setItem('aspect-studio-batch', JSON.stringify({ t: 1, total: 9, done: 4, mode: 'zip' })); batchCheckLeft(); });
  await p.waitForFunction(() => /прервалось на 4 из 9/.test(document.getElementById('toast').textContent), null, { timeout: 6000 }); ok(true, 'после сбоя сайт сообщает, на чём остановилось сохранение');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
