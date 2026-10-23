'use strict';
/* Aspect Studio — нейросетевое увеличение ×4 (Real-ESRGAN) на общем движке ONNX.
   Считается только при сохранении и в «Проверить на 100%»: в предпросмотре слишком долго.
   Оценка времени — миллисекунды на пиксель исходника (по замеру на обычном ноутбуке, один поток WASM, с учётом перекрытия плиток). */
const SR_MODELS = {
  fast: { comp: 'srfast', name: 'Быстрая', model: 'vendor/models/sr-fast-x4.onnx', tile: 128, pad: 12, maxPx: 2.5e6, ms: 0.09 },
  general: { comp: 'srgen', name: 'Обычная', model: 'vendor/models/sr-general-x4.onnx', tile: 128, pad: 12, maxPx: 2.5e6, ms: 0.18 },
  max: { comp: 'srmax', name: 'Максимум', model: ['vendor/models/sr-max-x4.onnx.p1', 'vendor/models/sr-max-x4.onnx.p2'], tile: 80, pad: 10, maxPx: 0.4e6, ms: 2.9 }
};
const SR_MIN_K = 1.2;                 // нейросеть нужна, только когда итоговый кадр заметно больше исходного
let srSlot = null;                    // один готовый результат: повторные сохранения того же фото не пересчитывают
const srWarned = new Set();
const srOf = (cfg = S) => SR_MODELS[cfg && cfg.srModel] || null;
const srFree = () => { if (srSlot) { try { srSlot.canvas.width = srSlot.canvas.height = 0; } catch (e) {} srSlot = null; } };
const srAbort = () => Object.assign(new Error('Отменено'), { name: 'AbortError' });

async function srRun(bmp, sx, sy, sw, sh, m, cs, label) {
  const T = m.tile, P = m.pad, out = mkCanvas(sw * 4, sh * 4), octx = out.getContext('2d', { colorSpace: cs });
  if (!octx) throw new RangeError('canvas');
  const nx = Math.ceil(sw / T), ny = Math.ceil(sh / T), total = nx * ny, t0 = performance.now();
  const own = !progressEl.classList.contains('show');
  if (own) { cancelFlag = false; showProgress('Нейро-увеличение…'); }
  let done = 0;
  try {
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      if (cancelFlag) throw srAbort();
      const cx0 = tx * T, cy0 = ty * T, cw = Math.min(T, sw - cx0), chh = Math.min(T, sh - cy0);
      const x0 = Math.max(0, cx0 - P), y0 = Math.max(0, cy0 - P), x1 = Math.min(sw, cx0 + cw + P), y1 = Math.min(sh, cy0 + chh + P), w = x1 - x0, h = y1 - y0;
      const tc = mkCanvas(w, h), tctx = tc.getContext('2d', { willReadFrequently: true, colorSpace: cs });
      tctx.drawImage(bmp, sx + x0, sy + y0, w, h, 0, 0, w, h);
      const px = getPix(tctx, 0, 0, w, h, cs).data; tc.width = tc.height = 0;
      const f32 = new Float32Array(3 * w * h), pl = w * h;
      for (let i = 0, p = 0; i < pl; i++, p += 4) { f32[i] = px[p] / 255; f32[pl + i] = px[p + 1] / 255; f32[2 * pl + i] = px[p + 2] / 255; }
      const res = await ortRun(m.model, { input: { data: f32, dims: [1, 3, h, w], type: 'float32' } });
      const o = res[Object.keys(res)[0]], d = o.data, OW = w * 4, OH = h * 4, ox = (cx0 - x0) * 4, oy = (cy0 - y0) * 4, W4 = cw * 4, H4 = chh * 4, plo = OW * OH;
      const img = new Uint8ClampedArray(W4 * H4 * 4);
      for (let j = 0; j < H4; j++) {
        let s = (oy + j) * OW + ox, q = j * W4 * 4;
        for (let i = 0; i < W4; i++, s++, q += 4) { img[q] = d[s] * 255; img[q + 1] = d[plo + s] * 255; img[q + 2] = d[2 * plo + s] * 255; img[q + 3] = 255; }
      }
      octx.putImageData(mkImageData(img, W4, H4, cs), cx0 * 4, cy0 * 4);
      done++;
      const el = performance.now() - t0, left = el / done * (total - done);
      $('#progressName').textContent = `${label ? label + ' · ' : ''}нейро-увеличение ${Math.round(done / total * 100)}%${done < total ? ' · осталось ~' + fmtDur(left) : ''}`;
      if (own) progressFill.style.width = (done / total * 100) + '%';
      await yieldUI();
    }
  } catch (e) { out.width = out.height = 0; throw e; }
  finally { if (own) hideProgress(); }
  return out;
}

/* Вернуть холст ×4 для области фото или null, если нейросеть не нужна/не может. */
async function srMaybe(bmp, item, sx, sy, sw, sh, c, cs, tag = '') {
  const m = srOf(c); if (!m) return null;
  if (!compInstalled(m.comp)) { compWarnOnce(m.comp, 'Нейро-увеличение'); return null; }
  if (sw * sh > m.maxPx) {
    const k = item.id + m.comp; if (!srWarned.has(k)) { srWarned.add(k); toast(`Нейро-увеличение «${m.name}» пропущено: ${(sw * sh / 1e6).toFixed(1)} МП больше предела ${(m.maxPx / 1e6).toFixed(1)} МП. Обрежь фото или выбери другую модель`, true, { ms: 8000 }); }
    return null;
  }
  const key = [m.comp, sx, sy, sw, sh, cs, tag].join('|');
  if (srSlot && srSlot.id === item.id && srSlot.key === key && srSlot.canvas.width) return srSlot.canvas;
  srFree();
  try {
    const canvas = await srRun(bmp, sx, sy, sw, sh, m, cs, item.name);
    srSlot = { id: item.id, key, canvas }; return canvas;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    console.error('SR', e); toast('Нейро-увеличение не удалось (' + friendlyError(e).replace(/^Ошибка: /, '') + '). Использую обычное увеличение', true, { ms: 7000 });
    return null;
  }
}
/* Подсказка про время для текущего фото (оценка для компьютера; на телефоне в 2–4 раза дольше) */
function srEstimateText(item, cfg) {
  const m = srOf(cfg); if (!m || !item) return '';
  const px = item.w * item.h, t = fmtDur(px * m.ms);
  return px > m.maxPx ? `Это фото (${(px / 1e6).toFixed(1)} МП) больше предела ${(m.maxPx / 1e6).toFixed(1)} МП для этой модели: нейросеть будет пропущена.` : `Для этого фото примерно ${t} на компьютере; на телефоне в 2–4 раза дольше.`;
}
