'use strict';
/* Aspect Studio — «до/после» для нейросетей на небольшом фрагменте фото.
   Считается один кусочек (256×256 для шумоподавления, одна плитка для увеличения), а не всё фото: результат видно за секунды. */
const pk = { open: false, item: null, bmp: null, kind: '', cx: 0.5, cy: 0.5, seq: 0, rect: null };
const pkEl = $('#peek'), pkB = $('#peekBefore'), pkA = $('#peekAfter'), pkMap = $('#peekMap'), pkView = $('#peekView'), pkSl = $('#peekSlider'), pkInfo = $('#peekInfo');
const pkSet = v => { pkView.style.setProperty('--p', v + '%'); pkSl.value = v; };
function pkMapDraw() {
  const b = pk.bmp; if (!b) return;
  const w = Math.min(160, b.width), h = Math.max(1, Math.round(w * b.height / b.width));
  pkMap.width = w; pkMap.height = h; const x = pkMap.getContext('2d'); x.drawImage(b, 0, 0, w, h);
  if (pk.rect) {
    const k = w / b.width, r = pk.rect; x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(r.x * k, r.y * k, Math.max(4, r.w * k), Math.max(4, r.h * k));
    x.strokeStyle = '#000'; x.lineWidth = 1; x.strokeRect(r.x * k - 1.5, r.y * k - 1.5, Math.max(4, r.w * k) + 3, Math.max(4, r.h * k) + 3);
  }
}
async function pkRun() {
  const my = ++pk.seq, item = pk.item, bmp = pk.bmp, kind = pk.kind, cfg = cfgFor(item);
  const m = kind === 'dn' ? dnOf(cfg) : SR_MODELS[cfg.srModel];
  if (!m) { pkClose(); return; }
  if (!compInstalled(m.comp)) { pkClose(); compWarnOnce(m.comp, kind === 'dn' ? 'Нейро-шумоподавление' : 'Нейро-увеличение'); return; }
  const size = kind === 'dn' ? DN_T : m.tile, sw = Math.min(size, bmp.width), sh = Math.min(size, bmp.height);
  const sx = Math.max(0, Math.min(bmp.width - sw, Math.round(pk.cx * bmp.width - sw / 2))), sy = Math.max(0, Math.min(bmp.height - sh, Math.round(pk.cy * bmp.height - sh / 2)));
  pk.rect = { x: sx, y: sy, w: sw, h: sh }; pkMapDraw();
  pkInfo.textContent = 'Считаю фрагмент…';
  const t0 = performance.now(); busy = true; setToolbarBusy(true); let out = null;
  try {
    out = kind === 'dn' ? await dnRun(bmp, sx, sy, sw, sh, m, dnLvl(cfg), 'srgb', 'Фрагмент') : await srRun(bmp, sx, sy, sw, sh, m, 'srgb', 'Фрагмент');
  } catch (e) {
    if (!e || e.name !== 'AbortError') { console.error(e); toast(friendlyError(e), true); }
    if (my === pk.seq) pkInfo.textContent = 'Не удалось посчитать. Нажми «Другое место».';
    return;
  } finally { busy = false; setToolbarBusy(false); }
  if (my !== pk.seq || !pk.open) { out.width = out.height = 0; return; }
  const k = kind === 'dn' ? 1 : 4, W = sw * k, H = sh * k;
  pkB.width = pkA.width = W; pkB.height = pkA.height = H;
  const bx = pkB.getContext('2d'); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high'; bx.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
  pkA.getContext('2d').drawImage(out, 0, 0); out.width = out.height = 0;
  pkView.style.aspectRatio = W + '/' + H;
  pkInfo.textContent = (kind === 'dn' ? `Фрагмент ${sw}×${sh} · «${m.name}»` : `Фрагмент ${sw}×${sh} → ×4 · «${m.name}»`) + ` · ${((performance.now() - t0) / 1000).toFixed(1)} с`;
}
async function pkOpen(kind) {
  const item = cur();
  if (!item || busy || pk.open) return;
  const cfg = cfgFor(item), m = kind === 'dn' ? dnOf(cfg) : SR_MODELS[cfg.srModel];
  if (!m) return;
  if (!compInstalled(m.comp)) { compWarnOnce(m.comp, kind === 'dn' ? 'Нейро-шумоподавление' : 'Нейро-увеличение'); return; }
  try { pk.bmp = await getBitmap(item); } catch (e) { toast(friendlyError(e), true); return; }
  Object.assign(pk, { open: true, item, kind, cx: 0.5, cy: 0.5, rect: null });
  $('#peekTitle').textContent = kind === 'dn' ? 'Шумоподавление: до и после' : 'Увеличение: до и после';
  pkB.width = pkB.height = pkA.width = pkA.height = 1; pkSet(50);
  rememberFocus(pkEl); pkEl.classList.add('show'); document.body.classList.add('peek-open'); $('#peekClose').focus();
  pkRun();
}
function pkClose() {
  if (!pk.open) return;
  pk.open = false; pk.seq++; cancelFlag = true; (typeof exPool !== 'undefined' ? exPool : [exWork]).forEach(w => w.cancel());
  pkEl.classList.remove('show'); document.body.classList.remove('peek-open'); restoreFocus(pkEl);
  pkB.width = pkA.width = pkMap.width = 1; pk.item = pk.bmp = null;
}
const pkPos = e => { const r = pkView.getBoundingClientRect(); return Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)); };
pkView.addEventListener('pointerdown', e => { pkView.setPointerCapture(e.pointerId); pkSet(pkPos(e)); });
pkView.addEventListener('pointermove', e => { if (pkView.hasPointerCapture(e.pointerId)) pkSet(pkPos(e)); });
pkSl.addEventListener('input', () => pkSet(+pkSl.value));
pkMap.addEventListener('pointerdown', e => {
  if (busy) return; const r = pkMap.getBoundingClientRect();
  pk.cx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); pk.cy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); pkRun();
});
$('#peekRandom').addEventListener('click', () => { if (busy) return; pk.cx = 0.12 + Math.random() * 0.76; pk.cy = 0.12 + Math.random() * 0.76; pkRun(); });
$('#peekClose').addEventListener('click', pkClose); $('#peekDone').addEventListener('click', pkClose);
$('#dnPeek').addEventListener('click', () => pkOpen('dn')); $('#srPeek').addEventListener('click', () => pkOpen('sr'));
addEventListener('keydown', e => { if (e.key === 'Escape' && pk.open) pkClose(); });
