'use strict';
/* Aspect Studio — отмена/повтор настроек, «Сбросить фото», запоминание фото между запусками, приём фото из меню «Поделиться» */

/* ===================================================================
   Отмена и повтор: снимок = общие настройки + настройки каждого фото
   =================================================================== */
const hist = { undo: [], redo: [], lastKey: '', lastT: 0, busy: false }, HIST_MAX = 60;
const XF_KEYS = ['rot', 'tilt', 'flipH', 'flipV', 'crop', 'focus', 'zoom', 'skip', 'manual'];
function histSnap() {
  return JSON.stringify({ S, items: items.map(it => ({ id: it.id, ov: it.ov, ...Object.fromEntries(XF_KEYS.map(k => [k, it[k]])) })) });
}
/* Вызывать ПЕРЕД изменением. Подряд идущие правки одной настройки (ползунок) считаются одним шагом. */
function histPush(key) {
  if (hist.busy) return;
  const now = Date.now();
  if (key && key === hist.lastKey && now - hist.lastT < 900) { hist.lastT = now; return; }
  hist.lastKey = key || ''; hist.lastT = now;
  const s = histSnap();
  if (hist.undo[hist.undo.length - 1] === s) return;
  hist.undo.push(s); if (hist.undo.length > HIST_MAX) hist.undo.shift();
  hist.redo.length = 0; histButtons();
}
function histButtons() {
  const u = $('#undoBtn'), r = $('#redoBtn'); if (!u) return;
  u.disabled = !hist.undo.length; r.disabled = !hist.redo.length;
  const rb = $('#resetPhoto'); if (rb) { const it = cur(); rb.disabled = !it || !photoChanged(it); }
}
const photoChanged = it => !!it.ov || !!it.rot || !!it.tilt || it.flipH || it.flipV || !!it.crop || it.zoom !== 1 || (it.focus && (it.focus.x !== .5 || it.focus.y !== .5) && it.manual);
async function histApply(json) {
  hist.busy = true;
  try {
    const snap = JSON.parse(json);
    const keep = { view: S.view, pin: S.pin }; Object.keys(S).forEach(k => { delete S[k]; }); Object.assign(S, snap.S, keep);
    const redo = [];
    for (const st of snap.items) {
      const it = items.find(x => x.id === st.id); if (!it) continue;
      const xfChanged = (it.rot || 0) !== (st.rot || 0) || (it.tilt || 0) !== (st.tilt || 0) || !!it.flipH !== !!st.flipH || !!it.flipV !== !!st.flipV || JSON.stringify(it.crop) !== JSON.stringify(st.crop);
      it.ov = st.ov; XF_KEYS.forEach(k => { it[k] = st[k]; });
      if (xfChanged) { redo.push(it); syncDims(it); if (cache.id === it.id) releaseCache(); }
    }
    save(); renderThumbs(); syncUI(); applyView(); schedule();
    for (const it of redo) {                       // кадр изменился: обновить миниатюру и просмотр
      try { const f = { ...it.focus }, z = it.zoom, m = it.manual; await commitXform(it); it.focus = f; it.zoom = z; it.manual = m; } catch (e) { logError(e, 'undo'); }
    }
    updateChrome();
  } finally { hist.busy = false; histButtons(); sessSaveSoon(); }
}
async function histUndo() { if (!hist.undo.length || exporting) return; const cur_ = histSnap(); const s = hist.undo.pop(); hist.redo.push(cur_); lastKey_reset(); await histApply(s); toast('Шаг назад'); }
async function histRedo() { if (!hist.redo.length || exporting) return; const cur_ = histSnap(); const s = hist.redo.pop(); hist.undo.push(cur_); lastKey_reset(); await histApply(s); toast('Шаг вперёд'); }
function lastKey_reset() { hist.lastKey = ''; }
async function resetPhoto() {
  const it = cur(); if (!it || exporting) return;
  histPush('reset');
  const needXf = !!it.rot || !!it.tilt || it.flipH || it.flipV || !!it.crop;
  it.ov = null; it.rot = 0; it.tilt = 0; it.flipH = false; it.flipV = false; it.crop = null; it.focus = { x: .5, y: .5 }; it.zoom = 1; it.manual = false;
  if (needXf) { syncDims(it); if (cache.id === it.id) releaseCache(); try { await commitXform(it); } catch (e) { logError(e, 'reset'); } }
  renderThumbs(); syncUI(); applyView(); schedule(); histButtons(); sessSaveSoon(); toast('Фото сброшено: общие настройки, без поворота и обрезки');
}
$('#undoBtn').addEventListener('click', histUndo);
$('#redoBtn').addEventListener('click', histRedo);
$('#resetPhoto').addEventListener('click', resetPhoto);
addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target; if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && /text|search|number|email|url/.test(t.type)))) return;
  if (e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? histRedo() : histUndo(); }
  else if (e.code === 'KeyY') { e.preventDefault(); histRedo(); }
});
/* Кадр и список фото меняются и вне set(): подпишемся на события без правки каждого обработчика */
['#zoom', '#resetFocus', '#scopeSeg', '#applyAllBtn', '#cpDone'].forEach(s => { const el = $(s); if (el) el.addEventListener(s === '#zoom' ? 'pointerdown' : 'click', () => histPush(s), true); });
const _updateChrome = updateChrome; updateChrome = function () { _updateChrome.apply(this, arguments); histButtons(); sessSaveSoon(); };

/* ===================================================================
   Запоминание фото между запусками (по желанию; хранится только в браузере, IndexedDB)
   =================================================================== */
const SESS_FLAG = 'aspect-studio-resume', SESS_DB = 'aspect-studio-session', SESS_CAP = 400 * 1048576;
const sessOn = () => { try { return localStorage.getItem(SESS_FLAG) === '1'; } catch (e) { return false; } };
const sessOpen = () => new Promise((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('no idb'));
  const r = indexedDB.open(SESS_DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('meta'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const sessTx = (db, stores, mode, fn) => new Promise((res, rej) => { const tx = db.transaction(stores, mode); const out = fn(tx); tx.oncomplete = () => res(out); tx.onerror = tx.onabort = () => rej(tx.error); });
const idbGetAll = (store, q) => new Promise((res, rej) => { const r = q ? store.getAll(q) : store.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbKeys = store => new Promise((res, rej) => { const r = store.getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
let sessTimer = 0, sessWarned = false, sessSaving = false;
const sessKey = it => `${it.name}|${it.file.size}|${it.file.lastModified || 0}`;
function sessSaveSoon() { if (!sessOn() || window.wiping) return; clearTimeout(sessTimer); sessTimer = setTimeout(sessSave, 1500); }
async function sessSave() {
  if (window.wiping) return;
  if (!sessOn() || sessSaving) { if (sessSaving) sessSaveSoon(); return; }
  sessSaving = true;
  try {
    const db = await sessOpen();
    const have = new Set(await sessTx(db, ['files'], 'readonly', tx => idbKeys(tx.objectStore('files'))));
    const list = items.filter(it => it.file), keys = list.map(sessKey);
    let total = 0; list.forEach(it => { total += it.file.size; });
    if (total > SESS_CAP) { if (!sessWarned) { sessWarned = true; toast('Фото слишком много для запоминания (больше 400 МБ): сессия не сохраняется', true, { ms: 7000 }); } db.close(); return; }
    await sessTx(db, ['files', 'meta'], 'readwrite', tx => {
      const f = tx.objectStore('files'), m = tx.objectStore('meta');
      list.forEach((it, i) => { if (!have.has(keys[i])) f.put(it.file, keys[i]); });
      have.forEach(k => { if (!keys.includes(k)) f.delete(k); });
      if (!list.length) m.clear();
      else m.put({ t: Date.now(), S, idx, items: list.map((it, i) => ({ key: keys[i], ov: it.ov, ...Object.fromEntries(XF_KEYS.map(k => [k, it[k]])) })) }, 'session');
    });
    db.close();
  } catch (e) { if (!sessWarned) { sessWarned = true; toast('Не удалось сохранить фото для следующего запуска (мало места или режим без хранилища)', true, { ms: 7000 }); } console.warn('session', e); }
  finally { sessSaving = false; }
}
async function sessForget() {
  clearTimeout(sessTimer);
  await new Promise(res => { try { const r = indexedDB.deleteDatabase(SESS_DB); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch (e) { res(); } });
  const b = $('#sessBanner'); if (b) b.hidden = true;
}
async function sessLoad() {
  const db = await sessOpen();
  try {
    const meta = await sessTx(db, ['meta'], 'readonly', tx => new Promise((res, rej) => { const r = tx.objectStore('meta').get('session'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    if (!meta || !meta.items || !meta.items.length) return null;
    const files = await sessTx(db, ['files'], 'readonly', tx => Promise.all(meta.items.map(m => new Promise(res => { const r = tx.objectStore('files').get(m.key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }))));
    return { meta, files };
  } finally { db.close(); }
}
async function sessRestore() {
  let d; try { d = await sessLoad(); } catch (e) { toast('Не удалось открыть сохранённую сессию', true); return; }
  if (!d) { toast('Сохранённых фото нет'); return; }
  const files = d.files.filter(Boolean); if (!files.length) { toast('Сохранённые файлы пропали из браузера', true); sessForget(); return; }
  $('#sessBanner').hidden = true;
  const before = items.length;
  await addFiles(files);
  d.meta.items.forEach((m, i) => {
    const it = items[before + d.files.slice(0, i).filter(Boolean).length]; if (!it || !d.files[i]) return;
    it.ov = m.ov || null; XF_KEYS.forEach(k => { if (m[k] !== undefined) it[k] = m[k]; });
    syncDims(it);
  });
  if (d.meta.S) { const keep = ['view']; Object.keys(d.meta.S).forEach(k => { if (k in DEFAULTS && typeof d.meta.S[k] === typeof DEFAULTS[k] && !keep.includes(k)) S[k] = d.meta.S[k]; }); save(); }
  items.slice(before).forEach(it => { if (it.rot || it.tilt || it.flipH || it.flipV || it.crop) { if (cache.id === it.id) releaseCache(); commitXform(it).then(() => { const m = d.meta.items.find(x => x.key === sessKey(it)); if (m) { it.focus = m.focus || it.focus; it.zoom = m.zoom || 1; it.manual = !!m.manual; } schedule(); }).catch(() => {}); } });
  idx = Math.min(before + Math.max(0, d.meta.idx || 0), items.length - 1); updateChrome(); syncUI(); schedule();
}
$('#sessRestore').addEventListener('click', sessRestore);
$('#sessDrop').addEventListener('click', async () => { await sessForget(); toast('Сохранённые фото удалены'); });
const sessSw = $('#sessOn');
sessSw.checked = sessOn();
sessSw.addEventListener('change', async () => {
  try { localStorage.setItem(SESS_FLAG, sessSw.checked ? '1' : '0'); } catch (e) {}
  if (sessSw.checked) { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} sessSaveSoon(); toast('Фото будут сохраняться в этом браузере'); }
  else { await sessForget(); toast('Запоминание выключено, сохранённое удалено'); }
});
$('#sessForgetBtn').addEventListener('click', async () => { await sessForget(); toast('Сохранённые фото удалены'); });
(async function sessBannerInit() {
  if (!sessOn() || typeof indexedDB === 'undefined') return;
  try {
    const d = await sessLoad(); if (!d || items.length) return;
    const n = d.meta.items.length; $('#sessBannerText').textContent = `Прошлая сессия: ${n} фото. Продолжить с того же места?`;
    $('#sessBanner').hidden = false;
  } catch (e) {}
})();

/* ===================================================================
   Приём фото из меню «Поделиться» (Android, установленное приложение): sw.js кладёт файлы в кэш и открывает ./?shared=N
   =================================================================== */
(async function takeShared() {
  const q = new URLSearchParams(location.search), n = Math.min(200, Math.floor(+q.get('shared')));   // число берётся из адреса: ограничиваем, чтобы чужая ссылка не зациклила страницу
  if (!(n > 0) || typeof caches === 'undefined') return;
  try {
    const c = await caches.open('aspect-share'), files = [];
    for (let i = 0; i < n; i++) {
      const u = new URL('./share/' + i, document.baseURI).href, r = await c.match(u); if (!r) continue;
      const blob = await r.blob(); files.push(new File([blob], decodeURIComponent(r.headers.get('X-Name') || 'photo-' + (i + 1)), { type: blob.type, lastModified: +(r.headers.get('X-Modified') || Date.now()) }));
      await c.delete(u);
    }
    history.replaceState(null, '', location.pathname);
    if (files.length) { toast(`Получено из «Поделиться»: ${files.length}`); await addFiles(files); }
  } catch (e) { logError(e, 'share-target'); }
})();
