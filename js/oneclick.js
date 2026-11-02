'use strict';
/* Aspect Studio — «Улучшить фото»: смотрит на фото (тёмное, с лицами, шумное) и включает подходящие тон, ретушь, ночной свет и шумоподавление. */
/* Чистая логика: a — результат toneAnalyze, an — анализ фото, has — какие компоненты скачаны. Возвращает { patch, notes, missing } */
function ocPlan(a, an, has, enh) {
  const faces = !!(an && an.faces > 0), patch = {}, notes = [], missing = [];
  const tone = toneSuggest(a, { faces });
  const dark = !!a && a.p50 < .27 && a.p95 < .62, veryDark = !!a && a.p50 < .18;
  const noisy = !!an && an.noise >= 4.5;
  Object.assign(patch, tone);
  if (dark) {
    if (has.lowlight) {
      patch.lowOn = true; patch.lowAmt = veryDark ? 80 : 60; patch.lowDn = noisy ? 75 : 50;
      patch.toneExp = Math.round(patch.toneExp * .35); notes.push('ночной свет');
    } else missing.push('Ночной свет');
  } else if (patch.lowOn === undefined) patch.lowOn = false;
  if (has.retouch) {
    patch.retouchOn = true; patch.retouchStyle = faces ? 'exp' : (a && a.sat < .28 ? 'vivid' : 'exp'); patch.retouchAmt = faces ? 55 : 65;
    patch.toneExp = Math.round(patch.toneExp * .5); patch.toneCon = Math.round(patch.toneCon * .5);
    notes.push(faces ? 'мягкая ретушь (люди)' : 'ретушь');
  } else missing.push('Умная ретушь');
  if (TONE_KEYS.some(k => patch[k])) notes.unshift('тон и цвет');
  if (enh) { Object.assign(patch, enh); if (enh.denoise >= 35 || (an && an.noise >= 4.5)) notes.push('шумоподавление'); }
  return { patch, notes, missing };
}
async function ocStats(item) {
  const bmp = await loadBitmap(item);
  try {
    const { w, h } = dimsOf(bmp), k = Math.min(1, 160 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = mkCanvas(cw, ch), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, cw, ch);
    const a = toneAnalyze(g.getImageData(0, 0, cw, ch).data); c.width = c.height = 0; return a;
  } finally { closeBmp(bmp); }
}
async function ocOne(item) {
  const an = await ensureAnalysis(item), a = await ocStats(item);
  const rec = an ? anRecommend(item, an) : null;
  const enh = rec ? { enhOn: rec.enhOn, sharp: rec.sharp, denoise: rec.denoise, enhLevel: rec.enhLevel, smart: rec.smart } : null;
  const r = ocPlan(a, an, { lowlight: compInstalled('lowlight'), retouch: compInstalled('retouch') }, enh);
  applyTune(item, r.patch); return r;
}
window.ocRun = async function (targets, all) {
  const prev = targets.map(t => [t, t.ov ? { ...t.ov } : null]), miss = new Set(); let last = null;
  histPush('oneEnh');
  for (let i = 0; i < targets.length; i++) {
    if (all) toast(`Улучшаю ${i + 1} из ${targets.length}…`);
    await yieldUI();
    try { last = await ocOne(targets[i]); last.missing.forEach(m => miss.add(m)); } catch (e) { console.warn('oneclick', e); }
  }
  renderThumbs(); syncUI(); schedule();
  const txt = all ? `Улучшено фото: ${targets.length}` : (last && last.notes.length ? 'Включено: ' + last.notes.join(', ') : 'Фото уже в порядке — менять почти нечего');
  const ms = miss.size ? ` Не хватает компонентов: ${[...miss].join(', ')} (вкладка «Компоненты»).` : '';
  toast(txt + '.' + ms, false, { action: { label: 'Отменить', fn: () => { prev.forEach(([i, o]) => { i.ov = o; }); renderThumbs(); syncUI(); schedule(); } }, ms: 10000 });
  return last;
};
