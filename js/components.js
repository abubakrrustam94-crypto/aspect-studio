'use strict';
/* Aspect Studio — компоненты: тяжёлые модули (декодеры форматов, нейросети) скачиваются только по кнопке на вкладке «Компоненты».
   Файлы лежат в Cache Storage браузера (кэш aspect-studio-components); service worker отдаёт их оттуда, поэтому они работают без сети.
   Если нужного компонента нет, функция не запускается, а пользователь получает предупреждение (compNeed / ComponentMissing). */
const COMP_CACHE = 'aspect-studio-components';
const COMP_NOCACHE = typeof caches === 'undefined';            // file:// и http не на localhost: Cache API нет — компоненты грузятся по требованию как раньше
// files: [путь, размер в байтах]. Размеры сверяет tests/components.js с реальными файлами.
const COMPONENTS = [
  { id: 'zlib', group: 'f', name: 'Сжатие zlib', desc: 'Нужен для PSD со сжатием ZIP, XCF и TIFF', files: [['vendor/pako/pako.umd.min.js', 45440]] },
  { id: 'tiff', group: 'f', name: 'TIFF', desc: 'Файлы .tif и .tiff, превью DOS EPS', files: [['vendor/utif/UTIF.js', 95737]], requires: ['zlib'] },
  { id: 'heif', group: 'f', name: 'HEIC / HEIF', desc: 'Фото с iPhone и многих телефонов', files: [['vendor/heif/libheif-bundle.js', 2044206]] },
  { id: 'jxl', group: 'f', name: 'JPEG XL', desc: 'Файлы .jxl (если браузер не открывает их сам)', files: [['vendor/jxl/jxl-decode.js', 20282], ['vendor/jxl/jxl_dec.wasm', 849240]] },
  { id: 'exr', group: 'f', name: 'OpenEXR', desc: 'Файлы .exr', files: [['vendor/exr/parse-exr.js', 26476]] },
  { id: 'pdf', group: 'f', name: 'Adobe Illustrator (AI)', desc: 'Файлы .ai с PDF-совместимостью', files: [['vendor/pdfjs/pdf.min.mjs', 523774], ['vendor/pdfjs/pdf.worker.min.mjs', 1321307]] },
  { id: 'raw', group: 'f', name: 'RAW: полное проявление', desc: 'LibRaw: проявляет настоящие данные матрицы вместо встроенного превью (CR2, CR3, NEF, ARW, RAF, DNG и др.)', files: [['vendor/raw/worker.js', 63682], ['vendor/raw/libraw.wasm', 1385126]] },
  { id: 'encjpeg', group: 'e', name: 'JPG: MozJPEG', desc: 'Файл JPG на 10–20% меньше при том же виде (прогрессивный JPEG)', files: [['vendor/enc/mozjpeg_enc.js', 38422], ['vendor/enc/mozjpeg_enc.wasm', 251524]] },
  { id: 'encpng', group: 'e', name: 'PNG: оптимизатор', desc: 'oxipng: PNG без потерь на 10–30% меньше; режим «Палитра» уменьшает ещё сильнее', files: [['vendor/enc/squoosh_oxipng.js', 6307], ['vendor/enc/squoosh_oxipng_bg.wasm', 164172]] },
  { id: 'encavif', group: 'e', name: 'AVIF', desc: 'Формат вывода AVIF: вдвое меньше JPG при том же виде; кодирование медленное', files: [['vendor/enc/avif_enc.js', 39621], ['vendor/enc/avif_enc.wasm', 3485872]] },
  { id: 'encjxl', group: 'e', name: 'JPEG XL: запись', desc: 'Формат вывода JXL, в том числе без потерь; открывается не везде', files: [['vendor/enc/jxl_enc.js', 47073], ['vendor/enc/jxl_enc.wasm', 1363824]] },
  { id: 'tfjs', group: 'n', name: 'Движок нейросетей', desc: 'Общая основа для поиска лиц и удаления фона; сам по себе ничего не делает', files: [['vendor/tfjs/runtime.js', 692675], ['vendor/tfjs/tfjs-backend-wasm.wasm', 311123], ['vendor/tfjs/tfjs-backend-wasm-simd.wasm', 424594]] },
  { id: 'faces', group: 'n', name: 'Поиск лиц', desc: 'Кадр «Заполнить» смотрит на лица', files: [['vendor/blazeface/blazeface-back.json', 79043], ['vendor/blazeface/blazeface-back.bin', 538928]], requires: ['tfjs'] },
  { id: 'cutout', group: 'n', name: 'Удаление фона', desc: 'Вырезает объект из кадра: товары, люди, животные', files: [['vendor/cutout/u2netp.json', 28572], ['vendor/cutout/u2netp.f16.bin', 2250970]], requires: ['tfjs'] },
  { id: 'ort', group: 'n', name: 'Движок ONNX', desc: 'Общий движок для точных нейросетей (удаление фона, увеличение и др.)', files: [['vendor/ort/ort.wasm.min.js', 50196], ['vendor/ort/ort-wasm-simd-threaded.mjs', 24381], ['vendor/ort/ort-wasm-simd-threaded.wasm', 14239897]] },
  { id: 'cutout2', group: 'n', name: 'Удаление фона: точный', desc: 'IS-Net: аккуратнее края, волосы, мелкие детали; считает дольше быстрого', files: [['vendor/models/isnet-int8.onnx.p1', 22171218], ['vendor/models/isnet-int8.onnx.p2', 22171218]], requires: ['ort'] },
];
/* Какой компонент нужен удалению фона при выбранном качестве */
const cutComp = (cfg = S) => cfg && cfg.cutQuality === 'precise' ? 'cutout2' : 'cutout';
const compById = id => COMPONENTS.find(c => c.id === id);
const compUrl = p => new URL(p, document.baseURI).href;
const compBytes = c => c.files.reduce((s, f) => s + f[1], 0);
const compChain = id => { const c = compById(id), out = []; (c.requires || []).forEach(r => compChain(r).forEach(x => { if (!out.includes(x)) out.push(x); })); out.push(id); return out; };   // зависимости, затем сам
const compDependents = id => COMPONENTS.filter(c => (c.requires || []).includes(id));
const compFmt = b => b >= 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(b / 1e3)) + ' КБ';

const compFiles = {};                                           // id → файлы лежат в кэше
const compBad = {};                                             // id → файлы есть, но неполные или повреждены
let compPersisted = null;                                       // true/false после проверки, null — неизвестно
const compBusy = {};                                            // id → идёт скачивание
/* Установлен ли компонент (вместе с зависимостями). Синхронно: состояние читается из кэша при старте и после каждой операции */
function compInstalled(id) {
  if (COMP_NOCACHE) return true;
  return compChain(id).every(x => compFiles[x] === true);
}
const compSizeOf = path => { for (const c of COMPONENTS) for (const f of c.files) if (f[0] === path) return f[1]; return -1; };
async function compRefresh() {
  const wasOn = { ...compFiles };
  if (!COMP_NOCACHE) {
    try {
      const cache = await caches.open(COMP_CACHE);
      for (const c of COMPONENTS) {
        let present = 0, good = 0;
        for (const f of c.files) {
          const r = await cache.match(compUrl(f[0]));
          if (!r) continue;
          present++;
          const len = +(r.headers.get('content-length') || -1);        // кладём сами при скачивании, тело читать не нужно
          if (len === f[1]) good++;
        }
        compFiles[c.id] = good === c.files.length;
        compBad[c.id] = present > 0 && good !== c.files.length;
        if (wasOn[c.id] && !compFiles[c.id] && typeof toast === 'function') toast(`«${c.name}» ${present ? 'повреждён' : 'пропал из памяти браузера'}: скачай заново на вкладке «Компоненты»`, true, { action: { label: 'Открыть', fn: openComponentsTab }, ms: 9000 });
      }
      try { compPersisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { compPersisted = null; }
    } catch (e) { COMPONENTS.forEach(c => { compFiles[c.id] = false; }); }
  }
  if (typeof renderComponents === 'function') renderComponents();
  if (typeof updateComponentHints === 'function') updateComponentHints();
}
const compReady = compRefresh();
document.addEventListener('visibilitychange', () => { if (!document.hidden && !Object.keys(compBusy).length) compRefresh(); });   // Android мог очистить память, пока вкладка была свёрнута
document.getElementById('compPersistBtn').addEventListener('click', async () => {
  let ok = false; try { ok = !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch (e) {}
  compPersisted = ok; renderComponents(); toast(ok ? 'Готово: браузер не будет чистить компоненты сам' : 'Браузер не разрешил. Добавь сайт на главный экран (установи как приложение) и попробуй снова', !ok, { ms: 7000 });
});

/* Скачивание одного файла с прогрессом: возвращает число байт */
async function compFetchFile(cache, path, onBytes) {
  const url = compUrl(path), res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
  const reader = res.body && res.body.getReader ? res.body.getReader() : null, parts = []; let got = 0;
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(value.length); }
  else { const b = await res.blob(); parts.push(b); got = b.size; onBytes(b.size); }
  if (got !== compSizeOf(path)) throw new Error(`Размер не совпал: ${path} (${got} вместо ${compSizeOf(path)})`);
  const type = res.headers.get('content-type') || (path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') || path.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
  await cache.put(url, new Response(new Blob(parts, { type }), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(got) } }));
  return got;
}
/* Скачать компонент (и недостающие зависимости). onProgress(0..1). Ошибка → удаляем недокачанное и пробрасываем */
async function compInstall(id, onProgress) {
  if (COMP_NOCACHE) throw new Error('Cache API недоступен');
  const chain = compChain(id).filter(x => !compFiles[x]), total = chain.reduce((s, x) => s + compBytes(compById(x)), 0) || 1;
  let done = 0; const cache = await caches.open(COMP_CACHE);
  chain.forEach(x => { compBusy[x] = true; }); if (typeof renderComponents === 'function') renderComponents();
  try {
    for (const x of chain) {
      const c = compById(x);
      try {
        for (const f of c.files) await compFetchFile(cache, f[0], n => { done += n; if (onProgress) onProgress(Math.min(1, done / total), x); });
        compFiles[x] = true; compBad[x] = false;
      } catch (e) { for (const f of c.files) await cache.delete(compUrl(f[0])); compFiles[x] = false; compBad[x] = false; throw e; }
    }
    try { if (navigator.storage && navigator.storage.persist) compPersisted = await navigator.storage.persist(); } catch (e) {}      // просим браузер не вычищать файлы
  } finally { chain.forEach(x => { delete compBusy[x]; }); if (typeof renderComponents === 'function') renderComponents(); if (typeof updateComponentHints === 'function') updateComponentHints(); }
  if (typeof compInstalledHook === 'function') compInstalledHook(id);
}
async function compRemove(id) {
  const deps = compDependents(id).filter(d => compFiles[d.id]);
  if (deps.length) throw new Error('Нужен для: ' + deps.map(d => d.name).join(', '));
  const cache = await caches.open(COMP_CACHE);
  for (const f of compById(id).files) await cache.delete(compUrl(f[0]));
  compFiles[id] = false; renderComponents(); updateComponentHints();
}
/* Какой компонент нужен для файла (по пути) */
const compForPath = path => COMPONENTS.find(c => c.files.some(f => f[0] === path));

/* Предупреждение: компонента нет. Возвращает true, если можно продолжать */
function compNeed(id, what) {
  if (compInstalled(id)) return true;
  compWarn([id], what);
  return false;
}
function compMissingText(ids, what) {
  const names = ids.map(i => '«' + compById(i).name + '»').join(', ');
  return `${what ? what + ': нужен' : 'Нужен'} ${ids.length > 1 ? 'компоненты' : 'компонент'} ${names}. Скачай ${ids.length > 1 ? 'их' : 'его'} на вкладке «Компоненты» и повтори.`;
}
function compWarn(ids, what) {
  toast(compMissingText(ids, what), true, { action: { label: 'Открыть', fn: openComponentsTab }, ms: 9000 });
}
function openComponentsTab() { if (typeof setSettingsTab === 'function') setSettingsTab('components'); const col = document.getElementById('colSettings'); if (col && col.scrollIntoView && innerWidth < 900) col.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

/* ---------- Вкладка «Компоненты» ---------- */
const compOnce = new Set();
function compWarnOnce(id, what) { if (compOnce.has(id)) return; compOnce.add(id); compWarn([id], what); }
function renderComponents() {
  const box = document.getElementById('compList'); if (!box) return;
  box.replaceChildren();
  const note = document.getElementById('compNoCache'); if (note) note.hidden = !COMP_NOCACHE;
  [['f', 'Форматы файлов'], ['e', 'Сжатие и форматы вывода'], ['n', 'Нейросети']].forEach(([g, title]) => {
    const h = document.createElement('div'); h.className = 'comp-group'; h.textContent = title; box.append(h);
    COMPONENTS.filter(c => c.group === g).forEach(c => {
      const inst = compFiles[c.id] === true, bad = !inst && !!compBad[c.id], busy = !!compBusy[c.id], need = compChain(c.id).filter(x => !compFiles[x]);
      const total = need.reduce((s, x) => s + compBytes(compById(x)), 0);
      const row = document.createElement('div'); row.className = 'comp'; row.dataset.id = c.id;
      const head = document.createElement('div'); head.className = 'comp-head';
      const nm = document.createElement('b'); nm.textContent = c.name;
      const st = document.createElement('span'); st.className = 'comp-state ' + (inst ? 'on' : busy ? 'busy' : bad ? 'bad' : ''); st.textContent = inst ? 'Скачан' : busy ? 'Скачивается…' : bad ? 'Повреждён' : 'Не скачан';
      head.append(nm, st);
      const d = document.createElement('p'); d.className = 'note'; d.style.margin = '2px 0 0';
      const extra = (c.requires || []).filter(r => !compFiles[r]).map(r => compById(r).name);
      d.textContent = `${c.desc} · ${compFmt(inst ? compBytes(c) : total)}` + (!inst && extra.length ? ` (вместе с «${extra.join('», «')}»)` : '');
      const bar = document.createElement('div'); bar.className = 'comp-bar'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Скачивание: ' + c.name); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', '0'); bar.hidden = !busy;
      bar.append(document.createElement('i'));
      const act = document.createElement('div'); act.className = 'row'; act.style.marginTop = '8px';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + (inst ? 'btn-outlined' : 'btn-tonal'); b.disabled = busy || COMP_NOCACHE;
      if (inst) {
        const deps = compDependents(c.id).filter(x => compFiles[x.id]);
        b.textContent = 'Удалить'; if (deps.length) { b.disabled = true; b.title = 'Нужен для: ' + deps.map(x => x.name).join(', '); }
        b.addEventListener('click', async () => { try { await compRemove(c.id); toast(`«${c.name}» удалён`); } catch (e) { toast('Не удалось удалить: ' + e.message, true); } });
      } else {
        b.textContent = bad ? 'Скачать заново' : 'Скачать';
        b.addEventListener('click', () => compDownloadUI(c.id));
      }
      b.setAttribute('aria-label', `${b.textContent}: ${c.name}`);
      act.append(b);
      if (inst && compDependents(c.id).some(x => compFiles[x.id])) { const n = document.createElement('span'); n.className = 'note'; n.style.margin = '0'; n.textContent = 'Нужен для: ' + compDependents(c.id).filter(x => compFiles[x.id]).map(x => x.name).join(', '); act.append(n); }
      row.append(head, d, bar, act); box.append(row);
    });
  });
  const pn = document.getElementById('compPersist'); if (pn) pn.hidden = COMP_NOCACHE || compPersisted !== false || !COMPONENTS.some(c => compFiles[c.id]);
  const have = COMPONENTS.filter(c => compFiles[c.id]), sz = have.reduce((s, c) => s + compBytes(c), 0), left = COMPONENTS.filter(c => !compFiles[c.id]).reduce((s, c) => s + compBytes(c), 0);
  const sum = document.getElementById('compSummary'); if (sum) sum.textContent = COMP_NOCACHE ? 'Менеджер компонентов недоступен в этом режиме' : `Скачано ${have.length} из ${COMPONENTS.length} · занято ${compFmt(sz)}`;
  const all = document.getElementById('compAll'); if (all) { all.disabled = COMP_NOCACHE || !left || Object.keys(compBusy).length > 0; all.textContent = left ? `Скачать всё (${compFmt(left)})` : 'Всё скачано'; }
  const none = document.getElementById('compNone'); if (none) none.disabled = COMP_NOCACHE || !have.length || Object.keys(compBusy).length > 0;
}
function compSetProgress(id, v) {
  const row = document.querySelector(`#compList .comp[data-id="${id}"]`); if (!row) return;
  const bar = row.querySelector('.comp-bar'); bar.hidden = false; bar.setAttribute('aria-valuenow', Math.round(v * 100)); bar.firstChild.style.width = Math.round(v * 100) + '%';
}
async function compDownloadUI(id) {
  const c = compById(id);
  try {
    await compInstall(id, (v, cur) => { compSetProgress(id, v); if (cur !== id) compSetProgress(cur, v); });
    toast(`«${c.name}» скачан`);
  } catch (e) { console.warn('component', e); toast(`Не удалось скачать «${c.name}»: проверь соединение и попробуй снова`, true, { ms: 7000 }); }
}
function compInstalledHook(id) {                                // после скачивания: перезапустить то, что ждало компонент
  if (compChain(id).includes('faces') && typeof items !== 'undefined' && S.faceAI) { items.forEach(i => { if (i.an && i.an.faceMissing) i.an = undefined; }); if (typeof renderAnalysis === 'function') renderAnalysis(); }
}
document.getElementById('compAll').addEventListener('click', async () => {
  for (const c of COMPONENTS) if (!compFiles[c.id]) { try { await compInstall(c.id, (v, cur) => compSetProgress(c.id, v)); } catch (e) { toast(`Не удалось скачать «${c.name}»`, true, { ms: 7000 }); return; } }
  toast('Все компоненты скачаны');
});
document.getElementById('compNone').addEventListener('click', async () => {
  for (let pass = 0; pass < 4; pass++) for (const c of COMPONENTS) if (compFiles[c.id] || compBad[c.id]) { try { await compRemove(c.id); } catch (e) {} }   // сначала те, от кого ничего не зависит
  toast('Компоненты удалены');
});
renderComponents();

/* Подсказки в карточках функций: что нужно скачать */
function updateComponentHints() {
  const cut = document.getElementById('cutNeed'); if (cut) { const id = cutComp(typeof cfgFor === 'function' && typeof cur === 'function' ? cfgFor(cur()) : S); cut.hidden = compInstalled(id); const nm = document.getElementById('cutNeedName'); if (nm) nm.textContent = id === 'cutout2' ? '«Удаление фона: точный» (около 58 МБ вместе с движком)' : '«Удаление фона» (около 3 МБ вместе с движком)'; }
  const face = document.getElementById('faceNeed'); if (face) face.hidden = compInstalled('faces');
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.js-open-components')) openComponentsTab(); });
