// Компоненты в файлах сайта (OPFS), перенос из кэша и фоновая загрузка (Background Fetch).
// Запуск: node tests/opfs.js   (нужен http)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8786/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const LIST = `async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('aspect-components', { create: true }), out = {}; for await (const [n, h] of d.entries()) out[decodeURIComponent(n)] = (await h.getFile()).size; return out; }`;
const CACHED = `async () => (await (await caches.open(COMP_CACHE)).keys()).map(k => k.url.replace(location.origin + '/', ''))`;
(async () => {
  await new Promise(r => server.listen(8786, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  ok(await p.evaluate(() => compStoreMode() === 'opfs' && COMP_OPFS), 'по умолчанию компоненты хранятся в файлах сайта (OPFS)');
  await p.evaluate(() => compInstall('heif'));
  const l1 = await p.evaluate(`(${LIST})()`), c1 = await p.evaluate(`(${CACHED})()`);
  const size = fs.statSync(path.join(ROOT, 'vendor/heif/libheif-bundle.js')).size;
  ok(l1['vendor/heif/libheif-bundle.js'] === size && c1.length === 0, 'файл лежит в OPFS (' + size + ' байт), в Cache Storage пусто');
  ok(await p.evaluate(() => compInstalled('heif')), 'компонент считается скачанным');
  await p.reload(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => compInstalled('heif')), 'после перезагрузки страницы он по-прежнему скачан');
  // неполный файл
  await p.evaluate(async () => { const d = await opfsDir(), w = await (await d.getFileHandle(opfsName('vendor/exr/parse-exr.js'), { create: true })).createWritable(); await w.write(new Uint8Array(100)); await w.close(); await compRefresh(); });
  ok(await p.evaluate(() => !compInstalled('exr') && compBad.exr === true), 'неполный файл в OPFS: компонент «Повреждён», не считается скачанным');
  await p.evaluate(() => compInstall('exr')); ok(await p.evaluate(() => compInstalled('exr') && !compBad.exr), 'повторное скачивание чинит его');
  // удаление
  await p.evaluate(async () => { await compRemove('heif'); await compRemove('exr'); });
  ok(Object.keys(await p.evaluate(`(${LIST})()`)).length === 0, 'удаление убирает файлы из OPFS');
  // отмена посреди скачивания: недокачанного не остаётся
  await p.route('**/vendor/pdfjs/pdf.worker.min.mjs', async r => { await new Promise(x => setTimeout(x, 1500)); r.continue().catch(() => {}); });
  const dl = p.evaluate(() => compInstall('pdf').then(() => 'ok', e => e.name));
  await p.waitForFunction(() => compBusy.pdf); await p.waitForTimeout(300); await p.evaluate(() => compAbort.pdf.abort());
  ok((await dl) === 'AbortError' && !(await p.evaluate(() => compInstalled('pdf'))), 'отмена: ошибка AbortError, компонент не скачан');
  const l2 = await p.evaluate(`(${LIST})()`); ok(!('vendor/pdfjs/pdf.worker.min.mjs' in l2), 'после отмены недокачанного файла в OPFS нет');
  await p.unroute('**/vendor/pdfjs/pdf.worker.min.mjs');
  // перенос из кэша
  await p.evaluate(() => localStorage.setItem('aspect-studio-compstore', 'cache')); await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(() => compInstall('exr')); ok((await p.evaluate(`(${CACHED})()`)).length === 1 && Object.keys(await p.evaluate(`(${LIST})()`)).length === 0, 'режим «кэш» (старый браузер): файл ушёл в Cache Storage');
  await p.evaluate(() => localStorage.removeItem('aspect-studio-compstore')); await p.reload(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => compInstalled('exr') && compOld.exr === true), 'скачанное раньше в кэш продолжает работать и помечено «старое»');
  await p.click('#settingsTabs [data-tab=components]');
  ok(!(await p.$eval('#compOldNote', e => e.hidden)), 'вкладка предлагает перенести компоненты из кэша');
  await p.click('#compMigrate'); await p.waitForFunction(() => !compOld.exr && compFiles.exr, null, { timeout: 15000 });
  await p.waitForFunction(() => document.getElementById('compOldNote').hidden);
  ok((await p.evaluate(`(${CACHED})()`)).length === 0 && (await p.evaluate(`(${LIST})()`))['vendor/exr/parse-exr.js'] === fs.statSync(path.join(ROOT, 'vendor/exr/parse-exr.js')).size, 'перенос: файл в OPFS, кэш пуст, подсказка скрыта');
  await p.evaluate(() => compRemove('exr'));
  ok(!errs.length, 'нет ошибок JS (без service worker)' + (errs.length ? ': ' + errs.join('; ') : ''));
  await ctx.close();
  // ---------- с service worker: отдача из OPFS и фоновая загрузка ----------
  const ctx2 = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'allow' });
  const q = await ctx2.newPage(); const errs2 = []; q.on('pageerror', e => errs2.push(e.message));
  await q.goto(URL_); await q.evaluate(SEEN); await q.reload(); await q.evaluate(() => navigator.serviceWorker.ready); await q.waitForTimeout(800);
  const bgOk = await q.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.backgroundFetch); });
  console.log('  Background Fetch в этом браузере:', bgOk ? 'есть' : 'нет (проверяю запасной путь)');
  await q.evaluate(() => { window.__bg = 0; if (navigator.serviceWorker.getRegistration) { navigator.serviceWorker.getRegistration().then(r => { if (r && r.backgroundFetch) { const f = r.backgroundFetch.fetch.bind(r.backgroundFetch); r.backgroundFetch.fetch = (...a) => { window.__bg++; return f(...a); }; } }); } });
  await q.evaluate(() => { window.COMP_BG_STALL_MS = 2500; });
  const res = await q.evaluate(() => compInstall('exr').then(() => 'ok', e => e.name + ':' + e.message));
  ok(res === 'ok' && await q.evaluate(() => compInstalled('exr')), 'скачивание с включённым service worker завершилось: ' + res);
  const bgUsed = await q.evaluate(() => window.__bg);
  console.log('  фоновая загрузка запускалась:', bgUsed ? 'да (в headless Chromium она не качает, сработал откат на загрузку из страницы)' : 'нет');
  ok(!bgOk || bgUsed >= 1, 'при поддержке Background Fetch загрузка пошла через него (и откатилась, когда не сдвинулась с места)');
  const l3 = await q.evaluate(`(${LIST})()`); ok(l3['vendor/exr/parse-exr.js'] === fs.statSync(path.join(ROOT, 'vendor/exr/parse-exr.js')).size, 'файл лежит в OPFS нужного размера');
  const served = await q.evaluate(async () => { const r = await fetch('vendor/exr/parse-exr.js'); const t = await r.text(); return { ok: r.ok, len: t.length, ct: r.headers.get('content-type') }; });
  ok(served.ok && served.ct.includes('javascript') && served.len > 1000, 'service worker отдаёт файл из OPFS: ' + served.ct);
  ok(!errs2.length, 'нет ошибок JS (с service worker)' + (errs2.length ? ': ' + errs2.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
