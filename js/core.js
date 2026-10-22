'use strict';
/* Aspect Studio — Ядро: константы, состояние, тема, уведомления, загрузка изображений */
/* ===================================================================
   Aspect Studio v2 — чистый JS, без зависимостей
   =================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- Локальный журнал ошибок: хранится только в этом браузере, никуда не отправляется ---------- */
const ERRLOG_KEY = 'aspect-studio-errlog', ERRLOG_MAX = 30;
const errLog = (() => { try { const a = JSON.parse(localStorage.getItem(ERRLOG_KEY) || '[]'); return Array.isArray(a) ? a.slice(-ERRLOG_MAX) : []; } catch (e) { return []; } })();
function logError(err, where) {
  try {
    const msg = String(err && err.stack ? err.stack : (err && err.message) || err).slice(0, 600);
    const last = errLog[errLog.length - 1];
    if (last && last.m === msg) { last.n = (last.n || 1) + 1; last.t = Date.now(); }
    else errLog.push({ t: Date.now(), w: where || '', m: msg, n: 1 });
    while (errLog.length > ERRLOG_MAX) errLog.shift();
    localStorage.setItem(ERRLOG_KEY, JSON.stringify(errLog));
    if (typeof renderErrLog === 'function') renderErrLog();
  } catch (e) {}
}
window.addEventListener('error', ev => logError(ev.error || ev.message, 'error'));
window.addEventListener('unhandledrejection', ev => logError(ev.reason, 'promise'));
(() => { const orig = console.error; console.error = function (...a) { logError(a.map(x => (x && x.stack) || (x && x.message) || String(x)).join(' '), 'console'); return orig.apply(this, a); }; })();

/* ---------- Константы ---------- */
const APP_VERSION = '2.20.0';
const STORE_KEY = 'aspect-studio-v2';
const THEME_KEY = 'aspect-studio-theme';
const PREVIEW_CAP = 1280;          // макс. сторона холста предпросмотра
const DEV_MEM = navigator.deviceMemory || 4;     // ГБ ОЗУ (Chrome/Android); где API нет (iOS/Firefox) считаем 4
const MAX_AREA = DEV_MEM <= 2 ? 8000000 : DEV_MEM <= 4 ? 14000000 : 16000000;   // лимит площади холста
let ZIP_PART = (DEV_MEM <= 2 ? 60 : DEV_MEM <= 4 ? 120 : 250) * 1048576;        // размер одной части ZIP

const RATIOS = [[16,9],[9,16],[1,1],[4,3],[3,4],[21,9],[4,5],[2,3],[3,2]];
const PRESETS = [
  { g: 'Соцсети', id: 'yt',       name: 'YouTube',        note: '16:9',   w: 1920, h: 1080 },
  { g: 'Соцсети', id: 'shorts',   name: 'YouTube Shorts', note: '9:16',   w: 1080, h: 1920 },
  { g: 'Соцсети', id: 'igpost',   name: 'Instagram пост', note: '1:1',    w: 1080, h: 1080 },
  { g: 'Соцсети', id: 'ig45',     name: 'Instagram',      note: '4:5',    w: 1080, h: 1350 },
  { g: 'Соцсети', id: 'ig34',     name: 'Instagram сетка', note: '3:4',   w: 1080, h: 1440 },
  { g: 'Соцсети', id: 'story',    name: 'Stories / Reels',note: '9:16',   w: 1080, h: 1920 },
  { g: 'Соцсети', id: 'tiktok',   name: 'TikTok',         note: '9:16',   w: 1080, h: 1920 },
  { g: 'Соцсети', id: 'x',        name: 'X (Twitter)',    note: '16:9',   w: 1600, h: 900  },
  { g: 'Соцсети', id: 'fb',       name: 'Facebook',       note: '1.91:1', w: 1200, h: 630  },
  { g: 'Соцсети', id: 'in',       name: 'LinkedIn',       note: '1.91:1', w: 1200, h: 627  },
  { g: 'Соцсети', id: 'pin',      name: 'Pinterest',      note: '2:3',    w: 1000, h: 1500 },
  { g: 'Соцсети', id: 'vk',       name: 'VK пост',        note: '1:1',    w: 1080, h: 1080 },
  { g: 'Соцсети', id: 'tgava',    name: 'Telegram аватар',note: '1:1',    w: 640,  h: 640  },
  { g: 'Маркетплейсы', id: 'wb',  name: 'Wildberries',    note: '3:4',    w: 900,  h: 1200 },
  { g: 'Маркетплейсы', id: 'ozon',name: 'Ozon',           note: '3:4',    w: 1200, h: 1600 },
  { g: 'Маркетплейсы', id: 'ozf', name: 'Ozon Fresh',     note: '1:1',    w: 1000, h: 1000 },
  { g: 'Маркетплейсы', id: 'ym',  name: 'Яндекс Маркет',  note: '3:4',    w: 900,  h: 1200 },
  { g: 'Маркетплейсы', id: 'avito',name: 'Авито',         note: '4:3',    w: 1600, h: 1200 },
  { g: 'Печать (300 dpi)', id: 'p10x15', name: '10×15 см',  note: '2:3',  w: 1181, h: 1772 },
  { g: 'Печать (300 dpi)', id: 'p13x18', name: '13×18 см',  note: '5:7',  w: 1535, h: 2126 },
  { g: 'Печать (300 dpi)', id: 'pa5',    name: 'A5',        note: '148×210 мм', w: 1748, h: 2480 },
  { g: 'Печать (300 dpi)', id: 'pa4',    name: 'A4',        note: '210×297 мм', w: 2480, h: 3508 },
  { g: 'Печать (300 dpi)', id: 'pdoc',   name: 'Документы 3×4', note: '30×40 мм', w: 354, h: 472 },
  { g: 'Печать (300 dpi)', id: 'p35x45', name: 'Паспорт 35×45', note: '35×45 мм', w: 413, h: 531 },
  { g: 'Экран', id: '4k', name: '4K UHD', note: '16:9', w: 3840, h: 2160 },
];

const DEFAULTS = {
  sizeMode: 'auto', ratioW: 16, ratioH: 9,
  presetId: 'yt', outW: 1920, outH: 1080,
  fit: 'fit', align: 'center',
  bg: 'blur', color: '#000000', blur: 60, dim: 25,
  grad1: '#7c3aed', grad2: '#0891b2', gradAngle: 'v',
  format: 'png', quality: 92, maxSide: 4096, targetOn: false, targetKB: 500, nameTpl: '{name}_{w}x{h}', autoCenter: true, diskZip: true,
  wmOn: false, wmText: '@aspect.studio', wmPos: 'br', wmSize: 22, wmOpacity: 75, wmMode: 'single', wmAngle: -30, wmGap: 80,
  view: 'slider', pin: true,
  enhOn: true, enhScale: 1, enhLevel: 'mid', sharp: 45, denoise: 20, smart: true,
  meta: 'none', author: '', colorSpace: 'p3', metaCam: true, metaDate: 'keep', metaCopy: '', metaDpi: 0,
  faceAI: true, cutOn: false, cutBg: 'white', cutColor: '#ffffff', cutEdge: 50, cutQuality: 'fast', nameStart: 1, nameTranslit: false, nameSpaces: false, folderOn: false,
};

let S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) {}
// Миграция со старых настроек (v2.7 и ниже): «wide» и «keepMeta» заменены на colorSpace и meta
try {
  const old = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  if (old.colorSpace === undefined && old.wide === false) S.colorSpace = 'srgb';
  if (old.meta === undefined && old.keepMeta === true) S.meta = 'basic';
  delete S.wide; delete S.keepMeta;
} catch (e) {}
// Страховка от повреждённых значений
for (const k of Object.keys(DEFAULTS)) if (typeof S[k] !== typeof DEFAULTS[k]) S[k] = DEFAULTS[k];

// Настройки на фото: у фото может быть свой набор (item.ov) поверх общих S
const OV_KEYS = ['sizeMode', 'ratioW', 'ratioH', 'outW', 'outH', 'presetId', 'fit', 'align', 'bg', 'color', 'blur', 'dim', 'grad1', 'grad2', 'gradAngle', 'enhOn', 'enhScale', 'enhLevel', 'sharp', 'denoise', 'smart', 'cutOn', 'cutBg', 'cutColor', 'cutEdge', 'cutQuality'];
const cfgFor = item => (item && item.ov) ? Object.assign({}, S, item.ov) : S;
const tgt = () => { const it = items[idx]; return it && it.ov ? it.ov : S; };   // куда писать изменения

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }, 200);
}

/* ---------- Состояние ---------- */
let items = [];            // {id,name,file,url,thumb,w,h,focus,zoom,sample,dom}
let idx = 0;
let uid = 0;
let busy = false;
let cancelFlag = false;
let sliderPos = 50;
let wmLogo = null;         // ImageBitmap | HTMLImageElement
let lastDims = null;
let cache = { id: null, bmp: null, promise: null, released: false };

/* ---------- Элементы ---------- */
const uploadZone = $('#uploadZone'), fileInput = $('#fileInput');
const thumbsRow = $('#thumbsRow'), thumbsEl = $('#thumbs'), countPill = $('#countPill');
const previewCard = $('#previewCard'), frame = $('#frame'), stage = $('#stage');
const beforeImg = $('#beforeImg'), afterCanvas = $('#afterCanvas');
const sliderHandle = $('#sliderHandle'), infoRow = $('#infoRow');
const tagBefore = $('#tagBefore'), tagAfter = $('#tagAfter'), panHint = $('#panHint');
const toolbar = $('#toolbar'), toastEl = $('#toast');
const progressEl = $('#progress'), progressFill = $('#progressFill');
const mqDesktop = matchMedia('(min-width: 900px)');

const cur = () => items[idx];

/* ===================================================================
   Тема
   =================================================================== */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#themeToggle').innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${t === 'dark' ? 'moon' : 'sun'}"/></svg>`;
  const m = $('meta[name="theme-color"]');
  if (m) m.content = t === 'dark' ? '#0f0f14' : '#faf8ff';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
  if (t !== 'dark' && t !== 'light') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(t);
})();
$('#themeToggle').addEventListener('click', toggleTheme);

/* ===================================================================
   Тосты и прогресс
   =================================================================== */
let toastTimer = 0;
function toast(msg, isError = false, opt = null) {
  toastEl.replaceChildren(document.createTextNode(msg));
  const act = opt && opt.action;
  if (act) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = act.label;
    b.addEventListener('click', () => { toastEl.classList.remove('show'); act.fn(); });
    toastEl.append(b);
  }
  toastEl.className = 'toast show' + (isError ? ' error' : '') + (act ? ' has-act' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), (opt && opt.ms) || (isError ? 5000 : 2800));
}
/* Оценка оставшегося времени: скользящее среднее по времени на один файл */
const eta = { t0: 0, lastDone: 0, lastT: 0, avg: 0 };
function etaStart() { eta.t0 = eta.lastT = performance.now(); eta.lastDone = 0; eta.avg = 0; }
function fmtDur(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60), r = s % 60;
  return m < 60 ? `${m} мин${r ? ` ${r} с` : ''}` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}
function etaText(done, total) {
  const now = performance.now();
  if (done > eta.lastDone) {
    const per = (now - eta.lastT) / (done - eta.lastDone);
    eta.avg = eta.avg ? 0.6 * eta.avg + 0.4 * per : per;
    eta.lastDone = done; eta.lastT = now;
  }
  if (!eta.avg || done >= total) return '';
  return `осталось ~${fmtDur(eta.avg * (total - done))}`;
}
function showProgress(title) {
  etaStart();
  $('#progressTitle').textContent = title;
  progressFill.style.width = '0%';
  progressEl.classList.add('show');
}
function setProgress(done, total, name) {
  progressFill.style.width = (total ? (done / total) * 100 : 0) + '%';
  $('#progressTitle').textContent = `Обработка: ${done} / ${total}`;
  const e = etaText(done, total);
  $('#progressName').textContent = (name || '') + (e ? (name ? ' · ' : '') + e : '');
}
function hideProgress() { progressEl.classList.remove('show'); }
$('#progressCancel').addEventListener('click', () => { cancelFlag = true; (typeof exPool !== 'undefined' ? exPool : [exWork]).forEach(w => w.cancel()); });

const yieldUI = () => new Promise(r => setTimeout(r, 0));

/* ===================================================================
   Загрузка изображений (с учётом EXIF-ориентации)
   =================================================================== */
// Размер файла без полной расшифровки: <img> сообщает размеры (с учётом EXIF-ориентации) сразу после чтения заголовка
function probeSize(src) {
  return new Promise(res => {
    const img = new Image(); let done = false;
    const end = v => { if (done) return; done = true; img.onload = img.onerror = null; img.removeAttribute('src'); res(v); };
    img.onload = () => end(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    img.onerror = () => end(null);
    setTimeout(() => end(null), 8000);
    img.src = src.url;
  });
}
// Больше этой площади фото целиком не держим в памяти: результат всё равно не выйдет за MAX_AREA
const LOAD_AREA = MAX_AREA * 2.5;
function loadTarget(w, h) {
  if (w * h <= LOAD_AREA) return null;
  const k = Math.sqrt(LOAD_AREA / (w * h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
async function decodeBitmap(src) {
  const f = src.file, L = src.load;
  if (L) {                                  // большое фото: декодируем сразу в уменьшенном виде, при нехватке памяти пробуем ещё меньше
    const ladder = src.laddering ? [1, .75, .55, .4, .28] : [1];
    let lastErr;
    for (const k of ladder) {
      const rw = Math.max(1, Math.round(L.w * k)), rh = Math.max(1, Math.round(L.h * k));
      try { return await createImageBitmap(f, { imageOrientation: 'from-image', resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' }); }
      catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  try { return await createImageBitmap(f, { imageOrientation: 'from-image' }); } catch (e) {}
  try { return await createImageBitmap(f); } catch (e) {}
  const img = new Image();
  img.src = src.url;
  await img.decode();
  return img;
}
// Загрузка с применением поворота / отражения / обрезки (если они заданы у фото)
async function loadBitmap(src) { return applyXform(await decodeBitmap(src), src); }
const dimsOf = b => ({ w: b.naturalWidth || b.width, h: b.naturalHeight || b.height });
const closeBmp = b => { if (b && typeof b.close === 'function') b.close(); else if (typeof HTMLCanvasElement !== 'undefined' && b instanceof HTMLCanvasElement) b.width = b.height = 0; };

// Порядок: отражение → поворот (по часовой) → обрезка. crop хранится долями уже повёрнутого изображения.
function xformInfo(item) {
  const r = item.rot || 0, sw = r % 180 ? item.oh : item.ow, sh = r % 180 ? item.ow : item.oh;
  const cr = item.crop || { x: 0, y: 0, w: 1, h: 1 };
  const cx = Math.max(0, Math.min(sw - 1, Math.round(cr.x * sw))), cy = Math.max(0, Math.min(sh - 1, Math.round(cr.y * sh)));
  const cw = Math.max(1, Math.min(sw - cx, Math.round(cr.w * sw))), ch = Math.max(1, Math.min(sh - cy, Math.round(cr.h * sh)));
  return { sw, sh, cx, cy, cw, ch, same: !r && !item.flipH && !item.flipV && !item.crop };
}
function syncDims(item) { const x = xformInfo(item); item.w = x.cw; item.h = x.ch; }
function applyXform(bmp, item) {
  if (!item || item.ow == null) return bmp;                    // не фото из очереди (например, логотип)
  const x = xformInfo(item);
  if (x.same) return bmp;
  const { w, h } = dimsOf(bmp);
  const c = mkCanvas(x.cw, x.ch);
  const g = c.getContext('2d', item.p3 && supportsP3 ? { colorSpace: 'display-p3' } : undefined);
  g.imageSmoothingQuality = 'high';
  g.translate(-x.cx, -x.cy); g.translate(x.sw / 2, x.sh / 2);
  g.rotate((item.rot || 0) * Math.PI / 180); g.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
  g.drawImage(bmp, -w / 2, -h / 2);
  closeBmp(bmp);
  return c;
}

async function makeThumb(bmp, w, h) {
  const c = document.createElement('canvas');
  const T = 144, s = Math.max(T / w, T / h);
  c.width = c.height = T;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const sw = T / s, sh = T / s;
  ctx.drawImage(bmp, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, T, T);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.7));
  return blob ? URL.createObjectURL(blob) : '';
}

async function makeItem(file) {
  const url = URL.createObjectURL(file);
  let bmp;
  try {
    const pr = await probeSize({ url });
    const load = pr ? loadTarget(pr.w, pr.h) : null;
    bmp = await loadBitmap({ file, url, load, laddering: !!load });
    const { w, h } = dimsOf(bmp);
    if (!w || !h) throw new Error('empty');
    const reduced = load ? { from: pr, to: { w, h } } : null;       // что было в файле и до чего уменьшили
    const thumb = await makeThumb(bmp, w, h);
    const p3 = await detectP3(file);
    return { id: ++uid, name: file.name || `image-${uid}`, file, url, thumb, w, h, ow: w, oh: h, rot: 0, flipH: false, flipV: false, crop: null, view: null, ov: null, focus: { x: .5, y: .5 }, zoom: 1, sample: null, dom: null, p3, load: load ? { w, h } : null, reduced };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  } finally { closeBmp(bmp); }
}

const mpOf = d => (d.w * d.h / 1e6).toFixed(d.w * d.h >= 1e7 ? 0 : 1);
function bigPhotoMsg(list) {
  const f = list[0].reduced;
  const one = `${list[0].name}: ${mpOf(f.from)} МП (${f.from.w}×${f.from.h}) — для скорости открыто в уменьшенном виде ${f.to.w}×${f.to.h}`;
  const tail = '. Для результата этого хватает; если нужна полная детализация (например, сильная обрезка), разрежь фото или уменьши заранее.';
  return list.length === 1 ? one + tail : `${list.length} больших фото открыты в уменьшенном виде (${one.split(' — ')[0]} и др.)` + tail;
}
async function addFiles(list) {
  await compReady;
  const files = Array.from(list || []).filter(isInputFile);
  if (!files.length) { toast('Выбери изображения', true); return; }
  const first = items.length;
  const failed = [], notes = [], bigNotes = [];
  for (let i = 0; i < files.length; i++) {
    if (files.length > 3) toast(`Загрузка ${i + 1} / ${files.length}…`);
    try { const it = await makeItem(await normalizeInput(files[i], notes)); items.push(it); if (it.reduced) bigNotes.push(it); }
    catch (e) { if (!(e instanceof FormatError)) console.error(e); failed.push({ name: files[i].name, msg: e && e.userMsg, ids: e && e.compIds }); }
  }
  if (items.length > first) { idx = first; updateChrome(); schedule(); }
  const ok = items.length - first, extra = notes.length ? ' · ' + notes.slice(0, 2).join('; ') + (notes.length > 2 ? '…' : '') : '';
  if (failed.length && failed.every(f => f.ids)) {            // не хватает компонентов: говорим, какие скачать
    const ids = [...new Set(failed.flatMap(f => f.ids))];
    toast(`${failed.length === 1 ? failed[0].name + ': не открыт.' : `Не открыто файлов: ${failed.length}.`} ${compMissingText(ids, '')}`, true, { action: { label: 'Открыть', fn: openComponentsTab }, ms: 10000 });
  }
  else if (failed.length) {
    const f = failed[0], heic = /\.hei[cf]$/i.test(f.name);
    const why = f.msg || (heic ? 'не удалось прочитать HEIC' : 'формат не распознан или файл повреждён');
    toast(failed.length === 1 ? `${f.name}: ${why}` : `Не удалось открыть ${failed.length} из ${files.length}: ${failed.slice(0, 2).map(x => x.name).join(', ')}${failed.length > 2 ? '…' : ''}. ${why}`, true, { ms: 7000 });
  }
  else if (ok) toast(`Загружено: ${ok}${extra}`, false, { ms: notes.length ? 6000 : 0 });
  if (bigNotes.length) setTimeout(() => toast(bigPhotoMsg(bigNotes), false, { ms: 9000 }), 900);
}

let trash = null;   // последнее удаление, которое ещё можно отменить
function freeItem(it) { URL.revokeObjectURL(it.url); if (it.thumb) URL.revokeObjectURL(it.thumb); if (it.view) URL.revokeObjectURL(it.view); }
function commitTrash() { if (!trash) return; clearTimeout(trash.timer); trash.list.forEach(e => freeItem(e.item)); trash = null; }
function stashTrash(list, prevIdx, label) {
  commitTrash();
  trash = { list, prevIdx, timer: setTimeout(commitTrash, 9000) };
  toast(label, false, { action: { label: 'Отменить', fn: undoTrash }, ms: 9000 });
}
function undoTrash() {
  if (!trash) return;
  const t = trash; clearTimeout(t.timer); trash = null;
  t.list.slice().sort((a, b) => a.index - b.index).forEach(e => items.splice(Math.min(e.index, items.length), 0, e.item));
  idx = Math.max(0, Math.min(t.prevIdx, items.length - 1));
  beforeImg.dataset.id = '';
  updateChrome(); schedule(); toast('Восстановлено');
}
function removeItem(i) {
  const it = items[i];
  if (!it) return;
  if (cache.id === it.id) releaseCache();
  const prev = idx;
  items.splice(i, 1);
  if (idx >= items.length) idx = Math.max(0, items.length - 1);
  beforeImg.dataset.id = '';
  updateChrome();
  schedule();
  stashTrash([{ item: it, index: i }], prev, `Удалено: ${it.name}`);
}

function clearAll() {
  if (!items.length) return;
  releaseCache();
  const list = items.map((item, index) => ({ item, index })), prev = idx;
  items = []; idx = 0; fileInput.value = '';
  beforeImg.removeAttribute('src'); beforeImg.dataset.id = '';
  updateChrome();
  stashTrash(list, prev, `Очищено: ${list.length} фото`);
}

function select(i) {
  if (i < 0 || i >= items.length) return;
  idx = i;
  updateChrome();
  schedule();
}

/* Кэш декодированного битмапа только для текущего фото (экономим память) */
function getBitmap(item) {
  if (cache.id === item.id && cache.promise) return cache.promise;
  releaseCache();
  const entry = { id: item.id, bmp: null, promise: null, released: false };
  cache = entry;
  entry.promise = loadBitmap(item).then(b => {
    if (entry.released) { closeBmp(b); return b; }
    entry.bmp = b; return b;
  });
  return entry.promise;
}
function releaseCache() {
  cache.released = true;
  closeBmp(cache.bmp);
  cache = { id: null, bmp: null, promise: null, released: false };
}
