'use strict';
/* Aspect Studio — удаление фона. Модель U²-Net-P (2,2 МБ) работает в воркере (js/cutout-worker.js), грузится лениво при первом
   включении и кэшируется service worker'ом, дальше работает без сети. Фото никуда не отправляются.
   Здесь: общение с воркером, уточнение края (направляющий фильтр по самому фото), маска для рендера. */
const CO_SIDE = 1024;                                // рабочее разрешение маски (длинная сторона)
let coWorker = null, coReady = null, coSeq = 0, coBackend = ''; const coWait = new Map();

function coCall(msg, transfer) {
  return new Promise((res, rej) => { const id = ++coSeq; coWait.set(id, { res, rej }); coWorker.postMessage({ ...msg, id }, transfer || []); });
}
function coStart() {                                 // один раз; при ошибке (нет сети, нет воркеров) можно повторить
  if (coReady) return coReady;
  coReady = (async () => {
    if (typeof Worker === 'undefined') throw new Error('no worker');
    coWorker = new Worker('js/cutout-worker.js');
    coWorker.onmessage = e => { const w = coWait.get(e.data.id); if (!w) return; coWait.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); };
    coWorker.onerror = e => { e.preventDefault(); coWait.forEach(w => w.rej(new Error('worker'))); coWait.clear(); };
    coBackend = (await coCall({ type: 'init' })).backend;
  })();
  coReady.catch(() => { if (typeof compRefresh === 'function') compRefresh(); if (coWorker) coWorker.terminate(); coWorker = null; coReady = null; coWait.clear(); });
  return coReady;
}

// Скользящее среднее с радиусом r (по краям — усечённое окно)
function coBox(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0; const o = y * w;
    for (let x = 0; x <= Math.min(r, w - 1); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      const hi = Math.min(w - 1, x + r), lo = x - r - 1;
      if (x > 0 && x + r <= w - 1) s += src[o + hi];
      if (lo >= 0) s -= src[o + lo];
      tmp[o + x] = s / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) s += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const hi = Math.min(h - 1, y + r), lo = y - r - 1;
      if (y > 0 && y + r <= h - 1) s += tmp[hi * w + x];
      if (lo >= 0) s -= tmp[lo * w + x];
      out[y * w + x] = s / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
    }
  }
  return out;
}
// Направляющий фильтр (He et al.): край маски подтягивается к краям самого фото
function coGuided(I, p, w, h, r, eps) {
  const n = w * h, II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = coBox(I, w, h, r), mp = coBox(p, w, h, r), cII = coBox(II, w, h, r), cIp = coBox(Ip, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = cII[i] - mI[i] * mI[i], c = cIp[i] - mI[i] * mp[i]; a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = coBox(a, w, h, r), mb = coBox(b, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.max(0, Math.min(1, ma[i] * I[i] + mb[i]));
  return q;
}

/* Маска для готового (уже повёрнутого/обрезанного) изображения bmp. Возвращает { w, h, data: Uint8Array 0..255, cover } */
async function computeMask(bmp) {
  await coStart();
  const bw = dimsOf(bmp).w, bh = dimsOf(bmp).h, N = 320;
  // 1) вход модели — 320×320 (как у rembg: с растяжением)
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;
  const m320 = (await coCall({ type: 'mask', pixels: px }, [px.buffer])).mask;
  // 2) рабочее разрешение: маска растягивается, фото уменьшается до того же размера
  const k = Math.min(1, CO_SIDE / Math.max(bw, bh)), w = Math.max(8, Math.round(bw * k)), h = Math.max(8, Math.round(bh * k));
  const id = g.createImageData(N, N); for (let i = 0; i < m320.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = m320[i]; id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  const up = document.createElement('canvas'); up.width = w; up.height = h;
  const ug = up.getContext('2d', { willReadFrequently: true }); ug.imageSmoothingQuality = 'high'; ug.drawImage(c, 0, 0, w, h);
  const mu = ug.getImageData(0, 0, w, h).data, P = new Float32Array(w * h);
  for (let i = 0; i < P.length; i++) P[i] = mu[i * 4] / 255;
  ug.drawImage(bmp, 0, 0, w, h);
  const im = ug.getImageData(0, 0, w, h).data, I = new Float32Array(w * h);
  for (let i = 0; i < I.length; i++) I[i] = (0.299 * im[i * 4] + 0.587 * im[i * 4 + 1] + 0.114 * im[i * 4 + 2]) / 255;
  c.width = c.height = 0; up.width = up.height = 0;
  // 3) подтягиваем край к границам объекта на самом фото
  const Q = coGuided(I, P, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.008)), 1e-3);
  const data = new Uint8Array(w * h); let sum = 0;
  for (let i = 0; i < data.length; i++) { data[i] = Math.round(Q[i] * 255); sum += Q[i]; }
  return { w, h, data, cover: sum / data.length };
}

const coSig = item => `${item.rot || 0}|${item.flipH ? 1 : 0}|${item.flipV ? 1 : 0}|${item.crop ? [item.crop.x, item.crop.y, item.crop.w, item.crop.h].map(v => v.toFixed(4)).join(',') : ''}`;
const coPending = new Map();
/* Маска фото (кэшируется на фото; пересчитывается после поворота/обрезки). Ошибка → item.maskFail */
function ensureMask(item, bmp) {
  const sig = coSig(item);
  if (item.mask && item.mask.sig === sig) return Promise.resolve(item.mask);
  if (item.maskFail === 'load' && Date.now() - (item.maskTry || 0) < 15000) return Promise.resolve(null);     // модель не загрузилась — не долбим сеть на каждый кадр
  const key = item.id + '|' + sig;
  if (coPending.has(key)) return coPending.get(key);
  item.maskTry = Date.now();
  const quiet = typeof exporting !== 'undefined' && exporting;
  const p = (async () => {
    if (!quiet) toast('Вырезаю фон… (первый раз скачивается модель, около 3 МБ)', false, { ms: 6000 });
    try {
      const m = await computeMask(bmp);
      m.sig = sig; item.mask = m; item.maskCv = null; item.maskFail = m.cover < 0.02 ? 'empty' : false;    // почти ничего не найдено — не вырезаем
    } catch (e) { console.warn('cutout', e); item.maskFail = 'load'; item.mask = null; }
    finally { coPending.delete(key); }
    if (!quiet && item.maskFail === 'load') toast(location.protocol === 'file:' ? 'Удаление фона не работает, если открыт сам файл index.html: открой сайт по ссылке (http/https)' : 'Не удалось загрузить модель удаления фона: при первом запуске нужен интернет', true, { ms: 7000 });
    else if (!quiet && item.maskFail === 'empty') toast('Не нашёл объект на этом фото, фон оставлен как есть', true, { ms: 6000 });
    else if (!quiet) toast('Фон удалён');
    return item.mask;
  })();
  coPending.set(key, p);
  return p;
}
/* Холст с альфа-каналом из маски; edge 0..100: 0 — резкий край, 100 — мягкий */
function maskCanvas(item, edge) {
  if (item.maskCv && item.maskCv.edge === edge) return item.maskCv.canvas;
  const m = item.mask, c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
  const g = c.getContext('2d'), id = g.createImageData(m.w, m.h), s = 16 - 0.1 * edge;      // крутизна кривой: 16 → 6
  for (let i = 0; i < m.data.length; i++) { const v = (m.data[i] / 255 - 0.5) * s + 0.5; id.data[i * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, v))); }
  g.putImageData(id, 0, 0);
  if (item.maskCv) item.maskCv.canvas.width = 0;
  item.maskCv = { edge, canvas: c };
  return c;
}
