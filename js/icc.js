'use strict';
/* Aspect Studio — цветовые профили ICC на LittleCMS (lcms-wasm). Нужны только для вывода не в sRGB/P3:
   Adobe RGB, Rec.2020, ProPhoto и «как у исходника» (профиль, встроенный в исходный JPG/PNG).
   Пиксели из рабочего холста (sRGB или Display P3) переводятся в профиль вывода, а сам профиль записывается в JPG/PNG. */
const ICC_OUT = {
  adobe: { name: 'Adobe RGB (1998)', file: 'vendor/icc/adobe-rgb.icc' },
  rec2020: { name: 'Rec.2020', file: 'vendor/icc/rec2020.icc' },
  prophoto: { name: 'ProPhoto RGB', file: 'vendor/icc/prophoto.icc' },
  source: { name: 'профиль исходного фото', file: null }
};
const ICC_WIDE = ['p3', ...Object.keys(ICC_OUT)];            // режимы, в которых холст рисуется в широком цвете, если исходник широкий
let iccLcms = null; const iccFiles = new Map(), iccWarned = new Set();
const iccBytes = path => { if (!iccFiles.has(path)) iccFiles.set(path, fetch(path).then(r => { if (!r.ok) throw new Error('Нет файла ' + path); return r.arrayBuffer(); }).then(b => new Uint8Array(b)).catch(e => { iccFiles.delete(path); throw e; })); return iccFiles.get(path); };
function iccLoad() {
  if (!iccLcms) iccLcms = (async () => {
    const mod = await import(new URL('vendor/icc/lcms.js', document.baseURI).href);
    const lc = await mod.instantiate({ locateFile: n => new URL('vendor/icc/' + n, document.baseURI).href });
    return { lc, mod };
  })().catch(e => { iccLcms = null; throw e; });
  return iccLcms;
}
/* Профиль, встроенный в исходный файл: JPEG (APP2 ICC_PROFILE, может быть из нескольких частей) или PNG (iCCP, сжат zlib) */
async function iccFromFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    const parts = [];
    for (let p = 2; p + 4 < buf.length && buf[p] === 0xFF;) {
      const m = buf[p + 1], len = (buf[p + 2] << 8) | buf[p + 3];
      if (m === 0xDA || len < 2) break;
      if (m === 0xE2 && len > 16 && String.fromCharCode(...buf.subarray(p + 4, p + 15)) === 'ICC_PROFILE') parts.push({ n: buf[p + 16], d: buf.subarray(p + 18, p + 2 + len) });
      p += 2 + len;
    }
    if (!parts.length) return null;
    parts.sort((a, b) => a.n - b.n); const out = new Uint8Array(parts.reduce((s, x) => s + x.d.length, 0)); let o = 0; parts.forEach(x => { out.set(x.d, o); o += x.d.length; });
    return out;
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && typeof DecompressionStream !== 'undefined') {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
    for (let p = 8; p + 12 <= buf.length;) {
      const len = dv.getUint32(p), nm = String.fromCharCode(...buf.subarray(p + 4, p + 8));
      if (nm === 'iCCP') {
        let z = p + 8; while (buf[z] && z < p + 8 + 80) z++;                // имя профиля, затем 0 и метод сжатия
        const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(buf.subarray(z + 2, p + 8 + len)); w.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
      }
      if (nm === 'IDAT') break; p += 12 + len;
    }
  }
  return null;
}
const iccOf = async item => { if (item._icc === undefined) item._icc = await iccFromFile(item.exifSrc || item.file).catch(() => null); return item._icc; };

/* Вернёт { canvas, icc } — новый sRGB-холст с числами в профиле вывода и байты профиля; null, если перевод не нужен или невозможен */
async function iccApply(c, item, fmt) {
  const sel = S.colorSpace, out = ICC_OUT[sel]; if (!out) return null;
  if (fmt !== 'jpg' && fmt !== 'png') {
    if (!iccWarned.has('fmt')) { iccWarned.add('fmt'); toast(`Профиль «${out.name}» записывается только в JPG и PNG. В ${fmt.toUpperCase()} сохранён обычный цвет`, true, { ms: 7000 }); }
    return null;
  }
  if (!compInstalled('icc')) { compWarnOnce('icc', 'Цветовые профили'); return null; }
  let bytes = null;
  if (sel === 'source') {
    bytes = await iccOf(item);
    if (!bytes) { const k = 'nosrc' + item.id; if (!iccWarned.has(k)) { iccWarned.add(k); toast(`У «${item.name}» нет встроенного профиля: сохранён sRGB`, true, { ms: 6000 }); } return null; }
  } else bytes = await iccBytes(out.file);
  const { lc, mod } = await iccLoad();
  const ctx = c.getContext('2d'), cs = ctxCS(ctx);
  const inBytes = cs === 'srgb' ? null : await iccBytes('vendor/icc/display-p3.icc');
  const hIn = inBytes ? lc.cmsOpenProfileFromMem(inBytes, inBytes.length) : lc.cmsCreate_sRGBProfile(), hOut = lc.cmsOpenProfileFromMem(bytes, bytes.length);
  let t = 0;
  try {
    if (!hIn || !hOut || lc.cmsGetColorSpaceASCII(hOut) !== 'RGB') {
      if (sel === 'source') { const k = 'badsrc' + item.id; if (!iccWarned.has(k)) { iccWarned.add(k); toast(`Профиль «${item.name}» не RGB или повреждён: сохранён sRGB`, true, { ms: 6000 }); } }
      return null;
    }
    t = lc.cmsCreateTransform(hIn, mod.TYPE_RGBA_8, hOut, mod.TYPE_RGBA_8, mod.INTENT_RELATIVE_COLORIMETRIC, mod.cmsFLAGS_BLACKPOINTCOMPENSATION || 0x2000);
    if (!t) return null;
    const w = c.width, h = c.height, rows = Math.max(1, Math.floor(1e6 / w)), o = mkCanvas(w, h), octx = o.getContext('2d');
    for (let y = 0; y < h; y += rows) {
      const n = Math.min(rows, h - y), id = getPix(ctx, 0, y, w, n, cs), src = id.data, res = lc.cmsDoTransform(t, src, w * n), dst = new Uint8ClampedArray(w * n * 4);
      for (let i = 0; i < src.length; i += 4) { dst[i] = res[i]; dst[i + 1] = res[i + 1]; dst[i + 2] = res[i + 2]; dst[i + 3] = src[i + 3]; }
      octx.putImageData(new ImageData(dst, w, n), 0, y);
      if ((y / rows) % 2 === 1) await yieldUI();
    }
    return { canvas: o, icc: bytes };
  } finally { if (t) lc.cmsDeleteTransform(t); if (hIn) lc.cmsCloseProfile(hIn); if (hOut) lc.cmsCloseProfile(hOut); }
}

/* Записать профиль в файл: JPEG — сегменты APP2, PNG — чанк iCCP (чанки sRGB/gAMA/cHRM убираем: рядом с iCCP они противоречат) */
function iccJpegSegs(bytes) {
  const MAX = 65519, n = Math.ceil(bytes.length / MAX), segs = [];
  for (let i = 0; i < n; i++) {
    const part = bytes.subarray(i * MAX, (i + 1) * MAX), seg = new Uint8Array(18 + part.length), len = 16 + part.length;
    seg.set([0xFF, 0xE2, len >> 8, len & 255, ...[...'ICC_PROFILE'].map(ch => ch.charCodeAt(0)), 0, i + 1, n]); seg.set(part, 18); segs.push(seg);
  }
  return segs;
}
async function iccPngChunk(bytes) {
  const cs = new CompressionStream('deflate'), w = cs.writable.getWriter(); w.write(bytes); w.close();
  const z = new Uint8Array(await new Response(cs.readable).arrayBuffer()), name = [...'icc'].map(ch => ch.charCodeAt(0)), body = new Uint8Array(4 + name.length + 2 + z.length);
  body.set([0x69, 0x43, 0x43, 0x50, ...name, 0, 0]); body.set(z, 4 + name.length + 2);
  const chunk = new Uint8Array(12 + body.length - 4), dv = new DataView(chunk.buffer);
  dv.setUint32(0, body.length - 4); chunk.set(body, 4); dv.setUint32(8 + body.length - 4, crc32(body));
  return chunk;
}
async function iccEmbed(blob, bytes) {
  if (blob.type === 'image/jpeg') return jpegWithIcc(blob, iccJpegSegs(bytes));
  if (blob.type === 'image/png') {
    const src = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(src.buffer), parts = [src.subarray(0, 33), await iccPngChunk(bytes)];
    for (let p = 33; p + 12 <= src.length;) {
      const len = dv.getUint32(p), nm = String.fromCharCode(...src.subarray(p + 4, p + 8));
      if (!['sRGB', 'gAMA', 'cHRM', 'iCCP'].includes(nm)) parts.push(src.subarray(p, p + 12 + len));
      p += 12 + len;
    }
    return new Blob(parts, { type: 'image/png' });
  }
  return blob;
}
