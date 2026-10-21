// Блок «Приватность и экспорт»: метаданные, sRGB/P3, имена файлов, сохранение в папку.  Запуск: node tests/privacy.js
const { chromium } = require('playwright');
const path = require('path');
const http = require('http'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let url; const FX = path.join(__dirname, 'fixtures');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const lin = v => Math.pow(v / 255, 2.2), enc = l => { l = Math.max(0, Math.min(1, l)); return Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); };
function p3ToSrgb([r, g, b]) {       // та же матрица, что в тестовом ICC: P3(D50) → XYZ → sRGB(D50)
  const R = lin(r), G = lin(g), B = lin(b);
  const X = 0.5151 * R + 0.2920 * G + 0.1571 * B, Y = 0.2412 * R + 0.6922 * G + 0.0666 * B, Z = -0.0011 * R + 0.0419 * G + 0.7841 * B;
  return [enc(3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z), enc(-0.9787684 * X + 1.9161415 * Y + 0.0334540 * Z), enc(0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z)];
}
(async () => {
  await new Promise(r => server.listen(8767, r)); url = 'http://localhost:8767/';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => {          // «папка»: подменяем выбор каталога на каталог в OPFS (в тесте нельзя нажать системный диалог)
    window.showDirectoryPicker = async () => { const root = await navigator.storage.getDirectory(); const h = await root.getDirectoryHandle('out', { create: true }); h.queryPermission = async () => 'granted'; h.requestPermission = async () => 'granted'; return h; };
    { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(500);
  const load = async f => { await p.evaluate(() => { items.length = 0; idx = 0; }); await p.setInputFiles('#fileInput', Array.isArray(f) ? f.map(x => path.join(FX, x)) : path.join(FX, f)); await p.waitForFunction(n => items.length === n, Array.isArray(f) ? f.length : 1, { timeout: 15000 }); await p.waitForTimeout(300); };
  const tab = t => p.click(`#settingsTabs [data-tab=${t}]`);

  // ---------- метаданные ----------
  await load('exif_gps.jpg'); await tab('meta');
  const info = await p.textContent('#metaInfo');
  ok(/геолокация/.test(info) && /TestCam/.test(info) && /2024-05-01/.test(info), 'исходное фото: найдены геолокация, камера и дата → ' + info.slice(0, 90));
  const exp = (fmt = 'jpg') => p.evaluate(async fmt => { S.format = fmt; const it = items[0], bmp = await loadBitmap(it), r = await exportBlob(it, bmp); closeBmp(bmp); const info = await readExifBasics(new File([r.blob], 'x.jpg')); const u8 = new Uint8Array(await r.blob.arrayBuffer()); const txt = new TextDecoder('latin1').decode(u8); return { type: r.blob.type, info, secret: /SecretSoftware/.test(txt), cam: /TestCam/.test(txt), copy: /Иван/.test(new TextDecoder().decode(u8)) }; }, fmt);
  await p.evaluate(() => { set('meta', 'none'); set('author', ''); });
  let r = await exp(); ok(r.type === 'image/jpeg' && !r.info && !r.cam && !r.secret, 'режим «Удалить всё»: в JPG нет EXIF вообще');
  await p.evaluate(() => set('meta', 'basic'));
  r = await exp(); ok(r.info && r.info.make === 'TestCam' && r.info.dto === '2024:05:01 10:20:30' && r.info.gps === false && !r.secret, 'режим «Дата и камера»: камера и дата есть, геолокации и ПО нет');
  await p.evaluate(() => { set('meta', 'none'); set('author', 'Иван Петров'); });
  r = await exp(); ok(r.copy && !r.cam, 'автор записывается в JPG даже в режиме «Удалить всё», камера не попадает');
  r = await exp('png'); ok(r.type === 'image/png', 'PNG экспортируется без попытки писать EXIF');
  await p.evaluate(() => set('author', ''));

  // ---------- sRGB / P3 ----------
  const P3 = [204, 102, 51], want = p3ToSrgb(P3);
  const pix = fmt => p.evaluate(async fmt => { S.format = fmt; const it = items[0], bmp = await loadBitmap(it), r = await exportBlob(it, bmp); closeBmp(bmp); const m = await createImageBitmap(r.blob, { colorSpaceConversion: 'none' }), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0); return { px: [...x.getImageData(c.width >> 1, c.height >> 1, 1, 1).data].slice(0, 3), icc: /Display P3|P3/.test(new TextDecoder('latin1').decode(new Uint8Array(await r.blob.arrayBuffer()).subarray(0, 3000))) }; }, fmt);
  for (const f of ['p3_orange.png', 'p3_orange.jpg']) {
    await load(f);
    const isP3 = await p.evaluate(() => items[0].p3), sup = await p.evaluate(() => supportsP3);
    ok(isP3, `${f}: профиль Display P3 распознан`);
    await p.evaluate(() => set('colorSpace', 'srgb'));
    const s = await pix(f.endsWith('png') ? 'png' : 'png');
    ok(s.px.every((v, i) => Math.abs(v - want[i]) <= 6), `${f} → sRGB: пиксель ${s.px} ≈ ожидаемый ${want} (оригинальные числа P3: ${P3})`);
    if (sup) { await p.evaluate(() => set('colorSpace', 'p3')); const q = await pix('png'); ok(q.px.every((v, i) => Math.abs(v - P3[i]) <= 4), `${f} → Display P3: значения сохранены ${q.px}${q.icc ? ', профиль вшит' : ''}`); }
  }
  await p.evaluate(() => set('colorSpace', 'p3'));

  // ---------- имена ----------
  const names = await p.evaluate(() => {
    items.length = 0; const mk = (n, ov) => ({ name: n, ov: ov || null, w: 100, h: 100 }); items.push(mk('Фото Москва.jpg'), mk('Щука.jpg'), mk('Ёж и Ґанок.png', { ratioW: 1, ratioH: 1 }), mk('Қувват ҳамаи.jpg'));
    const out = [];
    set('ratioW', 16); set('ratioH', 9);
    set('nameTpl', '{name}_{k}_{ratio}_{n}'); set('nameStart', 5); set('nameTranslit', true); set('nameSpaces', true);
    items.forEach(i => out.push(makeName(i, 1920, 1080, 'jpg')));
    set('nameTranslit', false); set('nameSpaces', false); set('nameStart', 1); set('nameTpl', '{name}_{w}x{h}');
    return out;
  });
  ok(names[0] === 'Foto_Moskva_01_16x9_05.jpg', 'счётчик, формат, нумерация с 5, транслит и пробелы: ' + names[0]);
  ok(names[1] === 'Shchuka_02_16x9_06.jpg', '{k} внутри группы растёт: ' + names[1]);
  ok(names[2] === 'Yozh_i_Ganok_01_1x1_07.jpg', '{k} в другой группе (1:1) начинается заново: ' + names[2]);
  ok(names[3] === 'Quvvat_hamai_03_16x9_08.jpg'.replace('Quvvat', 'Kuvvat') || names[3] === 'Kuvvat_hamai_03_16x9_08.jpg', 'таджикские буквы: ' + names[3]);

  // ---------- сохранение в папку ----------
  await load(['quad.jpg', 'exif_gps.jpg']); await tab('export');
  ok(await p.evaluate(() => !document.getElementById('folderRow').hidden), 'выбор папки показан, когда браузер его поддерживает');
  await p.evaluate(() => { set('format', 'jpg'); set('nameTpl', '{name}'); });
  await p.click('#folderRow label.switch'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => S.folderOn === true && dirHandle && dirHandle.name === 'out'), 'включение переключателя сразу предлагает выбрать папку');
  ok((await p.textContent('#zipLabel')).startsWith('В папку'), 'кнопка ZIP превращается в «В папку»');
  await p.click('#btnDownload'); await p.waitForTimeout(1200);
  const list = () => p.evaluate(async () => { const o = []; for await (const [n] of dirHandle.entries()) o.push(n); return o.sort(); });
  let l = await list(); ok(l.length === 1 && /^quad\.jpg$|^exif_gps\.jpg$/.test(l[0]), '«Скачать» положил файл в папку: ' + l);
  await p.click('#btnDownload'); await p.waitForTimeout(1200);
  l = await list(); ok(l.length === 2 && l.some(n => /_2\.jpg$/.test(n)), 'повторное сохранение не затирает файл, добавляется _2: ' + l);
  await p.click('#btnZip'); await p.waitForFunction(() => /Сохранено в «out»/.test(document.querySelector('.toast').textContent), null, { timeout: 15000 });
  l = await list(); ok(l.length === 4, 'пакет сохранён отдельными файлами, без ZIP: ' + l.join(', '));
  ok(await p.evaluate(() => !document.querySelector('.layout').classList.contains('locked')), 'после пакетного сохранения экран разблокирован');
  await p.evaluate(() => { set('folderOn', false); });
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
