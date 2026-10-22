'use strict';
/* Aspect Studio — кодирование: MozJPEG, оптимизатор PNG, AVIF, JPEG XL (компоненты, по желанию).
   Без компонента всё работает как раньше — через встроенный кодер браузера. */
let encPool = [], encSeq = 0, encIdle = 0; const encWait = new Map();
const ENC_IDLE_MS = 45000;
function encKill() { clearTimeout(encIdle); encPool.forEach(w => { try { w.terminate(); } catch (e) {} }); encPool = []; encWait.forEach(w => w.rej(new Error('Кодер остановлен'))); encWait.clear(); }
function encWorker() {
  if (typeof Worker === 'undefined') throw new Error('Воркеры недоступны');
  const busy = w => { let n = 0; encWait.forEach(x => { if (x.w === w) n++; }); return n; };
  let w = encPool.find(x => !busy(x));
  if (!w && encPool.length < 2 && (typeof DEV_MEM === 'undefined' || DEV_MEM >= 4)) {
    w = new Worker('js/enc-worker.js');
    w.onmessage = e => { const x = encWait.get(e.data.id); if (!x) return; encWait.delete(e.data.id); e.data.ok ? x.res(e.data) : x.rej(new Error(e.data.error)); };
    w.onerror = e => { e.preventDefault(); if (typeof compRefresh === 'function') compRefresh(); encWait.forEach(x => { if (x.w === w) x.rej(new Error('Кодер не запустился')); }); try { w.terminate(); } catch (_) {} encPool = encPool.filter(y => y !== w); };
    encPool.push(w);
  }
  return w || encPool.reduce((a, b) => busy(a) <= busy(b) ? a : b);
}
function encCall(msg, transfer) {
  clearTimeout(encIdle);
  const w = encWorker();
  return new Promise((res, rej) => { const id = ++encSeq; encWait.set(id, { res, rej, w }); w.postMessage({ ...msg, id }, transfer || []); })
    .finally(() => { clearTimeout(encIdle); if (!encWait.size) encIdle = setTimeout(encKill, ENC_IDLE_MS); });
}

const ENC_COMP = { jpg: 'encjpeg', png: 'encpng', avif: 'encavif', jxl: 'encjxl' };
const encEffort = () => ({ fast: 0, normal: 1, best: 2 })[S.encEffort] ?? 1;
/* Какие кодеры реально работают сейчас: нужен и выбор в настройках, и скачанный компонент */
function encUses(fmt) {
  if (!ENC_COMP[fmt] || !compInstalled(ENC_COMP[fmt])) return false;
  if (fmt === 'jpg') return S.jpgEngine === 'moz';
  if (fmt === 'png') return S.pngOpt !== 'off';
  return fmt === 'avif' || fmt === 'jxl';
}
const nativeBlob = (c, mime, q) => new Promise(r => c.toBlob(r, mime, q));

/* ICC профиль Display P3 берём у самого браузера: он кладёт его в файл, когда холст в широком цвете */
let encP3 = null;
function p3Segments() {
  if (!encP3) encP3 = (async () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 2; const x = c.getContext('2d', { colorSpace: 'display-p3' }); x.fillStyle = '#c33'; x.fillRect(0, 0, 2, 2);
      const jpg = new Uint8Array(await (await nativeBlob(c, 'image/jpeg', 0.9)).arrayBuffer()), segs = [];
      for (let p = 2; p + 4 < jpg.length && jpg[p] === 0xFF;) {
        const m = jpg[p + 1], len = (jpg[p + 2] << 8) | jpg[p + 3];
        if (m === 0xDA) break;
        if (m === 0xE2 && String.fromCharCode(...jpg.subarray(p + 4, p + 15)) === 'ICC_PROFILE') segs.push(jpg.slice(p, p + 2 + len));
        p += 2 + len;
      }
      const png = new Uint8Array(await (await nativeBlob(c, 'image/png')).arrayBuffer()), dv = new DataView(png.buffer); let chunk = null;
      for (let p = 8; p + 12 <= png.length;) { const len = dv.getUint32(p), nm = String.fromCharCode(...png.subarray(p + 4, p + 8)); if (nm === 'iCCP') { chunk = png.slice(p, p + 12 + len); break; } if (nm === 'IDAT') break; p += 12 + len; }
      return { jpg: segs.length ? segs : null, png: chunk };
    } catch (e) { return { jpg: null, png: null }; }
  })();
  return encP3;
}
async function jpegWithIcc(blob, segs) {
  const src = new Uint8Array(await blob.arrayBuffer()); let at = 2;
  if (src[2] === 0xFF && src[3] === 0xE0) at = 4 + ((src[4] << 8) | src[5]);
  return new Blob([src.subarray(0, at), ...segs, src.subarray(at)], { type: 'image/jpeg' });
}
async function pngWithIcc(blob, chunk) {
  const src = new Uint8Array(await blob.arrayBuffer());
  return new Blob([src.subarray(0, 33), chunk, src.subarray(33)], { type: 'image/png' });   // после IHDR (8 + 25 байт)
}
const encPixels = (c, wide) => {
  const x = c.getContext('2d'), cs = ctxCS(x);
  return { id: getPix(x, 0, 0, c.width, c.height, wide ? cs : 'srgb'), cs };
};
const ENC_MAX_MP = { avif: 40e6, jxl: 60e6 };
function encCheckSize(c, fmt) {
  const lim = ENC_MAX_MP[fmt];
  if (lim && c.width * c.height > lim) throw new Error(`Слишком большая картинка для ${fmt.toUpperCase()} (${Math.round(c.width * c.height / 1e6)} Мпикс). Уменьши «Макс. сторону».`);
}
const MOZ_BASE = { quality: 75, baseline: false, arithmetic: false, progressive: true, optimize_coding: true, smoothing: 0, color_space: 3, quant_table: 3, trellis_multipass: false, trellis_opt_zero: false, trellis_opt_table: false, trellis_loops: 1, auto_subsample: true, chroma_subsample: 2, separate_chroma_quality: false, chroma_quality: 75 };
async function encMoz(c, q) {
  const icc = ctxCS(c.getContext('2d')) !== 'srgb' ? (await p3Segments()).jpg : null;
  const { id } = encPixels(c, !!icc), e = encEffort(), hi = q >= 0.95;
  const opts = { ...MOZ_BASE, quality: Math.round(q * 100), trellis_multipass: e >= 2, trellis_opt_zero: e >= 2, trellis_opt_table: e >= 2, auto_subsample: !hi, chroma_subsample: hi ? 1 : 2, chroma_quality: Math.round(q * 100) };
  const r = await encCall({ type: 'jpeg', data: id.data.buffer, w: c.width, h: c.height, opts }, [id.data.buffer]);
  let blob = new Blob([r.buf], { type: 'image/jpeg' });
  if (icc) blob = await jpegWithIcc(blob, icc);
  return blob;
}
const avifQ = q => Math.round(30 + (Math.min(0.99, q) * 100 - 50) * 1.1);        // 50→30, 75→57, 92→76, 99→85
async function encModern(c, fmt, q) {
  encCheckSize(c, fmt);
  const { id } = encPixels(c, false), e = encEffort();
  const opts = fmt === 'avif'
    ? { quality: avifQ(q), qualityAlpha: -1, denoiseLevel: 0, tileRowsLog2: 0, tileColsLog2: 0, speed: [8, 6, 4][e], subsample: q >= 0.95 ? 3 : 1, chromaDeltaQ: false, sharpness: 0, tune: 0, enableSharpYUV: false, bitDepth: 8 }
    : { effort: [5, 7, 8][e], quality: Math.round(Math.min(0.99, q) * 100), progressive: false, epf: -1, lossyPalette: false, decodingSpeedTier: 0, photonNoiseIso: 0, lossyModular: false, lossless: q >= 1 };
  const r = await encCall({ type: fmt, data: id.data.buffer, w: c.width, h: c.height, opts }, [id.data.buffer]);
  return new Blob([r.buf], { type: fmt === 'avif' ? 'image/avif' : 'image/jxl' });
}
async function encPng(c) {
  const e = encEffort(), level = [1, 3, 4][e], wide = ctxCS(c.getContext('2d')) !== 'srgb';
  if (S.pngOpt === 'lossy') {
    const icc = wide ? (await p3Segments()).png : null;
    const { id } = encPixels(c, !!icc);
    const r = await encCall({ type: 'pngq', data: id.data.buffer, w: c.width, h: c.height, colors: Math.max(2, Math.min(256, +S.pngColors || 256)), level, dither: true }, [id.data.buffer]);
    let blob = new Blob([r.buf], { type: 'image/png' });
    if (icc) blob = await pngWithIcc(blob, icc);
    return blob;
  }
  const png = await nativeBlob(c, 'image/png');
  if (!png) return png;
  const r = await encCall({ type: 'png', data: await png.arrayBuffer(), level, alpha: false });
  return r.buf.byteLength < png.size ? new Blob([r.buf], { type: 'image/png' }) : png;
}
/* Главный вход: холст → файл нужного формата. q — от 0 до 1. */
async function encodeBlob(c, fmt, q) {
  if (encUses(fmt)) {
    if (fmt === 'jpg') return encMoz(c, q);
    if (fmt === 'png') return encPng(c);
    return encModern(c, fmt, q);
  }
  return nativeBlob(c, MIME[fmt], q);
}
