'use strict';
/* Aspect Studio — определение лиц лёгкой моделью BlazeFace (MediaPipe).
   Рантайм (tfjs + WASM, ~1 МБ) и веса (~0,5 МБ) лежат в vendor/blazeface и грузятся лениво, при первом анализе фото,
   работают в отдельном потоке (js/faces-worker.js). Service Worker кэширует файлы, дальше всё работает без сети.
   Фото никуда не отправляются. */
const BF_SIZE = 256, BF_MIN_SCORE = 0.75;
let bfWorker = null, bfReady = null, bfSeq = 0; const bfWait = new Map();
let bfBackend = '';

function bfCall(msg, transfer) {
  return new Promise((res, rej) => { const id = ++bfSeq; bfWait.set(id, { res, rej }); bfWorker.postMessage({ ...msg, id }, transfer || []); });
}
function bfStart() {                                  // один раз; при ошибке (нет сети, нет WASM) можно повторить позже
  if (bfReady) return bfReady;
  bfReady = (async () => {
    if (typeof Worker === 'undefined') throw new Error('no worker');
    bfWorker = new Worker('js/faces-worker.js');
    bfWorker.onmessage = e => { const w = bfWait.get(e.data.id); if (!w) return; bfWait.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); };
    bfWorker.onerror = e => { bfWait.forEach(w => w.rej(new Error('worker'))); bfWait.clear(); };
    const r = await bfCall({ type: 'init' }); bfBackend = r.backend;
  })();
  bfReady.catch(() => { if (bfWorker) bfWorker.terminate(); bfWorker = null; bfReady = null; bfWait.clear(); });
  return bfReady;
}
function bfIoU(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0), u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
}

/* Лица в области (sx, sy, sw, sh) холста. Область вписывается в квадрат с полями — лицо не растягивается.
   Возвращает [{x0,y0,x1,y1,score}] в долях всего холста */
async function bfDetectArea(canvas, sx, sy, sw, sh) {
  const N = BF_SIZE, k = Math.min(N / sw, N / sh), dw = sw * k, dh = sh * k, ox = (N - dw) / 2, oy = (N - dh) / 2;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, sx, sy, sw, sh, ox, oy, dw, dh);
  const px = g.getImageData(0, 0, N, N).data; c.width = c.height = 0;
  const r = await bfCall({ type: 'detect', pixels: px, minScore: BF_MIN_SCORE }, [px.buffer]);
  const W = canvas.width, H = canvas.height;
  return r.boxes.map(([x0, y0, x1, y1, score]) => ({
    x0: Math.max(0, ((x0 * N - ox) / k + sx) / W), y0: Math.max(0, ((y0 * N - oy) / k + sy) / H),
    x1: Math.min(1, ((x1 * N - ox) / k + sx) / W), y1: Math.min(1, ((y1 * N - oy) / k + sy) / H), score
  })).filter(f => f.x1 - f.x0 > 0.01 && f.y1 - f.y0 > 0.01);
}

/* Весь кадр; если лиц нет — ещё 4 перекрывающихся фрагмента (находит мелкие лица на больших кадрах) */
async function detectFacesBF(canvas) {
  await bfStart();
  let faces = await bfDetectArea(canvas, 0, 0, canvas.width, canvas.height);
  if (!faces.length && Math.max(canvas.width, canvas.height) >= 400) {
    const W = canvas.width, H = canvas.height, tw = W * 0.6, th = H * 0.6;
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) faces.push(...await bfDetectArea(canvas, (W - tw) * fx, (H - th) * fy, tw, th));
    const out = [];
    faces.sort((a, b) => b.score - a.score).forEach(f => { if (!out.some(o => bfIoU(o, f) > 0.3)) out.push(f); });
    faces = out;
  }
  return faces.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0)).slice(0, 12);
}
