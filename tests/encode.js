// Блок L: MozJPEG, оптимизатор PNG (без потерь и палитра), AVIF, JPEG XL как компоненты.
// Запуск: node tests/encode.js   (нужен http: воркеры не работают с file://)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const URL_ = 'http://localhost:8779/';
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
// экспорт текущего фото с настройками; возвращает тип, размер, первые байты, размеры и признаки
const EXP = `async (o) => { Object.assign(S, o); const it = items[0], bmp = await loadBitmap(it); let r; const t0 = performance.now();
  try { r = await exportBlob(it, bmp); } finally { closeBmp(bmp); }
  const u = new Uint8Array(await r.blob.arrayBuffer()); let dims = null; try { const m = await createImageBitmap(r.blob); dims = [m.width, m.height]; m.close(); } catch (e) {}
  const txt = new TextDecoder('latin1').decode(u.subarray(0, Math.min(u.length, 4000)));
  return { type: r.blob.type, size: r.blob.size, head: [...u.subarray(0, 16)], dims, name: r.name, fellBack: r.fellBack, ms: Math.round(performance.now() - t0), prog: /\\xff\\xc2/.test(txt), icc: txt.includes('ICC_PROFILE') || txt.includes('iCCP'), ihdr: u[24] === 8 ? [u[24], u[25]] : null, u8: o.keep ? [...u] : null }; }`;
(async () => {
  await new Promise(r => server.listen(8779, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL_); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  const exp = o => p.evaluate(`(${EXP})(${JSON.stringify(o)})`);
  const load = async f => { await p.evaluate(() => { items.length = 0; }); await p.setInputFiles('#fileInput', path.join(FX, f)); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(300);
    await p.evaluate(() => { const it = items[0]; set('sizeMode', 'auto'); set('ratioW', it.w); set('ratioH', it.h); set('fit', 'fit'); set('enhOn', false); set('cutOn', false); set('targetOn', false); }); };
  await load('face_two.jpg');
  // реестр
  const reg = await p.evaluate(() => COMPONENTS.filter(c => c.group === 'e' && c.id !== 'icc').map(c => ({ id: c.id, files: c.files })));
  ok(reg.length === 4 && reg.every(c => c.files.every(([f, s]) => fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size === s)), 'четыре компонента сжатия, файлы на месте, размеры в реестре верны');
  // без компонентов: выбор не включается, экспорт работает как раньше
  await p.evaluate(() => { document.getElementById('toast').textContent = ''; set('format', 'avif'); });
  ok(await p.evaluate(() => S.format !== 'avif') && /AVIF/.test(await p.textContent('#toast')), 'без компонента формат AVIF не включается, показано предупреждение');
  await p.evaluate(() => { set('format', 'jxl'); set('jpgEngine', 'moz'); set('pngOpt', 'lossy'); });
  ok(await p.evaluate(() => S.format !== 'jxl' && S.jpgEngine === 'native' && S.pngOpt === 'off'), 'JXL, MozJPEG и оптимизатор PNG тоже не включаются без компонентов');
  const nat = await exp({ format: 'jpg', quality: 80, jpgEngine: 'native' });
  ok(nat.type === 'image/jpeg' && nat.head[0] === 0xFF && nat.dims[0] > 100, `встроенный JPG как раньше: ${nat.size} Б`);
  // MozJPEG
  await p.evaluate(() => compInstall('encjpeg')); ok(await p.evaluate(() => compInstalled('encjpeg')), 'компонент MozJPEG скачан');
  await p.evaluate(() => set('jpgEngine', 'moz')); ok(await p.evaluate(() => S.jpgEngine === 'moz'), 'с компонентом MozJPEG включается');
  const moz = await exp({ format: 'jpg', quality: 80, jpgEngine: 'moz' });
  ok(moz.type === 'image/jpeg' && moz.head[0] === 0xFF && moz.head[1] === 0xD8 && moz.dims[0] === nat.dims[0] && moz.dims[1] === nat.dims[1], `MozJPEG: корректный JPG тех же размеров ${moz.dims}`);
  ok(moz.prog, 'MozJPEG: файл прогрессивный');
  ok(moz.size < nat.size, `MozJPEG меньше встроенного: ${moz.size} < ${nat.size} Б`);
  const mozD = await exp({ format: 'jpg', quality: 80, jpgEngine: 'moz', metaDpi: 300, meta: 'strip' });
  ok(mozD.type === 'image/jpeg' && mozD.head[2] === 0xFF, 'MozJPEG вместе с записью разрешения даёт целый файл');
  // подгонка под размер
  const lim = Math.round(moz.size * 0.6 / 1024);
  const fit = await exp({ format: 'jpg', quality: 90, jpgEngine: 'moz', targetOn: true, targetKB: Math.max(20, lim) });
  ok(fit.size <= Math.max(20, lim) * 1024 + 1700, `подгонка под размер с MozJPEG: ${fit.size} Б при пределе ${Math.max(20, lim)} КБ`);
  await p.evaluate(() => set('targetOn', false));
  // PNG
  const pn = await exp({ format: 'png', pngOpt: 'off', keep: true });
  await p.evaluate(() => compInstall('encpng'));
  await p.evaluate(() => set('pngOpt', 'lossless')); ok(await p.evaluate(() => S.pngOpt === 'lossless'), 'оптимизатор PNG включился');
  const pl = await exp({ format: 'png', pngOpt: 'lossless', keep: true });
  ok(pl.type === 'image/png' && pl.size <= pn.size && pl.dims[0] === pn.dims[0], `PNG без потерь: ${pn.size} → ${pl.size} Б`);
  const same = await p.evaluate(async ([a, c]) => { const px = async u8 => { const m = await createImageBitmap(new Blob([new Uint8Array(u8)], { type: 'image/png' })), cv = document.createElement('canvas'); cv.width = m.width; cv.height = m.height; const x = cv.getContext('2d'); x.drawImage(m, 0, 0); return x.getImageData(0, 0, m.width, m.height).data; };
    const A = await px(a), B = await px(c); if (A.length !== B.length) return false; for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false; return true; }, [pn.u8, pl.u8]);
  ok(same, 'PNG без потерь: пиксели совпадают до одного значения');
  const pq = await exp({ format: 'png', pngOpt: 'lossy', pngColors: 128, keep: true });
  ok(pq.type === 'image/png' && pq.ihdr && pq.ihdr[1] === 3 && pq.size < pl.size * 0.6, `PNG-палитра: индексированный файл, ${pl.size} → ${pq.size} Б (тип цвета ${pq.ihdr && pq.ihdr[1]})`);
  ok(pq.dims[0] === pn.dims[0] && pq.dims[1] === pn.dims[1], 'PNG-палитра: размеры те же');
  const diff = await p.evaluate(async ([a, c]) => { const px = async u8 => { const m = await createImageBitmap(new Blob([new Uint8Array(u8)], { type: 'image/png' })), cv = document.createElement('canvas'); cv.width = m.width; cv.height = m.height; const x = cv.getContext('2d'); x.drawImage(m, 0, 0); return x.getImageData(0, 0, m.width, m.height).data; };
    const A = await px(a), B = await px(c); let s = 0, n = 0; for (let i = 0; i < A.length; i += 4 * 7) { for (let k = 0; k < 3; k++) { s += Math.abs(A[i + k] - B[i + k]); n++; } } return s / n; }, [pn.u8, pq.u8]);
  ok(diff < 6, `PNG-палитра: средняя ошибка цвета небольшая (${diff.toFixed(2)} из 255)`);
  // прозрачность в палитре
  await load('quad.bmp'); await p.evaluate(() => { set('bg', 'transparent'); set('fit', 'fit'); set('ratioW', 16); set('ratioH', 9); });
  const pt = await exp({ format: 'png', pngOpt: 'lossy', pngColors: 64, keep: true });
  const hasA = await p.evaluate(async u8 => { const m = await createImageBitmap(new Blob([new Uint8Array(u8)], { type: 'image/png' })), cv = document.createElement('canvas'); cv.width = m.width; cv.height = m.height; const x = cv.getContext('2d'); x.drawImage(m, 0, 0); const d = x.getImageData(0, 0, m.width, m.height).data; let z = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 0) z++; return z > 0; }, pt.u8);
  ok(hasA, 'PNG-палитра сохраняет прозрачность');
  await load('face_two.jpg');
  // AVIF
  await p.evaluate(() => compInstall('encavif')); await p.evaluate(() => set('format', 'avif')); ok(await p.evaluate(() => S.format === 'avif'), 'AVIF включился после скачивания компонента');
  const av = await exp({ format: 'avif', quality: 80, encEffort: 'fast' });
  ok(av.type === 'image/avif' && String.fromCharCode(...av.head.slice(4, 12)) === 'ftypavif' && av.name.endsWith('.avif'), `AVIF: файл ftypavif, имя ${av.name}, ${av.size} Б, ${av.ms} мс`);
  ok(av.dims && av.dims[0] === nat.dims[0] && av.dims[1] === nat.dims[1], 'AVIF: браузер открывает файл, размеры совпадают ' + av.dims);
  ok(av.size < nat.size, `AVIF меньше JPG: ${av.size} < ${nat.size} Б`);
  // JPEG XL
  await p.evaluate(() => compInstall('encjxl'));
  const jx = await exp({ format: 'jxl', quality: 85, encEffort: 'fast', keep: true });
  ok(jx.type === 'image/jxl' && jx.name.endsWith('.jxl') && ((jx.head[0] === 0xFF && jx.head[1] === 0x0A) || (jx.head[4] === 0x4A && jx.head[5] === 0x58 && jx.head[6] === 0x4C)), `JPEG XL: правильная сигнатура, ${jx.size} Б`);
  const jl = await exp({ format: 'jxl', quality: 100, encEffort: 'fast' });
  ok(jl.type === 'image/jxl' && jl.size > jx.size, `JPEG XL «100%» — без потерь, файл крупнее: ${jx.size} → ${jl.size} Б`);
  // проверка готового файла и подсказки интерфейса
  await p.evaluate(() => set('format', 'avif'));
  ok(await p.evaluate(() => !document.getElementById('encEffRow').hidden && document.getElementById('encNote').textContent.includes('AVIF')), 'интерфейс показывает «Усилие сжатия» и подсказку для AVIF');
  await p.evaluate(() => set('format', 'png'));
  ok(await p.evaluate(() => !document.getElementById('pngOptRow').hidden && document.getElementById('jpgEngRow').hidden), 'для PNG виден выбор сжатия PNG, выбор JPG скрыт');
  // пакет из трёх фото через пул (параллельный экспорт)
  const batch = await p.evaluate(async () => {
    S.format = 'avif'; S.encEffort = 'fast'; S.quality = 70; window.EXPORT_CONC = 2;
    const base = items[0]; items.length = 0; for (let i = 0; i < 3; i++) items.push({ ...base, id: 'b' + i, name: 'b' + i + '.jpg' });
    const out = []; await pooledExport(items.slice(), 2, async (it, r, e) => { out.push(e ? 'err:' + e.message : r.blob.type + ':' + r.blob.size); }); return out; });
  ok(batch.length === 3 && batch.every(x => x.startsWith('image/avif')), 'пакетный экспорт в AVIF через пул: ' + batch.join(', '));
  await load('face_two.jpg');
  // удалили компонент, формат остался: вернётся запасной вариант
  await p.evaluate(() => { S.format = 'avif'; }); await p.evaluate(() => compRemove('encavif'));
  const fb = await exp({ format: 'avif' });
  ok(fb.type === 'image/png' && fb.fellBack, 'компонент удалён, а формат остался: сохраняется PNG, без падения');
  await p.evaluate(() => { S.format = 'png'; });
  // широкий цвет: MozJPEG сохраняет профиль
  const p3 = await p.evaluate(() => supportsP3);
  if (p3) {
    await load('p3_orange.jpg'); await p.evaluate(() => set('colorSpace', 'p3'));
    const m3 = await exp({ format: 'jpg', jpgEngine: 'moz', quality: 90 });
    ok(m3.icc, 'широкий цвет: MozJPEG кладёт в файл цветовой профиль');
  } else console.log('… P3 в этом браузере не поддерживается — проверка пропущена');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.slice(0, 3).join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
