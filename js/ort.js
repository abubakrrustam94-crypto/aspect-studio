'use strict';
/* Aspect Studio — клиент общего ONNX-воркера. Воркер сам закрывается после простоя, чтобы вернуть память. */
let ortWorker = null, ortSeq = 0, ortIdle = 0; const ortWait = new Map();
const ORT_IDLE_MS = 45000;
function ortKill() { clearTimeout(ortIdle); if (ortWorker) { try { ortWorker.terminate(); } catch (e) {} } ortWorker = null; ortWait.forEach(w => w.rej(new Error('Движок остановлен'))); ortWait.clear(); }
function ortCall(msg, transfer) {
  if (!ortWorker) {
    if (typeof Worker === 'undefined') return Promise.reject(new Error('Воркеры недоступны'));
    ortWorker = new Worker('js/ort-worker.js');
    ortWorker.onmessage = e => { const w = ortWait.get(e.data.id); if (!w) return; ortWait.delete(e.data.id); e.data.ok ? w.res(e.data) : w.rej(new Error(e.data.error)); };
    ortWorker.onerror = e => { e.preventDefault(); if (typeof compRefresh === 'function') compRefresh(); const msg = 'Движок ONNX не запустился'; ortWait.forEach(w => w.rej(new Error(msg))); ortWait.clear(); try { ortWorker.terminate(); } catch (_) {} ortWorker = null; };
  }
  clearTimeout(ortIdle);
  return new Promise((res, rej) => {
    const id = ++ortSeq; ortWait.set(id, { res, rej }); ortWorker.postMessage({ ...msg, id }, transfer || []);
  }).finally(() => { clearTimeout(ortIdle); if (!ortWait.size) ortIdle = setTimeout(ortKill, ORT_IDLE_MS); });
}
/* Запуск модели: model — путь в vendor/, inputs — { имя: { data, dims, type } }; возвращает { имя: { data, dims } } */
async function ortRun(model, inputs, outputs) {
  const tr = Object.values(inputs).map(i => i.data.buffer);
  const r = await ortCall({ type: 'run', model, inputs, outputs }, tr);
  return r.out;
}
