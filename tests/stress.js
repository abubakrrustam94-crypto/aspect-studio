// Тесты нагрузки и крайних случаев: ZIP из 100 файлов, EXIF-поворот, огромные и крошечные фото.
// Запуск: node tests/stress.js
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib');
const url = 'file://' + path.resolve(__dirname, '../index.html');
const img = path.resolve(__dirname, 'quad.png');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };

// Минимальный EXIF-блок с Orientation, вставляется сразу после SOI
function withOrientation(jpeg, o) {
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}
// Разбор ZIP (метод store): число записей, уникальные имена, CRC
function checkZip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return { err: 'нет EOCD' };
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const names = new Set(); let crcBad = 0;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return { err: 'битый каталог' };
    const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    names.add(buf.toString('utf8', p + 46, p + 46 + nl));
    const ds = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    if (zlib.crc32(buf.subarray(ds, ds + size)) !== crc) crcBad++;
    p += 46 + nl + el + cl;
  }
  return { n, unique: names.size, crcBad };
}

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.evaluate(() => localStorage.setItem('aspect-studio-onboarded', '1')); await p.reload(); await p.waitForTimeout(400);

  // 1) ZIP из 100 файлов
  await p.setInputFiles('#fileInput', Array(100).fill(img)); await p.waitForFunction(() => items.length === 100, null, { timeout: 60000 });
  await p.evaluate(() => { S.format = 'jpg'; S.diskZip = false; });
  const t0 = Date.now();
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 180000 }), p.click('#btnZip')]);
  const zp = path.join(os.tmpdir(), 'as-100.zip'); await dl.saveAs(zp);
  const z = checkZip(fs.readFileSync(zp));
  ok(!z.err && z.n === 100, `ZIP: 100 записей (${z.err || z.n}) за ${Math.round((Date.now() - t0) / 1000)} с`);
  ok(z.unique === 100, 'ZIP: все имена уникальны (одинаковые исходные имена получили _2, _3…)');
  ok(z.crcBad === 0, 'ZIP: контрольные суммы всех файлов верны');
  fs.unlinkSync(zp);
  await p.evaluate(() => { items.length = 0; });

  // 2) EXIF-поворот: JPEG 200×100 с Orientation=6 должен стать 100×200
  const jpg = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 100, 100); x.fillStyle = '#00f'; x.fillRect(100, 0, 100, 100); const bl = await new Promise(r => c.toBlob(r, 'image/jpeg', .95)); return Array.from(new Uint8Array(await bl.arrayBuffer())); });
  const buf = withOrientation(Buffer.from(jpg), 6);
  const p2 = await (await b.newContext({ viewport: { width: 1100, height: 800 } })).newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(url); await p2.evaluate(() => localStorage.setItem('aspect-studio-onboarded', '1')); await p2.reload(); await p2.waitForTimeout(400);
  await p2.setInputFiles('#fileInput', [{ name: 'exif6.jpg', mimeType: 'image/jpeg', buffer: buf }]); await p2.waitForFunction(() => items.length === 1, null, { timeout: 10000 }); await p2.waitForTimeout(500);
  const dims = await p2.evaluate(() => [items[0].w, items[0].h]);
  ok(dims.join('x') === '100x200', 'EXIF Orientation=6: размеры после поворота ' + dims.join('×'));
  const top = await p2.evaluate(async () => { const m = await loadBitmap(items[0]), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0); const g = (a, b) => [...x.getImageData(a, b, 1, 1).data].slice(0, 3).join(); return [g(50, 10), g(50, 190)]; });
  const near = (s, r, g, b2) => s.split(',').every((v, i) => Math.abs(v - [r, g, b2][i]) < 12);
  ok(near(top[0], 255, 0, 0) && near(top[1], 0, 0, 255), 'EXIF Orientation=6: красный сверху, синий снизу (по часовой) — ' + top.join(' | '));

  // 3) Крайние размеры
  const edge = await p2.evaluate(async () => {
    const res = [];
    const mk = async (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, w, h); x.fillStyle = '#e33'; x.fillRect(0, 0, Math.max(1, w >> 1), Math.max(1, h >> 1)); return new File([await new Promise(r => c.toBlob(r, 'image/png'))], `e${w}x${h}.png`, { type: 'image/png' }); };
    for (const [w, h] of [[1, 1], [2, 3000], [9000, 9000], [12000, 40]]) {
      try {
        items.length = 0; await addFiles([await mk(w, h)]); idx = 0;
        const it = items[0]; set('ratioW', 16); set('ratioH', 9); set('format', 'png');
        const bmp = await loadBitmap(it), r = await exportBlob(it, bmp); closeBmp(bmp);
        const o = await createImageBitmap(r.blob); res.push([w, h, o.width, o.height, r.blob.size > 0]); o.close();
      } catch (e) { res.push([w, h, 'ERR ' + (e && e.message)]); }
    }
    return res;
  });
  edge.forEach(r => ok(r.length === 5 && r[4] && Math.max(r[2], r[3]) <= 16384 && (Math.abs(r[2] / r[3] - 16 / 9) < 0.05 || Math.min(r[2], r[3]) <= 2), `размер ${r[0]}×${r[1]} → ${r[2]}×${r[3]}${r.length === 3 ? ' ' + r[2] : ''}`));

  // 4) Журнал ошибок
  await p2.evaluate(() => { console.error('тестовая ошибка'); });
  ok(await p2.evaluate(() => errLog.some(e => /тестовая ошибка/.test(e.m)) && JSON.parse(localStorage.getItem('aspect-studio-errlog')).length > 0), 'журнал ошибок записал console.error');
  await p2.evaluate(() => document.getElementById('errLogClear').click());
  ok(await p2.evaluate(() => errLog.length === 0 && !localStorage.getItem('aspect-studio-errlog')), 'журнал очищается');

  const real = errs.filter(e => !/тестовая/.test(e));
  ok(!real.length, 'нет ошибок JS' + (real.length ? ': ' + real.join('; ') : ''));
  await b.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
