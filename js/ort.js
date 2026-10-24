'use strict';
/* Aspect Studio — клиент общего ONNX-воркера. Воркер сам закрывается после простоя, чтобы вернуть память. */
let ortWorker = null, ortSeq = 0, ortIdle = 0; const ortWait = new Map();
const ORT_IDLE_MS = 45000;
/* Сколько потоков отдать нейросетям. Нужна изоляция страницы (crossOriginIsolated): её включает service worker после перезагрузки. */
const ORT_ISO = () => typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
function ortThreads() {
  if (!ORT_ISO()) return 1;
  const v = typeof S !== 'undefined' ? S.nnThreads : 'auto', hc = navigator.hardwareConcurrency || 2;
  if (v === '1' || v === '2' || v === '4') return Math.min(+v, Math.max(1, hc));
  return hc >= 2 ? Math.min(4, hc) : 1;
}
/* Во сколько раз меньше времени, чем на одном потоке (по замерам: 2 потока дают ×1,7–2,3, дальше медленнее) */
const ortSpeed = () => { const t = ortThreads(); return t >= 4 ? 0.4 : t >= 2 ? 0.55 : 1; };
function ortKill() { clearTimeout(ortIdle); if (ortWorker) { try { ortWorker.terminate(); } catch (e) {} } ortWorker = null; ortWait.forEach(w => w.rej(new Error('Движок остановлен'))); ortWait.clear(); }
function ortCall(msg, transfer) {
  if (!ortWorker) {
    if (typeof Worker === 'undefined') return Promise.reject(new Error('Воркеры недоступны'));
    ortWorker = new Worker('js/ort-worker.js'); ortWorker.postMessage({ type: 'init', id: 0, threads: ortThreads() });
    ortWorker.onmessage = e => { const w = ortWait.get(e.data.id); if (!w) return; ortWait.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); };
    ortWorker.onerror = e => { e.preventDefault(); if (typeof compRefresh === 'function') compRefresh(); const msg = 'Движок ONNX не запустился'; ortWait.forEach(w => w.rej(new Error(msg))); ortWait.clear(); try { ortWorker.terminate(); } catch (_) {} ortWorker = null; };
  }
  clearTimeout(ortIdle);
  return new Promise((res, rej) => {
    const id = ++ortSeq; ortWait.set(id, { res, rej }); ortWorker.postMessage({ ...msg, id }, transfer || []);
  }).finally(() => { clearTimeout(ortIdle); if (!ortWait.size) ortIdle = setTimeout(ortKill, ORT_IDLE_MS); });
}
/* Запуск модели: model — путь в vendor/, inputs — { имя: { data, dims, type } }; возвращает { имя: { data, dims } } */
async function ortRun(model, inputs, outputs, small = false) {      // small: маленькая модель, остаётся в памяти рядом с большой
  const tr = Object.values(inputs).map(i => i.data.buffer);
  const r = await ortCall({ type: 'run', model, inputs, outputs, small }, tr);
  return r.out;
}
