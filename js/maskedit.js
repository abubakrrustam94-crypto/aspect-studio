'use strict';
/* Aspect Studio — ручная правка маски удаления фона: кисти «Оставить» / «Убрать» поверх результата нейросети */
const me = { open: false, item: null, mask: null, photo: null, disp: null, ctx: null, tool: 'keep', size: 28, strokes: [], drawing: null, base: null };
const meEl = $('#maskEd'), meCv = $('#meCanvas');

function meRepaint(x0 = 0, y0 = 0, x1 = me.mask.w, y1 = me.mask.h) {         // перерисовать участок: фото с альфой маски, убранное — красноватой дымкой
  const m = me.mask, W = m.w, P = me.photo.data, out = me.disp;
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(m.h, Math.ceil(y1));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * W + x, a = m.data[i] / 255, ha = a + (1 - a) * 0.3, o = i * 4;
    if (ha <= 0) { out.data[o + 3] = 0; continue; }
    const k = (1 - a) * 0.3;
    out.data[o] = (P[o] * a + 255 * k) / ha; out.data[o + 1] = (P[o + 1] * a + 60 * k) / ha; out.data[o + 2] = (P[o + 2] * a + 60 * k) / ha; out.data[o + 3] = ha * 255;
  }
  me.ctx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
}
function meFit() {                                                               // вписать холст в окно, сохранив пропорции
  if (!me.mask) return; const w = $('.me-wrap', meEl), aw = w.clientWidth - 16, ah = w.clientHeight - 16, k = Math.min(aw / me.mask.w, ah / me.mask.h);
  meCv.style.width = Math.max(40, Math.floor(me.mask.w * k)) + 'px'; meCv.style.height = Math.max(40, Math.floor(me.mask.h * k)) + 'px';
}
addEventListener('resize', () => { if (me.open) meFit(); });
function meInfo() { $('#meInfo').textContent = `Кисть: ${me.tool === 'keep' ? 'оставить' : 'убрать'} · шагов назад: ${me.strokes.length}`; $('#meUndo').disabled = !me.strokes.length; }
function mePos(e) { const r = meCv.getBoundingClientRect(); return { x: (e.clientX - r.left) * me.mask.w / r.width, y: (e.clientY - r.top) * me.mask.h / r.height, k: me.mask.w / r.width }; }
function meDab(x, y, rad) {                                                      // круглое пятно с мягким краем
  const m = me.mask, target = me.tool === 'keep' ? 255 : 0, f = Math.max(1, rad * 0.3);
  const x0 = Math.max(0, Math.floor(x - rad - 1)), x1 = Math.min(m.w, Math.ceil(x + rad + 1)), y0 = Math.max(0, Math.floor(y - rad - 1)), y1 = Math.min(m.h, Math.ceil(y + rad + 1));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const d = Math.hypot(xx + .5 - x, yy + .5 - y), a = Math.max(0, Math.min(1, (rad - d) / f)); if (!a) continue;
    const i = yy * m.w + xx; m.data[i] = Math.round(m.data[i] * (1 - a) + target * a);
  }
  return [x0, y0, x1, y1];
}
function meStroke(p, q) {
  const rad = Math.max(1.5, me.size * p.k / 2), dx = q.x - p.x, dy = q.y - p.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (rad / 3)));
  let b = [1e9, 1e9, -1, -1];
  for (let i = 0; i <= n; i++) { const r = meDab(p.x + dx * i / n, p.y + dy * i / n, rad); b = [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])]; }
  meRepaint(b[0], b[1], b[2], b[3]);
}
meCv.addEventListener('pointerdown', e => {
  if (!me.open) return; e.preventDefault();
  me.strokes.push(me.mask.data.slice()); if (me.strokes.length > 20) me.strokes.shift();
  const p = mePos(e); me.drawing = p; try { meCv.setPointerCapture(e.pointerId); } catch (_) {}
  meStroke(p, p); meInfo();
});
meCv.addEventListener('pointermove', e => {
  const br = $('#meBrush'), r = meCv.getBoundingClientRect(); br.style.display = 'block';
  br.style.width = br.style.height = me.size + 'px'; br.style.left = (e.clientX - r.left) + 'px'; br.style.top = (e.clientY - r.top) + 'px';
  if (!me.drawing) return; const p = mePos(e); meStroke(me.drawing, p); me.drawing = p;
});
const meEnd = () => { me.drawing = null; };
meCv.addEventListener('pointerup', meEnd); meCv.addEventListener('pointercancel', meEnd);
meCv.addEventListener('pointerleave', () => { $('#meBrush').style.display = 'none'; });
$$('#meTool button').forEach(b => b.addEventListener('click', () => { me.tool = b.dataset.t; $$('#meTool button').forEach(x => x.classList.toggle('active', x === b)); meInfo(); }));
$('#meSize').addEventListener('input', e => { me.size = +e.target.value; });
$('#meUndo').addEventListener('click', () => { const s = me.strokes.pop(); if (!s) return; me.mask.data.set(s); meRepaint(); meInfo(); });
$('#meReset').addEventListener('click', async () => {                          // вернуть исходный результат нейросети
  const item = me.item; if (!item) return;
  me.strokes.push(me.mask.data.slice()); me.mask.data.set(me.base); meRepaint(); meInfo(); toast('Правки сброшены');
});
function meClose(save) {
  if (!me.open) return;
  const item = me.item;
  if (save) { item.mask.data = me.mask.data; item.mask.edited = true; item.maskCv = null; item.maskFail = false; }
  me.open = false; meEl.classList.remove('show'); restoreFocus(meEl);
  me.photo = me.disp = me.base = null; me.strokes = []; meCv.width = meCv.height = 0; me.item = null; me.mask = null;
  if (save) { schedule(); sessSaveSoon && sessSaveSoon(); toast('Маска сохранена'); }
}
$('#meDone').addEventListener('click', () => meClose(true));
$('#meCancel').addEventListener('click', () => meClose(false));
addEventListener('keydown', e => { if (e.key === 'Escape' && me.open) meClose(false); });

async function openMaskEditor() {
  const item = cur(); if (!item || me.open || busy) return;
  const E = cfgFor(item);
  if (!E.cutOn) { toast('Сначала включи «Вырезать объект»', true); return; }
  if (!compInstalled('cutout')) { compWarn(['cutout'], 'Удаление фона'); return; }
  busy = true; setToolbarBusy(true);
  try {
    const bmp = await getBitmap(item); await ensureMask(item, bmp);
    if (!item.mask || item.maskFail === 'load') { toast('Маска ещё не готова: подожди секунду и нажми снова', true); return; }
    const m = item.mask, c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, m.w, m.h);
    me.photo = g.getImageData(0, 0, m.w, m.h); c.width = c.height = 0;
    me.item = item; me.mask = { ...m, data: m.data.slice() }; me.base = m.edited && m.orig ? m.orig : m.data.slice();
    if (!m.orig) m.orig = m.data.slice();
    me.base = m.orig; me.strokes = [];
    meCv.width = m.w; meCv.height = m.h; me.ctx = meCv.getContext('2d'); me.disp = me.ctx.createImageData(m.w, m.h);
    meRepaint(); meInfo();
    me.open = true; rememberFocus(meEl); meEl.classList.add('show'); meFit(); $('#meDone').focus();
  } catch (e) { console.error(e); toast(friendlyError(e), true); }
  finally { busy = false; setToolbarBusy(false); }
}
$('#maskEditBtn').addEventListener('click', openMaskEditor);
