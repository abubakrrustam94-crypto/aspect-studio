'use strict';
/* Aspect Studio — размытие по глубине («портретный режим»): MiDaS small оценивает, что ближе, а что дальше;
   резко остаётся то, что на той же глубине, что и главный объект. Карта глубины считается один раз на кадр. */
const DP_MODEL = ['vendor/models/depth-midas-s.onnx.p1', 'vendor/models/depth-midas-s.onnx.p2'], DP_N = 256;
const dpSig = it => `${it.rot || 0}|${it.tilt || 0}|${it.flipH ? 1 : 0}|${it.flipV ? 1 : 0}|${it.crop ? [it.crop.x, it.crop.y, it.crop.w, it.crop.h].join(',') : ''}`;

async function depthCompute(bmp) {
  const N = DP_N, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data; c.width = c.height = 0;
  const f = new Float32Array(3 * N * N), mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) f[k * N * N + i] = (px[i * 4 + k] / 255 - mean[k]) / std[k];
  const out = await ortRun(DP_MODEL, { '0': { data: f, dims: [1, 3, N, N], type: 'float32' } });
  const a = out[Object.keys(out)[0]].data, s = Float32Array.from(a).sort(), lo = s[Math.floor(s.length * .02)], hi = s[Math.floor(s.length * .98)], k = 1 / ((hi - lo) || 1);
  const d = new Float32Array(N * N);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(0, Math.min(1, (a[i] - lo) * k));        // 1 — близко, 0 — далеко
  return { n: N, d };
}
async function ensureDepth(item, bmp) {
  const sig = dpSig(item);
  if (item.depth && item.depth.sig === sig) return item.depth;
  if (item.depthP && item.depthP.sig === sig) return item.depthP.p;
  const rec = { sig }; item.depthFail = false;
  rec.p = (async () => {
    try { toast('Считаю глубину кадра…'); const r = await depthCompute(bmp); item.depth = { sig, ...r }; return item.depth; }
    catch (e) { item.depthFail = true; console.warn('depth', e); return null; }
    finally { if (item.depthP === rec) item.depthP = null; }
  })();
  item.depthP = rec;
  return rec.p;
}
function depthSubject(item) {          // где главный объект: ручной фокус, найденное лицо/объект или центр
  if (item.manual && item.focus) return item.focus;
  const an = item.an; if (an && an.subject) return an.subject;
  return item.focus || { x: .5, y: .5 };
}
function depthAt(D, x, y) {            // среднее в окне 7×7 вокруг точки (доли кадра)
  const n = D.n, cx = Math.round(Math.max(0, Math.min(1, x)) * (n - 1)), cy = Math.round(Math.max(0, Math.min(1, y)) * (n - 1));
  let s = 0, k = 0; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const xx = cx + i, yy = cy + j; if (xx >= 0 && yy >= 0 && xx < n && yy < n) { s += D.d[yy * n + xx]; k++; } }
  return s / k;
}
function depthBlurCanvas(src, sx, sy, iw, ih, r) {      // размытие без ctx.filter: уменьшение и ступенчатое увеличение
  const div = Math.max(2, r * 1.2), tw = Math.max(4, Math.round(iw / div)), th = Math.max(4, Math.round(ih / div));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; return [c, g]; };
  let [cur, cg] = mk(tw, th); cg.drawImage(src, sx, sy, iw, ih, 0, 0, tw, th);
  while (cur.width * 2 < iw) { const [nx, ng] = mk(cur.width * 2, cur.height * 2); ng.drawImage(cur, 0, 0, nx.width, nx.height); cur = nx; }
  const [out, og] = mk(iw, ih); og.drawImage(cur, 0, 0, iw, ih); return out;
}
/* Маска «что размыть»: грубая карта глубины 256² растягивается до рабочего размера и подтягивается к краям самого фото
   направляющим фильтром — размытие перестаёт заходить на объект и оставлять светлый ореол. */
function depthRefineMask(D, d0, lum, mw, mh) {
  const n = D.n, p = new Float32Array(mw * mh), T0 = 0.10, T1 = 0.42;
  for (let y = 0; y < mh; y++) {
    const fy = Math.max(0, Math.min(n - 1, (y + .5) / mh * n - .5)), y0 = Math.floor(fy), y1 = Math.min(n - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < mw; x++) {
      const fx = Math.max(0, Math.min(n - 1, (x + .5) / mw * n - .5)), x0 = Math.floor(fx), x1 = Math.min(n - 1, x0 + 1), tx = fx - x0;
      const v = (D.d[y0 * n + x0] * (1 - tx) + D.d[y0 * n + x1] * tx) * (1 - ty) + (D.d[y1 * n + x0] * (1 - tx) + D.d[y1 * n + x1] * tx) * ty;
      const t = Math.max(0, Math.min(1, (Math.abs(v - d0) - T0) / (T1 - T0)));
      p[y * mw + x] = t * t * (3 - 2 * t);
    }
  }
  const r = Math.max(4, Math.round(Math.max(mw, mh) / 60));
  let q = coGuided(lum, p, mw, mh, r, 2e-4); q = coGuided(lum, q, mw, mh, r, 2e-4);     // два прохода: край садится ближе к границе объекта
  for (let i = 0; i < q.length; i++) { const v = q[i]; q[i] = v < 0.04 ? 0 : v > 0.96 ? 1 : v; }
  return q;
}
function applyDepthBlur(ctx, item, L, cw, ch, c) {
  const D = item.depth; if (!D || D.sig !== dpSig(item) || !(c.depthBlur > 0)) return;
  const ix = Math.max(0, Math.floor(L.dx)), iy = Math.max(0, Math.floor(L.dy)), ix2 = Math.min(cw, Math.ceil(L.dx + L.dw)), iy2 = Math.min(ch, Math.ceil(L.dy + L.dh)), iw = ix2 - ix, ih = iy2 - iy;
  if (iw < 8 || ih < 8) return;
  const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, w); cv.height = Math.max(1, h); return [cv, cv.getContext('2d', { willReadFrequently: false })]; };
  const k = Math.min(1, 1600 / Math.max(iw, ih)), ws = Math.max(8, Math.round(iw * k)), hs = Math.max(8, Math.round(ih * k));
  const r = Math.max(1.5, c.depthBlur / 100 * 0.03 * Math.max(L.dw, L.dh)) * k;
  const [ph, pg] = mk(ws, hs); pg.imageSmoothingQuality = 'high'; pg.drawImage(ctx.canvas, ix, iy, iw, ih, 0, 0, ws, hs);
  // направляющая яркость (≤640 px по длинной стороне)
  const km = Math.min(1, 640 / Math.max(ws, hs)), mw = Math.max(8, Math.round(ws * km)), mh = Math.max(8, Math.round(hs * km));
  const [sm, sg] = mk(mw, mh); sg.imageSmoothingQuality = 'high'; sg.drawImage(ph, 0, 0, mw, mh);
  const px = sg.getImageData(0, 0, mw, mh).data, lum = new Float32Array(mw * mh);
  for (let i = 0; i < lum.length; i++) lum[i] = (.299 * px[i * 4] + .587 * px[i * 4 + 1] + .114 * px[i * 4 + 2]) / 255;
  sm.width = sm.height = 0;
  const sub = depthSubject(item), q = depthRefineMask(D, depthAt(D, sub.x, sub.y), lum, mw, mh);
  const [mc, mg] = mk(mw, mh), id = mg.createImageData(mw, mh);
  for (let i = 0; i < q.length; i++) id.data[i * 4 + 3] = Math.round(q[i] * 255);
  mg.putImageData(id, 0, 0);
  // обычное размытие + размытие только по «фоновым» пикселям (без подмешивания цвета объекта)
  const plain = depthBlurCanvas(ph, 0, 0, ws, hs, r);
  const [pm, pmg] = mk(ws, hs); pmg.drawImage(ph, 0, 0); pmg.globalCompositeOperation = 'destination-in'; pmg.imageSmoothingQuality = 'high'; pmg.drawImage(mc, 0, 0, ws, hs);
  const nb = depthBlurCanvas(pm, 0, 0, ws, hs, r), lg = plain.getContext('2d');
  lg.drawImage(nb, 0, 0); lg.globalCompositeOperation = 'destination-in'; lg.imageSmoothingQuality = 'high'; lg.drawImage(mc, 0, 0, ws, hs);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(plain, 0, 0, ws, hs, ix, iy, iw, ih);
  for (const z of [ph, mc, pm, nb, plain]) z.width = z.height = 0;
}
