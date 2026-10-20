'use strict';
/* Воркер удаления фона: U²-Net-P (2,2 МБ, float16) на tfjs. Граф собран tools/build_u2netp.py и исполняется здесь операция за операцией.
   Работает вне основного потока на WASM (при неудаче — на CPU). */
const TF = new URL('../vendor/tfjs/', self.location.href).href, DIR = new URL('../vendor/cutout/', self.location.href).href;
importScripts(TF + 'runtime.js');
const { tf, setWasmPaths } = self.BlazeFaceLib;
let G = null, W = null, backend = '';

function f16(u16) {                                  // float16 → float32
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    out[i] = e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return out;
}
async function init() {
  setWasmPaths(TF);
  try { await tf.setBackend('wasm'); } catch (e) { await tf.setBackend('cpu'); }
  await tf.ready(); backend = tf.getBackend();
  const [gj, bin] = await Promise.all([fetch(DIR + 'u2netp.json').then(r => { if (!r.ok) throw new Error('model json'); return r.json(); }), fetch(DIR + 'u2netp.f16.bin').then(r => { if (!r.ok) throw new Error('model bin'); return r.arrayBuffer(); })]);
  const all = f16(new Uint16Array(bin)); W = {};
  for (const [name, m] of Object.entries(gj.w)) W[name] = tf.tensor(all.subarray(m.o / 2, m.o / 2 + m.n), m.s.length === 4 ? m.s : m.s);
  G = gj;
  // когда тензор больше не нужен — освобождаем (экономим память на активациях 320×320)
  const last = {}; G.ops.forEach((op, k) => [].concat(op.i).forEach(n => { last[n] = k; })); G.last = last;
}
function run(rgba) {                                 // rgba: Uint8ClampedArray 320×320×4 → Uint8Array маска 320×320
  const N = G.size, mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const rgb = new Float32Array(N * N * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) for (let c = 0; c < 3; c++) rgb[j + c] = (rgba[i + c] / 255 - mean[c]) / std[c];
  const T = { [G.input]: tf.tensor4d(rgb, [1, N, N, 3]) };
  let d;
  try {
    G.ops.forEach((op, k) => {
      const names = [].concat(op.i), xs = names.map(n => T[n]), x = Array.isArray(op.i) ? xs : xs[0];
      let y;
      switch (op.t) {
        case 'conv': y = tf.conv2d(x, W[op.w], 1, op.k === 1 ? 'valid' : 'same', 'NHWC', op.d || 1); if (op.b) { const y2 = tf.add(y, W[op.b]); y.dispose(); y = y2; } break;
        case 'relu': y = tf.relu(x); break;
        case 'sigmoid': y = tf.sigmoid(x); break;
        case 'pool': y = tf.maxPool(x, 2, 2, 'same'); break;
        case 'add': y = tf.add(x[0], x[1]); break;
        case 'cat': y = tf.concat(x, 3); break;
        case 'resize': y = tf.image.resizeBilinear(x, [op.h, op.w], false, true); break;
      }
      T[op.o] = y;
      new Set(names).forEach(n => { if (G.last[n] === k && T[n]) { T[n].dispose(); delete T[n]; } });     // активация больше не нужна
    });
    d = T[G.output].dataSync();
  } finally { Object.values(T).forEach(t => { try { t.dispose(); } catch (e) {} }); }
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const res = new Uint8Array(d.length), r = (mx - mn) || 1;
  for (let i = 0; i < d.length; i++) res[i] = Math.round(255 * (d[i] - mn) / r);
  return res;
}
self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'init') { await init(); self.postMessage({ id: m.id, ok: true, backend }); }
    else if (m.type === 'mask') { const mask = run(m.pixels); self.postMessage({ id: m.id, ok: true, mask }, [mask.buffer]); }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) }); }
};
