'use strict';
/* Воркер определения лиц: BlazeFace на tfjs (WASM, при неудаче — CPU). Работает вне основного потока, интерфейс не подвисает. */
const DIR = new URL('../vendor/blazeface/', self.location.href).href;
importScripts(DIR + 'runtime.js');
const { tf, loadGraphModel, setWasmPaths } = self.BlazeFaceLib;
const SIZE = 256;                                    // модель «back»: вход 256×256
let model = null, anchors = null, backend = '';

// Якоря SSD как в MediaPipe: шаги 16 и 32; 2 якоря на ячейку первого слоя и 6 — на втором
function makeAnchors() {
  const out = [];
  [[16, 2], [32, 6]].forEach(([st, per]) => {
    const g = SIZE / st;
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) for (let k = 0; k < per; k++) out.push([(x + .5) / g, (y + .5) / g]);
  });
  return out;
}
async function init() {
  setWasmPaths(DIR);
  try { await tf.setBackend('wasm'); } catch (e) { await tf.setBackend('cpu'); }
  await tf.ready(); backend = tf.getBackend();
  model = await loadGraphModel(DIR + 'blazeface-back.json');
  anchors = makeAnchors();
}
const sigmoid = v => 1 / (1 + Math.exp(-Math.max(-80, Math.min(80, v))));
function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0), u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
}
async function detect(rgba, minScore) {
  const rgb = new Float32Array(SIZE * SIZE * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i] / 127.5 - 1; rgb[j + 1] = rgba[i + 1] / 127.5 - 1; rgb[j + 2] = rgba[i + 2] / 127.5 - 1; }
  const input = tf.tensor4d(rgb, [1, SIZE, SIZE, 3]);
  let outs; try { outs = await model.executeAsync(input); } finally { input.dispose(); }
  const arr = Array.isArray(outs) ? outs : [outs], data = [];
  for (const t of arr) data.push({ n: t.shape[1], d: t.shape[2], v: await t.data() }); arr.forEach(t => t.dispose());
  const regs = data.filter(x => x.d === 16).sort((a, b) => b.n - a.n), scs = data.filter(x => x.d === 1).sort((a, b) => b.n - a.n);   // сначала слой на 512 якорей, затем на 384
  const R = new Float32Array(896 * 16), S = new Float32Array(896);
  let o = 0; regs.forEach(x => { R.set(x.v, o * 16); o += x.n; });
  o = 0; scs.forEach(x => { S.set(x.v, o); o += x.n; });
  const cand = [];
  for (let i = 0; i < 896; i++) {
    const s = sigmoid(S[i]); if (s < minScore) continue;
    const cx = R[i * 16] / SIZE + anchors[i][0], cy = R[i * 16 + 1] / SIZE + anchors[i][1], w = R[i * 16 + 2] / SIZE, h = R[i * 16 + 3] / SIZE;
    cand.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, score: s });
  }
  cand.sort((a, b) => b.score - a.score);          // взвешенный NMS: близкие рамки сливаем
  const res = [];
  while (cand.length) {
    const top = cand.shift(), grp = [top], rest = [];
    for (const q of cand) (iou(top, q) > 0.3 ? grp : rest).push(q);
    cand.length = 0; cand.push(...rest);
    let ws = 0; const b = { x0: 0, y0: 0, x1: 0, y1: 0 };
    grp.forEach(q => { ws += q.score; b.x0 += q.x0 * q.score; b.y0 += q.y0 * q.score; b.x1 += q.x1 * q.score; b.y1 += q.y1 * q.score; });
    res.push([b.x0 / ws, b.y0 / ws, b.x1 / ws, b.y1 / ws, top.score]);
  }
  return res;
}
self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(); self.postMessage({ id: m.id, ok: true, backend }); }
    else if (m.type === 'detect') self.postMessage({ id: m.id, ok: true, boxes: await detect(m.pixels, m.minScore) });
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};
