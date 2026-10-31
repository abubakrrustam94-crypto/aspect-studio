// Блок S1: безопасность (CSP, экранирование, хеши компонентов, стирание данных, лимиты).
// Запуск: node tests/s1.js
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
  process.env.CSP_WATCH_OFF = '1';          // этот тест сам намеренно нарушает политику, чтобы убедиться, что она работает
  await new Promise(r => server.listen(8800, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const { execFileSync } = require('child_process');
  await p.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || ''))); });
  await p.goto('http://localhost:8800/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // --- политика безопасности ---
  const meta = await p.evaluate(() => ({ csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, ref: document.querySelector('meta[name=referrer]').content }));
  ok(/default-src 'self'/.test(meta.csp) && /object-src 'none'/.test(meta.csp) && /base-uri 'none'/.test(meta.csp) && /connect-src 'self' blob: data:/.test(meta.csp) && !/'unsafe-eval'/.test(meta.csp) && !/script-src[^;]*unsafe-inline/.test(meta.csp), 'CSP: только свой origin, без eval и без inline-скриптов');
  ok(meta.ref === 'no-referrer', 'Referrer-Policy: no-referrer');
  const enf = await p.evaluate(async () => {
    const r = {};
    const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.appendChild(s); r.inline = !!window.__inl;
    try { await fetch('https://example.com/x'); r.fetchOk = true; } catch (e) { r.fetchOk = false; }
    const i = new Image(); i.src = 'https://example.com/p.png'; await new Promise(res => { i.onload = i.onerror = res; }); r.imgLoaded = i.complete && i.naturalWidth > 0;
    await new Promise(res => setTimeout(res, 100)); r.viol = window.__csp.length; return r;
  });
  console.log('  ' + JSON.stringify(enf));
  // eval здесь не проверяем: код из page.evaluate запускается через DevTools и CSP на eval не распространяется; отсутствие 'unsafe-eval' проверено выше
  ok(!enf.inline && !enf.fetchOk && !enf.imgLoaded && enf.viol >= 3, `CSP действительно блокирует: inline-скрипт, запрос и картинку с чужого сайта (нарушений ${enf.viol})`);
  // --- экранирование ---
  ok(await p.evaluate(() => esc(`<img src=x onerror=1>"'&`) === '&lt;img src=x onerror=1&gt;&quot;&#39;&amp;' && esc(null) === '' && esc(5) === '5'), 'esc() заменяет < > & " \'');
  const evil = path.join(require('os').tmpdir(), '<img src=x onerror=window.__x=1>&"a.png'); 
  try { fs.copyFileSync(path.join(FX, 'dn_noisy.png'), evil); } catch (e) {}
  const evilName = fs.existsSync(evil) ? evil : path.join(FX, 'dn_noisy.png');
  await p.setInputFiles('#fileInput', evilName); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(400);
  await p.evaluate(() => { items[0].name = '<img src=x onerror=window.__x=1>&"evil.png'; items.push({ ...items[0], id: 999 }); rvBuild(); items.forEach(rvPaint); });
  const dom = await p.evaluate(() => ({ imgs: document.querySelectorAll('img[src="x"]').length, x: window.__x === undefined, txt: [...document.querySelectorAll('.rv-meta span')].map(e => e.textContent).join('|') }));
  ok(dom.imgs === 0 && dom.x && /<img src=x onerror=window.__x=1>&"evil\.png/.test(dom.txt), 'вредное имя файла показано как текст, а не как HTML');
  await p.evaluate(() => { items.pop(); items[0].name = 'ok.png'; });
  // --- хеши компонентов ---
  ok((() => { try { execFileSync('node', ['tools/comp-hashes.js', '--check'], { cwd: ROOT }); return true; } catch (e) { return false; } })(), 'SHA-256 всех файлов компонентов совпадают с записанными (tools/comp-hashes.js --check)');
  ok(await p.evaluate(() => COMPONENTS.every(c => c.files.every(f => /^[0-9a-f]{64}$/.test(f[2])))), 'у каждого файла компонента есть SHA-256');
  const exr = (await p.evaluate(() => compById('exr').files[0]));
  await p.route('**/' + exr[0], async r => { const resp = await r.fetch(); const buf = await resp.body(); const t = Buffer.from(buf); t[100] ^= 1; r.fulfill({ response: resp, body: t }); });
  const bad = await p.evaluate(async () => { try { await compInstall('exr'); return 'installed'; } catch (e) { return e.message; } });
  ok(/проверку целостности/.test(bad) && !(await p.evaluate(() => compInstalled('exr'))), 'подменённый файл (тот же размер, один байт изменён) не принят: ' + bad.slice(0, 60));
  await p.unroute('**/' + exr[0]);
  await p.evaluate(() => compInstall('exr')); ok(await p.evaluate(() => compInstalled('exr')), 'настоящий файл проходит проверку и устанавливается');
  // --- лимит размера ---
  const n0 = await p.evaluate(() => items.length);
  const cap = await p.evaluate(async () => { const f = new File([new Uint8Array(10)], 'huge.jpg', { type: 'image/jpeg' }); Object.defineProperty(f, 'size', { value: MAX_INPUT_BYTES + 1 }); await addFiles([f]); return items.length; });
  ok(cap === n0 && await p.evaluate(() => /Слишком большой файл/.test(document.querySelector('.toast') ? document.querySelector('.toast').textContent : '')), 'файл больше лимита не открывается, показано понятное сообщение');
  // --- ссылка ?shared=огромное число ---
  const p2 = await ctx.newPage(); const t0 = Date.now();
  await p2.goto('http://localhost:8800/?shared=999999999'); await p2.evaluate(SEEN); await p2.waitForTimeout(800);
  const ev = await p2.evaluate(() => ({ items: items.length, ok: true })); const dt = Date.now() - t0;
  ok(ev.ok && dt < 8000, `ссылка с ?shared=999999999 не зависает страницу (${dt} мс)`); await p2.close();
  // --- стирание данных ---
  await p.evaluate(() => { localStorage.setItem('aspect-studio-pins', '["x"]'); localStorage.setItem('other-site-key', 'keep'); });
  await p.click('#settingsTabs [data-tab=meta]');
  await p.click('#wipeBtn'); ok((await p.textContent('#wipeBtn')).includes('Точно'), 'первое нажатие только просит подтверждение');
  await Promise.all([p.waitForNavigation({ timeout: 15000 }), p.click('#wipeBtn')]); await p.waitForTimeout(800);
  const after = await p.evaluate(async () => ({ pins: localStorage.getItem('aspect-studio-pins'), other: localStorage.getItem('other-site-key'), exr: compInstalled('exr'), caches: typeof caches !== 'undefined' ? (await Promise.all((await caches.keys()).map(async k => (await (await caches.open(k)).keys()).length))).reduce((a, x) => a + x, 0) : 0, opfs: await (async () => { try { const walk = async d => { let n = 0; for await (const [, h] of d.entries()) n += h.kind === 'file' ? 1 : await walk(h); return n; }; return await walk(await navigator.storage.getDirectory()); } catch (e) { return 0; } })() }));
  ok(after.pins === null && !after.exr && after.caches === 0 && after.opfs === 0, `после стирания нет настроек, компонентов, записей кэша и файлов (${JSON.stringify(after)})`);
  ok(fs.existsSync(path.join(ROOT, '.github/dependabot.yml')), 'настроен Dependabot (npm и GitHub Actions)');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
