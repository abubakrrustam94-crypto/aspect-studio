'use strict';
/* Общий воркер ONNX Runtime Web (WASM, один поток): точное удаление фона, увеличение, лица и другие тяжёлые модели.
   Держит одну сессию: новая модель вытесняет старую, чтобы не занимать память телефона. */
const ORT_DIR = new URL('../vendor/ort/', self.location.href).href;
importScripts(ORT_DIR + 'ort.wasm.min.js');
ort.env.wasm.wasmPaths = ORT_DIR; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
let sess = null, sessName = '';
const smalls = new Map();                 // небольшие модели (лица, объекты) живут рядом с большой и не вытесняют её; не больше трёх
/* Модель может лежать частями (файлы до ~22 МБ): склеиваем их в один буфер */
async function getSmall(urls) {
  const key = urls.join('|');
  if (smalls.has(key)) { const s = smalls.get(key); smalls.delete(key); smalls.set(key, s); return s; }      // свежие — в конец
  while (smalls.size >= 3) { const k = smalls.keys().next().value; try { await smalls.get(k).release(); } catch (e) {} smalls.delete(k); }
  const s = await ort.InferenceSession.create(urls[0], { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  smalls.set(key, s); return s;
}
async function getSession(urls) {
  const key = urls.join('|');
  if (sess && sessName === key) return sess;
  if (sess) { try { await sess.release(); } catch (e) {} sess = null; sessName = ''; }
  let src;
  if (urls.length === 1) src = urls[0];
  else {
    const parts = [];
    for (const u of urls) { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); parts.push(new Uint8Array(await r.arrayBuffer())); }
    let n = 0; parts.forEach(x => { n += x.length; }); src = new Uint8Array(n); let o = 0; parts.forEach(x => { src.set(x, o); o += x.length; });
    parts.length = 0;
  }
  sess = await ort.InferenceSession.create(src, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  sessName = key; return sess;
}
onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'init') { self.postMessage({ id: m.id, ok: true, version: ort.env.versions && ort.env.versions.common }); return; }
    if (m.type === 'stat') { self.postMessage({ id: m.id, ok: true, small: smalls.size, big: sessName }); return; }
    if (m.type === 'free') { for (const s of smalls.values()) { try { await s.release(); } catch (_) {} } smalls.clear(); if (sess) { try { await sess.release(); } catch (_) {} } sess = null; sessName = ''; self.postMessage({ id: m.id, ok: true }); return; }
    if (m.type === 'run') {
      const urls = [].concat(m.model).map(p => new URL('../' + p, self.location.href).href);
      const s = m.small ? await getSmall(urls) : await getSession(urls);
      const feeds = {};
      for (const k of Object.keys(m.inputs)) { const i = m.inputs[k]; feeds[k] = new ort.Tensor(i.type || 'float32', i.data, i.dims); }
      const names = m.outputs && m.outputs.length ? m.outputs : [s.outputNames[0]];
      const res = await s.run(feeds, names);
      const out = {}, tr = [];
      for (const n of names) { const t = res[n]; const d = t.data; out[n] = { data: d, dims: t.dims, type: t.type }; if (d.buffer && !tr.includes(d.buffer)) tr.push(d.buffer); }
      self.postMessage({ id: m.id, ok: true, out, inputNames: s.inputNames }, tr);
    }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
};
