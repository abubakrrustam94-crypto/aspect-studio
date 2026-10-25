'use strict';
/* Aspect Studio — Горячие клавиши, просмотр 100%, акцент, настройки для фото, наборы, обрезка */
/* ===================================================================
   Горячие клавиши (по физическим клавишам — работают и в русской раскладке)
   =================================================================== */
addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.code) {
    case 'KeyD': e.shiftKey ? exportAll() : downloadCurrent(); break;
    case 'KeyC': copyCurrent(); break;
    case 'KeyS': if (e.shiftKey) { if (SHARE_FILES && items.length > 1) shareAll(); } else if (navigator.share) shareCurrent(); break;
    case 'KeyT': toggleTheme(); break;
    case 'KeyZ': openInspector(); break;
    case 'KeyV': set('view', { slider: 'before', before: 'after', after: 'slider' }[S.view]); break;
    case 'KeyF': set('fit', cfgFor(cur()).fit === 'fit' ? 'fill' : 'fit'); break;
    case 'ArrowLeft': if (t === sliderHandle) return; select(idx - 1); break;
    case 'ArrowRight': if (t === sliderHandle) return; select(idx + 1); break;
    default: return;
  }
});

/* ===================================================================
   PWA
   =================================================================== */
/* ===================================================================
   Окно «Проверить на 100%»: реальные пиксели результата, с улучшением и без
   =================================================================== */
const insp = { item: null, bmp: null, canvases: {}, mode: 'on' };
const inspEl = $('#inspect'), inspScroll = $('#inspScroll');

async function inspShow(mode) {
  let c = insp.canvases[mode];
  if (!c) {
    c = document.createElement('canvas');
    await render(c, insp.item, insp.bmp, { enh: mode === 'on', p3: wantP3(insp.item) });
    if (!insp.item) return;          // окно закрыли, пока считали
    insp.canvases[mode] = c;
  }
  const keepL = inspScroll.scrollLeft, keepT = inspScroll.scrollTop, first = !inspScroll.firstChild;
  c.style.width = (c.width / (devicePixelRatio || 1)) + 'px';
  inspScroll.replaceChildren(c);
  insp.mode = mode;
  $$('#inspSeg button').forEach(b => b.classList.toggle('active', b.dataset.m === mode));
  $('#inspInfo').textContent = `${c.width}×${c.height} px · реальный масштаб`;
  if (first) { inspScroll.scrollLeft = (inspScroll.scrollWidth - inspScroll.clientWidth) / 2; inspScroll.scrollTop = (inspScroll.scrollHeight - inspScroll.clientHeight) / 2; }
  else { inspScroll.scrollLeft = keepL; inspScroll.scrollTop = keepT; }
}

/* ---------- Акцентный цвет темы ---------- */
const ACCENT_KEY = 'aspect-studio-accent';
const ACCENTS = [['violet', 262, 'Фиолетовый'], ['blue', 217, 'Синий'], ['teal', 174, 'Бирюзовый'], ['green', 142, 'Зелёный'], ['orange', 28, 'Оранжевый'], ['pink', 330, 'Розовый']];
const accentStyle = document.head.appendChild(Object.assign(document.createElement('style'), { id: 'accentStyle' }));
/* Контраст WCAG: подбираем яркость так, чтобы текст на цвете читался (≥ 4.5:1) в обеих темах */
function hslRgb(h, s, l) { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)].map(x => x * 255); }
function relLum(c) { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; }
function contrast(a, b) { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function accentPalette(h) {
  const S_LIGHT = [250, 248, 255], WHITE = [255, 255, 255];
  let lp = 36; while (lp > 18 && (contrast(hslRgb(h, 70, lp), WHITE) < 4.8 || contrast(hslRgb(h, 70, lp), S_LIGHT) < 4.8)) lp--;
  let dc = 36; const opcD = hslRgb(h, 100, 97); while (dc > 20 && contrast(hslRgb(h, 65, dc), opcD) < 5) dc--;
  return { lp, dc };
}
function applyAccent(id) {
  const a = ACCENTS.find(x => x[0] === id) || ACCENTS[0], h = a[1], { lp, dc } = accentPalette(h);
  accentStyle.textContent = a[0] === 'violet' ? '' : `
    :root { --md-sys-color-primary: hsl(${h} 90% 82%); --md-sys-color-on-primary: hsl(${h} 70% 16%); --md-sys-color-primary-container: hsl(${h} 65% ${dc}%); --md-sys-color-on-primary-container: hsl(${h} 100% 97%); }
    [data-theme="light"] { --md-sys-color-primary: hsl(${h} 70% ${lp}%); --md-sys-color-on-primary: #fff; --md-sys-color-primary-container: hsl(${h} 90% 93%); --md-sys-color-on-primary-container: hsl(${h} 70% 18%); }`;
  $$('#accentRow .accent-dot').forEach(b => { const on = b.dataset.id === a[0]; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  try { localStorage.setItem(ACCENT_KEY, a[0]); } catch (e) {}
}
(function () {
  const row = $('#accentRow');
  ACCENTS.forEach(([id, h, name]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'accent-dot'; b.dataset.id = id;
    b.style.background = `hsl(${h} 70% 52%)`; b.title = name; b.setAttribute('aria-label', 'Акцент: ' + name);
    b.addEventListener('click', () => applyAccent(id)); row.appendChild(b);
  });
  let a = 'violet'; try { a = localStorage.getItem(ACCENT_KEY) || 'violet'; } catch (e) {}
  applyAccent(a);
})();

/* ---------- aria-pressed для всех переключателей: следим за классом .active ---------- */
(function () {
  const sel = '.seg button, .chip, .swatch';
  const sync = n => n.setAttribute('aria-pressed', n.classList.contains('active') ? 'true' : 'false');
  const mo = new MutationObserver(list => list.forEach(m => { if (m.target.matches && m.target.matches(sel)) sync(m.target); }));
  const watch = () => document.querySelectorAll(sel).forEach(n => { if (!n.hasAttribute('aria-pressed') || true) sync(n); mo.observe(n, { attributes: true, attributeFilter: ['class'] }); });
  watch();
  // чипы/цвета создаются динамически — подхватываем новые
  new MutationObserver(() => watch()).observe(document.body, { childList: true, subtree: true });
})();
/* ---------- Фокус в модальных окнах: ловушка Tab и возврат на кнопку-открывашку ---------- */
const focusBack = new Map();
function rememberFocus(el) { focusBack.set(el, document.activeElement); }
function restoreFocus(el) {
  const t = focusBack.get(el); focusBack.delete(el);
  if (t && t.isConnected && typeof t.focus === 'function') { try { t.focus({ preventScroll: true }); } catch (_) {} }
}
addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const dlg = [cpEl, inspEl, $('#review'), $('#maskEd'), $('#erEd'), $('#peek')].find(el => el && el.classList.contains('show'));
  if (!dlg) return;
  const f = [...dlg.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')].filter(n => !n.disabled && n.offsetParent !== null);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!dlg.contains(a)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
});
async function openInspector() {
  const item = cur();
  if (!item || busy || inspEl.classList.contains('show')) return;
  if (!cfgFor(item).enhOn) { toast('Включи «Улучшение качества», чтобы сравнить'); return; }
  busy = true; setToolbarBusy(true);
  try {
    toast('Готовлю просмотр 100%…');
    await yieldUI(); await yieldUI();
    insp.item = item; insp.bmp = await getBitmap(item); insp.canvases = {};
    inspScroll.replaceChildren();
    await inspShow('on');
    rememberFocus(inspEl); inspEl.classList.add('show');
    $('#inspClose').focus();
  } catch (e) { console.error(e); toast('Ошибка: ' + (e.message || e), true); }
  finally { busy = false; setToolbarBusy(false); }
}
function closeInspector() {
  exWork.cancel();
  inspEl.classList.remove('show'); restoreFocus(inspEl);
  Object.values(insp.canvases).forEach(c => { c.width = c.height = 0; });
  insp.canvases = {}; insp.item = insp.bmp = null; inspScroll.replaceChildren();
}
$('#inspectBtn').addEventListener('click', openInspector);
$('#inspClose').addEventListener('click', closeInspector);
$$('#inspSeg button').forEach(b => b.addEventListener('click', async () => {
  if (b.dataset.m === insp.mode) return;
  if (!insp.canvases[b.dataset.m]) { toast('Считаю…'); await yieldUI(); await yieldUI(); }
  try { await inspShow(b.dataset.m); } catch (e) { if (!e || e.name !== 'AbortError') toast(friendlyError(e), true); }
}));
addEventListener('keydown', e => { if (e.key === 'Escape' && inspEl.classList.contains('show')) closeInspector(); });

/* ===================================================================
   Настройки «для всех / только для этого фото»
   =================================================================== */
function syncScope() {
  const it = cur();
  $('#cardScope').hidden = !it;
  if (!it) return;
  $$('#scopeSeg button').forEach(b => { const on = (b.dataset.s === 'one') === !!it.ov; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  $('#applyAllBtn').hidden = !it.ov;
  $('#copyToSel').hidden = items.length < 2;
  $('#scopeNote').textContent = it.ov
    ? 'Формат, поля, улучшение и масштаб кадра — только для этого фото. Формат файла и водяной знак общие.'
    : (items.length > 1 ? 'Изменения применяются ко всем фото. Нужно иначе для одного — выбери «Только этого».' : '');
}
$$('#scopeSeg button').forEach(b => b.addEventListener('click', () => {
  const it = cur(); if (!it) return;
  if (b.dataset.s === 'one' && !it.ov) { it.ov = {}; OV_KEYS.forEach(k => { it.ov[k] = S[k]; }); }
  else if (b.dataset.s === 'all' && it.ov) it.ov = null;
  renderThumbs(); syncUI(); schedule();
}));
$('#applyAllBtn').addEventListener('click', () => {
  const it = cur(); if (!it || !it.ov) return;
  OV_KEYS.forEach(k => { S[k] = it.ov[k]; });
  items.forEach(x => { x.ov = null; });
  save(); renderThumbs(); syncUI(); schedule(); toast('Настройки стали общими для всех фото');
});

/* ===================================================================
   Мои наборы настроек (хранятся в браузере)
   =================================================================== */
const PRESET_KEY = 'aspect-studio-presets', PRESET_SKIP = ['view', 'pin'];
let myPresets = [];
try { myPresets = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); if (!Array.isArray(myPresets)) myPresets = []; } catch (e) { myPresets = []; }
myPresets = myPresets.filter(p => p && typeof p.name === 'string' && p.cfg && typeof p.cfg === 'object');
const savePresets = () => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(myPresets)); } catch (e) {} };
function renderPresets() {
  const box = $('#myPresets'); box.replaceChildren();
  myPresets.forEach((p, i) => {
    const w = document.createElement('span'); w.className = 'mp';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = p.name; b.addEventListener('click', () => applyMyPreset(p));
    const x = document.createElement('button'); x.type = 'button'; x.className = 'mp-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Удалить набор ' + p.name);
    x.addEventListener('click', () => { myPresets.splice(i, 1); savePresets(); renderPresets(); toast('Набор удалён'); });
    w.append(b, x); box.append(w);
  });
  $('#presetsEmpty').hidden = myPresets.length > 0;
}
function applyMyPreset(p) {
  histPush('preset');
  const it = cur(), ok = k => k in DEFAULTS && typeof p.cfg[k] === typeof DEFAULTS[k];
  Object.keys(p.cfg).forEach(k => { if (ok(k) && !PRESET_SKIP.includes(k)) S[k] = p.cfg[k]; });
  if (it && it.ov) OV_KEYS.forEach(k => { if (ok(k)) it.ov[k] = p.cfg[k]; });
  save(); syncUI(); schedule(); toast(`Набор «${p.name}» применён`);
}
$('#savePreset').addEventListener('click', () => {
  const inp = $('#presetName'), name = inp.value.trim().slice(0, 30);
  if (!name) { toast('Введи название набора', true); inp.focus(); return; }
  const E = cfgFor(cur()), cfg = {};
  Object.keys(DEFAULTS).forEach(k => { if (!PRESET_SKIP.includes(k)) cfg[k] = E[k]; });
  const ex = myPresets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  if (ex >= 0) myPresets[ex] = { name, cfg }; else myPresets.push({ name, cfg });
  myPresets = myPresets.slice(-30);
  savePresets(); renderPresets(); inp.value = ''; toast(`Набор «${name}» сохранён`);
});
$('#presetName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#savePreset').click(); });
renderPresets();

/* ===================================================================
   Обрезка, поворот, отражение
   =================================================================== */
const cp = { open: false, item: null, orig: null, rot: 0, flipH: false, flipV: false, crop: null, ratioKey: 'free', sw: 0, sh: 0, drag: null };
const cpEl = $('#cropper'), cpStage = $('#cpStage'), cpCanvas = $('#cpCanvas'), cpBox = $('#cpBox'), cpWrap = $('#cpWrap');
const FULL = () => ({ x: 0, y: 0, w: 1, h: 1 });
const isFull = r => r.x < .002 && r.y < .002 && r.w > .996 && r.h > .996;
const clamp01 = v => Math.max(0, Math.min(1, v));
const CP_MIN = 0.04;

function cpDraw() {
  const r = cp.rot % 180, sw = r ? cp.item.oh : cp.item.ow, sh = r ? cp.item.ow : cp.item.oh;
  cp.sw = sw; cp.sh = sh;
  const k = Math.min(1, 1100 / Math.max(sw, sh));
  cpCanvas.width = Math.max(1, Math.round(sw * k)); cpCanvas.height = Math.max(1, Math.round(sh * k));
  const g = cpCanvas.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.save(); g.translate(cpCanvas.width / 2, cpCanvas.height / 2); g.rotate(cp.rot * Math.PI / 180); g.scale(cp.flipH ? -1 : 1, cp.flipV ? -1 : 1);
  const { w, h } = dimsOf(cp.orig); g.drawImage(cp.orig, -w * k / 2, -h * k / 2, w * k, h * k); g.restore();
  cpLayout(); cpBoxUpdate();
}
function cpLayout() {      // вписываем холст в доступную область
  const aw = Math.max(60, cpWrap.clientWidth - 24), ah = Math.max(60, cpWrap.clientHeight - 24);
  const k = Math.min(aw / cpCanvas.width, ah / cpCanvas.height);
  cpStage.style.width = Math.max(40, cpCanvas.width * k) + 'px'; cpStage.style.height = Math.max(40, cpCanvas.height * k) + 'px';
}
function cpBoxUpdate() {
  const r = cp.crop;
  Object.assign(cpBox.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
  $('#cpInfo').textContent = `${Math.round(r.w * cp.sw)}×${Math.round(r.h * cp.sh)} px`;
}
function cpRatio() {       // выбранные пропорции в пикселях (w/h) или null
  const k = cp.ratioKey;
  if (k === 'free') return null;
  if (k === 'frame') { const E = cfgFor(cp.item); return E.sizeMode === 'fixed' ? E.outW / E.outH : E.ratioW / E.ratioH; }
  const [a, b] = k.split(':').map(Number); return a / b;
}
function cpFitRatio() {    // подгоняем текущую рамку под пропорции, центр сохраняем
  const r = cpRatio(); if (!r) return;
  const c = cp.crop; let w = c.w * cp.sw, h = c.h * cp.sh;
  if (w / h > r) w = h * r; else h = w / r;
  const fw = w / cp.sw, fh = h / cp.sh, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  cp.crop = { x: Math.min(1 - fw, Math.max(0, cx - fw / 2)), y: Math.min(1 - fh, Math.max(0, cy - fh / 2)), w: fw, h: fh };
}
function cpApply(mode, r0, dx, dy) {     // dx, dy — смещение в долях сцены
  const { x, y, w, h } = r0;
  if (mode === 'move') { cp.crop = { x: Math.min(1 - w, Math.max(0, x + dx)), y: Math.min(1 - h, Math.max(0, y + dy)), w, h }; return; }
  const mW = mode.includes('w'), mE = mode.includes('e'), mN = mode.includes('n'), mS = mode.includes('s');
  let x0 = x, x1 = x + w, y0 = y, y1 = y + h;
  if (mW) x0 = clamp01(x0 + dx); if (mE) x1 = clamp01(x1 + dx);
  if (mN) y0 = clamp01(y0 + dy); if (mS) y1 = clamp01(y1 + dy);
  if (x1 - x0 < CP_MIN) { if (mW) x0 = x1 - CP_MIN; else x1 = x0 + CP_MIN; }
  if (y1 - y0 < CP_MIN) { if (mN) y0 = y1 - CP_MIN; else y1 = y0 + CP_MIN; }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
  const ratio = cpRatio(), sw = cp.sw, sh = cp.sh;
  if (ratio) {
    if ((mW || mE) && (mN || mS)) {                       // угол: якорь — противоположный угол
      const ax = mW ? x + w : x, ay = mN ? y + h : y, sx = mW ? -1 : 1, sy = mN ? -1 : 1;
      let dw = Math.abs((mW ? x0 : x1) - ax) * sw, dh = Math.abs((mN ? y0 : y1) - ay) * sh;
      if (dw / Math.max(dh, 1e-6) > ratio) dw = dh * ratio; else dh = dw / ratio;
      const maxW = (sx < 0 ? ax : 1 - ax) * sw, maxH = (sy < 0 ? ay : 1 - ay) * sh;
      const sc = Math.min(1, maxW / Math.max(dw, 1e-6), maxH / Math.max(dh, 1e-6)); dw *= sc; dh *= sc;
      const fw = Math.max(CP_MIN, dw / sw), fh = Math.max(CP_MIN, dh / sh);
      x0 = sx < 0 ? ax - fw : ax; x1 = x0 + fw; y0 = sy < 0 ? ay - fh : ay; y1 = y0 + fh;
    } else if (mW || mE) {                                // боковая грань: высота подстраивается вокруг центра
      const cy = y + h / 2; let nw = (x1 - x0) * sw;
      nw = Math.min(nw, 2 * Math.min(cy, 1 - cy) * sh * ratio);
      const fw = nw / sw, fh = nw / ratio / sh;
      if (mW) x0 = x1 - fw; else x1 = x0 + fw;
      y0 = cy - fh / 2; y1 = y0 + fh;
    } else {                                              // верх/низ: ширина подстраивается вокруг центра
      const cx = x + w / 2; let nh = (y1 - y0) * sh;
      nh = Math.min(nh, 2 * Math.min(cx, 1 - cx) * sw / ratio);
      const fh = nh / sh, fw = nh * ratio / sw;
      if (mN) y0 = y1 - fh; else y1 = y0 + fh;
      x0 = cx - fw / 2; x1 = x0 + fw;
    }
  }
  cp.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function cpRotate(cw) {    // меняем и рамку, чтобы она осталась на том же месте изображения
  const c = cp.crop;
  cp.crop = cw ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
  cp.rot = (cp.rot + (cw ? 90 : 270)) % 360;
  cpDraw();
}
function cpFlip(vis) {     // отражение того, что видно на экране (при повороте на 90/270 меняется ось в исходнике)
  const c = cp.crop;
  cp.crop = vis === 'h' ? { ...c, x: 1 - c.x - c.w } : { ...c, y: 1 - c.y - c.h };
  const axis = (cp.rot % 180) ? (vis === 'h' ? 'v' : 'h') : vis;
  if (axis === 'h') cp.flipH = !cp.flipH; else cp.flipV = !cp.flipV;
  cpDraw();
}

cpStage.addEventListener('pointerdown', e => {
  const h = e.target.dataset && e.target.dataset.h;
  if (!h && e.target !== cpBox) return;
  const rect = cpStage.getBoundingClientRect();
  cp.drag = { mode: h || 'move', x: e.clientX, y: e.clientY, r0: { ...cp.crop }, rw: rect.width, rh: rect.height };
  try { cpStage.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});
cpStage.addEventListener('pointermove', e => {
  const d = cp.drag; if (!d) return;
  cpApply(d.mode, d.r0, (e.clientX - d.x) / d.rw, (e.clientY - d.y) / d.rh); cpBoxUpdate();
});
const cpEnd = () => { cp.drag = null; };
cpStage.addEventListener('pointerup', cpEnd); cpStage.addEventListener('pointercancel', cpEnd);

$('#cpRotL').addEventListener('click', () => cpRotate(false));
$('#cpRotR').addEventListener('click', () => cpRotate(true));
$('#cpFlipH').addEventListener('click', () => cpFlip('h'));
$('#cpFlipV').addEventListener('click', () => cpFlip('v'));
$$('#cpRatio button').forEach(b => b.addEventListener('click', () => {
  cp.ratioKey = b.dataset.r;
  $$('#cpRatio button').forEach(x => x.classList.toggle('active', x === b));
  cpFitRatio(); cpBoxUpdate();
}));
$('#cpReset').addEventListener('click', () => { Object.assign(cp, { rot: 0, flipH: false, flipV: false, crop: FULL() }); cpDraw(); });
addEventListener('resize', () => { if (cp.open) cpLayout(); });

async function openCropper() {
  const item = cur();
  if (!item || busy || cp.open) return;
  busy = true; setToolbarBusy(true);
  try {
    cp.orig = await decodeBitmap(item);
    Object.assign(cp, { open: true, item, rot: item.rot || 0, flipH: !!item.flipH, flipV: !!item.flipV, crop: item.crop ? { ...item.crop } : FULL(), ratioKey: 'free', drag: null });
    $$('#cpRatio button').forEach(b => b.classList.toggle('active', b.dataset.r === 'free'));
    rememberFocus(cpEl); cpEl.classList.add('show');
    cpDraw();
    $('#cpDone').focus();
  } catch (e) { console.error(e); closeBmp(cp.orig); cp.orig = null; toast(friendlyError(e), true); }
  finally { busy = false; setToolbarBusy(false); }
}
function closeCropper() { cpEl.classList.remove('show'); restoreFocus(cpEl); closeBmp(cp.orig); cp.orig = null; cp.open = false; cp.item = null; cp.drag = null; }

async function ensureView(item, bmp) {   // картинка «До» с учётом поворота/обрезки
  if (item.view) { URL.revokeObjectURL(item.view); item.view = null; }
  if (xformInfo(item).same) return;
  const { w, h } = dimsOf(bmp), k = Math.min(1, 1600 / Math.max(w, h));
  const c = mkCanvas(Math.round(w * k), Math.round(h * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  c.width = c.height = 0;
  if (blob) item.view = URL.createObjectURL(blob);
}
async function commitXform(item) {
  syncDims(item);
  item.focus = { x: .5, y: .5 }; item.zoom = 1; item.sample = null; item.dom = null; item.an = undefined; item.manual = false;
  if (cache.id === item.id) releaseCache();
  try {
    const bmp = await loadBitmap(item);
    const t = await makeThumb(bmp, item.w, item.h);
    if (item.thumb) URL.revokeObjectURL(item.thumb);
    item.thumb = t;
    await ensureView(item, bmp);
    closeBmp(bmp);
  } catch (e) { console.error(e); toast(friendlyError(e), true); }
  beforeImg.dataset.id = '';
  updateChrome(); schedule();
}
async function cpCommit() {
  const it = cp.item; if (!it) return;
  const crop = isFull(cp.crop) ? null : { ...cp.crop };
  const changed = (it.rot || 0) !== cp.rot || !!it.flipH !== cp.flipH || !!it.flipV !== cp.flipV || JSON.stringify(it.crop) !== JSON.stringify(crop);
  Object.assign(it, { rot: cp.rot, flipH: cp.flipH, flipV: cp.flipV, crop });
  closeCropper();
  if (changed) await commitXform(it);
}
$('#cpDone').addEventListener('click', cpCommit);
$('#cpCancel').addEventListener('click', closeCropper);
$('#cropBtn').addEventListener('click', openCropper);
addEventListener('keydown', e => { if (e.key === 'Escape' && cp.open) closeCropper(); });

let deferredPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null; $('#installBtn').hidden = true;
});
addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Приложение установлено'); });
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ===================================================================
   Вкладки настроек
   =================================================================== */
(function () {
  const col = $('#colSettings'), tabs = $$('#settingsTabs [role="tab"]'), KEY = 'aspect-studio-tab';
  function setTab(t, focus) {
    if (!tabs.some(b => b.dataset.tab === t)) t = 'frame';
    col.dataset.tab = t;
    tabs.forEach(b => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    try { localStorage.setItem(KEY, t); } catch (e) {}
  }
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); const vis = tabs.filter(x => !x.hidden); setTab(vis[(vis.indexOf(b) + d + vis.length) % vis.length].dataset.tab, true); }
    });
  });
  let t = 'frame'; try { t = localStorage.getItem(KEY) || 'frame'; } catch (e) {}
  setTab(t);
  window.setSettingsTab = setTab;
})();

/* ===================================================================
   Порядок фото: сдвиг, сортировка, перетаскивание
   =================================================================== */
function setOrder(newItems, label) {
  const before = items.slice(), current = cur();
  items = newItems; idx = Math.max(0, items.indexOf(current));
  beforeImg.dataset.id = '';
  updateChrome(); schedule();
  if (label) toast(label, false, { action: { label: 'Отменить', fn: () => { const c = cur(); items = before; idx = Math.max(0, items.indexOf(c)); beforeImg.dataset.id = ''; updateChrome(); schedule(); } }, ms: 7000 });
}
function moveItem(from, to) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
  const arr = items.slice(), [m] = arr.splice(from, 1); arr.splice(to, 0, m);
  const current = cur(); items = arr; idx = items.indexOf(current);
  updateChrome();
}
$('#moveL').addEventListener('click', () => { if (idx > 0) { const c = cur(); moveItem(idx, idx - 1); idx = items.indexOf(c); updateChrome(); } });
$('#moveR').addEventListener('click', () => { if (idx < items.length - 1) { const c = cur(); moveItem(idx, idx + 1); idx = items.indexOf(c); updateChrome(); } });
$('#sortSel').addEventListener('change', e => {
  const m = e.target.value; e.target.value = '';
  if (!m || items.length < 2) return;
  const arr = items.slice();
  const nat = (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' });
  if (m === 'name') arr.sort(nat);
  else if (m === 'date') arr.sort((a, b) => (a.file.lastModified || 0) - (b.file.lastModified || 0) || nat(a, b));
  else if (m === 'size') arr.sort((a, b) => (a.file.size || 0) - (b.file.size || 0) || nat(a, b));
  else if (m === 'rev') arr.reverse();
  setOrder(arr, { name: 'Отсортировано по имени', date: 'Отсортировано по дате', size: 'Отсортировано по размеру', rev: 'Порядок развёрнут' }[m]);
});
// Перетаскивание миниатюр (мышь; на телефоне — кнопки ◀ ▶)
let dragFrom = -1;
thumbsEl.addEventListener('dragstart', e => {
  const t = e.target.closest && e.target.closest('.thumb'); if (!t) return;
  dragFrom = Array.from(thumbsEl.children).indexOf(t); t.classList.add('dragging');
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (_) {}
});
thumbsEl.addEventListener('dragend', () => { dragFrom = -1; $$('.thumb', thumbsEl).forEach(t => t.classList.remove('dragging', 'drag-over')); });
thumbsEl.addEventListener('dragover', e => {
  if (dragFrom < 0) return;
  e.preventDefault();
  const t = e.target.closest('.thumb'); $$('.thumb', thumbsEl).forEach(x => x.classList.toggle('drag-over', x === t));
});
thumbsEl.addEventListener('drop', e => {
  if (dragFrom < 0) return;
  e.preventDefault(); e.stopPropagation();
  const t = e.target.closest('.thumb'); const to = t ? Array.from(thumbsEl.children).indexOf(t) : -1;
  const from = dragFrom; dragFrom = -1;
  if (to >= 0) moveItem(from, to);
});

/* ===================================================================
   Копирование настроек на отмеченные ✓
   =================================================================== */
$('#copyToSel').addEventListener('click', () => {
  const src = cur(); if (!src || busy) return;
  const E = cfgFor(src), pick = {};
  OV_KEYS.forEach(k => { pick[k] = E[k]; });
  const targets = items.filter(i => i !== src && !i.skip);
  if (!targets.length) { toast('Отметь галочкой миниатюры другие фото', true); return; }
  const prev = targets.map(t => [t, t.ov ? { ...t.ov } : null]);
  targets.forEach(t => { t.ov = { ...pick }; });
  renderThumbs(); syncUI(); schedule();
  toast(`Настройки применены к ${targets.length} фото`, false, { action: { label: 'Отменить', fn: () => { prev.forEach(([t, o]) => { t.ov = o; }); renderThumbs(); syncUI(); schedule(); } }, ms: 9000 });
});

/* ===================================================================
   Окно «Какими получатся файлы»: итоговый размер и вес каждого фото
   =================================================================== */
const rvEl = $('#review'), rvGrid = $('#rvGrid'), rvInfo = $('#rvInfo'), rvTotal = $('#rvTotal');
const rv = { token: 0, res: new Map(), cells: new Map(), locked: false };
function rvLock(on) {
  rv.locked = on; busy = on; exporting = on;
  $('.layout').classList.toggle('locked', on); setToolbarBusy(on);
}
function rvSummary() {
  let n = 0, bytes = 0, bad = 0;
  items.forEach(it => { if (it.skip) return; const r = rv.res.get(it.id); if (!r) return; if (r.err) bad++; else { n++; bytes += r.size; } });
  const sel = items.filter(i => !i.skip).length;
  rvTotal.textContent = sel ? `В ZIP: ${sel} из ${items.length} · ≈ ${fmtSize(bytes)}${n < sel ? ' (считаю…)' : ''}${bad ? ` · ошибок: ${bad}` : ''}` : 'Ничего не отмечено';
  $('#rvZip').disabled = !sel || rv.locked;
}
function rvPaint(it) {
  const c = rv.cells.get(it.id); if (!c) return;
  const r = rv.res.get(it.id);
  c.classList.toggle('skip', !!it.skip);
  c.setAttribute('aria-pressed', String(!it.skip));
  const meta = c.querySelector('.rv-meta');
  const name = `<span>${it.name.replace(/[<>&]/g, '')}</span>`;
  if (!r) meta.innerHTML = `<b>${it.skip ? 'Не входит в ZIP' : 'Считаю…'}</b>${name}`;
  else if (r.err) meta.innerHTML = `<b class="bad">Ошибка</b>${name}`;
  else meta.innerHTML = `<b>${r.w}×${r.h}</b>${fmtSize(r.size)}${r.fit && !r.fit.met ? ' <i class="warn">больше лимита</i>' : ''}<br>${name}`;
}
function rvBuild() {
  rvGrid.replaceChildren(); rv.cells.clear();
  items.forEach(it => {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'rv-cell';
    c.innerHTML = '<span class="rv-tick"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></span><div class="rv-pic"></div><div class="rv-meta"></div>';
    const img = new Image(); img.src = it.thumb; img.alt = ''; c.querySelector('.rv-pic').append(img);
    c.addEventListener('click', () => {
      it.skip = !it.skip; it.status = ''; rvPaint(it); renderThumbs(); updateZipLabel(); rvSummary();
      if (!it.skip && !rv.res.has(it.id) && !rv.locked) rvCompute();
    });
    rv.cells.set(it.id, c); rvGrid.append(c); rvPaint(it);
  });
}
async function rvCompute() {
  const token = ++rv.token;
  const todo = items.filter(it => !it.skip && !rv.res.has(it.id));
  etaStart();
  if (!todo.length) { rvInfo.textContent = 'Готово. Нажми на фото, чтобы включить или исключить его из ZIP.'; rvSummary(); return; }
  rvLock(true);
  try {
    for (let i = 0; i < todo.length; i++) {
      if (token !== rv.token) break;
      const it = todo[i]; const e = etaText(i, todo.length); rvInfo.textContent = `Считаю ${i + 1} из ${todo.length}…${e ? ' ' + e : ''}`;
      await yieldUI();
      let bmp, out;
      try {
        bmp = await loadBitmap(it);
        const r = await exportBlob(it, bmp);
        const res = { w: r.w, h: r.h, size: r.blob.size, fit: r.fit };
        try {
          out = await createImageBitmap(r.blob);
          const k = Math.min(1, 280 / Math.max(out.width, out.height)), cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(out.width * k)); cv.height = Math.max(1, Math.round(out.height * k));
          cv.getContext('2d').drawImage(out, 0, 0, cv.width, cv.height);
          const pic = rv.cells.get(it.id) && rv.cells.get(it.id).querySelector('.rv-pic'); if (pic) pic.replaceChildren(cv);
        } catch (e) {}
        rv.res.set(it.id, res);
      } catch (e) {
        if (e && e.name === 'AbortError') break;
        console.error(e); rv.res.set(it.id, { err: true });
      } finally { closeBmp(bmp); if (out && out.close) out.close(); }
      rvPaint(it); rvSummary();
    }
  } finally {
    if (token === rv.token) { rvLock(false); rvInfo.textContent = 'Готово. Нажми на фото, чтобы включить или исключить его из ZIP.'; rvSummary(); }
  }
}
function openReview() {
  if (busy || !items.length) return;
  rv.res.clear(); rv.token++;
  rememberFocus(rvEl); rvBuild(); rvEl.classList.add('show'); rvSummary();
  $('#rvClose').focus();
  rvCompute();
}
function closeReview() {
  rv.token++; exWork.cancel();
  if (rv.locked) rvLock(false);
  rvEl.classList.remove('show'); restoreFocus(rvEl);
  rvGrid.replaceChildren(); rv.cells.clear(); renderThumbs(); updateZipLabel();
}
$('#reviewBtn').addEventListener('click', openReview);
$('#rvClose').addEventListener('click', closeReview);
$('#rvRecalc').addEventListener('click', () => { if (rv.locked) { rv.token++; exWork.cancel(); rvLock(false); } rv.res.clear(); items.forEach(rvPaint); rvGrid.querySelectorAll('.rv-pic').forEach((p, i) => { const it = items[i]; const img = new Image(); img.src = it.thumb; img.alt = ''; p.replaceChildren(img); }); rvSummary(); rvCompute(); });
$('#rvZip').addEventListener('click', () => { closeReview(); exportAll(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && rvEl.classList.contains('show')) closeReview(); });

/* ===================================================================
   Анализ фото, автоподбор, умная центровка
   =================================================================== */
const anBusy = new Map();
function ensureAnalysis(item, bmp) {
  if (item.an !== undefined) return Promise.resolve(item.an);
  const busy = anBusy.get(item.id);
  if (busy) return busy;                       // уже считается — ждём тот же результат (а не отвечаем «пусто» и не крутим цикл)
  const job = (async () => {
    let own = null;
    try {
      let b = bmp;
      if (!b) { own = await loadBitmap(item); b = own; }
      item.an = await analyzePhoto(b);
    } catch (e) { console.warn('analysis', e); item.an = null; }
    finally { anBusy.delete(item.id); if (own) closeBmp(own); }
    return item.an;
  })();
  anBusy.set(item.id, job);
  return job;
}
function renderAnalysis() {
  const it = cur(), box = $('#anStats');
  if (!box) return;
  $('#anTuneAll').hidden = items.length < 2;
  if (!it) { box.replaceChildren(); $('#anAdvice').textContent = 'Загрузи фото, чтобы увидеть анализ.'; $('#anTuneOne').disabled = true; return; }
  if (it.an === undefined) {
    $('#anAdvice').textContent = 'Анализирую…'; $('#anTuneOne').disabled = true; box.replaceChildren();
    ensureAnalysis(it).then(() => { if (cur() === it) { renderAnalysis(); if (cfgFor(it).fit === 'fill') schedule(); } });
    return;
  }
  const an = it.an;
  $('#anTuneOne').disabled = !an;
  if (!an) { box.replaceChildren(); $('#anAdvice').textContent = 'Не удалось проанализировать это фото.'; return; }
  const [sl, sc] = anSharpLabel(an.sharp), [nl, nc] = anNoiseLabel(an.noise);
  const stat = (name, val, cls) => `<div class="an-stat ${cls || ''}"><small>${name}</small><b>${val}</b></div>`;
  box.innerHTML = stat('Резкость', sl, sc) + stat('Шум', nl, nc) + stat('Размер', `${an.w}×${an.h}<br>${an.mp.toFixed(1)} Мп`) +
    stat('Объект', an.subject ? (an.faces ? `лиц: ${an.faces}${an.eyes ? ' · глаза' : ''}` : an.objMain || 'найден') : 'по центру') +
    (an.objects && an.objects.length ? stat('На фото', [...new Set(an.objects.map(o => o.name))].slice(0, 3).join(', ')) : '');
  $('#anAdvice').textContent = anAdvice(it, an) + (an.faceXMissing ? ' Точный поиск лиц выбран, но не скачан компонент «Лица: точный поиск» (вкладка «Компоненты»).' : '') + (an.objMissing ? ' Поиск объектов выбран, но компонент не скачан (вкладка «Компоненты»).' : an.objFail ? ' Поиск объектов не удался.' : '') + (an.faceMissing ? ' Поиск лиц не работает: не скачан компонент «Поиск лиц» (вкладка «Компоненты»), объект определён по краям.' : an.faceFail ? ' Модель лиц не загрузилась, поэтому объект определён по краям.' : '');
}
function applyTune(it, patch) {
  if (!it.ov) { it.ov = {}; OV_KEYS.forEach(k => { it.ov[k] = S[k]; }); }
  Object.assign(it.ov, patch);
}
$('#anTuneOne').addEventListener('click', async () => {
  const it = cur(); if (!it || busy) return;
  const an = await ensureAnalysis(it); if (!an) return;
  const prev = it.ov ? { ...it.ov } : null;
  applyTune(it, anRecommend(it, an));
  renderThumbs(); syncUI(); schedule();
  toast('Настройки подобраны для этого фото', false, { action: { label: 'Отменить', fn: () => { it.ov = prev; renderThumbs(); syncUI(); schedule(); } }, ms: 9000 });
});
$('#anTuneAll').addEventListener('click', async () => {
  if (busy || !items.length) return;
  busy = true; exporting = true; $('.layout').classList.add('locked'); setToolbarBusy(true);
  const prev = items.map(i => [i, i.ov ? { ...i.ov } : null]);
  try {
    for (let i = 0; i < items.length; i++) {
      toast(`Анализ ${i + 1} из ${items.length}…`);
      await yieldUI();
      const it = items[i], an = await ensureAnalysis(it);
      if (an) applyTune(it, anRecommend(it, an));
    }
  } finally { busy = false; exporting = false; $('.layout').classList.remove('locked'); setToolbarBusy(false); }
  renderThumbs(); syncUI(); schedule();
  toast('Настройки подобраны для каждого фото', false, { action: { label: 'Отменить', fn: () => { prev.forEach(([i, o]) => { i.ov = o; }); renderThumbs(); syncUI(); schedule(); } }, ms: 9000 });
});
$('#recenter').addEventListener('click', () => { const it = cur(); if (!it) return; it.manual = false; syncUI(); schedule(); });

/* ---------- Экспорт / импорт наборов, сброс, «О программе» ---------- */
function cleanPresetCfg(cfg) {
  const out = {};
  Object.keys(cfg || {}).forEach(k => { if (k in DEFAULTS && !PRESET_SKIP.includes(k) && typeof cfg[k] === typeof DEFAULTS[k]) out[k] = cfg[k]; });
  return out;
}
function parsePresetsFile(text) {
  let d; try { d = JSON.parse(text); } catch (e) { return null; }
  const list = Array.isArray(d) ? d : (d && d.app === 'aspect-studio' && Array.isArray(d.presets) ? d.presets : null);
  if (!list) return null;
  return list.filter(p => p && typeof p.name === 'string' && p.name.trim() && p.cfg && typeof p.cfg === 'object')
    .map(p => ({ name: p.name.trim().slice(0, 30), cfg: cleanPresetCfg(p.cfg) })).filter(p => Object.keys(p.cfg).length);
}
function mergePresets(list) {
  let added = 0, replaced = 0;
  list.forEach(p => {
    const ex = myPresets.findIndex(m => m.name.toLowerCase() === p.name.toLowerCase());
    if (ex >= 0) { myPresets[ex] = p; replaced++; } else { myPresets.push(p); added++; }
  });
  myPresets = myPresets.slice(-30); savePresets(); renderPresets();
  return { added, replaced };
}
$('#presetsExport').addEventListener('click', () => {
  if (!myPresets.length) { toast('Нет сохранённых наборов', true); return; }
  const data = { app: 'aspect-studio', version: APP_VERSION, presets: myPresets };
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'aspect-studio-presets.json');
  toast(`Экспортировано наборов: ${myPresets.length}`);
});
$('#presetsImport').addEventListener('click', () => $('#presetsFile').click());
$('#presetsFile').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (file.size > 1e6) { toast('Файл слишком большой для набора', true); return; }
  const list = parsePresetsFile(await file.text());
  if (!list || !list.length) { toast('Это не файл наборов Aspect Studio', true); return; }
  const r = mergePresets(list);
  toast(`Импортировано: ${r.added} новых, ${r.replaced} обновлено`);
});
$('#appVersion').textContent = 'v' + APP_VERSION;
(function () {
  const btn = $('#resetAll'), note = $('#resetNote'); let armed = 0;
  const disarm = () => { armed = 0; btn.textContent = 'Сбросить все настройки'; btn.classList.remove('armed'); note.hidden = true; };
  btn.addEventListener('click', async () => {
    if (!armed) { armed = setTimeout(disarm, 6000); btn.textContent = 'Точно сбросить?'; btn.classList.add('armed'); note.hidden = false; return; }
    clearTimeout(armed); try { await sessForget(); } catch (e) {}
    try { Object.keys(localStorage).filter(k => k.startsWith('aspect-studio')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    location.reload();
  });
})();

/* ---------- Журнал ошибок в интерфейсе ---------- */
function errLogText() {
  const miss = typeof MISSING_IDS !== 'undefined' && MISSING_IDS.size ? `\nНет элементов в index.html: ${[...MISSING_IDS].join(' ')} (файлы сайта разных версий: обнови все файлы разом)` : '';
  const comps = typeof COMPONENTS !== 'undefined' ? COMPONENTS.map(c => c.id + ':' + (compFiles[c.id] ? 'да' : compBad[c.id] ? 'повреждён' : 'нет')).join(' ') : '';
  return `Aspect Studio v${APP_VERSION}\n${navigator.userAgent}\nЭкран ${innerWidth}×${innerHeight}, память ${DEV_MEM} ГБ, формат ${S.format}, лица ${S.faceAI ? 'вкл' : 'выкл'}, фон ${S.cutOn ? 'вкл' : 'выкл'}\nКомпоненты: ${comps}${typeof compPersisted !== 'undefined' && compPersisted !== null ? ', защита от очистки: ' + (compPersisted ? 'да' : 'нет') : ''}${miss}\n\n` + (errLog.length ? errLog.map(e => `[${new Date(e.t).toLocaleString('ru-RU')}] ${e.w}${e.n > 1 ? ' ×' + e.n : ''}\n${e.m}`).join('\n\n') : 'Ошибок нет');
}
function renderErrLog() {
  $('#errLogCount').textContent = errLog.length;
  $('#errLogText').textContent = errLogText();
}
$('#errLogCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(errLogText()); toast('Журнал скопирован'); } catch (e) { toast('Не удалось скопировать — выдели текст вручную', true); }
});
$('#errLogShare').addEventListener('click', async () => {
  const text = errLogText();
  try { if (navigator.share) { await navigator.share({ title: 'Aspect Studio: отчёт об ошибке', text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Отчёт скопирован: вставь его в сообщение'); } catch (e) { toast('Не удалось отправить — выдели текст вручную', true); }
});
$('#errLogClear').addEventListener('click', () => { errLog.length = 0; try { localStorage.removeItem(ERRLOG_KEY); } catch (e) {} renderErrLog(); toast('Журнал очищен'); });
renderErrLog();

/* ---------- Метаданные исходного фото и выбор папки ---------- */
let metaTok = 0;
async function renderMetaInfo() {
  const el = $('#metaInfo'); if (!el) return;
  const it = cur(), tok = ++metaTok;
  const o = metaOpts(), parts = [o.cam && 'камера', o.date === 'keep' ? 'дата съёмки' : o.date === 'today' ? 'сегодняшняя дата' : '', o.author && 'автор', o.copyright && 'авторские права', o.dpi && o.dpi + ' dpi'].filter(Boolean);
  const tail = parts.length ? `В результат (JPG) попадёт: ${parts.join(', ')}. Геолокация не переносится никогда.` : 'В результат не попадёт ничего: ни геолокация, ни камера, ни дата.';
  if (typeof renderMetaTable === 'function') renderMetaTable(it);
  if (!it) { el.textContent = tail; return; }
  if (it.metaInfo === undefined) it.metaInfo = await readExifBasics((it.exifSrc || it.file)).catch(() => null);
  if (tok !== metaTok) return;
  const i = it.metaInfo;
  const found = !i ? 'В этом фото нет EXIF (или это не JPG).' : `В исходном фото найдено: ${[i.gps ? 'геолокация' : '', i.make || i.model ? 'камера ' + [i.make, i.model].filter(Boolean).join(' ') : '', i.dto ? 'дата ' + i.dto.slice(0, 10).replace(/:/g, '-') : ''].filter(Boolean).join(', ') || 'ничего важного'}.`;
  el.textContent = found + ' ' + tail;
}
function updateFolderUI() {
  const row = $('#folderRow'); if (!row) return;
  row.hidden = !FOLDER_OK;
  if (!FOLDER_OK) return;
  $('#folderName').textContent = dirHandle ? '«' + dirHandle.name + '»' : 'не выбрана';
  $('#folderOnNote').hidden = !S.folderOn;
}
(function () {
  if (!FOLDER_OK) { updateFolderUI(); return; }
  idbGet('dir').then(h => { if (h && h.kind === 'directory') { dirHandle = h; updateFolderUI(); } }).catch(() => {});
  $('#pickFolder').addEventListener('click', async () => { try { await pickFolder(); toast(`Папка: «${dirHandle.name}»`); } catch (e) { if (e && e.name !== 'AbortError') toast('Не удалось выбрать папку', true); } });
  const cb = $('#folderRow input[data-key="folderOn"]');
  cb.addEventListener('change', async () => {          // включили, а папки ещё нет — сразу предлагаем выбрать
    if (cb.checked && !dirHandle) { try { await pickFolder(); } catch (e) { set('folderOn', false); } }
    updateZipLabel(); updateFolderUI();
  });
  updateFolderUI();
})();


/* ===================================================================
   Шаблоны водяного знака (хранятся в браузере вместе с логотипом)
   =================================================================== */
const WMTPL_KEY = 'aspect-studio-wmtpl', WMTPL_KEYS = ['wmText', 'wmMode', 'wmPos', 'wmSize', 'wmOpacity', 'wmAngle', 'wmGap'];
let wmTpls = [];
try { wmTpls = JSON.parse(localStorage.getItem(WMTPL_KEY) || '[]'); if (!Array.isArray(wmTpls)) wmTpls = []; } catch (e) { wmTpls = []; }
wmTpls = wmTpls.filter(t => t && typeof t.name === 'string' && t.cfg && typeof t.cfg === 'object');
function wmTplStore() {
  try { localStorage.setItem(WMTPL_KEY, JSON.stringify(wmTpls)); return true; }
  catch (e) { toast('Не хватило места в браузере — удали лишние шаблоны', true); return false; }
}
function logoToDataURL(bmp) {            // логотип уменьшаем, чтобы шаблон занимал мало места
  const d = dimsOf(bmp), k = Math.min(1, 480 / Math.max(d.w, d.h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(d.w * k)); c.height = Math.max(1, Math.round(d.h * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
function renderWmTpls() {
  const box = $('#wmTpls'); if (!box) return; box.replaceChildren();
  wmTpls.forEach((t, i) => {
    const w = document.createElement('span'); w.className = 'mp';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = (t.cfg.wmMode === 'tile' ? '▦ ' : '') + t.name; b.addEventListener('click', () => applyWmTpl(t));
    const x = document.createElement('button'); x.type = 'button'; x.className = 'mp-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Удалить шаблон ' + t.name);
    x.addEventListener('click', () => { wmTpls.splice(i, 1); wmTplStore(); renderWmTpls(); toast('Шаблон удалён'); });
    w.append(b, x); box.append(w);
  });
  $('#wmTplNote').hidden = wmTpls.length > 0 ? true : false;
}
async function applyWmTpl(t) {
  const ok = k => k in DEFAULTS && typeof t.cfg[k] === typeof DEFAULTS[k];
  WMTPL_KEYS.forEach(k => { if (ok(k)) S[k] = t.cfg[k]; });
  S.wmOn = true;
  closeBmp(wmLogo); wmLogo = null; $('#wmLogoName').textContent = ''; $('#wmLogoClear').hidden = true;
  if (t.logo) {
    try {
      const blob = await (await fetch(t.logo)).blob();
      wmLogo = await createImageBitmap(blob);
      $('#wmLogoName').textContent = 'из шаблона'; $('#wmLogoClear').hidden = false;
    } catch (e) { toast('Логотип шаблона не открылся — применён только текст', true); }
  }
  save(); syncUI(); schedule(); toast(`Шаблон «${t.name}» применён`);
}
$('#wmTplSave').addEventListener('click', () => {
  const inp = $('#wmTplName'), name = inp.value.trim().slice(0, 24);
  if (!name) { toast('Введи название шаблона', true); inp.focus(); return; }
  const cfg = {}; WMTPL_KEYS.forEach(k => { cfg[k] = S[k]; });
  const t = { name, cfg, logo: wmLogo ? logoToDataURL(wmLogo) : null };
  const ex = wmTpls.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  const prev = wmTpls.slice();
  if (ex >= 0) wmTpls[ex] = t; else wmTpls.push(t);
  wmTpls = wmTpls.slice(-12);
  if (!wmTplStore()) { wmTpls = prev; return; }
  renderWmTpls(); inp.value = ''; toast(`Шаблон «${name}» сохранён`);
});
$('#wmTplName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#wmTplSave').click(); });
renderWmTpls();
