// Блок C5: автосохранение сессии, резервная копия настроек, макеты «Как это будет выглядеть».
// Запуск: node tests/c5.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8810, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8810/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // --- макеты: чистая математика ---
  await p.evaluate(() => lazyLoad('mockups'));
  const ml = await p.evaluate(() => ({ same: mkCropLoss(100, 100, 50, 50), sq: mkCropLoss(100, 100, 9, 16), wide: mkCropLoss(1600, 900, 1, 1), tall: mkCropLoss(900, 1600, 1.91, 1), bad: mkCropLoss(0, 10, 1, 1) }));
  ok(ml.same === 0 && Math.abs(ml.sq - (1 - 9 / 16)) < 1e-9 && Math.abs(ml.wide - (1 - 9 / 16)) < 1e-9 && ml.tall > .7 && ml.bad === 0, 'расчёт обрезки: квадрат в 9:16 теряет 44%, 16:9 в квадрате — 44%');
  // --- фото ---
  await p.setInputFiles('#fileInput', [path.join(FX, 'face_astronaut.jpg'), path.join(FX, 'noface_coffee.jpg')]); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(700);
  await p.evaluate(() => { set('sizeMode', 'fixed'); set('fit', 'fill'); });
  await p.waitForFunction(() => document.querySelector('#afterCanvas').width > 2); await p.waitForTimeout(400);
  await p.click('#mockBtn'); await p.waitForSelector('#mockups:not([hidden])');
  ok(await p.evaluate(() => document.querySelectorAll('#mkTabs button').length === 5 && document.querySelectorAll('#mkStage canvas.mk-pic').length === 1), 'окно макетов: 5 вкладок, на «Телефоне» один кадр');
  const tabs = {};
  for (const t of ['phone', 'story', 'avatar', 'feed', 'link']) {
    await p.click(`#mkTabs [data-t=${t}]`);
    tabs[t] = await p.evaluate(() => { const cs = [...document.querySelectorAll('#mkStage canvas.mk-pic')]; const nonEmpty = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 37) s += d[i] + d[i + 1] + d[i + 2]; return s > 100; }; return { n: cs.length, drawn: cs.every(nonEmpty), note: document.querySelector('#mkNote').textContent }; });
  }
  ok(tabs.phone.n === 1 && tabs.story.n === 1 && tabs.avatar.n === 3 && tabs.feed.n === 1 && tabs.link.n === 1, 'на вкладках правильное число кадров (аватар — 3 размера)');
  ok(Object.values(tabs).every(t => t.drawn), 'во всех макетах кадр действительно нарисован' + JSON.stringify(Object.entries(tabs).map(([k, v]) => [k, v.drawn])));
  ok(/обрежутся|влезает целиком/.test(tabs.story.note) && /Пунктир/.test(tabs.story.note), 'под макетом написано, сколько обрежется, а для истории — про безопасные зоны');
  await p.click('#mkTabs [data-t=story]');
  ok(await p.evaluate(() => document.querySelector('#mkStage .mk-story .mk-safe') !== null), 'в истории нарисованы пунктирные зоны интерфейса');
  await p.keyboard.press('Escape'); ok(await p.evaluate(() => document.querySelector('#mockups').hidden && document.activeElement.id === 'mockBtn'), 'Esc закрывает окно и возвращает фокус на кнопку');
  // --- резервная копия настроек ---
  await p.evaluate(() => { set('quality', 77); set('toneExp', 33); set('lowDn', 12); localStorage.setItem('aspect-studio-accent', 'teal'); localStorage.setItem('aspect-studio-presets', JSON.stringify([{ name: 'Тест', cfg: { quality: 60 } }])); });
  await p.click('#settingsTabs [data-tab=extra]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#bkExportBtn')]);
  const file = path.join('/tmp', 'bk-test.json'); await dl.saveAs(file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(/^aspect-studio-settings-\d{8}\.json$/.test(dl.suggestedFilename()) && j.app === 'aspect-studio' && j.kind === 'settings' && j.S.quality === 77 && j.S.toneExp === 33 && j.ls['aspect-studio-accent'] === 'teal' && !('view' in j.S) && !('file' in j), `файл настроек сохранён (${dl.suggestedFilename()}, ${Object.keys(j.S).length} параметров)`);
  await p.evaluate(() => { set('quality', 50); set('toneExp', 0); localStorage.setItem('aspect-studio-accent', 'blue'); });
  await p.setInputFiles('#bkFile', file); await p.waitForFunction(() => S.quality === 77, null, { timeout: 8000 });
  ok(await p.evaluate(() => S.toneExp === 33 && S.lowDn === 12 && localStorage.getItem('aspect-studio-accent') === 'teal' && myPresets.some(x => x.name === 'Тест')), 'загрузка вернула настройки, акцент и мои наборы');
  await p.evaluate(() => histUndo()); await p.waitForTimeout(300); ok(await p.evaluate(() => S.quality === 50), 'импорт отменяется шагом назад');
  // порча и чужие данные
  const bad = await p.evaluate(() => { const t = bkParse; const evil = JSON.stringify({ app: 'aspect-studio', kind: 'settings', S: { quality: 'сто', __proto__: { x: 1 }, evil: 1, toneExp: 5, outW: 1e999 }, ls: { 'aspect-studio-presets': '{плохой json', 'other-key': '1', 'aspect-studio-theme': 'pink', 'aspect-studio-accent': 'nope' } });
    const r = t(evil); return { r: r && { S: r.S, ls: r.ls }, notApp: t('{"app":"x"}'), junk: t('не json'), big: t('x'.repeat(2.1e6)) }; });
  ok(bad.r && bad.r.S.toneExp === 5 && !('quality' in bad.r.S) && !('evil' in bad.r.S) && !('outW' in bad.r.S) && Object.keys(bad.r.ls).length === 0, 'импорт отбрасывает неверные типы, чужие ключи, бесконечности, сломанный JSON, неизвестную тему и акцент');
  ok(bad.notApp === null && bad.junk === null && bad.big === null, 'чужой файл, не-JSON и слишком большой файл не принимаются');
  // --- сессия ---
  await p.click('#settingsTabs [data-tab=export]');
  await p.evaluate(() => { document.getElementById('sessOn').click(); });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => /Включено/.test(document.getElementById('sessInfo').textContent)), 'в карточке сессии виден статус');
  await p.click('#sessNow'); await p.waitForFunction(() => /Сохранено в \d\d:\d\d: 2 фото/.test(document.getElementById('sessInfo').textContent), null, { timeout: 10000 });
  ok(true, 'кнопка «Сохранить сейчас» записала сессию, статус показывает время и число фото');
  // сохранение при сворачивании
  await p.evaluate(() => { set('quality', 61); items[0].skip = true; });
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(900);
  const saved = await p.evaluate(async () => { const d = await sessLoad(); return d && d.meta.S.quality; });
  ok(saved === 61, 'при сворачивании сессия сохраняется сразу, без ожидания паузы');
  // неожиданное закрытие: вкладка не успела сообщить о закрытии, флаг остался «1» — вторая вкладка видит это при запуске
  await p.evaluate(() => { localStorage.setItem('aspect-studio-alive', '1'); });
  const q = await ctx.newPage(); q.on('pageerror', e => errs.push(e.message)); await q.goto('http://localhost:8810/'); await q.waitForTimeout(3500);   // дольше паузы автосохранения: пустой список не должен стереть сессию
  const bn = await q.evaluate(() => ({ hidden: document.getElementById('sessBanner').hidden, text: document.getElementById('sessBannerText').textContent, btn: document.getElementById('sessRestore').textContent }));
  ok(!bn.hidden && /неожиданно/.test(bn.text) && /2 фото/.test(bn.text) && bn.btn === 'Восстановить', `после сбоя баннер: «${bn.text}»`);
  await q.click('#sessRestore'); await q.waitForFunction(() => items.length === 2, null, { timeout: 15000 });
  ok(await q.evaluate(() => S.quality === 61 && items[0].skip === true), 'восстановление вернуло фото, настройки и отметки');
  await q.reload(); await q.waitForTimeout(1200);
  ok(await q.evaluate(() => !/неожиданно/.test(document.getElementById('sessBannerText').textContent)), 'после обычного закрытия слова про сбой нет');
  ok(errs.length === 0, 'ошибок страницы нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `ПРОВАЛ: ${fail}` : 'Все проверки пройдены'); process.exit(fail ? 1 : 0);
})();
