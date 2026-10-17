'use strict';
/* Aspect Studio — анализ фото: резкость, шум, плоские края, главный объект */
const AN_SIDE = 640;   // анализ идёт на уменьшенной копии

function anGray(bmp) {
  const k = Math.min(1, AN_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
  return { g, w, h, canvas: c };
}

function anBlur(g, w, h, sigma) {
  const r = Math.ceil(sigma * 3), ker = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += ker[i + r]; }
  for (let i = 0; i < ker.length; i++) ker[i] /= s;
  const tmp = new Float32Array(g.length), out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0; for (let i = -r; i <= r; i++) a += g[y * w + Math.min(w - 1, Math.max(0, x + i))] * ker[i + r];
    tmp[y * w + x] = a;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0; for (let i = -r; i <= r; i++) a += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * ker[i + r];
    out[y * w + x] = a;
  }
  return out;
}

/* Резкость: отношение мелких деталей к средним (не зависит от контраста). Шум: оценка Иммеркера по медиане */
function anMetrics(g, w, h) {
  const n = w * h, b1 = anBlur(g, w, h, 1), b3 = anBlur(g, w, h, 3);
  const hf = new Float32Array(n), mf = new Float32Array(n);
  for (let i = 0; i < n; i++) { hf[i] = Math.abs(g[i] - b1[i]); mf[i] = Math.abs(b1[i] - b3[i]); }
  const th = Float32Array.from(mf).sort()[Math.floor(n * 0.7)];
  let sh = 0, sm = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (mf[i] > th) { sh += hf[i]; sm += mf[i]; cnt++; }
  const sharp = cnt ? (sh / cnt) / (sm / cnt + 1e-6) : 0;
  const r = new Float32Array((w - 2) * (h - 2)); let k = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const o = y * w + x;
    r[k++] = Math.abs(g[o - w - 1] - 2 * g[o - w] + g[o - w + 1] - 2 * g[o - 1] + 4 * g[o] - 2 * g[o + 1] + g[o + w - 1] - 2 * g[o + w] + g[o + w + 1]);
  }
  r.sort();
  return { sharp, noise: r[r.length >> 1] / 0.6745 / 6 };
}

/* Разброс яркости у краёв кадра: маленький — фон ровный (товар на белом) */
function anEdgeStd(g, w, h) {
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  const std = (x0, y0, x1, y1) => {
    let s = 0, s2 = 0, c = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = g[y * w + x]; s += v; s2 += v * v; c++; }
    const m = s / c; return Math.sqrt(Math.max(0, s2 / c - m * m));
  };
  return (std(0, 0, w, t) + std(0, h - t, w, h) + std(0, 0, t, h) + std(w - t, 0, w, h)) / 4;
}

/* Главный объект: центр деталей (края), с лёгким тяготением к центру кадра. null — явного объекта нет */
function anSubject(g, w, h) {
  const B = 16, gw = Math.ceil(w / B), gh = Math.ceil(h / B), e = new Float32Array(gw * gh);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const o = y * w + x, gx = g[o + 1] - g[o - 1], gy = g[o + w] - g[o - w];
    e[((y / B) | 0) * gw + ((x / B) | 0)] += Math.hypot(gx, gy);
  }
  let sum = 0, peak = 0; for (let i = 0; i < e.length; i++) { sum += e[i]; if (e[i] > peak) peak = e[i]; }
  const mean = sum / e.length;
  if (!(mean > 0.5) || peak / mean < 1.8) return null;
  let wx = 0, wy = 0, ws = 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const nx = (i + .5) / gw, ny = (j + .5) / gh;
    const wgt = Math.pow(e[j * gw + i], 1.3) * Math.exp(-((nx - .5) ** 2 + (ny - .5) ** 2) / (2 * 0.38 * 0.38));
    wx += wgt * nx; wy += wgt * ny; ws += wgt;
  }
  if (!ws) return null;
  return { x: 0.75 * (wx / ws) + 0.25 * 0.5, y: 0.75 * (wy / ws) + 0.25 * 0.5 };
}

async function anFaces(canvas) {
  if (!('FaceDetector' in window)) return null;
  try {
    const faces = await new FaceDetector({ fastMode: true, maxDetectedFaces: 6 }).detect(canvas);
    if (!faces.length) return null;
    let sx = 0, sy = 0, sw = 0;
    faces.forEach(f => { const b = f.boundingBox, a = b.width * b.height; sx += (b.x + b.width / 2) * a; sy += (b.y + b.height * .45) * a; sw += a; });
    return { x: sx / sw / canvas.width, y: sy / sw / canvas.height, n: faces.length };
  } catch (e) { return null; }
}

async function analyzePhoto(bmp) {
  const { g, w, h, canvas } = anGray(bmp);
  const m = anMetrics(g, w, h), edgeStd = anEdgeStd(g, w, h);
  const f = await anFaces(canvas);
  const subject = f ? { x: f.x, y: f.y } : anSubject(g, w, h);
  canvas.width = canvas.height = 0;
  return { w: bmp.width, h: bmp.height, mp: bmp.width * bmp.height / 1e6, sharp: m.sharp, noise: m.noise, edgeStd, flat: edgeStd < 14, subject, faces: f ? f.n : 0 };
}

const anSharpLabel = r => r < 0.22 ? ['Очень мягкое', 'bad'] : r < 0.36 ? ['Мягковатое', 'warn'] : r < 0.65 ? ['Нормальное', 'ok'] : ['Чёткое', 'ok'];
const anNoiseLabel = s => s < 2.2 ? ['Чистое', 'ok'] : s < 4.5 ? ['Немного шума', 'warn'] : s < 7 ? ['Шумное', 'warn'] : ['Очень шумное', 'bad'];

/* Рекомендации: что включить для этого фото */
function anRecommend(item, an) {
  const c = cfgFor(item);
  const sharp = an.sharp < 0.36 ? 70 : an.sharp < 0.65 ? 45 : 25;
  const denoise = an.noise < 2.2 ? 10 : an.noise < 4.5 ? 20 : an.noise < 7 ? 35 : 40;
  let scale = 1;
  if (c.sizeMode !== 'fixed') {
    const long = Math.max(an.w, an.h);
    scale = long < 700 ? 3 : long < 1300 ? 2 : 1;
    scale = Math.max(1, Math.min(scale, Math.floor(S.maxSide / long)));
  }
  const enhOn = scale > 1 || an.sharp < 0.65 || an.noise >= 2.2;
  const level = Object.keys(LEVELS).find(k => LEVELS[k].sharp === sharp && LEVELS[k].denoise === denoise) || 'custom';
  const patch = { enhOn, enhScale: scale, sharp, denoise, enhLevel: level, smart: true };
  if (c.fit === 'fit') patch.bg = an.flat ? 'edge' : 'blur';
  return patch;
}

function anAdvice(item, an) {
  const out = [], r = anRecommend(item, an);
  const [sl] = anSharpLabel(an.sharp), [nl] = anNoiseLabel(an.noise);
  if (an.sharp < 0.22) out.push('Фото очень мягкое: резкость поможет лишь отчасти, лучше взять более чёткий исходник.');
  else if (an.sharp < 0.36) out.push('Фото мягковатое: подойдёт сильная резкость.');
  else if (an.sharp >= 0.65) out.push('Фото и так чёткое: резкость нужна лёгкая.');
  if (an.noise >= 4.5) out.push('Есть заметный шум: включится шумоподавление.');
  if (r.enhScale > 1) out.push(`Фото небольшое (${an.mp.toFixed(1)} Мп): ×${r.enhScale} даст больше деталей при печати и на больших экранах.`);
  if (!r.enhOn) out.push('Улучшение не требуется: фото чистое и чёткое.');
  if (an.flat && cfgFor(item).fit === 'fit') out.push('Края ровные (как у товара на однотонном фоне): подойдёт «Градиент из фото».');
  return out.join(' ') || `${sl}, ${nl.toLowerCase()}.`;
}
