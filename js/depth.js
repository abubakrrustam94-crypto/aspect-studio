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
function applyDepthBlur(ctx, item, L, cw, ch, c) {
  const D = item.depth; if (!D || D.sig !== dpSig(item) || !(c.depthBlur > 0)) return;
  const ix = Math.max(0, Math.floor(L.dx)), iy = Math.max(0, Math.floor(L.dy)), ix2 = Math.min(cw, Math.ceil(L.dx + L.dw)), iy2 = Math.min(ch, Math.ceil(L.dy + L.dh)), iw = ix2 - ix, ih = iy2 - iy;
  if (iw < 8 || ih < 8) return;
  const r = Math.max(1.5, c.depthBlur / 100 * 0.03 * Math.max(L.dw, L.dh));
  const blur = depthBlurCanvas(ctx.canvas, ix, iy, iw, ih, r);
  const sub = depthSubject(item), d0 = depthAt(D, sub.x, sub.y), n = D.n;
  const m = document.createElement('canvas'); m.width = m.height = n; const mg = m.getContext('2d'), id = mg.createImageData(n, n);
  const T0 = 0.10, T1 = 0.42;
  for (let i = 0; i < n * n; i++) { const t = Math.max(0, Math.min(1, (Math.abs(D.d[i] - d0) - T0) / (T1 - T0))), a = t * t * (3 - 2 * t); id.data[i * 4 + 3] = Math.round(a * 255); }
  mg.putImageData(id, 0, 0);
  const lay = document.createElement('canvas'); lay.width = iw; lay.height = ih; const lg = lay.getContext('2d');
  lg.drawImage(blur, 0, 0); lg.globalCompositeOperation = 'destination-in'; lg.imageSmoothingQuality = 'high';
  lg.drawImage(m, L.dx - ix, L.dy - iy, L.dw, L.dh);
  ctx.drawImage(lay, ix, iy);
  blur.width = blur.height = lay.width = lay.height = m.width = m.height = 0;
}
