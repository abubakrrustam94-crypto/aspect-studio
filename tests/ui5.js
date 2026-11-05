// Блок E3 (v2.52.0): интерфейс. Иконки, ряд управления на телефоне, меню «⋯», панель действий, вес на кнопке «Скачать».
// Запуск: node tests/ui5.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const FILES = [path.join(FX, 'face_astronaut.jpg'), path.join(FX, 'noface_coffee.jpg')];
async function open(b, vp, mobile) {
  const ctx = await b.newContext({ viewport: vp, isMobile: !!mobile, hasTouch: !!mobile, serviceWorkers: 'block' }); const p = await ctx.newPage(); p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
  await p.goto('http://localhost:8851/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(500);
  await p.setInputFiles('#fileInput', FILES); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(900); return p;
}
(async () => {
  await new Promise(r => server.listen(8851, r));
  const b = await chromium.launch();

  // ---- иконки и манифест ----
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const has = (purpose, size) => man.icons.some(i => i.purpose === purpose && i.sizes === size && fs.existsSync(path.join(ROOT, i.src)));
  ok(has('any', '192x192') && has('any', '512x512') && has('maskable', '192x192') && has('maskable', '512x512') && has('monochrome', '512x512'), 'манифест: иконки any, maskable (192 и 512) и monochrome есть и файлы на месте');
  ok(/rel="apple-touch-icon" href="icon-180\.png"/.test(html), 'apple-touch-icon указывает на непрозрачную icon-180.png');
  const pg0 = await (await b.newContext({ serviceWorkers: 'block' })).newPage(); await pg0.goto('http://localhost:8851/');
  const px = await pg0.evaluate(async () => { const out = {}; for (const n of ['icon-180.png', 'icon-maskable-192.png', 'icon-maskable-512.png']) { const im = new Image(); im.src = '/' + n; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const w = im.width - 1; out[n] = [[0, 0], [w, 0], [0, w], [w, w]].map(([x, y]) => g.getImageData(x, y, 1, 1).data[3]); } return out; });
  ok(Object.values(px).every(a => a.every(v => v === 255)), 'иконки для ярлыка и maskable непрозрачны по всем углам (нет белой рамки на Android)');
  await pg0.context().close();

  // ---- телефон ----
  for (const [w, h] of [[390, 844], [360, 740]]) {
    const p = await open(b, { width: w, height: h }, true);
    const m = await p.evaluate(() => {
      const over = [], vw = innerWidth, chk = sel => document.querySelectorAll(sel).forEach(e => { const r = e.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1)) over.push(sel + ':' + (e.id || e.className || e.tagName).toString().slice(0, 30)); });
      ['.top-bar *', '#orderRow > *', '.preview-head *', '#thumbsRow *', '#infoRow *'].forEach(chk);
      const hd = document.querySelector('.top-bar').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, vw, over, headH: hd.height, sub: getComputedStyle(document.querySelector('.brand-text p')).display, tbPos: getComputedStyle(toolbar).position, tbPar: toolbar.parentNode === document.body };
    });
    ok(m.sw <= m.vw && !m.over.length, `${w}px: ничего не вылезает за край экрана` + (m.over.length ? ': ' + m.over.slice(0, 4).join(', ') : ''));
    ok(m.headH < 84 && m.sub === 'none', `${w}px: шапка компактная (${Math.round(m.headH)} px, без подписи)`);
    ok(m.tbPos === 'fixed' && m.tbPar, `${w}px: панель действий плавает внизу экрана`);
    if (w === 390) {
      // меню «⋯»
      await p.click('#moreMenu > summary'); const o = await p.evaluate(() => { const pop = document.querySelector('.more-pop').getBoundingClientRect(); return { open: moreMenu.open, l: pop.left, r: pop.right, vw: innerWidth, vis: pop.width > 100 }; });
      ok(o.open && o.vis && o.l >= 0 && o.r <= o.vw, 'меню «⋯» открывается и целиком помещается в экран');
      await p.selectOption('#sortSel', 'rev'); await p.waitForTimeout(200); ok(!(await p.evaluate(() => moreMenu.open)), 'после выбора сортировки меню закрывается');
      await p.click('#moreMenu > summary'); await p.mouse.click(200, 120); await p.waitForTimeout(100); ok(!(await p.evaluate(() => moreMenu.open)), 'нажатие вне меню закрывает его');
      // превью закреплено при прокрутке
      await p.evaluate(() => { if (document.getElementById('pinBtn').getAttribute('aria-pressed') !== 'true') document.getElementById('pinBtn').click(); window.scrollTo(0, 900); }); await p.waitForTimeout(400);
      const top = await p.evaluate(() => document.getElementById('previewCard').getBoundingClientRect().top); ok(top >= 0 && top < 30, 'закреплённое превью остаётся вверху при прокрутке настроек (top=' + Math.round(top) + ')');
    }
    ok(!p.__errs.length, `${w}px: нет ошибок JS` + (p.__errs.length ? ': ' + p.__errs[0] : '')); await p.context().close();
  }

  // ---- компьютер ----
  const d = await open(b, { width: 1366, height: 820 });
  const dd = await d.evaluate(() => { const tb = toolbar.getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(), uz = document.getElementById('uploadZone').getBoundingClientRect(), fr = getComputedStyle(document.getElementById('frame')).backgroundImage; return { inCard: toolbar.parentNode === previewCard, pos: getComputedStyle(toolbar).position, below: tb.top >= st.bottom - 1, upH: uz.height, fr, shown: toolbar.classList.contains('show'), vis: tb.width > 0 }; });
  ok(dd.inCard && dd.pos === 'static' && dd.below && dd.shown && dd.vis, 'компьютер: панель «Скачать» лежит под превью и его не закрывает');
  ok(dd.upH < 80, `компьютер: зона загрузки с фото — тонкая строка (${Math.round(dd.upH)} px)`);
  ok(/conic-gradient/.test(dd.fr), 'пустое поле рядом с фото показано шашечкой, а не сплошным пятном');
  await d.waitForFunction(() => { const t = document.getElementById('tbSize'); return t && !t.hidden && /\d/.test(t.textContent); }, null, { timeout: 15000 }).catch(() => {});
  const sz = await d.evaluate(() => ({ t: document.getElementById('tbSize').textContent, h: document.getElementById('tbSize').hidden })); ok(!sz.h && /\d/.test(sz.t), 'на кнопке «Скачать» виден вес файла: «' + sz.t + '»');
  await d.setViewportSize({ width: 600, height: 800 }); await d.waitForTimeout(300);
  ok(await d.evaluate(() => toolbar.parentNode === document.body && getComputedStyle(toolbar).position === 'fixed'), 'при сужении окна панель возвращается вниз экрана');
  await d.setViewportSize({ width: 1366, height: 820 }); await d.waitForTimeout(300);
  ok(await d.evaluate(() => toolbar.parentNode === previewCard), 'при расширении окна панель снова под превью');
  // область настроек: инструменты отделены
  ok(await d.evaluate(() => !!document.querySelector('.scope-tools-label') && getComputedStyle(document.querySelector('.scope-tools-label')).display !== 'none'), 'карточка «Настройки для»: инструменты отделены подписью');
  ok(!d.__errs.length, 'компьютер: нет ошибок JS' + (d.__errs.length ? ': ' + d.__errs[0] : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
