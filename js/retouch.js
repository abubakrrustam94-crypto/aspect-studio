'use strict';
/* Aspect Studio — «Умная ретушь»: Image-Adaptive-3DLUT (Zeng и др., TPAMI 2020, Apache-2.0). Небольшая нейросеть смотрит на кадр 256×256 и выбирает,
   как смешать три готовые цветовые 3D-таблицы (33³), обученные на ретуши эксперта; готовая таблица применяется к фото в полном размере. */
const RT_STYLES = {
  exp: { onnx: 'vendor/models/retouch-paired.onnx', lut: 'vendor/models/retouch-paired-lut.bin' },        // как у эксперта-ретушёра (MIT-Adobe FiveK, эксперт C)
  vivid: { onnx: 'vendor/models/retouch-unpaired.onnx', lut: 'vendor/models/retouch-unpaired-lut.bin' },   // ярче и сочнее (обучение без пар)
};
const RT_DIM = 33, RT_N = 256, RT_SZ = RT_DIM * RT_DIM * RT_DIM * 3;
const rtSig = it => `${it.rot || 0}|${it.tilt || 0}|${it.flipH ? 1 : 0}|${it.flipV ? 1 : 0}|${it.crop ? [it.crop.x, it.crop.y, it.crop.w, it.crop.h].join(',') : ''}`;
const rtLuts = {}, rtDone = {};
async function rtLoadLuts(style) {            // три таблицы подряд: [номер][b][g][r][канал]
  if (!rtLuts[style]) rtLuts[style] = (async () => {
    const r = await fetch(new URL(RT_STYLES[style].lut, document.baseURI).href);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const a = new Float32Array(await r.arrayBuffer());
    if (a.length !== RT_SZ * 3) throw new Error('таблицы повреждены');
    rtDone[style] = a; return a;
  })().catch(e => { delete rtLuts[style]; throw e; });
  return rtLuts[style];
}
async function rtWeights(bmp, style) {
  const N = RT_N, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data; c.width = c.height = 0;
  const f = new Float32Array(3 * N * N);
  for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) f[k * N * N + i] = px[i * 4 + k] / 255;
  const out = await ortRun([RT_STYLES[style].onnx], { input: { data: f, dims: [1, 3, N, N], type: 'float32' } }, undefined, true);
  return Array.from(out[Object.keys(out)[0]].data).slice(0, 3);
}
async function ensureRetouch(item, bmp, style) {
  const sig = rtSig(item);
  if (!item.rt || item.rt.sig !== sig) item.rt = { sig };
  if (item.rt[style]) return item.rt[style];
  const key = 'p_' + style;
  if (item.rt[key]) return item.rt[key];
  const rec = item.rt;
  item.rtFail = false;
  rec[key] = (async () => {
    let bz = null, cancelled = false;
    try {
      if (window.busy) bz = window.busy('Подбираю ретушь…', () => { cancelled = true; }); else toast('Подбираю ретушь…');
      const [w] = await Promise.all([rtWeights(bmp, style), rtLoadLuts(style)]);
      if (cancelled) { if (S.retouchOn) set('retouchOn', false); toast('Умная ретушь отключена'); return null; }
      rec[style] = w; return w;
    } catch (e) { item.rtFail = true; console.warn('retouch', e); return null; }
    finally { if (bz) bz.done(); rec[key] = null; }
  })();
  return rec[key];
}
/* Итоговая таблица = сумма таблиц с весами классификатора */
function rtFuse(luts, w) {
  const out = new Float32Array(RT_SZ);
  for (let k = 0; k < 3; k++) { const o = k * RT_SZ, wk = w[k]; for (let i = 0; i < RT_SZ; i++) out[i] += wk * luts[o + i]; }
  return out;
}
/* Трилинейная интерполяция — ровно как в исходном ядре (шаг 1.0001/32, fmod); amt 0…1 — доля эффекта */
function rtApplyData(d, lut, amt) {
  const dim = RT_DIM, bs = 1.0001 / (dim - 1), d1 = dim * 3, d2 = dim * dim * 3;
  for (let i = 0; i < d.length; i += 4) {
    const r0 = d[i] / 255, g0 = d[i + 1] / 255, b0 = d[i + 2] / 255;
    let ri = Math.floor(r0 / bs), gi = Math.floor(g0 / bs), bi = Math.floor(b0 / bs);
    const rd = (r0 - bs * ri) / bs, gd = (g0 - bs * gi) / bs, bd = (b0 - bs * bi) / bs;
    if (ri > dim - 2) ri = dim - 2; if (gi > dim - 2) gi = dim - 2; if (bi > dim - 2) bi = dim - 2;
    const o000 = bi * d2 + gi * d1 + ri * 3, o100 = o000 + 3, o010 = o000 + d1, o110 = o010 + 3, o001 = o000 + d2, o101 = o001 + 3, o011 = o001 + d1, o111 = o011 + 3;
    const w000 = (1 - rd) * (1 - gd) * (1 - bd), w100 = rd * (1 - gd) * (1 - bd), w010 = (1 - rd) * gd * (1 - bd), w110 = rd * gd * (1 - bd);
    const w001 = (1 - rd) * (1 - gd) * bd, w101 = rd * (1 - gd) * bd, w011 = (1 - rd) * gd * bd, w111 = rd * gd * bd;
    for (let c = 0; c < 3; c++) {
      let v = w000 * lut[o000 + c] + w100 * lut[o100 + c] + w010 * lut[o010 + c] + w110 * lut[o110 + c] + w001 * lut[o001 + c] + w101 * lut[o101 + c] + w011 * lut[o011 + c] + w111 * lut[o111 + c];
      const v0 = d[i + c] / 255; v = v0 + (v - v0) * amt;
      d[i + c] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }
}
function applyRetouch(ctx, item, L, cw, ch, c) {
  const style = c.retouchStyle === 'vivid' ? 'vivid' : 'exp', w = item.rt && item.rt.sig === rtSig(item) && item.rt[style], luts = rtDone[style];
  if (!w || !luts || !(c.retouchAmt > 0)) return;
  const ix = Math.max(0, Math.floor(L.dx)), iy = Math.max(0, Math.floor(L.dy)), ix2 = Math.min(cw, Math.ceil(L.dx + L.dw)), iy2 = Math.min(ch, Math.ceil(L.dy + L.dh)), iw = ix2 - ix, ih = iy2 - iy;
  if (iw < 4 || ih < 4) return;
  const lut = rtFuse(luts, w), amt = Math.min(1, c.retouchAmt / 100), STRIP = 128;
  for (let y = 0; y < ih; y += STRIP) {
    const h = Math.min(STRIP, ih - y), img = ctx.getImageData(ix, iy + y, iw, h);
    rtApplyData(img.data, lut, amt);
    ctx.putImageData(img, ix, iy + y);
  }
}
