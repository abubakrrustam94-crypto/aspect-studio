'use strict';
/* Aspect Studio — «Где применять»: тон, ретушь и ночной свет можно ограничить объектом, фоном, лицами или небом.
   Эффект считается для всего кадра, затем смешивается с исходным по маске: результат = до·(1−m) + после·m.
   Маска объекта — та же, что у «Удаления фона»; лица — из анализа фото; небо ищется по цвету сверху вниз (приблизительно). */
const FX_LABEL = { subject: 'Объект', bg: 'Фон', face: 'Лица', sky: 'Небо' };
function fxNote(item, key, msg) { if (item.fxWarn === key) return; item.fxWarn = key; toast(msg, false, { ms: 6000 }); }

/* Небо: сверху вниз по каждому столбцу, пока пиксель «небесный» (синий или светлый малонасыщенный и гладкий). Карта 96 px, потом растягивается */
function fxSkyMap(px, W, H) {
  const lum = new Float32Array(W * H), ok = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = .299 * px[i * 4] + .587 * px[i * 4 + 1] + .114 * px[i * 4 + 2];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], l = lum[i] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    const gr = Math.max(x + 1 < W ? Math.abs(lum[i + 1] - lum[i]) : 0, y + 1 < H ? Math.abs(lum[i + W] - lum[i]) : 0);
    const blue = b >= r + 10 && b >= g - 4 && l > .22, bright = l > .6 && sat < .2;
    ok[i] = ((blue && gr < 26) || (bright && gr < 18)) ? 1 : 0;
  }
  const m = new Float32Array(W * H); let n = 0;
  for (let x = 0; x < W; x++) for (let y = 0; y < H && ok[y * W + x]; y++) { m[y * W + x] = 1; n++; }
  const cover = n / (W * H);
  if (cover < .03) return null;
  let s = m; if (typeof boxBlur === 'function') s = boxBlur(boxBlur(m, W, H, 1), W, H, 1);
  return { m: s, cover };
}
function fxSkyCanvas(item, bmp) {
  const sig = dpSigFx(item);
  if (item.skyM && item.skyM.sig === sig) return item.skyM.cv;
  const k = Math.min(1, 96 / Math.max(bmp.width, bmp.height)), W = Math.max(8, Math.round(bmp.width * k)), H = Math.max(8, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, W, H);
  const r = fxSkyMap(g.getImageData(0, 0, W, H).data, W, H);
  let cv = null;
  if (r) { const id = g.createImageData(W, H); for (let i = 0; i < W * H; i++) id.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, r.m[i])) * 255); g.putImageData(id, 0, 0); cv = c; }
  else c.width = c.height = 0;
  item.skyM = { sig, cv }; return cv;
}
const dpSigFx = it => `${it.rot || 0}|${it.tilt || 0}|${it.flipH ? 1 : 0}|${it.flipV ? 1 : 0}|${it.crop ? [it.crop.x, it.crop.y, it.crop.w, it.crop.h].join(',') : ''}`;

/* Холст-маска cw×ch (прозрачность = доля эффекта) или null, если маску построить нельзя — тогда эффект идёт на весь кадр */
async function fxMaskCanvas(item, bmp, L, cw, ch, c) {
  const mode = c.fxMask, cv = mkCanvas(cw, ch), g = cv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  if (mode === 'subject' || mode === 'bg') {
    const comp = cutComp(c);
    if (!compInstalled(comp)) { cv.width = cv.height = 0; compWarnOnce(comp, 'Маска «' + FX_LABEL[mode] + '»'); return null; }
    if (typeof ensureMask !== 'function') { cv.width = cv.height = 0; return null; }
    await ensureMask(item, bmp);
    if (!item.mask || item.maskFail || item.mask.sig !== coSig(item)) { cv.width = cv.height = 0; fxNote(item, mode + 'nm', 'Не нашёл объект на фото — эффект применён ко всему кадру'); return null; }
    const mc = maskCanvas(item, c.cutEdge);
    if (mode === 'subject') g.drawImage(mc, L.dx, L.dy, L.dw, L.dh);
    else { g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch); g.globalCompositeOperation = 'destination-out'; g.drawImage(mc, L.dx, L.dy, L.dw, L.dh); g.globalCompositeOperation = 'source-over'; }
    return cv;
  }
  if (mode === 'face') {
    if (!compInstalled('faces')) { cv.width = cv.height = 0; compWarnOnce('faces', 'Маска «Лица»'); return null; }
    const an = await ensureAnalysis(item, bmp);
    if (!an || !an.faceList || !an.faceList.length) { cv.width = cv.height = 0; fxNote(item, 'facenone', 'Лиц на фото не нашёл — эффект применён ко всему кадру'); return null; }
    for (const f of an.faceList) {
      const cx = L.dx + (f.x0 + f.x1) / 2 * L.dw, cy = L.dy + (f.y0 + f.y1) / 2 * L.dh, rx = (f.x1 - f.x0) / 2 * L.dw * 1.55, ry = (f.y1 - f.y0) / 2 * L.dh * 1.75;
      g.save(); g.translate(cx, cy); g.scale(rx, ry);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.55, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
    }
    return cv;
  }
  if (mode === 'sky') {
    const sk = fxSkyCanvas(item, bmp);
    if (!sk) { cv.width = cv.height = 0; fxNote(item, 'skynone', 'Неба на фото не нашёл — эффект применён ко всему кадру'); return null; }
    g.drawImage(sk, L.dx, L.dy, L.dw, L.dh); return cv;
  }
  cv.width = cv.height = 0; return null;
}
/* до·(1−m) + после·m полосами по 128 строк; fn рисует эффект прямо в ctx */
async function fxApply(ctx, item, bmp, L, cw, ch, c, fn) {
  const M = await fxMaskCanvas(item, bmp, L, cw, ch, c);
  if (!M) { await fn(); return; }
  const cs = ctxCS(ctx), before = mkCanvas(cw, ch), bg = before.getContext('2d', { willReadFrequently: true, colorSpace: cs });
  bg.drawImage(ctx.canvas, 0, 0);
  try { await fn(); } catch (e) { M.width = M.height = 0; before.width = before.height = 0; throw e; }
  const mg = M.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < ch; y += 128) {
    const h = Math.min(128, ch - y), A = getPix(ctx, 0, y, cw, h, cs), B = getPix(bg, 0, y, cw, h, cs), a = A.data, b = B.data, m = mg.getImageData(0, y, cw, h).data;
    for (let i = 0, p = 0; i < cw * h; i++, p += 4) {
      const t = m[p + 3] / 255; if (t >= 1) continue;
      for (let k = 0; k < 3; k++) a[p + k] = Math.round(b[p + k] + (a[p + k] - b[p + k]) * t);
    }
    ctx.putImageData(A, 0, y);
  }
  M.width = M.height = 0; before.width = before.height = 0;
}
