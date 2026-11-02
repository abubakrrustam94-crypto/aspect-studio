'use strict';
/* Aspect Studio — «Ночной свет»: Zero-DCE++ (Li-Chongyi, только для некоммерческого использования) по кадру 256×256 строит карту кривых
   яркости; сами кривые применяются к фото в полном размере (8 шагов x += r·(x²−x)). Тёмные места светлеют, света не выжигаются. */
const llSig = it => `${it.rot || 0}|${it.tilt || 0}|${it.flipH ? 1 : 0}|${it.flipV ? 1 : 0}|${it.crop ? [it.crop.x, it.crop.y, it.crop.w, it.crop.h].join(',') : ''}`;
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
  const sig = llSig(item);
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
/* Шум после осветления: тёмные места на фото шумят, а кривые усиливают этот шум в разы. Лёгкое сглаживание с защитой краёв включается
   только там, где пиксель заметно посветлел (gain), и тем сильнее, чем сильнее подъём. Светлые и нетронутые места не размываются. */
function lowBoxRGB(d, W, H, r) {
  const n = 2 * r + 1, tmp = new Float32Array(W * H * 3), out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let k = 0; k < 3; k++) {
    let a = 0; for (let x = -r; x <= r; x++) a += d[(y * W + Math.min(W - 1, Math.max(0, x))) * 4 + k];
    for (let x = 0; x < W; x++) { tmp[(y * W + x) * 3 + k] = a / n; a += d[(y * W + Math.min(W - 1, x + r + 1)) * 4 + k] - d[(y * W + Math.max(0, x - r)) * 4 + k]; }
  }
  for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) {
    let a = 0; for (let y = -r; y <= r; y++) a += tmp[(Math.min(H - 1, Math.max(0, y)) * W + x) * 3 + k];
    for (let y = 0; y < H; y++) { out[(y * W + x) * 3 + k] = a / n; a += tmp[(Math.min(H - 1, y + r + 1) * W + x) * 3 + k] - tmp[(Math.max(0, y - r) * W + x) * 3 + k]; }
  }
  return out;
}
/* d — данные ПОСЛЕ кривых; lum0 — яркость каждого пикселя ДО них (0…255); dn 0…1 — сила; r — радиус (1…3) */
function lowDenoiseData(d, lum0, W, H, r, dn) {
  if (!(dn > 0) || W < 3 || H < 3) return 0;
  const blur = lowBoxRGB(d, W, H, r); let touched = 0;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const l1 = .299 * d[p] + .587 * d[p + 1] + .114 * d[p + 2], gain = (l1 + 3) / (lum0[i] + 3);
    const w = Math.max(0, Math.min(1, (gain - 1.25) / .9));
    if (w <= 0) continue;
    const sig = 6 + 5 * gain;
    let df = 0; for (let k = 0; k < 3; k++) df = Math.max(df, Math.abs(blur[i * 3 + k] - d[p + k]));
    const t = Math.min(1, w * dn * 1.6) * Math.exp(-(df / sig) * (df / sig));
    if (t < .01) continue; touched++;
    for (let k = 0; k < 3; k++) d[p + k] = Math.round(d[p + k] + (blur[i * 3 + k] - d[p + k]) * t);
  }
  return touched;
}
function applyLowLight(ctx, item, L, cw, ch, c) {
  const M = item.low; if (!M || M.sig !== llSig(item) || !(c.lowAmt > 0)) return;
  const ix = Math.max(0, Math.floor(L.dx)), iy = Math.max(0, Math.floor(L.dy)), ix2 = Math.min(cw, Math.ceil(L.dx + L.dw)), iy2 = Math.min(ch, Math.ceil(L.dy + L.dh)), iw = ix2 - ix, ih = iy2 - iy;
  if (iw < 4 || ih < 4) return;
  const amt = Math.min(1, c.lowAmt / 100), dn = Math.max(0, Math.min(1, (c.lowDn === undefined ? 50 : c.lowDn) / 100)), STRIP = 128;
  const r = dn > 0 ? Math.max(1, Math.min(3, Math.round(iw / 1500))) + (dn > .75 ? 1 : 0) : 0;
  for (let y = 0; y < ih; y += STRIP) {
    const h = Math.min(STRIP, ih - y), y0 = Math.max(0, y - r), y1 = Math.min(ih, y + h + r), hh = y1 - y0;
    const img = ctx.getImageData(ix, iy + y0, iw, hh), d = img.data;
    let lum0 = null;
    if (dn > 0) { lum0 = new Float32Array(iw * hh); for (let i = 0, p = 0; i < lum0.length; i++, p += 4) lum0[i] = .299 * d[p] + .587 * d[p + 1] + .114 * d[p + 2]; }
    lowApplyData(d, iw, hh, ix - L.dx, iy + y0 - L.dy, L.dw, L.dh, M, amt);
    if (dn > 0) lowDenoiseData(d, lum0, iw, hh, r, dn);
    ctx.putImageData(img, ix, iy + y0, 0, y - y0, iw, h);
  }
}
