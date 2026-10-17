'use strict';
/* Aspect Studio — Ядро: константы, состояние, тема, уведомления, загрузка изображений */
/* ===================================================================
   Aspect Studio v2 — чистый JS, без зависимостей
   =================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- Константы ---------- */
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
  { g: 'Соцсети', id: 'story',    name: 'Stories / Reels',note: '9:16',   w: 1080, h: 1920 },
  { g: 'Соцсети', id: 'tiktok',   name: 'TikTok',         note: '9:16',   w: 1080, h: 1920 },
  { g: 'Соцсети', id: 'x',        name: 'X (Twitter)',    note: '16:9',   w: 1600, h: 900  },
  { g: 'Соцсети', id: 'fb',       name: 'Facebook',       note: '1.91:1', w: 1200, h: 630  },
  { g: 'Соцсети', id: 'in',       name: 'LinkedIn',       note: '1.91:1', w: 1200, h: 627  },
  { g: 'Соцсети', id: 'pin',      name: 'Pinterest',      note: '2:3',    w: 1000, h: 1500 },
  { g: 'Соцсети', id: 'vk',       name: 'VK пост',        note: '1:1',    w: 1080, h: 1080 },
  { g: 'Соцсети', id: 'tgava',    name: 'Telegram аватар',note: '1:1',    w: 640,  h: 640  },
  { g: 'Маркетплейсы', id: 'wb',  name: 'Wildberries',    note: '3:4',    w: 900,  h: 1200 },
  { g: 'Маркетплейсы', id: 'ozon',name: 'Ozon',           note: '3:4',    w: 900,  h: 1200 },
  { g: 'Маркетплейсы', id: 'ozf', name: 'Ozon Fresh',     note: '1:1',    w: 1000, h: 1000 },
  { g: 'Маркетплейсы', id: 'ym',  name: 'Яндекс Маркет',  note: '3:4',    w: 900,  h: 1200 },
  { g: 'Маркетплейсы', id: 'avito',name: 'Авито',         note: '4:3',    w: 1280, h: 960  },
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
  format: 'png', quality: 92, maxSide: 4096, targetOn: false, targetKB: 500,
  wmOn: false, wmText: '@aspect.studio', wmPos: 'br', wmSize: 22, wmOpacity: 75,
  view: 'slider', pin: true,
  enhOn: true, enhScale: 1, enhLevel: 'mid', sharp: 45, denoise: 20, smart: true,
  wide: true, keepMeta: false,
};

let S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) {}
// Страховка от повреждённых значений
for (const k of Object.keys(DEFAULTS)) if (typeof S[k] !== typeof DEFAULTS[k]) S[k] = DEFAULTS[k];

// Настройки на фото: у фото может быть свой набор (item.ov) поверх общих S
const OV_KEYS = ['sizeMode', 'ratioW', 'ratioH', 'outW', 'outH', 'presetId', 'fit', 'align', 'bg', 'color', 'blur', 'dim', 'grad1', 'grad2', 'gradAngle', 'enhOn', 'enhScale', 'enhLevel', 'sharp', 'denoise', 'smart'];
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
  $('#themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
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
function showProgress(title) {
  $('#progressTitle').textContent = title;
  progressFill.style.width = '0%';
  progressEl.classList.add('show');
}
function setProgress(done, total, name) {
  progressFill.style.width = (total ? (done / total) * 100 : 0) + '%';
  $('#progressTitle').textContent = `Обработка: ${done} / ${total}`;
  $('#progressName').textContent = name || '';
}
function hideProgress() { progressEl.classList.remove('show'); }
$('#progressCancel').addEventListener('click', () => { cancelFlag = true; exWork.cancel(); });

const yieldUI = () => new Promise(r => setTimeout(r, 0));

/* ===================================================================
   Загрузка изображений (с учётом EXIF-ориентации)
   =================================================================== */
async function decodeBitmap(src) {
  const f = src.file;
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
    bmp = await loadBitmap({ file, url });
    const { w, h } = dimsOf(bmp);
    if (!w || !h) throw new Error('empty');
    const thumb = await makeThumb(bmp, w, h);
    const p3 = await detectP3(file);
    return { id: ++uid, name: file.name || `image-${uid}`, file, url, thumb, w, h, ow: w, oh: h, rot: 0, flipH: false, flipV: false, crop: null, view: null, ov: null, focus: { x: .5, y: .5 }, zoom: 1, sample: null, dom: null, p3 };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  } finally { closeBmp(bmp); }
}

async function addFiles(list) {
  const files = Array.from(list || []).filter(f => (f.type && f.type.startsWith('image/')) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name));
  if (!files.length) { toast('Выбери изображения', true); return; }
  const first = items.length;
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    try { items.push(await makeItem(files[i])); }
    catch (e) { failed.push(files[i].name); }
    if (files.length > 3) toast(`Загрузка ${i + 1} / ${files.length}…`);
  }
  if (items.length > first) { idx = first; updateChrome(); schedule(); }
  const ok = items.length - first;
  const heic = failed.filter(n => /\.hei[cf]$/i.test(n));
  if (failed.length && heic.length === failed.length) toast('HEIC этот браузер не открывает — сохрани фото как JPG или открой сайт в Safari', true);
  else if (failed.length) toast(`Не удалось открыть: ${failed.slice(0, 2).join(', ')}${failed.length > 2 ? '…' : ''}`, true);
  else if (ok) toast(`Загружено: ${ok}`);
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
