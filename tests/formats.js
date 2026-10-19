// Тесты входных форматов: каждый файл из tests/fixtures открывается в приложении, проверяются размеры и цвета четырёх квадрантов.
// Запуск: node tests/formats.js   (нужен http-сервер: wasm и модули не грузятся с file://, поднимаем свой)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});

const RED = [255, 0, 0], BLUE = [0, 0, 255], GREEN = [0, 200, 0], YEL = [255, 255, 0];
const Q = [RED, BLUE, GREEN, YEL];                    // ЛВ, ПВ, ЛН, ПН
const ROT6 = [GREEN, RED, YEL, BLUE];                 // после поворота на 90° по часовой
const U = (f, o = {}) => Object.assign({ f, dims: [64, 48], cols: Q, tol: 8 }, o);
const CASES = [
  U('quad.jpg', { tol: 30 }), U('quad.gif'), U('quad.bmp'), U('quad.heic', { tol: 40 }), U('quad.jxl'),
  U('quad_lzw.tif'), U('quad_16.tif'), U('quad_jpeg.tif', { tol: 40 }), U('quad_rot6.tif', { dims: [48, 64], cols: ROT6 }),
  U('quad_zip.exr'), U('quad_piz.exr'), U('quad_none.exr'), U('quad_flat.hdr'), U('quad_rle.hdr'),
  U('quad.psd'), U('quad_rle.psd'), U('quad_16.psd'), U('quad_alpha.psd'), U('quad_cmyk.psd', { tol: 30 }), U('quad.psb'), U('quad_rle.psb'),
  U('quad_v003.xcf', { note: /XCF/ }), U('quad_v003_raw.xcf'), U('quad_v011.xcf'),
  U('quad.svg', { dims: null }), U('quad_novb.svg', { dims: null, cols: null }),
  U('quad_epsi.eps', { cols: null, note: /EPS/ }), U('quad_dos.eps', { note: /EPS/ }),
  U('quad.ai', { dims: null, tol: 40 }),
];
// «RAW» собираем из готового JPEG: TIFF-заголовок + превью (и миниатюра поменьше — должен выбраться большой кадр)
function fakeTiffRaw(big, thumb, order, orient) {
  const le = order === 'II', u16 = v => { const b = Buffer.alloc(2); le ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b; }, u32 = v => { const b = Buffer.alloc(4); le ? b.writeUInt32LE(v) : b.writeUInt32BE(v); return b; };
  const ifd = Buffer.concat([u16(1), u16(0x112), u16(3), u32(1), u16(orient), u16(0), u32(0)]);
  return Buffer.concat([Buffer.from(order), u16(42), u32(8), ifd, Buffer.alloc(16), thumb, Buffer.alloc(7), big, Buffer.alloc(32)]);
}
const box = (t, d) => { const b = Buffer.alloc(8); b.writeUInt32BE(8 + d.length); b.write(t, 4); return Buffer.concat([b, d]); };

(async () => {
  await new Promise(r => server.listen(8766, r)); const base = 'http://localhost:8766/';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 800 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base); await p.evaluate(() => localStorage.setItem('aspect-studio-onboarded', '1')); await p.reload(); await p.waitForTimeout(500);
  const load = async (f, nm) => {
    await p.evaluate(() => { items.length = 0; idx = 0; const t = document.querySelector('.toast'); t.className = 'toast'; t.textContent = ''; });
    await p.setInputFiles('#fileInput', typeof f === 'string' ? f : { name: nm, mimeType: 'application/octet-stream', buffer: f });
    for (let i = 0; i < 150; i++) {
      const s = await p.evaluate(() => ({ n: items.length, err: !!document.querySelector('.toast.error.show'), msg: document.querySelector('.toast').textContent }));
      if (s.n || s.err) { await p.waitForTimeout(150); return s.n ? { ok: true, msg: s.msg } : { ok: false, msg: s.msg }; }
      await p.waitForTimeout(200);
    }
    return { ok: false, msg: 'таймаут' };
  };
  const inspect = () => p.evaluate(async () => {
    const it = items[0], m = await loadBitmap(it), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
    const g = (fx, fy) => [...x.getImageData(Math.floor(m.width * fx), Math.floor(m.height * fy), 1, 1).data];
    const r = { w: m.width, h: m.height, px: [g(.25, .25), g(.75, .25), g(.25, .75), g(.75, .75)] }; if (m.close) m.close(); return r;
  });
  const near = (a, b, t) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);

  const vendorReq = []; p.on('request', r => { if (/\/vendor\//.test(r.url())) vendorReq.push(r.url()); });
  { const r = await load(path.join(FX, 'quad.jpg')); ok(r.ok && !vendorReq.length, 'обычный JPG не подгружает внешние декодеры'); }
  for (const c of CASES.filter(c => !process.env.ONLY || new RegExp(process.env.ONLY).test(c.f))) {
    const r = await load(path.join(FX, c.f));
    if (!r.ok) { ok(false, `${c.f}: не открылся (${r.msg})`); continue; }
    const s = await inspect();
    let good = true, why = `${s.w}×${s.h}`;
    if (c.dims && (s.w !== c.dims[0] || s.h !== c.dims[1])) { good = false; why += ` ожидалось ${c.dims.join('×')}`; }
    if (c.cols && !c.cols.every((col, i) => near(s.px[i], col, c.tol))) { good = false; why += ' цвета ' + JSON.stringify(s.px.map(v => v.slice(0, 3))); }
    if (c.f === 'quad_alpha.psd' && s.px[0][3] !== 255) { good = false; why += ' альфа'; }
    if (c.note && !c.note.test(r.msg)) { good = false; why += ' нет пояснения в тосте: ' + r.msg; }
    ok(good, `${c.f}: ${why}`);
  }
  if (process.env.ONLY) { await b.close(); server.close(); process.exit(fail ? 1 : 0); }
  // SVG без размеров и с ними: прозрачный фон, пропорции сохранены
  { await load(path.join(FX, 'quad_novb.svg')); const s = await inspect(); ok(s.w === s.h && s.w >= 1024, `SVG без размеров: квадрат ${s.w}×${s.h}`); }
  { await load(path.join(FX, 'quad.svg')); const s = await inspect(); ok(Math.abs(s.w / s.h - 4 / 3) < 0.01 && s.w >= 2000, `SVG 64×48 отрисован крупно: ${s.w}×${s.h}`); }
  { await load(path.join(FX, 'quad.ai')); const s = await inspect(); ok(Math.abs(s.w / s.h - 4 / 3) < 0.02 && s.w > 64, `AI: ${s.w}×${s.h}, 4:3`); }

  // RAW (синтетические): все расширения из списка
  const J = fs.readFileSync(path.join(FX, 'quad.jpg')), T = fs.readFileSync(path.join(FX, 'thumb.jpg'));
  const rawNames = { cr2: 'II', nef: 'MM', nrw: 'MM', arw: 'II', orf: 'II', rw2: 'II', dng: 'II', pef: 'II', rwl: 'II' };
  for (const [ext, order] of Object.entries(rawNames)) {
    const r = await load(fakeTiffRaw(J, T, order, 1), `IMG_0001.${ext}`);
    if (!r.ok) { ok(false, `RAW .${ext}: не открылся (${r.msg})`); continue; }
    const s = await inspect(); ok(s.w === 64 && s.h === 48 && near(s.px[0], RED, 30) && /превью 64×48/.test(r.msg), `RAW .${ext}: взято большое превью ${s.w}×${s.h}, есть пояснение`);
  }
  { const r = await load(fakeTiffRaw(J, T, 'II', 6), 'rot.cr2'); const s = await inspect(); ok(r.ok && s.w === 48 && s.h === 64 && near(s.px[0], GREEN, 30) && near(s.px[1], RED, 30), `RAW с Orientation=6 повёрнут: ${s.w}×${s.h}`); }
  { const r = await load(fakeTiffRaw(J, T, 'MM', 3), 'rot3.nef'); const s = await inspect(); ok(r.ok && near(s.px[0], YEL, 30) && near(s.px[3], RED, 30), 'RAW с Orientation=3 (180°)'); }
  { const raf = Buffer.concat([Buffer.from('FUJIFILMCCD-RAW 0201FF393101'), Buffer.alloc(100), T, Buffer.alloc(5), J, Buffer.alloc(20)]); const r = await load(raf, 'DSCF0001.RAF'); const s = await inspect(); ok(r.ok && s.w === 64, `RAW .raf (Fuji)`); }
  { const cr3 = Buffer.concat([box('ftyp', Buffer.from('crx \0\0\0\1crx isom')), box('moov', box('PRVW', Buffer.concat([Buffer.alloc(8), J]))), box('mdat', Buffer.alloc(64))]); const r = await load(cr3, 'IMG_0002.CR3'); const s = await inspect(); ok(r.ok && s.w === 64, 'RAW .cr3 (Canon, превью в PRVW)'); }
  { const r = await load(Buffer.alloc(5000, 7), 'empty.cr2'); ok(!r.ok && /нет встроенного JPEG/.test(r.msg), 'RAW без превью: понятное сообщение'); }
  { const r = await load(path.join(FX, 'noprev.eps')); ok(!r.ok && /нет встроенного превью/.test(r.msg), 'EPS без превью: понятное сообщение'); }
  { const r = await load(path.join(FX, 'quad_planar.tif')); ok(!r.ok && /Planar/.test(r.msg), 'TIFF с раздельными плоскостями: понятное сообщение'); }
  { const r = await load(Buffer.from('<html>не svg'), 'bad.svg'); ok(!r.ok && /SVG/.test(r.msg), 'битый SVG: понятное сообщение'); }
  { const r = await load(Buffer.alloc(4000, 1), 'bad.heic'); ok(!r.ok, 'битый HEIC не роняет приложение: ' + r.msg); }
  { await p.evaluate(() => { items.length = 0; }); await p.setInputFiles('#fileInput', [path.join(FX, 'quad.jpg'), path.join(FX, 'quad_lzw.tif'), path.join(FX, 'quad.psd')]); await p.waitForFunction(() => items.length === 3, null, { timeout: 30000 }); ok(true, 'пачка из JPG + TIFF + PSD загружается вместе'); }
  { const ms = await p.evaluate(() => { const u = new Uint8Array(80e6); crypto.getRandomValues && [...Array(1000)].forEach((_, i) => crypto.getRandomValues(u.subarray(i * 65536, i * 65536 + 65536))); const t = performance.now(); jpegScan(u); return performance.now() - t; }); ok(ms < 1500, `поиск превью в 80 МБ данных: ${Math.round(ms)} мс`); }
  // Экспорт сконвертированного файла работает
  { await load(path.join(FX, 'quad.heic')); const r = await p.evaluate(async () => { const it = items[0], bmp = await loadBitmap(it), o = await exportBlob(it, bmp); return [o.w, o.h, o.blob.size > 0]; }); ok(r[2] && r[0] > 0, `экспорт HEIC → ${r[0]}×${r[1]}`); }
  ok(await p.evaluate(() => document.getElementById('fileInput').accept.includes('.cr2') && document.getElementById('fileInput').accept.includes('.heic')), 'в выборе файлов перечислены новые расширения');

  const real = errs.filter(e => !/Не удалось|SVG/.test(e));
  ok(!real.length, 'нет ошибок JS' + (real.length ? ': ' + real.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
