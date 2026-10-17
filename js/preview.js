'use strict';
/* Aspect Studio — Предпросмотр и слайдер */
/* ===================================================================
   Предпросмотр
   =================================================================== */
let rafId = 0, renderToken = 0;
function schedule() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(refresh); }

async function refresh() {
  const item = cur();
  if (!item) return;
  const token = ++renderToken;
  pvWork.cancel();                                   // новый кадр отменяет незаконченную обработку предыдущего
  let bmp;
  try { bmp = await getBitmap(item); } catch (e) { toast('Не удалось открыть фото', true); return; }
  if (cfgFor(item).enhOn && !quick) await new Promise(r => setTimeout(r, 80));   // дебаунс тяжёлой обработки при движении ползунков
  if (token !== renderToken || cur() !== item) return;
  try {
    const tmp = document.createElement('canvas');    // рисуем во временный холст, чтобы предпросмотр не мигал
    const r = await render(tmp, item, bmp, { cap: PREVIEW_CAP, work: pvWork });
    if (token !== renderToken || cur() !== item) { tmp.width = tmp.height = 0; return; }
    afterCanvas.width = r.cw; afterCanvas.height = r.ch;
    afterCanvas.getContext('2d').drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 0;
    lastDims = { cw: r.cw, ch: r.ch, L: r.L };
    fitFrame();
    { const vs = item.view || item.url, key = item.id + '|' + vs; if (beforeImg.dataset.id !== key) { beforeImg.src = vs; beforeImg.dataset.id = key; } }
    const E = cfgFor(item), pos = E.fit === 'fit' ? { start: '0%', center: '50%', end: '100%' }[E.align] : '50%';
    beforeImg.style.objectPosition = `${pos} ${pos}`;
    frame.classList.toggle('checker', E.bg === 'transparent' && E.fit === 'fit' && S.format !== 'jpg');
    updateInfo(item);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    console.error(e); toast(friendlyError(e), true);
  }
}

function fitFrame() {
  if (!lastDims) return;
  const stageW = stage.clientWidth || 300;
  const maxH = Math.min(innerHeight * (mqDesktop.matches ? .62 : (S.pin ? .27 : .42)), 680);
  const r = lastDims.cw / lastDims.ch;
  const w = Math.max(40, Math.min(stageW, maxH * r));
  frame.style.width = w + 'px';
  frame.style.height = (w / r) + 'px';
}
addEventListener('resize', fitFrame);

function applyPin() {
  previewCard.classList.toggle('pinned', S.pin);
  $('#pinBtn').setAttribute('aria-pressed', S.pin);
  fitFrame();
}
$('#pinBtn').addEventListener('click', () => { S.pin = !S.pin; save(); applyPin(); });

const gcd = (a, b) => b ? gcd(b, a % b) : a;
function ratioLabel(cw, ch) {
  const g = gcd(cw, ch), a = cw / g, b = ch / g;
  return (a <= 50 && b <= 50) ? `${a}:${b}` : `${(cw / ch).toFixed(2)}:1`;
}
function pill(text) { const s = document.createElement('span'); s.className = 'info-pill'; s.textContent = text; return s; }

function updateInfo(item) {
  const c = cfgFor(item), xi = xformInfo(item);
  const ex = computeSize(item.w, item.h, 0, c);
  const L = layout(item.w, item.h, ex.cw, ex.ch, item, c);
  const pills = [xi.same ? `Оригинал ${item.w}×${item.h}` : `Кадр ${item.w}×${item.h} (из ${item.ow}×${item.oh})`, `Результат ${ex.cw}×${ex.ch}`, `Формат ${ratioLabel(ex.cw, ex.ch)}`];
  if (c.fit === 'fit') {
    const mx = Math.round(ex.cw - L.dw), my = Math.round(ex.ch - L.dh);
    if (mx > 1) pills.push(`Поля по бокам ${mx}px`);
    else if (my > 1) pills.push(`Поля сверху/снизу ${my}px`);
    else pills.push('Без полей');
  } else {
    const crop = Math.max(0, Math.round((1 - (ex.cw * ex.ch) / (L.dw * L.dh)) * 100));
    pills.push(`Обрезка ${crop}%`);
  }
  if (c.enhOn) pills.push(c.enhScale > 1 ? `✨ Улучшение ×${c.enhScale}` : '✨ Улучшение');
  if (ex.limited) pills.push('⚠ Уменьшено до лимита');
  const note = $('#enhSizeNote');
  if (note) note.textContent = `Итог: ${ex.cw}×${ex.ch}` + (ex.limited ? ' — упёрлось в «Макс. сторону», подними её в «Экспорт»' : '');
  infoRow.replaceChildren(...pills.map(pill));
}

/* ---------- Слайдер / панорамирование ---------- */
function applyView() {
  const v = S.view;
  const slider = v === 'slider';
  sliderHandle.hidden = !slider;
  tagBefore.hidden = tagAfter.hidden = !slider;
  afterCanvas.style.clipPath = v === 'before' ? 'inset(0 0 0 100%)' : v === 'after' ? 'none' : `inset(0 0 0 ${sliderPos}%)`;
  beforeImg.style.visibility = v === 'after' ? 'hidden' : 'visible';
  sliderHandle.style.left = sliderPos + '%';
  sliderHandle.setAttribute('aria-valuenow', Math.round(sliderPos));
  const canPan = cfgFor(cur()).fit === 'fill' && v !== 'before';
  frame.classList.toggle('can-pan', canPan);
  panHint.hidden = !(canPan && items.length);
}

function setSlider(clientX) {
  const rect = frame.getBoundingClientRect();
  sliderPos = Math.max(3, Math.min(97, ((clientX - rect.left) / rect.width) * 100));
  applyView();
}

let drag = null;
frame.addEventListener('pointerdown', e => {
  const item = cur(); if (!item) return;
  const E = cfgFor(item);
  if (S.view === 'slider' && (e.target === sliderHandle || E.fit === 'fit')) {
    drag = { type: 'slider' }; setSlider(e.clientX);
  } else if (E.fit === 'fill' && S.view !== 'before') {
    if (lastDims && lastDims.L) { item.focus = { ...focusOf(item, lastDims.L.dw, lastDims.L.dh, lastDims.cw, lastDims.ch) }; }
    item.manual = true;
    drag = { type: 'pan', x: e.clientX, y: e.clientY, fx: item.focus.x, fy: item.focus.y };
    frame.classList.add('panning');
  } else return;
  try { frame.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});
frame.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.type === 'slider') { setSlider(e.clientX); return; }
  const item = cur(); if (!item || !lastDims) return;
  const rect = frame.getBoundingClientRect();
  const { cw, ch, L } = lastDims;
  const freeX = L.dw - cw, freeY = L.dh - ch;
  const dxc = (e.clientX - drag.x) * (cw / rect.width);
  const dyc = (e.clientY - drag.y) * (ch / rect.height);
  if (freeX > .5) item.focus.x = Math.max(0, Math.min(1, drag.fx - dxc / freeX));
  if (freeY > .5) item.focus.y = Math.max(0, Math.min(1, drag.fy - dyc / freeY));
  quick = true;
  schedule();
});
const endDrag = () => {
  const wasPan = drag && drag.type === 'pan';
  drag = null; frame.classList.remove('panning');
  if (wasPan) { quick = false; syncUI(); schedule(); }
};
frame.addEventListener('pointerup', endDrag);
frame.addEventListener('pointercancel', endDrag);
sliderHandle.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { sliderPos = Math.max(3, sliderPos - 5); applyView(); e.preventDefault(); }
  if (e.key === 'ArrowRight') { sliderPos = Math.min(97, sliderPos + 5); applyView(); e.preventDefault(); }
});
