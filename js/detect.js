'use strict';
/* Aspect Studio — точные детекторы на движке ONNX: лица с пятью точками (SCRFD) и объекты (YOLOX).
   Маленькие модели остаются в памяти рядом с большой (одна сессия «big» + до трёх «small»), поэтому анализ серии фото не перезагружает их. */
const DET = {
  scrfd: { comp: 'facex', model: 'vendor/models/scrfd-500m.onnx', N: 640 },
  nano: { comp: 'objx', model: 'vendor/models/yolox-nano.onnx', N: 416 },
  small: { comp: 'objx2', model: 'vendor/models/yolox-s.onnx', N: 640 }
};
const SCRFD_OUT = { score: ['443', '468', '493'], box: ['446', '471', '496'], kps: ['449', '474', '499'] };
const COCO_RU = ['человек', 'велосипед', 'машина', 'мотоцикл', 'самолёт', 'автобус', 'поезд', 'грузовик', 'лодка', 'светофор', 'гидрант', 'знак стоп', 'счётчик парковки', 'скамейка', 'птица', 'кошка', 'собака', 'лошадь', 'овца', 'корова', 'слон', 'медведь', 'зебра', 'жираф', 'рюкзак', 'зонт', 'сумка', 'галстук', 'чемодан', 'фрисби', 'лыжи', 'сноуборд', 'мяч', 'воздушный змей', 'бита', 'бейсбольная перчатка', 'скейтборд', 'сёрфборд', 'ракетка', 'бутылка', 'бокал', 'чашка', 'вилка', 'нож', 'ложка', 'миска', 'банан', 'яблоко', 'сэндвич', 'апельсин', 'брокколи', 'морковь', 'хот-дог', 'пицца', 'пончик', 'торт', 'стул', 'диван', 'растение', 'кровать', 'стол', 'унитаз', 'телевизор', 'ноутбук', 'мышь', 'пульт', 'клавиатура', 'телефон', 'микроволновка', 'духовка', 'тостер', 'раковина', 'холодильник', 'книга', 'часы', 'ваза', 'ножницы', 'плюшевый мишка', 'фен', 'зубная щётка'];
const COCO_BG = new Set([13, 56, 57, 58, 59, 60, 61, 62, 68, 69, 70, 71, 72]);     // мебель и «фон»: реже бывают главным объектом
const COCO_ANIMAL = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 77]);

/* Кадр (или его часть) → квадрат N×N, масштаб без искажения, пустое место справа и снизу */
function detInput(src, sx, sy, sw, sh, N, pad, mode) {
  const k = Math.min(N / sw, N / sh), dw = Math.max(1, Math.round(sw * k)), dh = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = `rgb(${pad},${pad},${pad})`; g.fillRect(0, 0, N, N); g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
  const px = g.getImageData(0, 0, N, N).data; c.width = c.height = 0;
  const n = N * N, f = new Float32Array(3 * n);
  if (mode === 'scrfd') for (let i = 0, p = 0; i < n; i++, p += 4) { f[i] = (px[p] - 127.5) / 128; f[n + i] = (px[p + 1] - 127.5) / 128; f[2 * n + i] = (px[p + 2] - 127.5) / 128; }
  else for (let i = 0, p = 0; i < n; i++, p += 4) { f[i] = px[p + 2]; f[n + i] = px[p + 1]; f[2 * n + i] = px[p]; }      // YOLOX: BGR, 0–255
  return { f, k };
}
function detNms(list, thr) {
  const out = []; list.sort((a, b) => b.score - a.score);
  for (const a of list) {
    if (out.every(b => {
      const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1), i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i; return !(u > 0 && i / u > thr);
    })) out.push(a);
  }
  return out;
}

/* ---------- Лица: SCRFD-500M ---------- */
async function scrfdPass(src, sx, sy, sw, sh, W, H, minScore) {
  const M = DET.scrfd, N = M.N, { f, k } = detInput(src, sx, sy, sw, sh, N, 0, 'scrfd');
  const o = await ortRun(M.model, { 'input.1': { data: f, dims: [1, 3, N, N], type: 'float32' } }, [...SCRFD_OUT.score, ...SCRFD_OUT.box, ...SCRFD_OUT.kps], true);
  const res = [];
  [8, 16, 32].forEach((st, li) => {
    const g = N / st, sc = o[SCRFD_OUT.score[li]].data, bb = o[SCRFD_OUT.box[li]].data, kp = o[SCRFD_OUT.kps[li]].data;
    for (let i = 0; i < g * g * 2; i++) {
      const s = sc[i]; if (s < minScore) continue;
      const cell = i >> 1, cx = (cell % g) * st, cy = ((cell / g) | 0) * st;
      const tx = v => (v / k + sx) / W, ty = v => (v / k + sy) / H;
      const face = { x0: tx(cx - bb[i * 4] * st), y0: ty(cy - bb[i * 4 + 1] * st), x1: tx(cx + bb[i * 4 + 2] * st), y1: ty(cy + bb[i * 4 + 3] * st), score: s, kps: [] };
      for (let j = 0; j < 5; j++) face.kps.push([tx(cx + kp[i * 10 + j * 2] * st), ty(cy + kp[i * 10 + j * 2 + 1] * st)]);
      res.push(face);
    }
  });
  return res;
}
/* Возвращает [{x0,y0,x1,y1,score,kps:[[x,y]×5: левый глаз, правый глаз, нос, левый и правый уголок рта]}] в долях кадра */
async function detectFacesSCRFD(src, W, H) {
  const minScore = 0.5;
  let faces = await scrfdPass(src, 0, 0, W, H, W, H, minScore);
  if (!faces.length && Math.max(W, H) >= 900) {            // мелкие лица на большом кадре: четыре перекрывающихся куска
    const tw = W * 0.6, th = H * 0.6;
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) faces.push(...await scrfdPass(src, (W - tw) * fx, (H - th) * fy, tw, th, W, H, minScore));
  }
  faces = detNms(faces, 0.4).filter(f => f.x1 - f.x0 > 0.008 && f.y1 - f.y0 > 0.008);
  faces.forEach(f => { f.x0 = Math.max(0, f.x0); f.y0 = Math.max(0, f.y0); f.x1 = Math.min(1, f.x1); f.y1 = Math.min(1, f.y1); });
  return faces.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0)).slice(0, 12);
}
/* Глаза самого крупного лица: точка в долях кадра и наклон головы (радианы), либо null */
function faceEyes(faces) {
  const f = faces && faces.find(x => x.kps && x.kps.length >= 2); if (!f) return null;
  const [a, b] = f.kps; return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, roll: Math.atan2(b[1] - a[1], b[0] - a[0]), size: f.x1 - f.x0 };
}

/* ---------- Объекты: YOLOX ---------- */
async function detectObjects(src, W, H, kind) {
  const M = DET[kind] || DET.nano, N = M.N, { f, k } = detInput(src, 0, 0, W, H, N, 114, 'yolox');
  const r = await ortRun(M.model, { images: { data: f, dims: [1, 3, N, N], type: 'float32' } }, undefined, true), d = r[Object.keys(r)[0]].data, cand = [];
  let at = 0;
  for (const st of [8, 16, 32]) {
    const g = N / st;
    for (let i = 0; i < g * g; i++, at++) {
      const o = at * 85, obj = d[o + 4]; if (obj < 0.2) continue;
      let bc = 0, bs = 0; for (let c = 0; c < 80; c++) { const s = d[o + 5 + c]; if (s > bs) { bs = s; bc = c; } }
      const score = obj * bs; if (score < 0.3) continue;
      const cx = ((i % g) + d[o]) * st, cy = (((i / g) | 0) + d[o + 1]) * st, w = Math.exp(d[o + 2]) * st, h = Math.exp(d[o + 3]) * st;
      cand.push({ x0: Math.max(0, (cx - w / 2) / k / W), y0: Math.max(0, (cy - h / 2) / k / H), x1: Math.min(1, (cx + w / 2) / k / W), y1: Math.min(1, (cy + h / 2) / k / H), score, cls: bc, name: COCO_RU[bc] });
    }
  }
  return detNms(cand, 0.45).filter(b => b.x1 - b.x0 > 0.02 && b.y1 - b.y0 > 0.02).slice(0, 20);
}
/* Главный объект: крупный, уверенный, ближе к центру; «мебель» и рамки на весь кадр не в счёт. Возвращает { box, list } либо null */
function pickMainObject(list) {
  const cand = list.filter(b => (b.x1 - b.x0) * (b.y1 - b.y0) < 0.85).map(b => {
    const area = (b.x1 - b.x0) * (b.y1 - b.y0), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const w = (COCO_BG.has(b.cls) ? 0.4 : COCO_ANIMAL.has(b.cls) || b.cls === 0 ? 1.4 : 1) * b.score * Math.sqrt(area) * Math.exp(-((cx - .5) ** 2 + (cy - .5) ** 2) / (2 * 0.45 * 0.45));
    return { b, w };
  }).sort((a, b) => b.w - a.w);
  if (!cand.length || cand[0].w < 0.08) return null;
  const top = cand[0].b, box = { x0: top.x0, y0: top.y0, x1: top.x1, y1: top.y1 };
  cand.slice(1).forEach(({ b, w }) => {                    // близкие по значимости объекты рядом (двое людей, пара предметов) входят в рамку
    if (w > cand[0].w * 0.6) { box.x0 = Math.min(box.x0, b.x0); box.y0 = Math.min(box.y0, b.y0); box.x1 = Math.max(box.x1, b.x1); box.y1 = Math.max(box.y1, b.y1); }
  });
  return { box, main: top };
}
