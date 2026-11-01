'use strict';
/* Aspect Studio — «Ночной свет»: Zero-DCE++ (Li-Chongyi, только для некоммерческого использования) по кадру 256×256 строит карту кривых
   яркости; сами кривые применяются к фото в полном размере (8 шагов x += r·(x²−x)). Тёмные места светлеют, света не выжигаются. */
const LL_MODEL = ['vendor/models/lowlight-zdce.onnx'], LL_N = 256;

async function lowCompute(bmp) {
  const N = LL_N, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data; c.width = c.height = 0;
  const f = new Float32Array(3 * N * N);
  for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) f[k * N * N + i] = px[i * 4 + k] / 255;
  const out = await ortRun(LL_MODEL, { input: { data: f, dims: [1, 3, N, N], type: 'float32' } }, undefined, true);
  return { n: N, r: Float32Array.from(out[Object.keys(out)[0]].data) };
}
async function ensureLow(item, bmp) {
  const sig = dpSig(item);
  if (item.low && item.low.sig === sig) return item.low;
  if (item.lowP && item.lowP.sig === sig) return item.lowP.p;
  const rec = { sig }; item.lowFail = false;
  rec.p = (async () => {
    let bz = null;
    try {
      if (window.busy) bz = window.busy('Считаю карту света…', () => { rec.cancelled = true; }); else toast('Считаю карту света…');
      const r = await lowCompute(bmp);
      if (rec.cancelled) { if (S.lowOn) set('lowOn', false); toast('Ночной свет отключён'); return null; }
      item.low = { sig, ...r }; return item.low;
    } catch (e) { item.lowFail = true; console.warn('lowlight', e); return null; }
    finally { if (bz) bz.done(); if (item.lowP === rec) item.lowP = null; }
  })();
  item.lowP = rec;
  return rec.p;
}
/* Применяет кривые к данным RGBA (сетка W×H) — часть кадра с началом (ox, oy) внутри области размером iw×ih. amt: 0…1 */
function lowApplyData(d, W, H, ox, oy, iw, ih, M, amt) {
  const n = M.n, r = M.r, nn = n * n, X0 = new Int32Array(W), X1 = new Int32Array(W), TX = new Float32Array(W);
  for (let x = 0; x < W; x++) { const f = Math.max(0, Math.min(n - 1, (ox + x + .5) / iw * n - .5)), a = Math.floor(f); X0[x] = a; X1[x] = Math.min(n - 1, a + 1); TX[x] = f - a; }
  for (let y = 0; y < H; y++) {
    const f = Math.max(0, Math.min(n - 1, (oy + y + .5) / ih * n - .5)), y0 = Math.floor(f), y1 = Math.min(n - 1, y0 + 1), ty = f - y0, r0 = y0 * n, r1 = y1 * n;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = X0[x], b = X1[x], tx = TX[x];
      for (let k = 0; k < 3; k++) {
        const o = k * nn, rr = ((r[o + r0 + a] * (1 - tx) + r[o + r0 + b] * tx) * (1 - ty) + (r[o + r1 + a] * (1 - tx) + r[o + r1 + b] * tx) * ty);
        const x0 = d[i + k] / 255; let v = x0;
        for (let s = 0; s < 8; s++) v += rr * (v * v - v);
        v = x0 + (v - x0) * amt;
        d[i + k] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
      }
    }
  }
}
function applyLowLight(ctx, item, L, cw, ch, c) {
  const M = item.low; if (!M || M.sig !== dpSig(item) || !(c.lowAmt > 0)) return;
  const ix = Math.max(0, Math.floor(L.dx)), iy = Math.max(0, Math.floor(L.dy)), ix2 = Math.min(cw, Math.ceil(L.dx + L.dw)), iy2 = Math.min(ch, Math.ceil(L.dy + L.dh)), iw = ix2 - ix, ih = iy2 - iy;
  if (iw < 4 || ih < 4) return;
  const amt = Math.min(1, c.lowAmt / 100), STRIP = 128;
  for (let y = 0; y < ih; y += STRIP) {
    const h = Math.min(STRIP, ih - y), img = ctx.getImageData(ix, iy + y, iw, h);
    lowApplyData(img.data, iw, h, ix - L.dx, iy + y - L.dy, L.dw, L.dh, M, amt);
    ctx.putImageData(img, ix, iy + y);
  }
}
