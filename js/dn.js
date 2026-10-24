'use strict';
/* Aspect Studio — нейросетевое шумоподавление на общем движке ONNX.
   FFDNet (быстрая, уровень шума задаётся) и SCUNet (реальный шум, медленнее). Модели собраны под плитку 256×256: плитки считаются внахлёст, края дублируются.
   Считается только при сохранении и в «Проверить на 100%»; результат кэшируется для повторных сохранений. */
const DN_T = 256, DN_PAD = 16;
const DN_MODELS = {
  ffd: { comp: 'dnffd', name: 'Быстрая', model: 'vendor/models/dn-ffdnet.onnx', small: true, maxPx: 16e6, ms: 0.02, sigma: [8, 18, 32], mix: [1, 1, 1] },
  scu: { comp: 'dnscu', name: 'Реальный шум', model: ['vendor/models/dn-scunet.onnx.p1', 'vendor/models/dn-scunet.onnx.p2'], small: false, maxPx: 3e6, ms: 0.16, sigma: null, mix: [0.5, 0.75, 1] }
};
let dnSlot = null;
const dnWarned = new Set();
const dnOf = (cfg = S) => DN_MODELS[cfg && cfg.dnModel] || null;
const dnLvl = cfg => Math.min(3, Math.max(1, +(cfg && cfg.dnLevel) || 2)) - 1;
const dnFree = () => { if (dnSlot) { try { dnSlot.canvas.width = dnSlot.canvas.height = 0; } catch (e) {} dnSlot = null; } };
const dnAbort = () => Object.assign(new Error('Отменено'), { name: 'AbortError' });

async function dnRun(bmp, sx, sy, sw, sh, m, lv, cs, label) {
  const out = mkCanvas(sw, sh), octx = out.getContext('2d', { colorSpace: cs });
  if (!octx) throw new RangeError('canvas');
  const C = DN_T - 2 * DN_PAD, nx = Math.ceil(sw / C), ny = Math.ceil(sh / C), total = nx * ny, t0 = performance.now(), mix = m.mix[lv];
  const own = !progressEl.classList.contains('show');
  if (own) { cancelFlag = false; showProgress('Шумоподавление…'); }
  let done = 0;
  try {
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      if (cancelFlag) throw dnAbort();
      const cx0 = tx * C, cy0 = ty * C, cw = Math.min(C, sw - cx0), chh = Math.min(C, sh - cy0);
      const wx = Math.max(0, Math.min(cx0 - DN_PAD, sw - DN_T)), wy = Math.max(0, Math.min(cy0 - DN_PAD, sh - DN_T));
      const w = Math.min(DN_T, sw - wx), h = Math.min(DN_T, sh - wy);
      const tc = mkCanvas(w, h), tctx = tc.getContext('2d', { willReadFrequently: true, colorSpace: cs });
      tctx.drawImage(bmp, sx + wx, sy + wy, w, h, 0, 0, w, h);
      const px = getPix(tctx, 0, 0, w, h, cs).data; tc.width = tc.height = 0;
      const pl = DN_T * DN_T, f32 = new Float32Array(3 * pl);
      for (let y = 0; y < DN_T; y++) {                       // меньше плитки — край дублируем
        const yy = Math.min(y, h - 1);
        for (let x = 0; x < DN_T; x++) { const p = (yy * w + Math.min(x, w - 1)) * 4, i = y * DN_T + x; f32[i] = px[p] / 255; f32[pl + i] = px[p + 1] / 255; f32[2 * pl + i] = px[p + 2] / 255; }
      }
      const inputs = { x: { data: f32, dims: [1, 3, DN_T, DN_T], type: 'float32' } };
      if (m.sigma) inputs.sigma = { data: new Float32Array([m.sigma[lv] / 255]), dims: [1, 1, 1, 1], type: 'float32' };
      const res = await ortRun(m.model, inputs, null, m.small);
      const d = res[Object.keys(res)[0]].data, ox = cx0 - wx, oy = cy0 - wy, img = new Uint8ClampedArray(cw * chh * 4);
      for (let j = 0; j < chh; j++) {
        let s = (oy + j) * DN_T + ox, q = j * cw * 4, o = ((oy + j) * w + ox) * 4;
        for (let i = 0; i < cw; i++, s++, q += 4, o += 4) {
          img[q] = px[o] + (d[s] * 255 - px[o]) * mix; img[q + 1] = px[o + 1] + (d[pl + s] * 255 - px[o + 1]) * mix; img[q + 2] = px[o + 2] + (d[2 * pl + s] * 255 - px[o + 2]) * mix; img[q + 3] = px[o + 3];
        }
      }
      octx.putImageData(mkImageData(img, cw, chh, cs), cx0, cy0);
      done++;
      const el = performance.now() - t0, left = el / done * (total - done);
      $('#progressName').textContent = `${label ? label + ' · ' : ''}шумоподавление ${Math.round(done / total * 100)}%${done < total ? ' · осталось ~' + fmtDur(left) : ''}`;
      if (own) progressFill.style.width = (done / total * 100) + '%';
      await yieldUI();
    }
  } catch (e) { out.width = out.height = 0; throw e; }
  finally { if (own) hideProgress(); }
  return out;
}

/* Вернуть очищенный холст области фото (размер sw×sh) или null, если шумоподавление не нужно/не может. */
async function dnMaybe(bmp, item, sx, sy, sw, sh, c, cs) {
  const m = dnOf(c); if (!m) return null;
  if (!compInstalled(m.comp)) { compWarnOnce(m.comp, 'Нейро-шумоподавление'); return null; }
  if (sw * sh > m.maxPx) {
    const k = item.id + m.comp; if (!dnWarned.has(k)) { dnWarned.add(k); toast(`Нейро-шумоподавление «${m.name}» пропущено: ${(sw * sh / 1e6).toFixed(1)} МП больше предела ${(m.maxPx / 1e6).toFixed(1)} МП. Обрежь фото или выбери быструю модель`, true, { ms: 8000 }); }
    return null;
  }
  const lv = dnLvl(c), key = [m.comp, lv, sx, sy, sw, sh, cs].join('|');
  if (dnSlot && dnSlot.id === item.id && dnSlot.key === key && dnSlot.canvas.width) return dnSlot.canvas;
  dnFree();
  try {
    const canvas = await dnRun(bmp, sx, sy, sw, sh, m, lv, cs, item.name);
    dnSlot = { id: item.id, key, canvas }; return canvas;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    console.error('DN', e); toast('Нейро-шумоподавление не удалось (' + friendlyError(e).replace(/^Ошибка: /, '') + '). Сохраняю без него', true, { ms: 7000 });
    return null;
  }
}
function dnEstimateText(item, cfg) {
  const m = dnOf(cfg); if (!m || !item) return '';
  const px = item.w * item.h;
  return px > m.maxPx ? `Это фото (${(px / 1e6).toFixed(1)} МП) больше предела ${(m.maxPx / 1e6).toFixed(1)} МП для этой модели: шумоподавление будет пропущено.` : `Для этого фото примерно ${fmtDur(px * m.ms * ortSpeed())} на компьютере; на телефоне в 2–4 раза дольше.`;
}
