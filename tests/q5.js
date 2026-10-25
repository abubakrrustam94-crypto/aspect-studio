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
  await new Promise(r => server.listen(8790, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.addInitScript(() => { navigator.canShare = () => true; window.__shared = []; window.__abortOnce = true; navigator.share = async d => { if (window.__abortOnce && d.files && d.files.length > 1) { window.__abortOnce = false; throw Object.assign(new Error('x'), { name: 'AbortError' }); } window.__shared.push(...(d.files || []).map(f => f.name)); }; });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8790/'); await p.evaluate(SEEN); await p.evaluate(() => localStorage.removeItem('aspect-studio-theme')); await p.reload(); await p.waitForTimeout(600);
  // ---------- тема ----------
  const th = () => p.evaluate(() => [document.documentElement.dataset.theme, themePref, !!document.querySelector('#themeToggle .theme-a'), localStorage.getItem('aspect-studio-theme')]);
  let t = await th(); ok(t[0] === 'light' && t[1] === 'auto' && t[2], 'по умолчанию «как в системе»: светлая при светлой системе, значок A есть');
  await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(100); t = await th(); ok(t[0] === 'dark' && t[1] === 'auto', 'смена темы системы подхватывается на лету');
  await p.click('#themeToggle'); t = await th(); ok(t[1] === 'light' && t[0] === 'light' && !t[2] && t[3] === 'light', 'первое нажатие: светлая, значка A нет');
  await p.click('#themeToggle'); t = await th(); ok(t[1] === 'dark' && t[0] === 'dark' && t[3] === 'dark', 'второе: тёмная');
  await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(100); t = await th(); ok(t[0] === 'dark', 'при явном выборе система тему не меняет');
  await p.click('#themeToggle'); t = await th(); ok(t[1] === 'auto' && t[0] === 'light' && t[2] && t[3] === 'auto', 'третье: снова «как в системе»');
  ok((await p.getAttribute('#themeToggle', 'title')).includes('как в системе'), 'подсказка кнопки называет режим');
  await p.click('#themeToggle'); await p.reload(); await p.waitForTimeout(500); t = await th(); ok(t[1] === 'light', 'выбор запоминается после перезагрузки');
  // ---------- защита от рассинхрона ----------
  await p.evaluate(() => { document.getElementById('dnNote').remove(); document.getElementById('bundleNote').remove(); document.getElementById('compBgRow') && document.getElementById('compBgRow').remove(); });
  const miss = await p.evaluate(() => { try { $('#нет-такого').addEventListener('click', () => {}); $('#нет-такого').textContent = 'x'; syncUI(); renderErrLog(); return [...MISSING_IDS]; } catch (e) { return 'ERR ' + e.message; } });
  ok(Array.isArray(miss) && miss.includes('#нет-такого'), 'отсутствующие элементы не роняют страницу: ' + JSON.stringify(miss));
  ok((await p.evaluate(() => errLogText())).includes('Нет элементов в index.html'), 'журнал ошибок называет недостающие элементы');
  // ---------- свайпы ----------
  await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#fileInput', ['dn_noisy.png', 'dn_clean.png', 'er_scene.png'].map(f => path.join(FX, f))); await p.waitForFunction(() => items.length === 3); await p.waitForTimeout(500);
  const swipe = (sel, dx, dy = 0, type = 'touch', dt = 150) => p.evaluate(async ([sel, dx, dy, type, dt]) => {
    const el = document.querySelector(sel), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 30);
    const mk = (n, X, Y) => new PointerEvent(n, { bubbles: true, cancelable: true, pointerId: 7, pointerType: type, clientX: X, clientY: Y, isPrimary: true });
    el.dispatchEvent(mk('pointerdown', x, y)); await new Promise(r => setTimeout(r, dt)); el.dispatchEvent(mk('pointerup', x + dx, y + dy)); return idx; }, [sel, dx, dy, type, dt]);
  await p.evaluate(() => select(0));
  ok(await swipe('.preview-head', -120) === 1, 'свайп влево по шапке предпросмотра: следующее фото');
  ok(await swipe('.preview-head', 120) === 0, 'свайп вправо: предыдущее');
  ok(await swipe('.preview-head', 120) === 0, 'на первом фото свайп вправо ничего не ломает');
  ok(await swipe('.preview-head', -30) === 0, 'короткое движение не листает');
  ok(await swipe('.preview-head', -120, 150) === 0, 'больше вниз, чем в сторону: не листает');
  ok(await swipe('.preview-head', -120, 0, 'mouse') === 0, 'мышь не листает');
  ok(await swipe('.preview-head', -120, 0, 'touch', 1500) === 0, 'долгое медленное движение не листает');
  await p.evaluate(() => { set('view', 'slider'); set('fit', 'fit'); });
  ok(await swipe('#frame', -120) === 0, 'внутри кадра в режиме слайдера свайп не листает (двигает границу)');
  await p.evaluate(() => { set('view', 'after'); set('fit', 'fit'); });
  ok(await swipe('#frame', -120) === 1, 'в режиме «После» свайп по кадру листает');
  await p.evaluate(() => { set('fit', 'fill'); });
  ok(await swipe('#frame', -120) === 1, 'при «Заполнить» кадр можно сдвигать, листание отключено');
  await p.evaluate(() => { set('view', 'slider'); set('fit', 'fit'); });
  // ---------- в галерею ----------
  ok(!(await p.$eval('#btnGallery', e => e.hidden)), 'при нескольких фото кнопка «В галерею» есть');
  await p.evaluate(() => { set('enhOn', false); S.format = 'png'; S.maxSide = 8192; });
  await p.click('#btnGallery'); await p.waitForFunction(() => document.querySelector('#toast .toast-act') && /Готово: 3 файлов/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
  ok(await p.evaluate(() => items.every(i => i.status === 'ok')), 'файлы подготовлены, у фото статус «готово»');
  await p.click('#toast .toast-act'); await p.waitForFunction(() => document.querySelector('#toast .toast-act') && window.__abortOnce === false, null, { timeout: 5000 });
  ok(await p.evaluate(() => window.__shared.length === 0), 'закрыли системное меню: файлы не потеряны, кнопка предложена снова');
  await p.click('#toast .toast-act'); await p.waitForFunction(() => window.__shared.length === 3, null, { timeout: 5000 });
  ok(await p.evaluate(() => window.__shared.every(n => /\.png$/.test(n))), 'в «Поделиться» ушло 3 файла: ' + (await p.evaluate(() => window.__shared.join(', '))));
  await p.evaluate(() => { window.__shared = []; set('bundle', 'video'); });
  ok((await p.textContent('#galLabel')).includes('×2'), 'с набором размеров на кнопке «×2»');
  await p.click('#btnGallery'); await p.waitForFunction(() => document.querySelector('#toast .toast-act') && /Готово: 6 файлов/.test(document.getElementById('toast').textContent), null, { timeout: 90000 });
  await p.click('#toast .toast-act'); await p.waitForFunction(() => window.__shared.length === 6, null, { timeout: 5000 }); ok(true, 'набор размеров: в галерею ушло 6 файлов');
  await p.evaluate(() => { set('bundle', 'off'); items.splice(1); idx = 0; updateChrome(); });
  ok(await p.$eval('#btnGallery', e => e.hidden), 'с одним фото кнопка скрыта (есть обычное «Поделиться»)');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
