'use strict';
/* Aspect Studio — Форматы на входе.
   Браузер сам читает JPEG, PNG, WebP, GIF, BMP, ICO, AVIF. Остальное приводится к PNG/JPEG здесь:
   — свои небольшие разборщики: RAW (встроенное превью), PSD/PSB, HDR, SVG, EPS (превью), XCF;
   — внешние декодеры из папки vendor/, подгружаются только при первом таком файле: HEIC/HEIF, TIFF, EXR, JXL, AI (PDF). */

const RAW_EXT = 'cr2|cr3|crw|nef|nrw|arw|srf|sr2|raf|orf|rw2|dng|pef|rwl|srw|3fr|erf|mrw|kdc|dcr|mef|iiq';
const INPUT_EXT_RE = new RegExp('\\.(jpe?g|jfif|png|apng|webp|gif|bmp|ico|avif|tiff?|heic|heif|jxl|svg|ai|eps|psd|psb|xcf|exr|hdr|' + RAW_EXT + ')$', 'i');
const INPUT_ACCEPT = 'image/*,.tif,.tiff,.heic,.heif,.jxl,.svg,.ai,.eps,.psd,.psb,.xcf,.exr,.hdr,.ico,.bmp,.gif,.' + RAW_EXT.split('|').join(',.');
const MAX_INPUT_PIXELS = 150e6;
const isInputFile = f => (f.type && f.type.startsWith('image/')) || INPUT_EXT_RE.test(f.name || '');

class FormatError extends Error { constructor(msg) { super(msg); this.name = 'FormatError'; this.userMsg = msg; } }
// Нужного компонента нет (не скачан на вкладке «Компоненты»): декодер не запускаем и ничего не качаем сами
class ComponentMissing extends FormatError {
  constructor(ids) { super(compMissingText(ids, '')); this.name = 'ComponentMissing'; this.compIds = ids; }
}
function assertComp(id) {
  if (compInstalled(id)) return;
  throw new ComponentMissing(compChain(id).filter(x => compFiles[x] !== true));
}
const extOf = n => ((n || '').match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
const checkPixels = (w, h) => { if (!w || !h) throw new FormatError('Пустое изображение'); if (w * h > MAX_INPUT_PIXELS) throw new FormatError(`Слишком большое изображение (${w}×${h}) для браузера`); };

/* ---------- Ленивая загрузка внешних декодеров ---------- */
const vendorCache = {};
const vendorUrl = p => new URL(p, document.baseURI).href;
function loadScript(path) {
  if (!vendorCache[path]) { const c = compForPath(path); if (c) assertComp(c.id); }
  return vendorCache[path] || (vendorCache[path] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = vendorUrl(path); s.async = true;
    s.onload = () => res(); s.onerror = () => { delete vendorCache[path]; rej(new FormatError('Не удалось загрузить декодер формата. Проверь соединение (нужно один раз)')); };
    document.head.appendChild(s);
  }));
}
async function loadPako() { await loadScript('vendor/pako/pako.umd.min.js'); return self.pako; }
async function loadUTIF() { assertComp('tiff'); await loadPako(); await loadScript('vendor/utif/UTIF.js'); return self.UTIF; }

/* ---------- Холст ↔ файл ---------- */
async function canvasToFile(c, name) {
  const big = c.width * c.height > 24e6;                       // очень большие кадры — JPEG, чтобы не ждать кодирования PNG
  const blob = await new Promise(r => c.toBlob(r, big ? 'image/jpeg' : 'image/png', .97));
  c.width = c.height = 0;
  if (!blob) throw new FormatError('Не хватило памяти при конвертации');
  return new File([blob], name, { type: blob.type });
}
async function imageDataToFile(img, name) {
  checkPixels(img.width, img.height);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return canvasToFile(c, name);
}
const ORIENT_T = (w, h) => ({ 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] });
function orientCanvas(src, w, h, o) {
  const swap = o >= 5, c = document.createElement('canvas'); c.width = swap ? h : w; c.height = swap ? w : h;
  const x = c.getContext('2d'), t = ORIENT_T(w, h)[o]; if (t) x.setTransform(...t);
  x.drawImage(src, 0, 0); return c;
}
async function nativeOk(file) { try { const b = await createImageBitmap(file); b.close(); return true; } catch (e) { return false; } }

/* ---------- Определение формата ---------- */
function sniffKind(h) {
  const s = (a, b) => String.fromCharCode(...h.subarray(a, b));
  if (s(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(s(8, 12))) return 'heic';
  if (s(0, 4) === '8BPS') return 'psd';
  if (s(0, 4) === '%PDF') return 'pdf';
  if (s(0, 9) === 'gimp xcf ') return 'xcf';
  if ((h[0] === 0xFF && h[1] === 0x0A) || (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0x0C && s(4, 8) === 'JXL ')) return 'jxl';
  if (h[0] === 0x76 && h[1] === 0x2F && h[2] === 0x31 && h[3] === 0x01) return 'exr';
  if (s(0, 2) === '#?') return 'hdr';
  if (h[0] === 0xC5 && h[1] === 0xD0 && h[2] === 0xD3 && h[3] === 0xC6) return 'eps';
  if (s(0, 10) === '%!PS-Adobe') return 'eps';
  if (s(0, 15) === 'FUJIFILMCCD-RAW') return 'raw';
  return '';
}
function kindOf(ext, sniffed) {
  if (new RegExp('^(' + RAW_EXT + ')$').test(ext)) return 'raw';
  if (sniffed) return sniffed;
  if (/^tiff?$/.test(ext)) return 'tiff';
  if (/^hei[cf]$/.test(ext)) return 'heic';
  const m = { jxl: 'jxl', svg: 'svg', ai: 'ai', eps: 'eps', psd: 'psd', psb: 'psd', xcf: 'xcf', exr: 'exr', hdr: 'hdr' }; return m[ext] || 'native';
}

/* Главная функция: вернуть файл, который браузер умеет читать (исходный или сконвертированный) */
async function normalizeInput(file, notes) {
  const ext = extOf(file.name);
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  let kind = kindOf(ext, sniffKind(head));
  if (kind === 'native' && ext === 'svg') kind = 'svg';
  if (kind === 'native') return file;
  if (kind === 'pdf') kind = 'ai';
  const info = msg => { try { toast(msg); } catch (e) {} };
  const need = async () => new Uint8Array(await file.arrayBuffer());
  switch (kind) {
    case 'heic': if (await nativeOk(file)) return file; info('Конвертирую HEIC…'); return heicToFile(file, await need());
    case 'jxl': if (await nativeOk(file)) return file; info('Конвертирую JPEG XL…'); return jxlToFile(file, await need());
    case 'tiff': if (await nativeOk(file)) return file; info('Конвертирую TIFF…'); return tiffToFile(file, await need());
    case 'raw': {
      const u8 = await need();
      if (S.rawMode !== 'preview' && compInstalled('raw')) {
        info('Проявляю RAW…');
        try { return await rawDevelop(file, u8.slice(), notes); }
        catch (e) { console.warn('LibRaw', e); if (notes) notes.push(`RAW ${file.name}: полное проявление не удалось (${(e && e.message) || e}), открыто превью`); }
      }
      info('Читаю превью RAW…'); return rawToFile(file, u8, ext, notes);
    }
    case 'psd': info('Читаю PSD…'); return psdToFile(file, await need(), notes);
    case 'hdr': info('Читаю HDR…'); return hdrToFile(file, await need());
    case 'exr': info('Читаю EXR…'); return exrToFile(file, await need());
    case 'svg': return svgToFile(file);
    case 'ai': info('Читаю AI…'); return aiToFile(file, await need(), notes);
    case 'eps': info('Читаю превью EPS…'); return epsToFile(file, await need(), notes);
    case 'xcf': info('Читаю XCF…'); return xcfToFile(file, await need(), notes);
  }
  return file;
}

/* ============================ HEIC / HEIF ============================ */
let heifLib = null;
async function heicToFile(file, u8) {
  await loadScript('vendor/heif/libheif-bundle.js');
  let dec, imgs;
  try { heifLib = heifLib || libheif(); dec = new heifLib.HeifDecoder(); imgs = dec.decode(u8); } catch (e) { throw new FormatError('Не удалось прочитать HEIC (файл повреждён или формат не поддерживается)'); }
  if (!imgs || !imgs.length) throw new FormatError('В HEIC нет изображения');
  const im = imgs[0], w = im.get_width(), h = im.get_height(); checkPixels(w, h);
  const out = new ImageData(w, h);
  await new Promise((res, rej) => im.display(out, d => d ? res() : rej(new FormatError('Ошибка декодирования HEIC'))));
  try { imgs.forEach(i => i.free && i.free()); } catch (e) {}
  return imageDataToFile(out, file.name);
}

/* ============================ JPEG XL ============================ */
async function jxlToFile(file, u8) {
  assertComp('jxl');
  await loadScript('vendor/jxl/jxl-decode.js');
  if (!jxlToFile.ready) {
    const wasm = await WebAssembly.compile(await (await fetch(vendorUrl('vendor/jxl/jxl_dec.wasm'))).arrayBuffer());
    await jxlDecoder.init(wasm); jxlToFile.ready = true;
  }
  let img; try { img = await jxlDecoder.decode(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); } catch (e) { throw new FormatError('Не удалось прочитать JPEG XL'); }
  return imageDataToFile(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), file.name);
}

/* ============================ TIFF (UTIF) ============================ */
async function tiffToFile(file, u8) {
  const UTIF = await loadUTIF();
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  let ifds; try { ifds = UTIF.decode(buf); } catch (e) { throw new FormatError('Не удалось прочитать TIFF'); }
  const all = []; const walk = l => l.forEach(i => { all.push(i); if (i.subIFD) walk(i.subIFD); }); walk(ifds);
  const pages = all.filter(i => i.t256 && i.t257 && i.t256[0] * i.t257[0] > 0);
  if (!pages.length) throw new FormatError('В TIFF нет изображения');
  pages.sort((a, b) => b.t256[0] * b.t257[0] - a.t256[0] * a.t257[0]);
  const ifd = pages[0]; checkPixels(ifd.t256[0], ifd.t257[0]);
  if (ifd.t284 && ifd.t284[0] === 2 && ifd.t277 && ifd.t277[0] > 1) throw new FormatError('TIFF с раздельными цветовыми плоскостями (Planar) не поддерживается: пересохрани как обычный TIFF или PNG');
  try { UTIF.decodeImage(buf, ifd, all); } catch (e) { throw new FormatError('Этот вариант TIFF (сжатие) не поддерживается — пересохрани как PNG/JPG'); }
  const rgba = UTIF.toRGBA8(ifd), w = ifd.width, h = ifd.height;
  const o = ifd.t274 ? ifd.t274[0] : 1;
  const img = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h);
  if (o > 1 && o <= 8) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(img, 0, 0);
    return canvasToFile(orientCanvas(c, w, h, o), file.name);
  }
  return imageDataToFile(img, file.name);
}

/* ============================ RAW: встроенное JPEG-превью ============================ */
function jpegSpan(u8, s) {
  let p = s + 2, w = 0, h = 0, ok = false; const n = u8.length;
  while (p + 4 <= n) {
    if (u8[p] !== 0xFF) return null;
    const m = u8[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xD9) return ok ? { start: s, end: p + 2, w, h } : null;
    if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { p += 2; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (len < 2) return null;
    if (m === 0xC0 || m === 0xC1 || m === 0xC2) { h = (u8[p + 5] << 8) | u8[p + 6]; w = (u8[p + 7] << 8) | u8[p + 8]; ok = true; }
    else if (m >= 0xC3 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return null;   // lossless / арифметика — браузер не прочтёт
    if (m === 0xDA) {
      p += 2 + len;
      while (p < n - 1) {
        if (u8[p] === 0xFF) { const c = u8[p + 1]; if (c === 0x00 || (c >= 0xD0 && c <= 0xD7)) { p += 2; continue; } if (c === 0xFF) { p++; continue; } break; }
        p++;
      }
      continue;
    }
    p += 2 + len;
  }
  return null;
}
function jpegScan(u8) {
  const out = [], n = u8.length; let i = 0;
  while (i < n - 3) {
    i = u8.indexOf(0xFF, i); if (i < 0 || i >= n - 3) break;
    if (u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) { const r = jpegSpan(u8, i); if (r) { out.push(r); i = r.end; continue; } }
    i++;
  }
  return out;
}
function tiffOrientation(u8, base = 0) {
  const a = u8[base], b = u8[base + 1], le = a === 0x49 && b === 0x49, be = a === 0x4D && b === 0x4D;
  if (!le && !be) return 1;
  const dv = new DataView(u8.buffer, u8.byteOffset + base, Math.max(0, u8.byteLength - base));
  try {
    const ifd = dv.getUint32(4, le); if (ifd + 2 > dv.byteLength) return 1;
    const n = dv.getUint16(ifd, le);
    for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > dv.byteLength) break; if (dv.getUint16(e, le) === 0x112) { const v = dv.getUint16(e + 8, le); return v >= 1 && v <= 8 ? v : 1; } }
  } catch (e) {}
  return 1;
}
function jpegOrientation(u8) {
  let p = 2;
  while (p + 4 < u8.length && u8[p] === 0xFF) {
    const m = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3];
    if (m === 0xDA || m === 0xD9) break;
    if (m === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78) return tiffOrientation(u8, p + 10);
    p += 2 + len;
  }
  return 1;
}
/* Полное проявление через LibRaw (WASM, один поток, отдельный воркер, который закрывается сразу после снимка) */
async function rawDevelop(file, u8, notes) {
  assertComp('raw');
  const w = new Worker(vendorUrl('vendor/raw/worker.js'), { type: 'module' });
  const pending = new Map(); let seq = 0, dead = null;
  const fail = e => { dead = e; pending.forEach(p => p.rej(e)); pending.clear(); };
  w.onmessage = ({ data }) => { const p = pending.get(data && data.id); if (!p) return; pending.delete(data.id); data.error ? p.rej(new Error(data.error)) : p.res(data.out); };
  w.onerror = e => { e.preventDefault(); if (typeof compRefresh === 'function') compRefresh(); fail(new Error('Декодер RAW не запустился')); };
  const call = (fn, tr, ...args) => new Promise((res, rej) => {
    if (dead) return rej(dead);
    const id = ++seq, t = setTimeout(() => { pending.delete(id); rej(new Error('слишком долго')); fail(new Error('слишком долго')); }, 180000);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    w.postMessage({ id, fn, args }, tr);
  });
  try {
    const settings = { useCameraWb: S.rawWb !== 'auto', useAutoWb: S.rawWb === 'auto', outputBps: 8, outputColor: 1, userQual: 3, userFlip: -1, halfSize: DEV_MEM <= 3 };
    await call('open', [u8.buffer], u8, settings);
    const img = await call('imageData', []);
    if (!img || !img.data || !img.width || !img.height) throw new Error('пустой результат');
    const W = img.width, H = img.height; checkPixels(W, H);
    const src = img.data, ch = img.colors || 3, n = W * H, rgba = new Uint8ClampedArray(n * 4), sh = img.bits === 16 ? 8 : 0;
    const at = sh ? i => src[i] >> 8 : i => src[i];
    if (src.length < n * ch) throw new Error('неполные данные');
    for (let i = 0, s = 0, o = 0; i < n; i++, s += ch, o += 4) { rgba[o] = at(s); rgba[o + 1] = at(s + (ch > 1 ? 1 : 0)); rgba[o + 2] = at(s + (ch > 2 ? 2 : 0)); rgba[o + 3] = 255; }
    if (notes) notes.push(`RAW ${file.name}: проявлено через LibRaw, ${W}×${H}${settings.halfSize ? ' (половинное разрешение: мало памяти)' : ''}`);
    return await imageDataToFile(new ImageData(rgba, W, H), file.name);
  } finally { try { w.terminate(); } catch (e) {} pending.clear(); }
}
async function rawToFile(file, u8, ext, notes) {
  const cands = jpegScan(u8).filter(c => c.w >= 32 && c.h >= 24);
  if (!cands.length) throw new FormatError(compInstalled('raw') ? 'В этом RAW нет встроенного JPEG-превью, а проявить его не удалось (файл повреждён или формат не поддерживается)' : 'В этом RAW нет встроенного JPEG-превью. Скачай компонент «RAW: полное проявление» (вкладка «Компоненты») или сохрани снимок как JPG/TIFF');
  cands.sort((a, b) => b.w * b.h - a.w * a.h);
  const best = cands[0], jpg = u8.subarray(best.start, best.end);
  const rawO = (ext === 'raf' || ext === 'cr3') ? 1 : tiffOrientation(u8);
  if (notes) notes.push(`RAW ${file.name}: открыто встроенное превью ${best.w}×${best.h} (сами RAW-данные не проявляются)`);
  const blob = new Blob([jpg], { type: 'image/jpeg' });
  if (rawO > 1 && jpegOrientation(jpg) === 1) {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'none' });
    const c = orientCanvas(bmp, bmp.width, bmp.height, rawO); bmp.close();
    return canvasToFile(c, file.name);
  }
  return new File([blob], file.name, { type: 'image/jpeg' });
}

/* ============================ PSD / PSB (готовый композит) ============================ */
function unpackBits(src, p, count, out, o, rowBytes) {
  const end = o + rowBytes;
  while (o < end && p < src.length) {
    let n = src[p++]; if (n > 127) n -= 256;
    if (n >= 0) { const c = Math.min(n + 1, end - o); out.set(src.subarray(p, p + c), o); p += n + 1; o += c; }
    else if (n !== -128) { const c = Math.min(1 - n, end - o); out.fill(src[p++], o, o + c); o += c; }
  }
  return p;
}
async function psdToFile(file, u8, notes) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 30 || dv.getUint32(0) !== 0x38425053) throw new FormatError('Это не PSD/PSB-файл');
  const ver = dv.getUint16(4); if (ver !== 1 && ver !== 2) throw new FormatError('Неизвестная версия PSD');
  const ch = dv.getUint16(12), h = dv.getUint32(14), w = dv.getUint32(18), depth = dv.getUint16(22), mode = dv.getUint16(24);
  checkPixels(w, h);
  if (depth === 32) throw new FormatError('PSD с 32 бит на канал не поддерживается: сохрани как 8 или 16 бит');
  if (mode === 9) throw new FormatError('PSD в режиме Lab не поддерживается: переведи в RGB');
  let p = 26;
  const cmLen = dv.getUint32(p); p += 4; const palette = u8.subarray(p, p + cmLen); p += cmLen;
  p += 4 + dv.getUint32(p);
  const lmLen = ver === 2 ? Number(dv.getBigUint64(p)) : dv.getUint32(p); p += (ver === 2 ? 8 : 4) + lmLen;
  const comp = dv.getUint16(p); p += 2;
  const bps = depth === 16 ? 2 : 1, rowBytes = depth === 1 ? (w + 7) >> 3 : w * bps, planeSize = rowBytes * h;
  const planes = [];
  if (comp === 0) { for (let c = 0; c < ch; c++) planes.push(u8.subarray(p + c * planeSize, p + (c + 1) * planeSize)); }
  else if (comp === 1) {
    const cw = ver === 2 ? 4 : 2; let q = p + ch * h * cw;
    for (let c = 0; c < ch; c++) { const pl = new Uint8Array(planeSize); for (let r = 0; r < h; r++) q = unpackBits(u8, q, 0, pl, r * rowBytes, rowBytes); planes.push(pl); }
  } else if (comp === 2 || comp === 3) {
    const pako = await loadPako(); let all;
    try { all = pako.inflate(u8.subarray(p)); } catch (e) { throw new FormatError('Не удалось распаковать PSD (ZIP)'); }
    for (let c = 0; c < ch; c++) {
      const pl = all.slice(c * planeSize, (c + 1) * planeSize);
      if (comp === 3) for (let r = 0; r < h; r++) {
        const o = r * rowBytes;
        if (bps === 1) for (let x = 1; x < rowBytes; x++) pl[o + x] = (pl[o + x] + pl[o + x - 1]) & 255;
        else for (let x = 2; x < rowBytes; x += 2) { const v = (((pl[o + x] << 8) | pl[o + x + 1]) + ((pl[o + x - 2] << 8) | pl[o + x - 1])) & 0xFFFF; pl[o + x] = v >> 8; pl[o + x + 1] = v & 255; }
      }
      planes.push(pl);
    }
  } else throw new FormatError('Неизвестное сжатие PSD');
  const img = new ImageData(w, h), d = img.data;
  const at = (c, i) => planes[c][depth === 16 ? i * 2 : i];                 // для 16 бит берём старший байт
  const hasAlpha = (mode === 3 && ch >= 4) || (mode === 4 && ch >= 5) || (mode === 1 && ch >= 2);
  const aC = mode === 4 ? 4 : mode === 3 ? 3 : 1;
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, b;
    if (mode === 3) { r = at(0, i); g = at(1, i); b = at(2, i); }
    else if (mode === 4) { const k = at(3, i); r = at(0, i) * k / 255; g = at(1, i) * k / 255; b = at(2, i) * k / 255; }   // в PSD CMYK хранится «инвертированным»
    else if (mode === 2) { const v = at(0, i); r = palette[v]; g = palette[256 + v]; b = palette[512 + v]; }
    else if (mode === 0 && depth === 1) { const bit = (planes[0][(i / w | 0) * rowBytes + ((i % w) >> 3)] >> (7 - ((i % w) & 7))) & 1; r = g = b = bit ? 0 : 255; }
    else { r = g = b = at(0, i); }
    const o = i * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = hasAlpha ? at(aC, i) : 255;
  }
  if (notes && mode === 4) notes.push('PSD в CMYK: цвета пересчитаны в RGB приблизительно');
  return imageDataToFile(img, file.name);
}

/* ============================ HDR / EXR (тонмаппинг) ============================ */
const OETF = (() => { const t = new Uint8ClampedArray(4097); for (let i = 0; i <= 4096; i++) { const c = i / 4096; t[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); } return t; })();
const toSrgb8 = v => OETF[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096 + .5) | 0];
function hdrScale(samples) { if (!samples.length) return 1; samples.sort((a, b) => a - b); const p = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.995))]; return p > 1 ? 1 / p : 1; }
async function hdrToFile(file, u8) {
  let p = 0; const line = () => { let s = ''; while (p < u8.length && u8[p] !== 10) s += String.fromCharCode(u8[p++]); p++; return s; };
  if (!/^#\?(RADIANCE|RGBE)/.test(line())) throw new FormatError('Это не файл Radiance HDR');
  let guard = 0; while (line() !== '') { if (p >= u8.length || ++guard > 200) throw new FormatError('Повреждённый заголовок HDR'); }
  const m = line().match(/^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)/); if (!m) throw new FormatError('Неподдерживаемая ориентация HDR');
  const h = +m[2], w = +m[4], flipY = m[1] === '+', flipX = m[3] === '-'; checkPixels(w, h);
  const rgbe = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    if (w >= 8 && w < 32768 && u8[p] === 2 && u8[p + 1] === 2 && !(u8[p + 2] & 0x80)) {
      if (((u8[p + 2] << 8) | u8[p + 3]) !== w) throw new FormatError('Повреждённые строки HDR'); p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let cnt = u8[p++]; if (p > u8.length || cnt === 0) throw new FormatError('Повреждённые данные HDR');
          if (cnt > 128) { cnt -= 128; const v = u8[p++]; while (cnt-- && x < w) rgbe[row + (x++) * 4 + c] = v; }
          else while (cnt-- && x < w) rgbe[row + (x++) * 4 + c] = u8[p++];
        }
      }
    } else { rgbe.set(u8.subarray(p, p + w * 4), row); p += w * 4; }
  }
  const ex = new Float32Array(256); for (let e = 1; e < 256; e++) ex[e] = Math.pow(2, e - 136);
  const step = Math.max(1, Math.floor(w * h / 200000)), samples = [];
  for (let i = 0; i < w * h; i += step) { const e = ex[rgbe[i * 4 + 3]]; samples.push(Math.max(rgbe[i * 4], rgbe[i * 4 + 1], rgbe[i * 4 + 2]) * e); }
  const sc = hdrScale(samples), img = new ImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, o = ((flipY ? h - 1 - y : y) * w + (flipX ? w - 1 - x : x)) * 4, e = ex[rgbe[s + 3]] * sc;
    d[o] = toSrgb8(rgbe[s] * e); d[o + 1] = toSrgb8(rgbe[s + 1] * e); d[o + 2] = toSrgb8(rgbe[s + 2] * e); d[o + 3] = 255;
  }
  return imageDataToFile(img, file.name);
}
async function exrToFile(file, u8) {
  await loadScript('vendor/exr/parse-exr.js');
  let r; try { r = parseExr(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), 1015); } catch (e) { throw new FormatError('Не удалось прочитать EXR (возможно, неподдерживаемое сжатие)'); }
  const { width: w, height: h, data } = r; checkPixels(w, h);
  const st = Math.round(data.length / (w * h)), img = new ImageData(w, h), d = img.data;
  const px = (i, c) => data[i * st + Math.min(c, st - 1 > 2 ? 2 : st - 1)];
  const step = Math.max(1, Math.floor(w * h / 200000)), samples = [];
  for (let i = 0; i < w * h; i += step) samples.push(Math.max(px(i, 0), st > 1 ? px(i, 1) : 0, st > 2 ? px(i, 2) : 0));
  const sc = hdrScale(samples);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (h - 1 - y) * w + x, o = (y * w + x) * 4, a = st >= 4 ? data[s * st + 3] : 1, k = a > 0 && a < 1 ? sc / a : sc;   // EXR хранит премультиплицированный цвет
    d[o] = toSrgb8(px(s, 0) * k); d[o + 1] = toSrgb8(st > 1 ? px(s, 1) * k : px(s, 0) * k); d[o + 2] = toSrgb8(st > 2 ? px(s, 2) * k : px(s, 0) * k); d[o + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  return imageDataToFile(img, file.name);
}

/* ============================ SVG ============================ */
async function svgToFile(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new FormatError('Не удалось прочитать SVG');
  const num = v => { const n = parseFloat(v); return isFinite(n) && n > 0 && !/%/.test(v || '') ? n : 0; };
  let w = num(svg.getAttribute('width')), h = num(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) { const r = vb[2] / vb[3]; if (w) h = w / r; else if (h) w = h * r; else { w = vb[2]; h = vb[3]; } }
  if (!w || !h) { w = 1024; h = 1024; }
  const k = Math.min(4096 / Math.max(w, h), Math.max(1, 2400 / Math.max(w, h)));   // векторный файл: рисуем крупно, но не больше 4096
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k)); checkPixels(W, H);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch (e) { throw new FormatError('Не удалось отрисовать SVG'); }
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(img, 0, 0, W, H);
    return canvasToFile(c, file.name);
  } finally { URL.revokeObjectURL(url); }
}

/* ============================ AI (PDF-совместимый) ============================ */
async function aiToFile(file, u8, notes) {
  const head = String.fromCharCode(...u8.subarray(0, Math.min(1024, u8.length)));
  if (!head.includes('%PDF')) {
    if (head.startsWith('%!PS-Adobe')) return epsToFile(file, u8, notes);
    throw new FormatError('Этот AI-файл сохранён без PDF-совместимости. В Illustrator: Сохранить как → «Создать PDF-совместимый файл», либо экспортируй в PNG/SVG');
  }
  assertComp('pdf');
  let pdfjs;
  try { pdfjs = await import(vendorUrl('vendor/pdfjs/pdf.min.mjs')); } catch (e) { throw new FormatError('Не удалось загрузить модуль чтения PDF/AI. Проверь соединение (нужно один раз)'); }
  pdfjs.GlobalWorkerOptions.workerSrc = vendorUrl('vendor/pdfjs/pdf.worker.min.mjs');
  let doc;
  try { doc = await pdfjs.getDocument({ data: u8.slice(u8.indexOf(0x25)) }).promise; } catch (e) { throw new FormatError('Не удалось прочитать AI/PDF'); }
  try {
    const page = await doc.getPage(1), v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(6, Math.max(1, 3000 / Math.max(v1.width, v1.height))), vp = page.getViewport({ scale });
    checkPixels(Math.ceil(vp.width), Math.ceil(vp.height));
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    if (notes && doc.numPages > 1) notes.push(`${file.name}: взят только 1-й монтажный стол из ${doc.numPages}`);
    return canvasToFile(c, file.name);
  } finally { try { await doc.destroy(); } catch (e) {} }
}

/* ============================ EPS (встроенное превью) ============================ */
async function epsToFile(file, u8, notes) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length > 30 && dv.getUint32(0, true) === 0xC6D3D0C5) {          // DOS EPS: превью-TIFF/WMF
    const tOff = dv.getUint32(20, true), tLen = dv.getUint32(24, true);
    if (tLen > 0 && tOff + tLen <= u8.length) {
      if (notes) notes.push(`EPS ${file.name}: открыто встроенное превью (низкое разрешение)`);
      return tiffToFile(file, u8.subarray(tOff, tOff + tLen));
    }
  }
  const txt = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 8e6)));
  const m = txt.match(/%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[^\n\r]*[\r\n]+([\s\S]*?)%%EndPreview/);
  if (m) {
    const w = +m[1], h = +m[2], depth = +m[3]; checkPixels(w, h);
    const hex = m[5].replace(/^%+/gm, '').replace(/[^0-9a-fA-F]/g, ''), rowBytes = (w * depth + 7) >> 3, img = new ImageData(w, h), d = img.data;
    if (![1, 2, 4, 8].includes(depth) || hex.length < rowBytes * h * 2) throw new FormatError('Превью в этом EPS повреждено');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = x * depth, byte = parseInt(hex.substr((y * rowBytes + (bit >> 3)) * 2, 2), 16), v = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1), g = Math.round(v * 255 / ((1 << depth) - 1)), o = (y * w + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255;
    }
    if (notes) notes.push(`EPS ${file.name}: открыто встроенное чёрно-белое превью (низкое разрешение)`);
    return imageDataToFile(img, file.name);
  }
  throw new FormatError('В этом EPS нет встроенного превью, а PostScript браузер выполнить не может. Экспортируй в PNG, SVG или PDF');
}

/* ============================ XCF (GIMP), упрощённо ============================ */
async function xcfToFile(file, u8, notes) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(...u8.subarray(0, 9)) !== 'gimp xcf ') throw new FormatError('Это не XCF-файл');
  const vs = String.fromCharCode(...u8.subarray(9, 13)), ver = vs === 'file' ? 0 : parseInt(vs.slice(1), 10);
  let p = 14;
  const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  const ptr = () => { if (ver >= 11) { const v = Number(dv.getBigUint64(p)); p += 8; return v; } return u32(); };
  const str = () => { const n = u32(); if (!n) return ''; p += n; return ''; };
  const W = u32(), H = u32(); u32(); checkPixels(W, H);
  let prec = ver >= 4 ? u32() : 0, linear = false;
  if (ver >= 7) { if (prec !== 100 && prec !== 150) throw new FormatError('XCF с 16/32 битами на канал не поддерживается: экспортируй в PNG'); linear = prec === 100; }
  else if (ver >= 4 && prec !== 0) throw new FormatError('XCF с повышенной точностью не поддерживается: экспортируй в PNG');
  let comp = 0, cmap = null;
  for (;;) {
    const t = u32(), len = u32(), st = p; if (t === 0) break;
    if (t === 17) comp = u8[p]; else if (t === 1) { const n = dv.getUint32(p); cmap = u8.subarray(p + 4, p + 4 + n * 3); }
    p = st + len;
  }
  const layers = []; for (;;) { const o = ptr(); if (!o) break; layers.push(o); if (layers.length > 2000) throw new FormatError('Слишком много слоёв'); }
  if (comp === 3) throw new FormatError('Сжатие XCF «fractal» не поддерживается');
  const pako = comp === 2 ? await loadPako() : null;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const octx = out.getContext('2d');
  let simplified = false;
  for (const off of layers.slice().reverse()) {                     // слои идут сверху вниз — рисуем снизу вверх
    p = off; const lw = u32(), lh = u32(), lt = u32(); str();
    let opacity = 255, visible = 1, ox = 0, oy = 0, mode = 0, group = false;
    for (;;) {
      const t = u32(), len = u32(), st = p; if (t === 0) break;
      if (t === 6) opacity = dv.getUint32(p); else if (t === 8) visible = dv.getUint32(p); else if (t === 15) { ox = dv.getInt32(p); oy = dv.getInt32(p + 4); } else if (t === 7) mode = dv.getUint32(p); else if (t === 29) group = true;
      p = st + len;
    }
    const hier = ptr(); const mask = ptr();
    if (!visible || group || !lw || !lh || !hier) continue;
    if (mode !== 0 && mode !== 28) simplified = true; if (mask) simplified = true;
    checkPixels(lw, lh);
    p = hier; u32(); u32(); const bpp = u32(); const lvl = ptr();
    p = lvl; const lvw = u32(), lvh = u32(), tiles = [];
    for (;;) { const o = ptr(); if (!o) break; tiles.push(o); if (tiles.length > 1e6) break; }
    const tx = Math.ceil(lvw / 64), data = new Uint8ClampedArray(lvw * lvh * 4);
    for (let i = 0; i < tiles.length; i++) {
      const x0 = (i % tx) * 64, y0 = Math.floor(i / tx) * 64, tw = Math.min(64, lvw - x0), th = Math.min(64, lvh - y0); if (th <= 0) break;
      const n = tw * th, start = tiles[i], end = tiles[i + 1] || u8.length; let px;
      if (comp === 0) px = u8.subarray(start, start + n * bpp);
      else if (comp === 1) {
        px = new Uint8Array(n * bpp); let q = start;
        for (let c = 0; c < bpp; c++) {
          let o = 0;
          while (o < n && q < u8.length) {
            const v = u8[q++]; let len;
            if (v >= 128) { len = 256 - v; if (len === 128) { len = (u8[q] << 8) | u8[q + 1]; q += 2; } len = Math.min(len, n - o); for (let k = 0; k < len; k++) px[(o + k) * bpp + c] = u8[q + k]; q += len; o += len; }
            else { len = v + 1; if (len === 128) { len = (u8[q] << 8) | u8[q + 1]; q += 2; } len = Math.min(len, n - o); const val = u8[q++]; for (let k = 0; k < len; k++) px[(o + k) * bpp + c] = val; o += len; }
          }
        }
      } else { try { px = pako.inflate(u8.subarray(start, end)); } catch (e) { throw new FormatError('Не удалось распаковать слой XCF'); } }
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const s = (y * tw + x) * bpp, o = ((y0 + y) * lvw + x0 + x) * 4; let r, g, b, a = 255;
        if (lt === 0 || lt === 1) { r = px[s]; g = px[s + 1]; b = px[s + 2]; if (lt === 1) a = px[s + 3]; }
        else if (lt === 2 || lt === 3) { r = g = b = px[s]; if (lt === 3) a = px[s + 1]; }
        else { const v = px[s]; if (!cmap) throw new FormatError('В XCF нет палитры'); r = cmap[v * 3]; g = cmap[v * 3 + 1]; b = cmap[v * 3 + 2]; if (lt === 5) a = px[s + 1]; }
        if (linear) { r = toSrgb8(r / 255); g = toSrgb8(g / 255); b = toSrgb8(b / 255); }
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
      }
    }
    const lc = document.createElement('canvas'); lc.width = lvw; lc.height = lvh; lc.getContext('2d').putImageData(new ImageData(data, lvw, lvh), 0, 0);
    octx.globalAlpha = opacity / 255; octx.drawImage(lc, ox, oy); octx.globalAlpha = 1; lc.width = lc.height = 0;
  }
  if (notes) notes.push(`XCF ${file.name}: слои собраны упрощённо${simplified ? ' (режимы наложения и маски слоёв не учтены)' : ''}`);
  return canvasToFile(out, file.name);
}
