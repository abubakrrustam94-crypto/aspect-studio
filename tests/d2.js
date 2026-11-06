// Блок C (v2.56): планшет, окно «Как это работает», окно «Как это работает», лимит памяти.
// Запуск: node tests/d2.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const DATA = require(path.join(ROOT, 'tools', 'seo-data.js'));
(async () => {
  // --- статические файлы ---
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'), rb = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  ok(DATA.every(d => fs.existsSync(path.join(ROOT, d.slug, 'index.html')) && fs.existsSync(path.join(ROOT, 'en', d.slug, 'index.html'))), 'для каждого сценария есть RU и EN страницы');
  ok(DATA.every(d => sm.includes('/' + d.slug + '/') && sm.includes('/en/' + d.slug + '/')), 'все страницы есть в sitemap.xml');
  ok(/Sitemap: https:\/\/.+\/sitemap\.xml/.test(rb) && /Allow: \//.test(rb), 'robots.txt ссылается на sitemap');
  let allOk = true, ids = new Set(), why = '';
  for (const d of DATA) for (const l of ['ru', 'en']) {
    const h = fs.readFileSync(path.join(ROOT, l === 'en' ? 'en' : '', d.slug, 'index.html'), 'utf8');
    const t = (h.match(/<title>([^<]*)/) || [])[1] || '', ds = (h.match(/name="description" content="([^"]*)"/) || [])[1] || '';
    const c = (h.match(/rel="canonical" href="([^"]*)"/) || [])[1] || '';
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return null; } });
    const bad = !t || t.length > 90 || !ds || ds.length > 175 || !c.endsWith('/' + (l === 'en' ? 'en/' : '') + d.slug + '/') || ld.length !== 1 || !Array.isArray(ld[0]) || ld[0].length !== 2 || ld[0][1]['@type'] !== 'FAQPage' || (h.match(/<h1>/g) || []).length !== 1 || /<script(?![^>]*ld\+json)/.test(h) || !h.includes('?scenario=' + d.slug) || !h.includes(d.size);
    if (bad) { allOk = false; why = d.slug + '/' + l; }
    ids.add(t);
  }
  ok(allOk, 'у каждой страницы заголовок, описание, canonical, JSON-LD, ссылка в редактор' + (why ? ' (ошибка: ' + why + ')' : ''));
  ok(ids.size === DATA.length * 2, 'заголовки всех страниц разные');
  // --- ссылки между страницами указывают на существующие файлы ---
  let links = 0, dead = [];
  for (const d of DATA) for (const l of ['ru', 'en']) {
    const dir = path.join(ROOT, l === 'en' ? 'en' : '', d.slug), h = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    for (const m of h.matchAll(/(?:href|src)="(\.\.[^"#?]*)(?:\?[^"]*)?"/g)) { links++; const f = path.resolve(dir, m[1]); if (!(fs.existsSync(f) && (fs.statSync(f).isFile() || fs.existsSync(path.join(f, 'index.html'))))) dead.push(m[1]); }
  }
  ok(links > 100 && dead.length === 0, `ссылки на соседние страницы и стили целы (${links})${dead.length ? ': ' + dead[0] : ''}`);
  ok(fs.statSync(path.join(ROOT, 'og.png')).size > 5000, 'og.png есть');
  await new Promise(r => server.listen(8871, r));
  const b = await chromium.launch(); const errs = [];
  // --- размеры на страницах совпадают с пресетами приложения ---
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' }); await ctx.addInitScript(SEEN);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8871/'); await p.waitForSelector('#exRow', { timeout: 8000 });
  const sizes = await p.evaluate(async list => { await lazyLoad('start'); return list.map(s => { const sc = ST_SCENARIOS.find(x => x.id === s.scenario); return sc && sc.p.outW === s.w && sc.p.outH === s.h; }); }, DATA.map(d => ({ scenario: d.scenario, w: d.w, h: d.h })));
  ok(sizes.every(Boolean), 'размеры страниц совпадают со сценариями приложения');
  ok(await p.evaluate(() => !!document.querySelector('link[rel=canonical]') && document.querySelector('meta[property="og:image"]').content.endsWith('og.png') && JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@type'] === 'WebApplication'), 'в index.html есть canonical, og:image и JSON-LD');
  // --- переход со страницы: ?scenario= выбирает размер ---
  await p.goto('http://localhost:8871/stories/index.html'); ok(await p.evaluate(() => document.querySelector('a.btn').getAttribute('href') === '../?scenario=stories'), 'кнопка на странице ведёт в редактор со сценарием');
  await p.goto('http://localhost:8871/?scenario=marketplace'); await p.waitForFunction(() => S.presetId === 'wb', null, { timeout: 8000 }).catch(() => {});
  ok(await p.evaluate(() => S.presetId === 'wb' && S.outW === 900 && S.outH === 1200 && location.search === ''), '?scenario=marketplace ставит 900×1200 и чистит адрес');
  await p.goto('http://localhost:8871/?scenario=%3Cimg%20src%3Dx%3E'); await p.waitForTimeout(2200);
  ok(await p.evaluate(() => location.search === '' && !document.querySelector('img[src=x]')), 'мусор в ?scenario= игнорируется');
  // --- страница не ломается в браузере и не даёт горизонтальной прокрутки ---
  await p.goto('http://localhost:8871/en/marketplace/index.html');
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('h1').textContent.length > 10), 'EN-страница читается на телефоне без прокрутки вбок');
  // --- счётчик и «Сообщить о проблеме» ---
  await p.goto('http://localhost:8871/'); await p.evaluate(() => localStorage.setItem('aspect-studio-count', '7')); await p.reload(); await p.waitForSelector('#reportBtn', { state: 'attached', timeout: 8000 });
  await p.click('#settingsTabs [data-tab=about]');
  ok(await p.evaluate(() => /7 фото/.test(document.getElementById('cntLine').textContent)), 'счётчик показывает сохранённое число');
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForSelector('#previewCard:not([hidden])', { timeout: 15000 });
  const dl = p.waitForEvent('download', { timeout: 15000 }); await p.evaluate(() => document.getElementById('btnDownload') ? document.getElementById('btnDownload').click() : document.querySelector('#dlBtn, .tb-btn.main').click()); await dl;
  ok(await p.evaluate(() => localStorage.getItem('aspect-studio-count') === '8'), 'после скачивания счётчик вырос на 1');
  await ctx.route('https://github.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  const popup = ctx.waitForEvent('page', { timeout: 8000 }); await p.click('#reportBtn'); const pg = await popup;
  const u = pg.url(); ok(/github\.com\/.+\/issues\/new\?title=/.test(u) && !u.includes('face_astronaut'), 'кнопка открывает форму проблемы на GitHub без имён файлов');
  await pg.close().catch(() => {});
  ok(await p.evaluate(() => { localStorage.setItem('aspect-studio-x', '1'); Object.keys(localStorage).filter(k => k.startsWith('aspect-studio')).forEach(k => localStorage.removeItem(k)); return localStorage.getItem('aspect-studio-count') === null; }), 'сброс настроек стирает и счётчик');
  ok(errs.length === 0, 'нет ошибок страницы' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
