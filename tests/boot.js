// Сбой загрузки скриптов: догрузка и понятное сообщение.
// Запуск: node tests/boot.js
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
  await new Promise(r => server.listen(8802, r));
  const b = await chromium.launch();
  const run = async (name, setup, check) => {
    const ctx = await b.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: 'block' }); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); });
    await setup(p); await p.goto('http://localhost:8802/'); await p.waitForTimeout(4500);
    await check(p, errs); await ctx.close();
  };
  // 1) один сбой: файл догружается сам
  let hits = 0;
  await run('once', async p => { await p.route('**/js/session.js*', r => { if (hits++ < 1 && !/retry=/.test(r.request().url())) r.abort('connectionreset'); else r.continue(); }); }, async p => {
    ok(await p.evaluate(() => typeof histPush === 'function'), 'после одного сбоя загрузки session.js догружен автоматически');
    ok(await p.$('.boot-fail') === null, 'сообщение об ошибке не показано, раз всё догрузилось');
    ok(await p.evaluate(() => { try { set('fit', 'fill'); return true; } catch (e) { return false; } }), 'настройки работают без ReferenceError');
  });
  // 2) постоянный сбой: честное сообщение с кнопкой
  await run('always', async p => { await p.route('**/js/session.js*', r => r.abort('connectionreset')); }, async p => {
    const bar = await p.$('.boot-fail'); ok(!!bar, 'при постоянном сбое показано сообщение');
    const txt = bar ? await bar.textContent() : ''; ok(/session\.js/.test(txt) && /Обновить/.test(txt), 'в сообщении названа проблемная часть и есть кнопка «Обновить»: ' + txt.slice(0, 80));
  });
  // 3) всё в порядке: ничего лишнего
  await run('fine', async () => {}, async (p, errs) => {
    ok(await p.$('.boot-fail') === null && await p.evaluate(() => typeof histPush === 'function'), 'без сбоев всё как обычно');
    ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  });
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
