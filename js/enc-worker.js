'use strict';
/* Воркер кодирования: MozJPEG, AVIF, JPEG XL, оптимизатор PNG (oxipng) и палитра для PNG.
   Кодеры лежат в vendor/enc/ и подгружаются по требованию; каждый — отдельный компонент. */
const ENC_DIR = new URL('../vendor/enc/', self.location.href).href;
const mods = {};
const load = {
  async jpeg() { return (await import(ENC_DIR + 'mozjpeg_enc.js')).default({ noInitialRun: true }); },
  async avif() { return (await import(ENC_DIR + 'avif_enc.js')).default({ noInitialRun: true }); },
  async jxl() { return (await import(ENC_DIR + 'jxl_enc.js')).default({ noInitialRun: true }); },
  async png() { const m = await import(ENC_DIR + 'squoosh_oxipng.js'); await m.default(); return m; }
};
const get = k => mods[k] || (mods[k] = load[k]().catch(e => { delete mods[k]; throw e; }));

/* Палитра: срезаем каналы до 5/5/5/4 бит, режем «медианным сечением» по частоте, рисуем с диффузией ошибки (Флойд–Стейнберг) */
function quantize(rgba, w, h, colors, dither) {
  const N = w * h, bin = i => ((rgba[i] >> 3) << 14) | ((rgba[i + 1] >> 3) << 9) | ((rgba[i + 2] >> 3) << 4) | (rgba[i + 3] >> 4);
  const cnt = new Uint32Array(1 << 19), sr = new Float64Array(1 << 19), sg = new Float64Array(1 << 19), sb = new Float64Array(1 << 19), sa = new Float64Array(1 << 19);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const b = bin(i); cnt[b]++; sr[b] += rgba[i]; sg[b] += rgba[i + 1]; sb[b] += rgba[i + 2]; sa[b] += rgba[i + 3];
  }
  const used = []; for (let b = 0; b < cnt.length; b++) if (cnt[b]) used.push(b);
  const ch = (b, k) => k === 0 ? (b >> 14) & 31 : k === 1 ? (b >> 9) & 31 : k === 2 ? (b >> 4) & 31 : (b & 15) << 1;   // alpha приводим к шкале 0..30
  let boxes = [used];
  const range = box => { let best = 0, bk = 0; for (let k = 0; k < 4; k++) { let lo = 99, hi = -1; for (const b of box) { const v = ch(b, k); if (v < lo) lo = v; if (v > hi) hi = v; } const r = (hi - lo) * (k === 3 ? 1.2 : k === 1 ? 1.1 : k === 0 ? 1 : 0.8); if (r > best) { best = r; bk = k; } } return [best, bk]; };
  while (boxes.length < colors) {
    let bi = -1, bs = 0, bk = 0;
    for (let i = 0; i < boxes.length; i++) { if (boxes[i].length < 2) continue; const [r, k] = range(boxes[i]); let pop = 0; for (const b of boxes[i]) pop += cnt[b]; const s = r * Math.sqrt(pop); if (s > bs) { bs = s; bi = i; bk = k; } }
    if (bi < 0) break;
    const box = boxes[bi].slice().sort((a, b) => ch(a, bk) - ch(b, bk));
    let tot = 0; for (const b of box) tot += cnt[b];
    let acc = 0, cut = 1; for (let i = 0; i < box.length - 1; i++) { acc += cnt[box[i]]; cut = i + 1; if (acc * 2 >= tot) break; }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const pal = boxes.map(box => { let c = 0, r = 0, g = 0, b = 0, a = 0; for (const x of box) { c += cnt[x]; r += sr[x]; g += sg[x]; b += sb[x]; a += sa[x]; } return c ? [r / c, g / c, b / c, a / c] : [0, 0, 0, 0]; });
  const hasClear = used.some(b => (b & 15) === 0 && cnt[b]);
  if (hasClear) { let k = pal.findIndex(p => p[3] < 8); if (k < 0) { pal[pal.length - 1] = [0, 0, 0, 0]; } else pal[k] = [0, 0, 0, 0]; }
  const P = pal.map(p => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), Math.round(p[3])]);
  const near = (r, g, b, a) => { let bi = 0, bd = 1e12; for (let i = 0; i < P.length; i++) { const q = P[i], dr = r - q[0], dg = g - q[1], db = b - q[2], da = a - q[3]; const d = (dr * dr + dg * dg + db * db) * (a < 8 && q[3] < 8 ? 0 : 1) + da * da * 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const cache = new Int16Array(1 << 19).fill(-1);
  const lookup = (r, g, b, a) => { const k = ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4); let v = cache[k]; if (v < 0) v = cache[k] = near(r, g, b, a); return v; };
  const out = new Uint8ClampedArray(rgba.length);
  const er = new Float32Array((w + 2) * 3), en = new Float32Array((w + 2) * 3);   // ошибка текущей и следующей строки (r,g,b)
  let cur = er, nxt = en;
  for (let y = 0; y < h; y++) {
    nxt.fill(0);
    const ltr = !dither || (y & 1) === 0;
    for (let s = 0; s < w; s++) {
      const x = ltr ? s : w - 1 - s, i = (y * w + x) * 4, e = (x + 1) * 3;
      const a = rgba[i + 3];
      let r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (dither && a > 8) { r = Math.min(255, Math.max(0, r + cur[e])); g = Math.min(255, Math.max(0, g + cur[e + 1])); b = Math.min(255, Math.max(0, b + cur[e + 2])); }
      const q = P[lookup(r | 0, g | 0, b | 0, a)];
      out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2]; out[i + 3] = q[3];
      if (dither && a > 8) {
        const dr = (r - q[0]) * 0.8, dg = (g - q[1]) * 0.8, db = (b - q[2]) * 0.8, d = ltr ? 1 : -1;
        for (let c = 0; c < 3; c++) {
          const v = c === 0 ? dr : c === 1 ? dg : db;
          cur[e + d * 3 + c] += v * 7 / 16;
          nxt[e - d * 3 + c] += v * 3 / 16; nxt[e + c] += v * 5 / 16; nxt[e + d * 3 + c] += v / 16;
        }
      }
    }
    const t = cur; cur = nxt; nxt = t;
  }
  return { out, palette: P.length };
}

onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'init') { self.postMessage({ id: m.id, ok: true }); return; }
    if (m.type === 'quant') {
      const r = quantize(new Uint8ClampedArray(m.data), m.w, m.h, m.colors, m.dither !== false);
      self.postMessage({ id: m.id, ok: true, buf: r.out.buffer, palette: r.palette }, [r.out.buffer]); return;
    }
    if (m.type === 'pngq') {                              // палитра + oxipng без канваса: цвета не портятся премультипликацией
      const mod = await get('png'), r = quantize(new Uint8ClampedArray(m.data), m.w, m.h, m.colors, m.dither !== false);
      const res = mod.optimise_raw(new Uint8ClampedArray(r.out.buffer), m.w, m.h, m.level, false, false), out = res.slice().buffer;
      self.postMessage({ id: m.id, ok: true, buf: out, palette: r.palette }, [out]); return;
    }
    const mod = await get(m.type);
    let res;
    if (m.type === 'png') res = mod.optimise(new Uint8Array(m.data), m.level, false, !!m.alpha);
    else res = mod.encode(new Uint8Array(m.data), m.w, m.h, m.opts);
    if (!res) throw new Error('Кодер не вернул результат');
    const out = res.slice().buffer;                       // wasm-память не передаём, копируем
    self.postMessage({ id: m.id, ok: true, buf: out }, [out]);
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
};
