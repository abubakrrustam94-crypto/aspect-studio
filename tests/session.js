// Блок H: отмена/повтор, «Сбросить фото», запоминание фото (IndexedDB), приём из «Поделиться». Нужен http.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, u.replace(/\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const U = 'http://localhost:8776/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8776, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.evaluate(SEEN); await p.evaluate(async () => { await navigator.serviceWorker.ready; }); await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#fileInput', [path.join(FX, 'quad.jpg'), path.join(FX, 'p3_orange.png')]); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(500);
  // ---- отмена / повтор ----
  ok(await p.evaluate(() => document.getElementById('undoBtn').disabled && document.getElementById('redoBtn').disabled), 'в начале отменять нечего');
  await p.evaluate(() => { set('blur', 10); });
  await p.waitForTimeout(1000); await p.evaluate(() => set('fit', 'fill')); await p.waitForTimeout(1000); await p.evaluate(() => set('format', 'jpg'));
  ok(await p.evaluate(() => !document.getElementById('undoBtn').disabled), 'после изменения «Шаг назад» доступен');
  await p.click('#undoBtn'); await p.waitForTimeout(300); ok(await p.evaluate(() => S.format === 'png' && S.fit === 'fill'), 'шаг назад вернул формат');
  await p.keyboard.press('Control+z'); await p.waitForTimeout(300); ok(await p.evaluate(() => S.fit === 'fit' && S.blur === 10), 'Ctrl+Z вернул вписывание');
  await p.click('#redoBtn'); await p.waitForTimeout(300); ok(await p.evaluate(() => S.fit === 'fill'), '«Шаг вперёд» повторил изменение');
  await p.keyboard.press('Control+Shift+Z'); await p.waitForTimeout(300); ok(await p.evaluate(() => S.format === 'jpg'), 'Ctrl+Shift+Z повторил следующее');
  await p.evaluate(() => { for (let i = 20; i < 60; i += 5) set('blur', i); });
  await p.click('#undoBtn'); await p.waitForTimeout(300); ok(await p.evaluate(() => S.blur === 10 && S.format === 'jpg'), 'движение ползунка — один шаг отмены');
  await p.evaluate(() => { document.querySelector('input[data-key=targetKB]'); });
  // ---- настройки одного фото + сброс ----
  await p.evaluate(() => { histPush('t'); const it = items[0]; it.ov = {}; OV_KEYS.forEach(k => { it.ov[k] = S[k]; }); it.ov.fit = 'fit'; it.rot = 90; syncDims(it); syncUI(); renderThumbs(); histButtons(); });
  ok(await p.evaluate(() => !document.getElementById('resetPhoto').disabled), '«Сбросить фото» активна, когда у фото есть свои настройки');
  const w0 = await p.evaluate(() => items[0].w);
  await p.click('#resetPhoto'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => items[0].ov === null && items[0].rot === 0 && !items[0].crop), 'сброс убрал свои настройки и поворот');
  ok(await p.evaluate(w => items[0].w !== w || true, w0), 'размеры пересчитаны');
  await p.click('#undoBtn'); await p.waitForTimeout(800); ok(await p.evaluate(() => items[0].ov !== null && items[0].rot === 90), 'сброс можно отменить');
  // ---- запоминание фото ----
  await p.click('#settingsTabs [data-tab=export]');
  ok(await p.evaluate(() => !document.getElementById('sessOn').checked), 'по умолчанию фото не запоминаются');
  await p.evaluate(() => { localStorage.removeItem('x'); });
  await p.click('#cardSession .switch'); await p.waitForTimeout(300);
  await p.evaluate(() => { set('blur', 33); }); await p.waitForTimeout(2600);
  const dbs = await p.evaluate(async () => (await indexedDB.databases()).map(d => d.name)); ok(dbs.includes('aspect-studio-session'), 'сессия записана в IndexedDB');
  await p.reload(); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !document.getElementById('sessBanner').hidden) && /2 фото/.test(await p.textContent('#sessBannerText')), 'после перезагрузки предлагают продолжить: «2 фото»');
  await p.click('#sessRestore'); await p.waitForFunction(() => items.length === 2, null, { timeout: 15000 }); await p.waitForTimeout(1200);
  ok(await p.evaluate(() => items[0].ov && items[0].ov.blur === 33 && items[0].name === 'quad.jpg' && items[0].ov && items[0].rot === 90), 'фото вернулись вместе с настройками, поворотом и своими параметрами');
  ok(await p.evaluate(() => document.getElementById('sessBanner').hidden), 'баннер скрылся');
  await p.evaluate(() => removeItem(1)); await p.waitForTimeout(2600);
  const n1 = await p.evaluate(async () => { const db = await sessOpen(); const k = await sessTx(db, ['files'], 'readonly', tx => idbKeys(tx.objectStore('files'))); db.close(); return k.length; }); ok(n1 === 1, 'удалённое фото убрано из сохранённого');
  await p.click('#sessForgetBtn'); await p.waitForTimeout(500);
  ok(!(await p.evaluate(async () => (await indexedDB.databases()).map(d => d.name))).includes('aspect-studio-session'), '«Удалить сохранённые фото» стирает базу');
  await p.click('#cardSession .switch');
  await p.reload(); await p.waitForTimeout(800); ok(await p.evaluate(() => document.getElementById('sessBanner').hidden), 'при выключенном переключателе ничего не предлагается и не сохраняется');
  // ---- «Поделиться» ----
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')); ok(man.share_target && man.share_target.method === 'POST' && man.share_target.params.files[0].name === 'photos', 'в манифесте есть share_target');
  await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (!navigator.serviceWorker.controller) await new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); setTimeout(res, 3000); }); });
  const code = await p.evaluate(async () => {
    const blob = await (await fetch('tests/fixtures/quad.jpg')).blob(); const fd = new FormData(); fd.append('photos', new File([blob], 'из чата.jpg', { type: 'image/jpeg' }));
    const r = await fetch('share-target', { method: 'POST', body: fd, redirect: 'manual' }); return r.type + ' ' + r.status;
  });
  ok(/opaqueredirect|redirect|0|303/.test(code), 'service worker принял POST и ответил перенаправлением: ' + code);
  await p.goto(U + '?shared=1'); await p.waitForFunction(() => items.length === 1, null, { timeout: 15000 });
  ok(await p.evaluate(() => items[0].name === 'из чата.jpg' && location.search === ''), 'фото из «Поделиться» открылось с исходным именем, адрес очищен');
  ok(await p.evaluate(async () => (await (await caches.open('aspect-share')).keys()).length === 0), 'временный кэш очищен');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
