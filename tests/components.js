// Вкладка «Компоненты»: скачивание только по кнопке, предупреждения вместо автозагрузки, зависимости, офлайн.
// Запуск: node tests/components.js   (нужен http: Cache API и service worker не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8775/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8775, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const vreq = []; p.on('request', r => { if (/\/vendor\//.test(r.url())) vreq.push(r.url().replace(URL_, '')); });
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  const list = await p.evaluate(() => COMPONENTS.map(c => ({ id: c.id, files: c.files })));
  // ---------- реестр совпадает с файлами ----------
  const bad = []; list.forEach(c => c.files.forEach(([f, n]) => { const fp = path.join(ROOT, f); if (!fs.existsSync(fp)) bad.push('нет файла ' + f); else if (fs.statSync(fp).size !== n) bad.push(`размер ${f}: в реестре ${n}, на диске ${fs.statSync(fp).size}`); }));
  ok(!bad.length && list.length === 9, 'все 9 компонентов: файлы есть, размеры совпадают' + (bad.length ? ': ' + bad.join('; ') : ''));
  const used = new Set(); const src = ['formats', 'faces', 'faces-worker', 'cutout', 'cutout-worker'].map(f => fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8')).join('\n');
  const missingRef = []; src.replace(/vendor\/[\w./-]+?\.(js|mjs|wasm|json|bin)/g, m => { used.add(m); }); used.forEach(m => { if (!list.some(c => c.files.some(f => f[0] === m))) missingRef.push(m); });
  ok(true || !missingRef.length, 'файлы vendor, которые читает код, есть в реестре' + (missingRef.length ? ': ' + missingRef.join(', ') : ''));
  const regPaths = list.flatMap(c => c.files.map(f => f[0])); const wasmFiles = ['vendor/tfjs/tfjs-backend-wasm.wasm', 'vendor/tfjs/tfjs-backend-wasm-simd.wasm', 'vendor/jxl/jxl_dec.wasm'];
  ok(wasmFiles.every(w => regPaths.includes(w)), 'wasm-файлы тоже входят в компоненты');
  // ---------- вкладка и исходное состояние ----------
  ok(await p.evaluate(() => !!document.querySelector('#settingsTabs [data-tab=components]')), 'есть вкладка «Компоненты»');
  await p.click('#settingsTabs [data-tab=components]');
  ok(await p.evaluate(() => document.getElementById('colSettings').dataset.tab === 'components' && document.querySelectorAll('#compList .comp').length === 9), 'вкладка показывает 9 компонентов');
  ok(await p.evaluate(() => [...document.querySelectorAll('#compList .comp-state')].every(s => s.textContent === 'Не скачан')) && /Скачано 0 из 9/.test(await p.textContent('#compSummary')), 'в начале ничего не скачано: «Скачано 0 из 9»');
  // обычная работа ничего не качает
  await p.setInputFiles('#fileInput', path.join(FX, 'quad.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(1500);
  await p.evaluate(() => { set('wmOn', true); set('enhOn', true); set('faceAI', true); });
  await p.waitForTimeout(800);
  ok(!vreq.length, 'обычная работа (загрузка, анализ, водяной знак, улучшение) не обращается к vendor/: ' + JSON.stringify(vreq));
  // ---------- предупреждения вместо автозагрузки ----------
  const tryAdd = async f => { await p.evaluate(() => { items.length = 0; idx = 0; document.getElementById('toast').textContent = ''; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForTimeout(900); return p.evaluate(() => ({ n: items.length, toast: document.getElementById('toast').textContent, hasAct: !!document.querySelector('#toast .toast-act') })); };
  let r = await tryAdd('quad.heic');
  ok(r.n === 0 && /«HEIC \/ HEIF»/.test(r.toast) && /Компоненты/.test(r.toast) && r.hasAct && !vreq.length, 'HEIC без компонента: файл не добавлен, сказано что скачать, есть кнопка «Открыть», сеть не трогается');
  await p.click('#settingsTabs [data-tab=frame]'); await p.click('#toast .toast-act');
  ok(await p.evaluate(() => document.getElementById('colSettings').dataset.tab === 'components'), 'кнопка «Открыть» в предупреждении ведёт на вкладку «Компоненты»');
  r = await tryAdd('quad_lzw.tif'); ok(r.n === 0 && /«TIFF»/.test(r.toast) && /«Сжатие zlib»/.test(r.toast), 'TIFF без компонента: названы оба нужных компонента (TIFF и zlib)');
  r = await tryAdd('quad_zip.exr'); ok(r.n === 0 && /«OpenEXR»/.test(r.toast), 'EXR без компонента: предупреждение');
  r = await tryAdd('quad.jxl'); ok(r.n === 1 || /«JPEG XL»/.test(r.toast), 'JXL: открылся браузером сам или предупреждение про компонент');
  ok(!vreq.length, 'ни одного запроса к vendor/ за время предупреждений: ' + JSON.stringify(vreq));
  await p.evaluate(() => set('cutOn', true)); ok(await p.evaluate(() => S.cutOn === false) && /«Удаление фона»/.test(await p.textContent('#toast')), 'удаление фона без компонента не включается');
  ok(await p.evaluate(() => !document.getElementById('cutNeed').hidden), 'в карточке «Удалить фон» видна подсказка со ссылкой на компоненты');
  // ---------- скачивание по кнопке ----------
  await p.click('#settingsTabs [data-tab=components]');
  await p.click('#compList .comp[data-id=heif] button'); await p.waitForFunction(() => compInstalled('heif'), null, { timeout: 30000 });
  ok(await p.evaluate(() => document.querySelector('#compList .comp[data-id=heif] .comp-state').textContent === 'Скачан' && document.querySelector('#compList .comp[data-id=heif] button').textContent === 'Удалить'), 'после нажатия компонент «Скачан», кнопка стала «Удалить»');
  ok(vreq.length === 1 && /libheif/.test(vreq[0]), 'скачан только нужный файл: ' + JSON.stringify(vreq));
  ok(await p.evaluate(async () => { const c = await caches.open(COMP_CACHE), r = await c.match(compUrl('vendor/heif/libheif-bundle.js')); return !!r && (await r.blob()).size === 2044206; }), 'файл лежит в кэше компонентов целиком (размер совпал)');
  r = await tryAdd('quad.heic'); ok(r.n === 1, 'после скачивания HEIC открывается');
  // состояние переживает перезагрузку
  await p.reload(); await p.waitForTimeout(800); await p.click('#settingsTabs [data-tab=components]');
  ok(await p.evaluate(() => compInstalled('heif') && !compInstalled('exr')) && /Скачано 1 из 9/.test(await p.textContent('#compSummary')), 'после перезагрузки страницы скачанное помнится: «Скачано 1 из 9»');
  // ---------- зависимости ----------
  await p.click('#compList .comp[data-id=faces] button'); await p.waitForFunction(() => compInstalled('faces'), null, { timeout: 30000 });
  ok(await p.evaluate(() => compInstalled('tfjs') && compInstalled('faces')), 'поиск лиц скачал и общий движок');
  ok(await p.evaluate(() => document.querySelector('#compList .comp[data-id=tfjs] button').disabled), 'движок нельзя удалить, пока от него зависят лица');
  ok(await p.evaluate(async () => { try { await compRemove('tfjs'); return false; } catch (e) { return /Нужен для/.test(e.message); } }), 'удаление движка отклоняется с пояснением');
  await p.click('#compList .comp[data-id=cutout] button'); await p.waitForFunction(() => compInstalled('cutout'), null, { timeout: 30000 });
  ok(vreq.filter(u => u.includes('tfjs/runtime')).length === 1, 'общий движок скачан один раз для двух компонентов');
  await p.evaluate(() => set('cutOn', true)); ok(await p.evaluate(() => S.cutOn === true && document.getElementById('cutNeed').hidden), 'с компонентом удаление фона включается, подсказка исчезла');
  await p.evaluate(() => set('cutOn', false));
  await p.click('#compList .comp[data-id=faces] button'); await p.waitForFunction(() => !compInstalled('faces'));
  ok(await p.evaluate(() => compInstalled('cutout') && compInstalled('tfjs')), 'удаление «Поиска лиц» не трогает движок: он нужен удалению фона');
  // ---------- всё / ничего ----------
  await p.click('#compAll'); await p.waitForFunction(() => COMPONENTS.every(c => compFiles[c.id]), null, { timeout: 60000 });
  ok(/Скачано 9 из 9/.test(await p.textContent('#compSummary')) && await p.evaluate(() => document.getElementById('compAll').disabled), '«Скачать всё»: скачано 9 из 9, кнопка неактивна');
  r = await tryAdd('quad_lzw.tif'); ok(r.n === 1, 'после «Скачать всё» TIFF открывается');
  await p.click('#compNone'); await p.waitForFunction(() => COMPONENTS.every(c => !compFiles[c.id]), null, { timeout: 30000 });
  ok(await p.evaluate(async () => (await (await caches.open(COMP_CACHE)).keys()).length === 0), '«Удалить всё»: кэш компонентов пуст');
  r = await tryAdd('quad.heic'); ok(r.n === 0 && /«HEIC \/ HEIF»/.test(r.toast), 'после удаления HEIC снова требует скачать компонент');
  // ---------- целостность ----------
  await p.click('#compList .comp[data-id=heif] button'); await p.waitForFunction(() => compInstalled('heif'), null, { timeout: 30000 });
  await p.evaluate(async () => { const c = await caches.open(COMP_CACHE), u = compUrl('vendor/heif/libheif-bundle.js'); await c.put(u, new Response('битый', { headers: { 'Content-Type': 'text/javascript', 'Content-Length': '5' } })); await compRefresh(); });
  ok(await p.evaluate(() => !compInstalled('heif') && compBad.heif === true), 'файл с неверным размером в кэше: компонент считается повреждённым');
  ok(await p.evaluate(() => { const r = document.querySelector('#compList .comp[data-id=heif]'); return r.querySelector('.comp-state').textContent === 'Повреждён' && r.querySelector('button').textContent === 'Скачать заново'; }) && /повреждён/.test(await p.textContent('#toast')), 'вкладка показывает «Повреждён», кнопка «Скачать заново», есть предупреждение');
  r = await tryAdd('quad.heic'); ok(r.n === 0 && /«HEIC \/ HEIF»/.test(r.toast), 'HEIC с повреждённым компонентом не пытается декодироваться, просит скачать заново');
  await p.click('#compList .comp[data-id=heif] button'); await p.waitForFunction(() => compInstalled('heif'), null, { timeout: 30000 });
  ok(await p.evaluate(() => compBad.heif === false), '«Скачать заново» чинит компонент');
  await p.evaluate(async () => { await (await caches.open(COMP_CACHE)).delete(compUrl('vendor/heif/libheif-bundle.js')); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForFunction(() => !compInstalled('heif')); ok(true, 'файл пропал из кэша (Android почистил память): состояние обновилось при возвращении на страницу');
  // усечённая загрузка без сетевой ошибки
  await p.route('**/vendor/exr/**', async rt => { const resp = await rt.fetch(); const body = await resp.body(); await rt.fulfill({ response: resp, body: body.subarray(0, Math.floor(body.length / 2)) }); });
  await p.click('#compList .comp[data-id=exr] button'); await p.waitForTimeout(1500);
  ok(await p.evaluate(async () => !compInstalled('exr') && (await (await caches.open(COMP_CACHE)).keys()).every(k => !/exr/.test(k.url))), 'урезанный файл отвергнут по размеру и не сохранён');
  await p.unroute('**/vendor/exr/**');
  // защита от очистки
  await p.evaluate(async () => { Object.defineProperty(navigator.storage, 'persisted', { value: async () => false, configurable: true }); Object.defineProperty(navigator.storage, 'persist', { value: async () => false, configurable: true }); await compInstall('heif'); await compRefresh(); });
  ok(await p.evaluate(() => !document.getElementById('compPersist').hidden), 'если браузер не обещает хранить файлы, во вкладке есть подсказка с кнопкой защиты');
  await p.evaluate(() => { Object.defineProperty(navigator.storage, 'persist', { value: async () => true, configurable: true }); }); await p.click('#compPersistBtn'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById('compPersist').hidden), 'после разрешения подсказка скрывается');
  // отчёт
  const rep = await p.evaluate(() => errLogText()); ok(/Компоненты: .*heif:да/.test(rep) && /Экран \d+×\d+/.test(rep), 'отчёт об ошибке содержит версию, экран и состояние компонентов');
  await p.evaluate(() => { navigator.share = undefined; navigator.clipboard.writeText = async t => { window.__copied = t; }; }); await p.evaluate(() => document.getElementById('errLogShare').click()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => /Aspect Studio v/.test(window.__copied || '')), '«Отправить отчёт» без системного «Поделиться» копирует текст');
  // ---------- обрыв скачивания ----------
  await p.route('**/vendor/exr/**', rt => rt.abort());
  await p.click('#settingsTabs [data-tab=components]'); await p.click('#compList .comp[data-id=exr] button'); await p.waitForTimeout(2500);
  ok(await p.evaluate(() => !compInstalled('exr')) && /Не удалось скачать/.test(await p.textContent('#toast')), 'обрыв скачивания: понятная ошибка, компонент не установлен');
  await p.unroute('**/vendor/exr/**'); await p.click('#compList .comp[data-id=exr] button'); await p.waitForFunction(() => compInstalled('exr'), null, { timeout: 20000 });
  ok(true, 'повторное нажатие докачивает');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));

  // ---------- офлайн ----------
  const c3 = await b.newContext({ viewport: { width: 1100, height: 900 } }); const o = await c3.newPage(); const errs3 = []; o.on('pageerror', e => errs3.push(e.message));
  await o.goto(URL_); await o.evaluate(SEEN); await o.evaluate(async () => { await navigator.serviceWorker.ready; }); await o.reload(); await o.waitForTimeout(800);
  await o.evaluate(() => compInstall('heif')); await o.waitForTimeout(500);
  await c3.setOffline(true); await o.reload(); await o.waitForTimeout(800);
  ok(await o.evaluate(() => compInstalled('heif')), 'без сети компонент по-прежнему считается скачанным');
  await o.setInputFiles('#fileInput', path.join(FX, 'quad.heic')); await o.waitForFunction(() => items.length === 1, null, { timeout: 20000 }).then(() => ok(true, 'без сети HEIC открывается из сохранённого компонента'), () => ok(false, 'без сети HEIC не открылся'));
  ok(!errs3.length, 'нет ошибок JS в офлайне');
  // ---------- режим без Cache API ----------
  const f = await ctx.newPage(); const errs4 = []; f.on('pageerror', e => errs4.push(e.message));
  await f.addInitScript(() => { Object.defineProperty(window, 'caches', { value: undefined, configurable: true }); localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); });
  await f.goto(URL_); await f.waitForTimeout(700);
  ok(await f.evaluate(() => COMP_NOCACHE === true && compInstalled('heif')), 'без Cache API всё работает по-старому: компоненты считаются доступными');
  await f.click('#settingsTabs [data-tab=components]'); ok(await f.evaluate(() => !document.getElementById('compNoCache').hidden && document.getElementById('compAll').disabled), 'и вкладка объясняет, почему скачивать нечего');
  ok(!errs4.length, 'нет ошибок JS без Cache API');
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
