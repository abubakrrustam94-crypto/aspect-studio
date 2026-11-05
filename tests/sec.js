// Блок E2 (v2.51.3): безопасность. Проверка настроек извне, защита от встраивания, политика стилей, PDF без eval, CI.
// Запуск: node tests/sec.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
process.env.CSP_WATCH_OFF = '1';          // тест намеренно нарушает политику (вставляет <style>), чтобы убедиться, что она блокирует
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8853, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8853/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(500);

  // ---- 1. проверка настроек ----
  const u = await p.evaluate(() => {
    const t = o => sanitizeSettings(o), poisoned = JSON.parse('{"__proto__":{"polluted":1},"quality":77}');
    const r = {
      big: t({ maxSide: 1e9 }).maxSide, neg: t({ outW: -5 }).outW, nan: 'blur' in t({ blur: NaN }), str: 'quality' in t({ quality: '80' }),
      fmt: 'format' in t({ format: 'evil' }), fmtOk: t({ format: 'webp' }).format, hexBad: 'color' in t({ color: 'red;background:url(//x)' }), hexOk: t({ color: '#a1B2c3' }).color,
      long: 'nameTpl' in t({ nameTpl: 'x'.repeat(5000) }), foreign: 'hack' in t({ hack: 1 }), q: t(poisoned).quality, protoLeak: ({}).polluted, hasPolluted: t(poisoned).polluted,
      arr: Object.keys(t([1, 2])).length, nul: Object.keys(t(null)).length, bool: 'depthOn' in t({ depthOn: 'yes' }), inRange: t({ maxSide: 4096, quality: 100 }),
    };
    // все стандартные значения проходят проверку без потерь (иначе таблица допустимых значений рассыпалась бы с новой настройкой)
    r.defaultsLost = Object.keys(DEFAULTS).filter(k => !(k in sanitizeSettings(DEFAULTS)));
    return r;
  });
  ok(u.big === undefined && u.neg === undefined && !u.nan && !u.str, 'числа вне пределов, NaN и числа-строки отбрасываются');
  ok(!u.fmt && u.fmtOk === 'webp', 'неизвестное значение из списка («format: evil») отбрасывается, правильное проходит');
  ok(!u.hexBad && u.hexOk === '#a1B2c3', 'цвет принимается только в виде #RRGGBB (без вставки CSS)');
  ok(!u.long && !u.foreign && !u.bool, 'слишком длинный текст, чужие ключи и неверный тип отбрасываются');
  ok(u.q === 77 && u.protoLeak === undefined && !u.hasPolluted, 'ключ __proto__ из JSON не портит прототипы');
  ok(u.arr === 0 && u.nul === 0, 'массив и null вместо настроек дают пустой результат');
  ok(u.defaultsLost.length === 0, 'все стандартные настройки проходят проверку' + (u.defaultsLost.length ? ': потеряны ' + u.defaultsLost.join(',') : ''));

  // ---- 2. подсунутые настройки в localStorage: сайт открывается, плохое значение заменено ----
  const key = await p.evaluate(() => STORE_KEY);
  await p.evaluate(k => localStorage.setItem(k, '{"maxSide":1000000000,"quality":5000,"format":"x","outW":-1,"blur":40,"__proto__":{"z":1}}'), key);
  await p.reload(); await p.waitForTimeout(500);
  const s2 = await p.evaluate(() => ({ m: S.maxSide, q: S.quality, f: S.format, w: S.outW, bl: S.blur, proto: Object.getPrototypeOf(S) === Object.prototype, z: S.z }));
  ok(s2.m === 4096 && s2.q === 92 && s2.f === 'png' && s2.w === 1920, `испорченные значения заменены стандартными (${s2.m}, ${s2.q}, ${s2.f}, ${s2.w})`);
  ok(s2.bl === 40 && s2.proto && s2.z === undefined, 'правильное значение сохранено, прототип настроек не тронут');

  // ---- 3. файл настроек и набор ----
  await p.evaluate(() => lazyLoad('backup'));
  const bk = await p.evaluate(() => { const ok1 = bkImportText(JSON.stringify({ app: 'aspect-studio', kind: 'settings', S: { maxSide: 99999999, quality: 80, format: 'jpg', color: 'javascript:1' } })); return { ok1, m: S.maxSide, q: S.quality, f: S.format, c: S.color }; });
  ok(bk.ok1 && bk.q === 80 && bk.f === 'jpg' && bk.m === 4096 && bk.c === '#000000', 'файл настроек: правильное применено, maxSide=99999999 и чужой цвет отброшены');
  const ps = await p.evaluate(() => parsePresetsFile(JSON.stringify([{ name: 'ok', cfg: { quality: 70, maxSide: -1 } }, { name: 'bad', cfg: { maxSide: 1e12 } }])));
  ok(ps.length === 1 && ps[0].cfg.quality === 70 && !('maxSide' in ps[0].cfg), 'файл наборов: пустой после проверки набор выброшен, у остального плохие числа убраны');

  // ---- 4. политика стилей ----
  const csp = await p.evaluate(async () => {
    const viol = []; document.addEventListener('securitypolicyviolation', e => viol.push(e.violatedDirective + '|' + e.blockedURI));
    const st = document.createElement('style'); st.textContent = 'body{outline:5px solid red}'; document.head.appendChild(st);
    await new Promise(r => setTimeout(r, 200));
    const blocked = getComputedStyle(document.body).outlineStyle === 'none';
    applyAccent('blue'); const prim = getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim();
    applyAccent('violet');
    return { viol, blocked, prim, meta: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, styleEls: document.querySelectorAll('head style').length };
  });
  ok(csp.blocked && csp.viol.some(v => /style-src/.test(v)), 'встроенный <style> заблокирован политикой: ' + csp.viol.slice(0, 1));
  ok(/^hsl\(217/.test(csp.prim), 'акцентный цвет работает без встроенного <style>: ' + csp.prim);
  ok(/style-src 'self';/.test(csp.meta) && !/script-src[^;]*unsafe-inline/.test(csp.meta) && /style-src-attr 'unsafe-inline'/.test(csp.meta) && /frame-src 'none'/.test(csp.meta), 'в политике нет unsafe-inline для скриптов и <style>');

  // ---- 5. защита от встраивания ----
  const hostSrv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<iframe id="f" src="http://localhost:8853/" style="width:900px;height:700px"></iframe>'); }); await new Promise(r => hostSrv.listen(8854, r));
  const host = await ctx.newPage(); await host.goto('http://127.0.0.1:8854/'); await host.waitForTimeout(2500); hostSrv.close();
  const navigated = /localhost:8853/.test(host.url());
  const framed = navigated ? null : await (await (await host.$('#f')).contentFrame()).evaluate(() => ({ t: document.documentElement.textContent.trim(), file: !!document.querySelector('#fileInput') }));
  console.log('  iframe:', navigated, JSON.stringify(framed));
  ok(navigated || (framed && /отдельной вкладке/.test(framed.t) && !framed.file), navigated ? 'страница в iframe увела верхнее окно на себя' : 'в чужом iframe интерфейс не показывается');

  // ---- 6. файлы проекта ----
  const src = n => fs.readFileSync(path.join(ROOT, n), 'utf8');
  ok((src('js/formats.js').match(/isEvalSupported: false/g) || []).length === 2, 'PDF/AI открываются с isEvalSupported:false (оба вызова pdf.js)');
  const wf = src('.github/workflows/tests.yml');
  ok(/permissions:\s*\n\s*contents: read/.test(wf) && /npm ci/.test(wf) && fs.existsSync(path.join(ROOT, 'package-lock.json')) && fs.existsSync(path.join(ROOT, '.github/dependabot.yml')), 'CI: права только на чтение, npm ci по lock-файлу, dependabot включён');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
