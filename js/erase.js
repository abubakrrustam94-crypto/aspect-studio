'use strict';
/* Aspect Studio — «Убрать лишнее»: закрасил кистью → нейросеть MI-GAN дорисовывает фон на месте метки.
   Модель работает на 512×512: вокруг каждой области вырезается квадрат с запасом контекста, результат возвращается в полный размер только внутри метки.
   Результат запекается в новый PNG-файл фото (поворот и обрезка применяются), прежний файл хранится для «Вернуть как было». */
const ER_T = 512, ER_DISP = 1600, ER_CELL = 16, ER_UNDO = 3;
const er = { open: false, item: null, bmp: null, W: 0, H: 0, dw: 0, dh: 0, mask: null, photo: null, disp: null, ctx: null, tool: 'paint', size: 36, strokes: [], drawing: null };
const erEl = $('#erEd'), erCv = $('#erCanvas');
const erAbort = () => Object.assign(new Error('Отменено'), { name: 'AbortError' });

function erRepaint(x0 = 0, y0 = 0, x1 = er.dw, y1 = er.dh) {
  const W = er.dw, P = er.photo.data, M = er.mask, out = er.disp;
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(er.dh, Math.ceil(y1));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * W + x, o = i * 4, a = M[i] / 255 * 0.6;
    out.data[o] = P[o] * (1 - a) + 255 * a; out.data[o + 1] = P[o + 1] * (1 - a) + 40 * a; out.data[o + 2] = P[o + 2] * (1 - a) + 60 * a; out.data[o + 3] = 255;
  }
  er.ctx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
}
function erFit() {
  if (!er.dw) return; const w = $('.me-wrap', erEl), aw = w.clientWidth - 16, ah = w.clientHeight - 16, k = Math.min(aw / er.dw, ah / er.dh);
  erCv.style.width = Math.max(40, Math.floor(er.dw * k)) + 'px'; erCv.style.height = Math.max(40, Math.floor(er.dh * k)) + 'px';
}
addEventListener('resize', () => { if (er.open) erFit(); });
/* Области: соседние метки (в пределах двух клеток) считаются одним объектом; каждая обрабатывается отдельно */
function erComponents() {
  const cols = Math.ceil(er.dw / ER_CELL), rows = Math.ceil(er.dh / ER_CELL), occ = new Uint8Array(cols * rows), M = er.mask, W = er.dw;
  for (let y = 0; y < er.dh; y++) for (let x = 0; x < W; x++) if (M[y * W + x] > 127) occ[((y / ER_CELL) | 0) * cols + ((x / ER_CELL) | 0)] = 1;
  const seen = new Uint8Array(cols * rows), list = [];
  for (let s = 0; s < occ.length; s++) {
    if (!occ[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1; let cx0 = cols, cy0 = rows, cx1 = 0, cy1 = 0;
    while (st.length) {
      const c = st.pop(), cx = c % cols, cy = (c / cols) | 0;
      cx0 = Math.min(cx0, cx); cx1 = Math.max(cx1, cx); cy0 = Math.min(cy0, cy); cy1 = Math.max(cy1, cy);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx; if (occ[n] && !seen[n]) { seen[n] = 1; st.push(n); }
      }
    }
    list.push({ x0: cx0 * ER_CELL, y0: cy0 * ER_CELL, x1: Math.min(er.dw, (cx1 + 1) * ER_CELL), y1: Math.min(er.dh, (cy1 + 1) * ER_CELL) });
  }
  return list;
}
function erInfo() {
  const n = er.mask ? erComponents().length : 0;
  $('#erInfo').textContent = n ? `Областей: ${n} · шагов назад: ${er.strokes.length}` : 'Закрась то, что нужно убрать';
  $('#erUndo').disabled = !er.strokes.length; $('#erDone').disabled = !n; $('#erClear').disabled = !n;
}
function erPos(e) { const r = erCv.getBoundingClientRect(); return { x: (e.clientX - r.left) * er.dw / r.width, y: (e.clientY - r.top) * er.dh / r.height, k: er.dw / r.width }; }
function erDab(x, y, rad) {
  const target = er.tool === 'paint' ? 255 : 0, f = Math.max(1, rad * 0.25), W = er.dw, M = er.mask;
  const x0 = Math.max(0, Math.floor(x - rad - 1)), x1 = Math.min(W, Math.ceil(x + rad + 1)), y0 = Math.max(0, Math.floor(y - rad - 1)), y1 = Math.min(er.dh, Math.ceil(y + rad + 1));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const d = Math.hypot(xx + .5 - x, yy + .5 - y), a = Math.max(0, Math.min(1, (rad - d) / f)); if (!a) continue;
    const i = yy * W + xx; M[i] = Math.round(M[i] * (1 - a) + target * a);
  }
  return [x0, y0, x1, y1];
}
function erStroke(p, q) {
  const rad = Math.max(1.5, er.size * p.k / 2), dx = q.x - p.x, dy = q.y - p.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (rad / 3)));
  let b = [1e9, 1e9, -1, -1];
  for (let i = 0; i <= n; i++) { const r = erDab(p.x + dx * i / n, p.y + dy * i / n, rad); b = [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])]; }
  erRepaint(b[0], b[1], b[2], b[3]);
}
/* «Выбрать объект»: маска главного объекта (модель удаления фона) режется на отдельные предметы, нажатие выделяет тот, что под пальцем */
async function erPick(e) {
  const p = erPos(e), W = er.dw, H = er.dh;
  if (!compInstalled('cutout')) { compWarn(['cutout'], 'Выбор объекта'); return; }
  if (!er.auto) {
    if (er.picking) return; er.picking = true; toast('Ищу объекты на фото…', false, { ms: 4000 });
    try {
      const m = await computeMask(er.bmp, 'fast'), a = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) { const sy = Math.min(m.h - 1, (y * m.h / H) | 0); for (let x = 0; x < W; x++) a[y * W + x] = m.data[sy * m.w + Math.min(m.w - 1, (x * m.w / W) | 0)] > 127 ? 1 : 0; }
      er.auto = a; er.autoCover = m.cover;
    } catch (err) { console.warn('erPick', err); toast('Не удалось найти объекты. Закрась кистью.', true); return; }
    finally { er.picking = false; }
    if (!er.open) return;
  }
  const a = er.auto, R = Math.round(Math.max(14, Math.min(W, H) * 0.03)), px = Math.round(p.x), py = Math.round(p.y);
  let sx = -1, sy = -1, best = 1e9;                                      // ближайшая точка объекта в радиусе R
  for (let y = Math.max(0, py - R); y <= Math.min(H - 1, py + R); y++) for (let x = Math.max(0, px - R); x <= Math.min(W - 1, px + R); x++) if (a[y * W + x]) { const d = (x - px) ** 2 + (y - py) ** 2; if (d < best) { best = d; sx = x; sy = y; } }
  if (sx < 0) { toast('Тут объект не найден. Закрась нужное кистью.', false, { ms: 4000 }); return; }
  const seen = new Uint8Array(W * H), st = [sy * W + sx], blob = []; seen[st[0]] = 1;
  while (st.length) {
    const i = st.pop(); blob.push(i); const x = i % W, y = (i / W) | 0;
    if (x > 0 && a[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; st.push(i - 1); }
    if (x < W - 1 && a[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; st.push(i + 1); }
    if (y > 0 && a[i - W] && !seen[i - W]) { seen[i - W] = 1; st.push(i - W); }
    if (y < H - 1 && a[i + W] && !seen[i + W]) { seen[i + W] = 1; st.push(i + W); }
  }
  er.strokes.push(er.mask.slice()); if (er.strokes.length > 20) er.strokes.shift();
  const g = new Uint8Array(W * H); blob.forEach(i => { g[i] = 1; }); erGrow(g, W, H, Math.max(2, Math.round(Math.max(W, H) / 400)));
  for (let i = 0; i < g.length; i++) if (g[i]) er.mask[i] = 255;
  erRepaint(); erInfo();
}
/* Расширить область на r пикселей (чтобы закрасить и каёмку по краю объекта) */
function erGrow(m, W, H, r) {
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= r) t[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) t[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (t[y * W + x]) last = y; if (y - last <= r) m[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) last = y; if (last - y <= r) m[y * W + x] = 1; } }
}
erCv.addEventListener('pointerdown', e => {
  if (!er.open) return; e.preventDefault();
  if (er.tool === 'pick') { erPick(e); return; }
  er.strokes.push(er.mask.slice()); if (er.strokes.length > 20) er.strokes.shift();
  const p = erPos(e); er.drawing = p; try { erCv.setPointerCapture(e.pointerId); } catch (_) {}
  erStroke(p, p);
});
erCv.addEventListener('pointermove', e => {
  const br = $('#erBrush'), r = erCv.getBoundingClientRect(); br.style.display = er.tool === 'pick' ? 'none' : 'block';
  br.style.width = br.style.height = er.size + 'px'; br.style.left = (e.clientX - r.left) + 'px'; br.style.top = (e.clientY - r.top) + 'px';
  if (!er.drawing) return; const p = erPos(e); erStroke(er.drawing, p); er.drawing = p;
});
const erEnd = () => { if (er.drawing) { er.drawing = null; erInfo(); } };
erCv.addEventListener('pointerup', erEnd); erCv.addEventListener('pointercancel', erEnd);
erCv.addEventListener('pointerleave', () => { $('#erBrush').style.display = 'none'; });
$$('#erTool button').forEach(b => b.addEventListener('click', () => { er.tool = b.dataset.t; $$('#erTool button').forEach(x => x.classList.toggle('active', x === b)); }));
$('#erSize').addEventListener('input', e => { er.size = +e.target.value; });
$('#erUndo').addEventListener('click', () => { const s = er.strokes.pop(); if (!s) return; er.mask.set(s); erRepaint(); erInfo(); });
$('#erClear').addEventListener('click', () => { er.strokes.push(er.mask.slice()); er.mask.fill(0); erRepaint(); erInfo(); });

function erHide() { er.open = false; erEl.classList.remove('show'); restoreFocus(erEl); }
function erShow() { er.open = true; rememberFocus(erEl); erEl.classList.add('show'); erFit(); $('#erDone').focus(); }
function erFree() {
  if (er.bmp) closeBmp(er.bmp);
  er.bmp = er.photo = er.disp = er.mask = er.auto = null; er.picking = false; er.strokes = []; er.item = null; erCv.width = erCv.height = 0; er.dw = er.dh = 0;
}
function erCancel() { if (!er.open) return; erHide(); erFree(); }
$('#erCancel').addEventListener('click', erCancel);
addEventListener('keydown', e => { if (e.key === 'Escape' && er.open) erCancel(); });

async function openErase() {
  const item = cur(); if (!item || er.open || busy || exporting) return;
  if (!compInstalled('erase')) { compWarn(['erase'], 'Убрать лишнее'); return; }
  busy = true; setToolbarBusy(true);
  try {
    const bmp = await loadBitmap(item), { w, h } = dimsOf(bmp), k = Math.min(1, ER_DISP / Math.max(w, h));
    er.bmp = bmp; er.item = item; er.W = w; er.H = h; er.dw = Math.max(1, Math.round(w * k)); er.dh = Math.max(1, Math.round(h * k));
    const c = mkCanvas(er.dw, er.dh), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, er.dw, er.dh);
    er.photo = g.getImageData(0, 0, er.dw, er.dh); c.width = c.height = 0;
    er.mask = new Uint8Array(er.dw * er.dh); er.strokes = []; er.auto = null;
    erCv.width = er.dw; erCv.height = er.dh; er.ctx = erCv.getContext('2d'); er.disp = er.ctx.createImageData(er.dw, er.dh);
    erRepaint(); erInfo(); erShow();
  } catch (e) { console.error(e); erFree(); toast(friendlyError(e), true); }
  finally { busy = false; setToolbarBusy(false); }
}

function erDilate(m, n, r) {                                    // максимум в окне (2r+1) по строкам и столбцам
  const tmp = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let d = Math.max(0, x - r); d <= Math.min(n - 1, x + r) && !v; d++) v = m[y * n + d]; tmp[y * n + x] = v; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let v = 0; for (let d = Math.max(0, y - r); d <= Math.min(n - 1, y + r) && !v; d++) v = tmp[d * n + x]; m[y * n + x] = v; }
}
/* Одна область: квадрат вокруг метки → 512×512 → MI-GAN → обратно только внутри метки */
async function erPatch(wc, wctx, cs, comp) {
  const W = er.W, H = er.H, kd = er.dw / W, m = Math.min(W, H), fx0 = comp.x0 / kd, fy0 = comp.y0 / kd, fx1 = comp.x1 / kd, fy1 = comp.y1 / kd;
  const bw = fx1 - fx0, bh = fy1 - fy0;
  const S = Math.round(Math.min(m, Math.max(Math.min(256, m), Math.max(bw, bh) * 1.8)));
  const rx = Math.max(0, Math.min(W - S, Math.round((fx0 + fx1) / 2 - S / 2))), ry = Math.max(0, Math.min(H - S, Math.round((fy0 + fy1) / 2 - S / 2)));
  const T = ER_T, ic = mkCanvas(T, T), ictx = ic.getContext('2d', { willReadFrequently: true, colorSpace: cs }); ictx.imageSmoothingQuality = 'high'; ictx.drawImage(wc, rx, ry, S, S, 0, 0, T, T);
  const px = getPix(ictx, 0, 0, T, T, cs).data; ic.width = ic.height = 0;
  const md = new Uint8ClampedArray(er.dw * er.dh * 4); for (let i = 0; i < er.mask.length; i++) md[i * 4 + 3] = er.mask[i];
  const mcv = mkCanvas(er.dw, er.dh); mcv.getContext('2d').putImageData(new ImageData(md, er.dw, er.dh), 0, 0);
  const mc = mkCanvas(T, T), mctx = mc.getContext('2d', { willReadFrequently: true }); mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(mcv, rx * kd, ry * kd, S * kd, S * kd, 0, 0, T, T); mcv.width = mcv.height = 0;
  const ma = mctx.getImageData(0, 0, T, T).data, mk = new Uint8Array(T * T); mc.width = mc.height = 0;
  let any = 0; for (let i = 0; i < T * T; i++) if (ma[i * 4 + 3] > 24) { mk[i] = 1; any++; }
  if (any) {
    erDilate(mk, T, 4);
    const pl = T * T, f32 = new Float32Array(4 * pl);
    for (let i = 0, p = 0; i < pl; i++, p += 4) {
      const hole = mk[i], keep = 1 - hole; f32[i] = 0.5 - hole;
      f32[pl + i] = (px[p] / 127.5 - 1) * keep; f32[2 * pl + i] = (px[p + 1] / 127.5 - 1) * keep; f32[3 * pl + i] = (px[p + 2] / 127.5 - 1) * keep;
    }
    const res = await ortRun('vendor/models/migan.onnx', { x: { data: f32, dims: [1, 4, T, T], type: 'float32' } });
    const d = res[Object.keys(res)[0]].data, img = new Uint8ClampedArray(pl * 4);
    for (let i = 0, q = 0; i < pl; i++, q += 4) { img[q] = (d[i] * .5 + .5) * 255; img[q + 1] = (d[pl + i] * .5 + .5) * 255; img[q + 2] = (d[2 * pl + i] * .5 + .5) * 255; img[q + 3] = mk[i] * 255; }
    const oc = mkCanvas(T, T); oc.getContext('2d', { colorSpace: cs }).putImageData(mkImageData(img, T, T, cs), 0, 0);
    const U = mkCanvas(S, S), uctx = U.getContext('2d', { colorSpace: cs }); uctx.imageSmoothingQuality = 'high'; uctx.drawImage(oc, 0, 0, S, S);
    wctx.drawImage(U, rx, ry); oc.width = oc.height = 0; U.width = U.height = 0;
  }
  const cx0 = Math.max(0, Math.floor(rx * kd)), cy0 = Math.max(0, Math.floor(ry * kd)), cx1 = Math.min(er.dw, Math.ceil((rx + S) * kd)), cy1 = Math.min(er.dh, Math.ceil((ry + S) * kd));
  for (let y = cy0; y < cy1; y++) er.mask.fill(0, y * er.dw + cx0, y * er.dw + cx1);          // всё, что было внутри квадрата, уже закрашено
  return { fits: Math.max(bw, bh) * 1.05 <= m };
}
/* Большая область: окно нейросети было бы растянуто на пол-фото и залив вышел бы мыльным. Режем область на клетки (~30% короткой стороны), каждая считается в своём окне, следующая видит уже готовое */
async function erPatchBig(wc, wctx, cs, comp) {
  const kd = er.dw / er.W, m = Math.min(er.W, er.H), W = er.dw, cell = Math.max(48, Math.round(m * 0.3 * kd));
  const bw = comp.x1 - comp.x0, bh = comp.y1 - comp.y0;
  if (Math.max(bw, bh) <= m * 0.4 * kd) return erPatch(wc, wctx, cs, comp);
  const full = er.mask, nx = Math.ceil(bw / cell), ny = Math.ceil(bh / cell); let fits = true;
  try {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (cancelFlag) throw erAbort();
      const x0 = comp.x0 + i * cell, y0 = comp.y0 + j * cell, x1 = Math.min(comp.x1, x0 + cell), y1 = Math.min(comp.y1, y0 + cell);
      const sub = new Uint8Array(full.length); let any = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = y * W + x; if (full[k] > 127) { sub[k] = full[k]; any++; } }
      if (!any) continue;
      er.mask = sub;
      const r = await erPatch(wc, wctx, cs, { x0, y0, x1, y1 }); if (!r.fits) fits = false;
      for (let y = y0; y < y1; y++) full.fill(0, y * W + x0, y * W + x1);
      await yieldUI();
    }
  } finally { er.mask = full; }
  return { fits };
}
async function erApply() {
  if (!er.open) return; const item = er.item, comps = erComponents(); if (!comps.length) return;
  erHide(); busy = true; setToolbarBusy(true); cancelFlag = false; showProgress('Убираю лишнее…');
  const cs = item.p3 && supportsP3 ? 'display-p3' : 'srgb';
  const wc = mkCanvas(er.W, er.H), wctx = wc.getContext('2d', { colorSpace: cs }), backup = er.mask.slice(), total = comps.length;
  let ok = false, big = false;
  try {
    wctx.drawImage(er.bmp, 0, 0);
    for (let i = 0; i < total; i++) {
      if (cancelFlag) throw erAbort();
      $('#progressName').textContent = `${item.name} · область ${i + 1} из ${total}`; progressFill.style.width = (i / total * 100) + '%';
      const r = await erPatchBig(wc, wctx, cs, comps[i]); if (!r.fits) big = true;
      await yieldUI();
    }
    const blob = await new Promise(r => wc.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Не удалось сохранить результат (слишком большой холст?)');
    const nm = (item.name || 'photo').replace(/\.[^.]+$/, '') + '.png';
    await erReplace(item, new File([blob], nm, { type: 'image/png', lastModified: Date.now() }), er.W, er.H);
    ok = true; toast(total === 1 ? 'Лишнее убрано' : `Убрано областей: ${total}`); if (big) toast('Область была больше окна нейросети: результат мог выйти нечётким, лучше убирать по частям', true, { ms: 8000 });
  } catch (e) {
    if (e && e.name === 'AbortError') toast('Отменено'); else { console.error(e); toast('Убрать не получилось: ' + friendlyError(e).replace(/^Ошибка: /, ''), true, { ms: 7000 }); }
    er.mask.set(backup); erRepaint(); erInfo();
  } finally { wc.width = wc.height = 0; hideProgress(); busy = false; setToolbarBusy(false); }
  if (ok) erFree(); else if (er.item) erShow();
}
$('#erDone').addEventListener('click', erApply);

/* Подменить файл фото; прежнее состояние кладём в стек «Вернуть как было» */
const ER_FIELDS = ['file', 'name', 'w', 'h', 'ow', 'oh', 'rot', 'flipH', 'flipV', 'crop', 'load', 'exifSrc'];
async function erSwap(item, patch) {
  if (item.url) URL.revokeObjectURL(item.url);
  Object.assign(item, patch); item.url = URL.createObjectURL(item.file);
  item.mask = null; item.maskCv = null; item.maskFail = false; item.ev = (item.ev || 0) + 1;
  if (typeof srFree === 'function') srFree(); if (typeof dnFree === 'function') dnFree();
  hist.undo.length = 0; hist.redo.length = 0; histButtons();           // старые шаги относятся к прежнему кадру
  await commitXform(item); renderThumbs(); updateChrome(); sessSaveSoon();
}
async function erReplace(item, file, w, h) {
  (item.erased = item.erased || []).push(Object.fromEntries(ER_FIELDS.map(k => [k, item[k]]))); if (item.erased.length > ER_UNDO) item.erased.shift();
  await erSwap(item, { file, name: file.name, w, h, ow: w, oh: h, rot: 0, flipH: false, flipV: false, crop: null, load: null, exifSrc: item.exifSrc || item.file });
}
async function eraseRestore() {
  const item = cur(); if (!item || busy || exporting || !item.erased || !item.erased.length) return;
  busy = true; setToolbarBusy(true);
  try { await erSwap(item, item.erased.pop()); toast('Фото возвращено как было'); } catch (e) { console.error(e); toast(friendlyError(e), true); }
  finally { busy = false; setToolbarBusy(false); erSync(); }
}
function erSync() { const b = $('#eraseUndoBtn'), it = cur(); if (b) b.hidden = !(it && it.erased && it.erased.length); }
$('#eraseBtn').addEventListener('click', openErase);
$('#eraseUndoBtn').addEventListener('click', eraseRestore);
