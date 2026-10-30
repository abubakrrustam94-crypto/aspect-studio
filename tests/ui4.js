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
  await new Promise(r => server.listen(8793, r));
  const b = await chromium.launch();
  // ---------- кнопки: радиус не меняется при нажатии ----------
  const mob = await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await mob.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8793/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  await p.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  const rad = sel => p.$eval(sel, e => getComputedStyle(e).borderTopLeftRadius + '|' + getComputedStyle(e).borderBottomLeftRadius);
  const big = v => v.split('|').every(x => parseFloat(x) >= 20);
  ok(await p.evaluate(() => !matchMedia('(hover: hover) and (pointer: fine)').matches), 'контекст телефона: наведения мышью нет');
  for (const sel of ['#themeToggle', '#btnCopy']) {
    const before = await rad(sel); ok(big(before), `${sel}: исходно круглая или «пилюля» (${before})`);
    const box = await p.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.touchscreen.tap(box.x, box.y); await p.waitForTimeout(700);
    const after = await rad(sel); ok(big(after), `${sel}: после касания радиус остаётся круглым, без «залипшей» квадратной формы (${after})`);
    await p.evaluate(() => { document.getElementById('toast').classList.remove('show'); });
  }
  await p.evaluate(() => { document.querySelector('#fileInput'); });
  // ---------- уведомление над окном обработки ----------
  await p.evaluate(() => { showProgress('Обработка: 1 / 3'); setProgress(1, 3, 'photo.jpg'); toast('Ошибка: тестовое сообщение об ошибке', true, { ms: 20000 }); });
  await p.waitForTimeout(700);
  const g = await p.evaluate(() => { document.getElementById('toast').style.pointerEvents = 'auto'; const t = document.getElementById('toast').getBoundingClientRect(), s = document.getElementById('progress').getBoundingClientRect(), x = t.left + t.width / 2, y = t.top + t.height / 2, top = document.elementFromPoint(x, y); return { tb: t.bottom, st: s.top, th: t.height, onTop: !!(top && document.getElementById('toast').contains(top)), vis: getComputedStyle(document.getElementById('toast')).opacity, cls: document.body.classList.contains('progress-on') }; });
  ok(g.cls && g.onTop && g.vis === '1', 'уведомление поверх окна обработки и полностью видно');
  ok(g.tb <= g.st + 1, `уведомление стоит над окном обработки, а не перекрывает его (низ ${Math.round(g.tb)} ≤ верх окна ${Math.round(g.st)})`);
  await p.evaluate(() => hideProgress()); await p.waitForTimeout(700);
  const g2 = await p.evaluate(() => ({ cls: document.body.classList.contains('progress-on'), bottom: parseFloat(getComputedStyle(document.getElementById('toast')).bottom) }));
  ok(!g2.cls && g2.bottom < 130, 'после обработки уведомление возвращается на обычное место (' + g2.bottom + ' px от низа)');
  // уведомление поверх открытых окон (peek/обрезка)
  await p.evaluate(() => { document.getElementById('cropper').classList.add('show'); toast('Проверка слоя', false, { ms: 20000 }); }); await p.waitForTimeout(600);
  ok(await p.evaluate(() => { document.getElementById('toast').style.pointerEvents = 'auto'; const t = document.getElementById('toast').getBoundingClientRect(), top = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return document.getElementById('toast').contains(top); }), 'уведомление видно и над полноэкранными окнами');
  // ---------- обход ВСЕХ кнопок на телефоне: нажатие и наведение не меняют форму ----------
  await p.evaluate(async () => { for (const t of document.querySelectorAll('#settingsTabs [role=tab]')) { t.click(); await new Promise(r => setTimeout(r, 20)); } document.querySelector('#settingsTabs [data-tab=frame]').click(); });
  await p.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const cdp2 = await mob.newCDPSession(p); await cdp2.send('DOM.enable'); await cdp2.send('CSS.enable');
  const root = await cdp2.send('DOM.getDocument', { depth: 0 });
  const nodes = (await cdp2.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: 'button, [role=button], [role=tab], .chip, .swatch, #uploadZone, .toast-act' })).nodeIds;
  const changed = [];
  for (const nodeId of nodes) {
    const { object } = await cdp2.send('DOM.resolveNode', { nodeId });
    const read = async () => (await cdp2.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){ const s = getComputedStyle(this); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius, (this.id ? "#" + this.id : "") + "." + String(this.className).trim().replace(/\\s+/g, ".") + " " + (this.textContent || "").trim().slice(0, 20)].join("|"); }', returnByValue: true })).result.value;
    const base = await read();
    for (const st of [['active'], ['hover'], ['focus', 'active', 'hover']]) {
      await cdp2.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: st }); await p.waitForTimeout(10);
      const cur = await read(); await cdp2.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      if (cur !== base) changed.push(`${base.split('|')[4]} :${st.join('+')} ${base.split('|').slice(0, 4).join('/')} → ${cur.split('|').slice(0, 4).join('/')}`);
    }
  }
  ok(nodes.length > 150 && changed.length === 0, `проверено элементов ${nodes.length}: форма углов при нажатии и наведении не меняется` + (changed.length ? '\n    ' + changed.slice(0, 8).join('\n    ') : ''));
  ok(await p.evaluate(() => ['#uploadZone', '#fileInput', 'label', 'a', '.thumb'].every(s => { const e = document.querySelector(s); return !e || getComputedStyle(e).webkitTapHighlightColor === 'rgba(0, 0, 0, 0)'; })), 'серая прямоугольная подсветка касания отключена у всех элементов, не только у button');
  await mob.close();
  // ---------- на компьютере наведение мышью сохраняет «морф» формы ----------
  const desk = await b.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' });
  const d = await desk.newPage(); await d.goto('http://localhost:8793/'); await d.evaluate(SEEN); await d.reload(); await d.waitForTimeout(600);
  await d.hover('#themeToggle'); await d.waitForTimeout(600);
  ok((await d.$eval('#themeToggle', e => getComputedStyle(e).borderTopLeftRadius)) === '16px', 'на компьютере при наведении иконка по-прежнему мягко меняет форму (16 px)');
  await d.mouse.move(5, 5); await d.waitForTimeout(600);
  await d.setInputFiles('#fileInput', path.join(FX, 'dn_noisy.png')); await d.waitForFunction(() => items.length === 1); await d.waitForTimeout(500);
  for (const sel of ['#btnDownload', '#btnCopy', '#cropBtn']) {
    const bx = await d.$eval(sel, e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const r0 = await d.$eval(sel, e => parseFloat(getComputedStyle(e).borderTopLeftRadius)); await d.mouse.move(bx.x, bx.y); await d.mouse.down(); await d.waitForTimeout(600);
    const r1 = await d.$eval(sel, e => parseFloat(getComputedStyle(e).borderTopLeftRadius)); await d.mouse.up(); await d.mouse.move(5, 5); await d.waitForTimeout(300);
    ok(r1 >= Math.min(r0, 20), `${sel}: пока кнопка зажата, радиус не меняется (${r0} → ${r1})`);
  }
  ok(parseFloat(await d.$eval('#themeToggle', e => getComputedStyle(e).borderTopLeftRadius)) >= 20, 'и возвращается в круг, когда мышь ушла');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
