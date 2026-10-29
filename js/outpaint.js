'use strict';
/* Aspect Studio — «Дорисовать края»: пустые полосы при смене формата заполняет нейросеть MI-GAN (та же, что в «Убрать лишнее»).
   Работа идёт на уменьшенной копии кадра (до 768 px по длинной стороне) полосами от фото к краю: каждая полоса считается в окне 512×512,
   где видно и фото, и уже дорисованное. Готовый фон растягивается на кадр, а само фото кладётся сверху в полном качестве.
   Считается при сохранении и в «Проверить на 100%»; в предпросмотре показаны зеркальные края. Результат кэшируется для повторных сохранений. */
const IP_WORK = 768, IP_T = 512;
let ipSlot = null;
const ipFree = () => { if (ipSlot) { try { ipSlot.canvas.width = ipSlot.canvas.height = 0; } catch (e) {} ipSlot = null; } };
const ipAbort = () => Object.assign(new Error('Отменено'), { name: 'AbortError' });

/* Одно окно: квадрат S×S с левым верхним углом (rx, ry); дорисовывается всё неизвестное, а в холст пишется только прямоугольник seg */
async function ipWindow(wc, wctx, known, w, h, rx, ry, S, seg, cs) {
  const T = IP_T, ic = mkCanvas(T, T), ictx = ic.getContext('2d', { willReadFrequently: true, colorSpace: cs });
  ictx.imageSmoothingQuality = 'high'; ictx.drawImage(wc, rx, ry, S, S, 0, 0, T, T);
  const px = getPix(ictx, 0, 0, T, T, cs).data; ic.width = ic.height = 0;
  const pl = T * T, f32 = new Float32Array(4 * pl);
  for (let y = 0; y < T; y++) {
    const sy = ry + Math.min(S - 1, (y * S / T) | 0);
    for (let x = 0; x < T; x++) {
      const i = y * T + x, p = i * 4, hole = known[sy * w + rx + Math.min(S - 1, (x * S / T) | 0)] ? 0 : 1, keep = 1 - hole;
      f32[i] = 0.5 - hole; f32[pl + i] = (px[p] / 127.5 - 1) * keep; f32[2 * pl + i] = (px[p + 1] / 127.5 - 1) * keep; f32[3 * pl + i] = (px[p + 2] / 127.5 - 1) * keep;
    }
  }
  const res = await ortRun('vendor/models/migan.onnx', { x: { data: f32, dims: [1, 4, T, T], type: 'float32' } });
  const d = res[Object.keys(res)[0]].data, img = new Uint8ClampedArray(pl * 4);
  for (let i = 0, q = 0; i < pl; i++, q += 4) { img[q] = (d[i] * .5 + .5) * 255; img[q + 1] = (d[pl + i] * .5 + .5) * 255; img[q + 2] = (d[2 * pl + i] * .5 + .5) * 255; img[q + 3] = 255; }
  const oc = mkCanvas(T, T); oc.getContext('2d', { colorSpace: cs }).putImageData(mkImageData(img, T, T, cs), 0, 0);
  const U = mkCanvas(S, S), uctx = U.getContext('2d', { colorSpace: cs }); uctx.imageSmoothingQuality = 'high'; uctx.drawImage(oc, 0, 0, S, S);
  wctx.save(); wctx.beginPath(); wctx.rect(seg.x0, seg.y0, seg.x1 - seg.x0, seg.y1 - seg.y0); wctx.clip(); wctx.drawImage(U, rx, ry); wctx.restore();
  oc.width = oc.height = 0; U.width = U.height = 0;
  for (let y = seg.y0; y < seg.y1; y++) known.fill(1, y * w + seg.x0, y * w + seg.x1);
}

/* Полоса seg-прямоугольника рядом с известной областью: side — с какой стороны фото (l, r, t, b) */
async function ipStrip(wc, wctx, known, w, h, S, side, x0, y0, x1, y1, cs) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  if (side === 'l' || side === 'r') {
    const rx = side === 'l' ? clamp(x0, 0, w - S) : clamp(x1 - S, 0, w - S);
    for (let ty = y0; ty < y1; ty += S) {
      if (cancelFlag) throw ipAbort();
      const ey = Math.min(y1, ty + S), ry = clamp(Math.round((ty + ey) / 2 - S / 2), 0, h - S);
      await ipWindow(wc, wctx, known, w, h, rx, ry, S, { x0, y0: ty, x1, y1: ey }, cs); await yieldUI();
    }
  } else {
    const ry = side === 't' ? clamp(y0, 0, h - S) : clamp(y1 - S, 0, h - S);
    for (let tx = x0; tx < x1; tx += S) {
      if (cancelFlag) throw ipAbort();
      const ex = Math.min(x1, tx + S), rx = clamp(Math.round((tx + ex) / 2 - S / 2), 0, w - S);
      await ipWindow(wc, wctx, known, w, h, rx, ry, S, { x0: tx, y0, x1: ex, y1 }, cs); await yieldUI();
    }
  }
}

/* Рисует фон в ctx (весь кадр cw×ch). false — не получилось или полос нет: вызывающий рисует зеркальные края */
async function ipBackground(ctx, bmp, item, cw, ch, L, c) {
  if (!compInstalled('erase')) { compWarnOnce('erase', 'Дорисовать края'); return false; }
  if (L.dx < 1 && L.dy < 1 && L.dx + L.dw > cw - 1 && L.dy + L.dh > ch - 1) return false;          // полос нет
  const cs = ctxCS(ctx), k = Math.min(1, IP_WORK / Math.max(cw, ch)), w = Math.max(32, Math.round(cw * k)), h = Math.max(32, Math.round(ch * k));
  const X0 = Math.max(0, Math.round(L.dx * k)), Y0 = Math.max(0, Math.round(L.dy * k)), X1 = Math.min(w, Math.round((L.dx + L.dw) * k)), Y1 = Math.min(h, Math.round((L.dy + L.dh) * k));
  const key = [item.id, item.file && item.file.size, coSig(item), cw, ch, X0, Y0, X1, Y1, cs].join('|');
  if (ipSlot && ipSlot.key === key && ipSlot.canvas.width) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(ipSlot.canvas, 0, 0, cw, ch); return true; }
  ipFree();
  const wc = mkCanvas(w, h), wctx = wc.getContext('2d', { colorSpace: cs }), known = new Uint8Array(w * h);
  const own = !progressEl.classList.contains('show');
  if (own) { cancelFlag = false; showProgress('Дорисовываю края…'); }
  try {
    wctx.imageSmoothingQuality = 'high'; wctx.drawImage(bmp, X0, Y0, X1 - X0, Y1 - Y0);
    for (let y = Y0; y < Y1; y++) known.fill(1, y * w + X0, y * w + X1);
    const S = Math.min(IP_T, w, h), D = Math.max(8, Math.floor(S * 0.4));
    let kx0 = X0, kx1 = X1, ky0 = Y0, ky1 = Y1, n = 0;
    const total = (Math.ceil(kx0 / D) + Math.ceil((w - kx1) / D) + Math.ceil(ky0 / D) + Math.ceil((h - ky1) / D)) || 1;
    const tick = () => { n++; $('#progressName').textContent = `${item.name} · дорисовываю края ${Math.min(99, Math.round(n / total * 100))}%`; if (own) progressFill.style.width = Math.min(100, n / total * 100) + '%'; };
    while (kx0 > 0 || kx1 < w) {
      if (kx0 > 0) { const t = Math.min(D, kx0); await ipStrip(wc, wctx, known, w, h, S, 'l', kx0 - t, ky0, kx0, ky1, cs); kx0 -= t; tick(); }
      if (kx1 < w) { const t = Math.min(D, w - kx1); await ipStrip(wc, wctx, known, w, h, S, 'r', kx1, ky0, kx1 + t, ky1, cs); kx1 += t; tick(); }
    }
    while (ky0 > 0 || ky1 < h) {
      if (ky0 > 0) { const t = Math.min(D, ky0); await ipStrip(wc, wctx, known, w, h, S, 't', kx0, ky0 - t, kx1, ky0, cs); ky0 -= t; tick(); }
      if (ky1 < h) { const t = Math.min(D, h - ky1); await ipStrip(wc, wctx, known, w, h, S, 'b', kx0, ky1, kx1, ky1 + t, cs); ky1 += t; tick(); }
    }
    ipSlot = { key, canvas: wc };
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(wc, 0, 0, cw, ch);
    return true;
  } catch (e) {
    wc.width = wc.height = 0;
    if (e && e.name === 'AbortError') throw e;
    console.error('IP', e); toast('Дорисовать края не удалось (' + friendlyError(e).replace(/^Ошибка: /, '') + '). Взял зеркальные края', true, { ms: 7000 });
    return false;
  } finally { if (own) hideProgress(); }
}
