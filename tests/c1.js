// Блок C1: PDF из фото, набор иконок, страницы PDF и кадры анимации, смаз от движения.
// Запуск: node tests/c1.js
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
  await new Promise(r => server.listen(8796, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8796/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  const os = require('os'), { execFileSync } = require('child_process');
  ok(await p.$eval('#pdfBtn', e => e.disabled) && await p.$eval('#iconsBtn', e => e.disabled), 'без фото кнопки PDF и иконок неактивны');
  // --- смаз ---
  const mo = await p.evaluate(() => {
    const W = 120, H = 120; const g = new Float32Array(W * H); let s = 7; for (let i = 0; i < g.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; g[i] = (s >> 8) % 256; }
    const sm = (src, r) => { const o = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { a += src[yy * W + xx]; n++; } } o[y * W + x] = a / n; } return o; };
    const g1 = sm(sm(g, 1), 1); const sharp = anMotion(g1, W, H);
    const bl = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let k = -12; k <= 12; k++) a += g1[y * W + Math.min(W - 1, Math.max(0, x + k))]; bl[y * W + x] = a / 25; }
    return { sharp, blur: anMotion(bl, W, H) };
  });
  ok(mo.sharp.ratio > 0.8, `чёткий кадр: смаза нет (отношение ${mo.sharp.ratio.toFixed(2)})`);
  ok(mo.blur.ratio < 0.3 && mo.blur.dir === 0, `горизонтальный смаз найден (отношение ${mo.blur.ratio.toFixed(2)}, направление ${mo.blur.dir})`);
  // --- PDF из двух фото ---
  await p.setInputFiles('#fileInput', [path.join(FX, 'dn_noisy.png'), path.join(FX, 'dn_noisy.png')]); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); S.quality = 80; });
  await p.click('#settingsTabs [data-tab=export]');
  ok(!(await p.$eval('#pdfBtn', e => e.disabled)), 'с фото кнопка PDF активна');
  for (const mode of ['a4', 'image']) {
    await p.evaluate(m => set('pdfPage', m), mode);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#pdfBtn')]);
    const f = path.join(os.tmpdir(), `c1_${mode}.pdf`); await dl.saveAs(f);
    const buf = fs.readFileSync(f); ok(buf.slice(0, 5).toString() === '%PDF-' && buf.slice(-6).toString().includes('%%EOF'), `PDF (${mode}) начинается и заканчивается правильно, ${(buf.length / 1024).toFixed(0)} КБ`);
    let info = ''; try { info = execFileSync('pdfinfo', [f]).toString(); } catch (e) { info = 'ERR ' + e.message; }
    if (/ERR.*ENOENT/.test(info)) { console.log('  (pdfinfo не установлен: проверку PDF утилитой пропускаю; в Termux: pkg install poppler)'); continue; }
    const pages = +(/Pages:\s+(\d+)/.exec(info) || [])[1], size = (/Page size:\s+([\d.]+) x ([\d.]+)/.exec(info) || []);
    ok(pages === 2 && !/ERR/.test(info), `pdfinfo читает файл: страниц ${pages}`);
    if (mode === 'a4') ok(Math.abs(size[1] - 595) < 2 && Math.abs(size[2] - 842) < 2 || Math.abs(size[1] - 842) < 2, `страница A4 (${size[1]}×${size[2]})`);
    else ok(size[1] > 0 && Math.abs(size[1] / size[2] - 1) < 5, `страница по размеру фото (${size[1]}×${size[2]})`);
    try { execFileSync('pdftoppm', ['-r', '30', '-png', '-f', '1', '-l', '1', f, path.join(os.tmpdir(), `c1_${mode}`)]); ok(true, 'страница рисуется без ошибок'); } catch (e) { ok(false, 'pdftoppm: ' + e.message); }
  }
  // --- иконки ---
  const [dz] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#iconsBtn')]);
  const zf = path.join(os.tmpdir(), 'c1_icons.zip'); await dz.saveAs(zf);
  const lst = execFileSync('unzip', ['-l', zf]).toString();
  ok(/favicon\.ico/.test(lst) && /icon-512\.png/.test(lst) && /icon-16\.png/.test(lst) && /apple-touch-icon\.png/.test(lst) && /head\.html/.test(lst) && /manifest-icons\.json/.test(lst), 'архив иконок: favicon.ico, PNG 16–512, apple-touch-icon, манифест, head.html');
  const dir = path.join(os.tmpdir(), 'c1_icons'); fs.rmSync(dir, { recursive: true, force: true }); execFileSync('unzip', ['-o', '-q', zf, '-d', dir]);
  const ico = fs.readFileSync(path.join(dir, 'favicon.ico')), cntI = ico.readUInt16LE(4);
  ok(ico.readUInt16LE(2) === 1 && cntI === 6 && ico[6] === 16, `favicon.ico: заголовок верный, размеров ${cntI}`);
  const png512 = fs.readFileSync(path.join(dir, 'icon-512.png')); ok(png512.readUInt32BE(16) === 512 && png512.readUInt32BE(20) === 512, 'icon-512.png квадратный 512×512');
  try { const id = execFileSync('python3', ['-c', 'from PIL import Image;im=Image.open(r"' + path.join(dir, 'favicon.ico') + '");print(im.info.get("sizes") or im.size)']).toString(); ok(/16/.test(id), 'PIL читает favicon.ico: ' + id.trim()); } catch (e) { console.log('  (PIL нет, пропущено)'); }
  // --- кадры анимации ---
  const gif = (() => { const hdr = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255];
    const fr = c => { const v = 4 | (c << 3) | (c << 6) | (5 << 9); return [0x21, 0xF9, 4, 0, 10, 0, 0, 0, 0x2C, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 2, v & 255, v >> 8, 0]; };
    return Buffer.from([...hdr, ...fr(0), ...fr(1), 0x3B]); })();
  const gf = path.join(os.tmpdir(), 'c1_anim.gif'); fs.writeFileSync(gf, gif);
  const before = await p.evaluate(() => items.length);
  await p.evaluate(() => set('multiPages', 'first')); await p.setInputFiles('#fileInput', gf); await p.waitForFunction(n => items.length === n + 1, before); 
  ok(await p.evaluate(() => items[items.length - 1].name === 'c1_anim.gif'), 'по умолчанию анимация открывается одним фото');
  await p.evaluate(() => set('multiPages', 'all')); await p.setInputFiles('#fileInput', gf); await p.waitForFunction(n => items.length === n + 3, before, { timeout: 20000 }).catch(() => {});
  const names = await p.evaluate(() => items.slice(-2).map(i => i.name));
  ok(names.join() === 'c1_anim_f01.png,c1_anim_f02.png', `в режиме «Все кадры» кадры стали отдельными фото: ${names.join(', ')}`);
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
