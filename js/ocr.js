'use strict';
/* Aspect Studio — распознавание текста на фото (Tesseract.js в WebAssembly, русский и английский).
   Результат: текст можно скопировать, а кадр «Заполнить» можно повернуть к тексту, чтобы обрезка его не задела. */
const OCR_DIR = 'vendor/tesseract/', OCR_SIDE = 2200, OCR_MIN = 1500, OCR_PROBE = 1100;
/* Холст под распознавание: мелкий текст увеличиваем (LSTM лучше всего читает буквы высотой 25–40 px), слишком большой уменьшаем */
function ocrCanvas(bmp) {
  const { w, h } = dimsOf(bmp), long = Math.max(w, h), k = long < OCR_MIN ? Math.min(3, OCR_MIN / long) : Math.min(1, OCR_SIDE / long);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}
/* Серый кадр с растянутым контрастом; в нём же определяем, светлый текст на тёмном или наоборот */
function ocrGrayData(cv) {
  const w = cv.width, h = cv.height, d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, n = w * h, y = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) { const v = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8; y[i] = v; hist[v]++; }
  let acc = 0, lo = 0, hi = 255; const t1 = n * 0.01, t2 = n * 0.99;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t1) { lo = v; break; } }
  acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t2) { hi = v; break; } }
  if (hi - lo < 24) { lo = Math.max(0, lo - 12); hi = Math.min(255, hi + 12); }
  const sc = 255 / Math.max(1, hi - lo); let sum = 0;
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, Math.round((y[i] - lo) * sc))); y[i] = v; sum += v; }
  return { y, w, h, mean: sum / n, span: hi - lo };
}
/* Местный порог (среднее в окне, интегральное изображение): выравнивает неровный свет, тени и блики */
function ocrBinarize(g) {
  const { y, w, h } = g, n = w * h, r = Math.max(8, Math.round(Math.min(w, h) / 24)), I = new Float64Array((w + 1) * (h + 1)), out = new Uint8Array(n);
  for (let j = 0; j < h; j++) { let row = 0; for (let i = 0; i < w; i++) { row += y[j * w + i]; I[(j + 1) * (w + 1) + i + 1] = I[j * (w + 1) + i + 1] + row; } }
  for (let j = 0; j < h; j++) {
    const y0 = Math.max(0, j - r), y1 = Math.min(h, j + r + 1);
    for (let i = 0; i < w; i++) {
      const x0 = Math.max(0, i - r), x1 = Math.min(w, i + r + 1), cnt = (x1 - x0) * (y1 - y0);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / cnt;
      out[j * w + i] = y[j * w + i] < m * 0.88 ? 0 : 255;
    }
  }
  return out;
}
function ocrToCanvas(y, w, h, invert) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h), d = im.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) { const v = invert ? 255 - y[i] : y[i]; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255; }
  g.putImageData(im, 0, 0); return c;
}
function ocrRotate(cv, deg, maxSide) {
  const k = maxSide ? Math.min(1, maxSide / Math.max(cv.width, cv.height)) : 1, w = Math.round(cv.width * k), h = Math.round(cv.height * k), sw = deg % 180 ? h : w, sh = deg % 180 ? w : h;
  const c = document.createElement('canvas'); c.width = sw; c.height = sh; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.translate(sw / 2, sh / 2); g.rotate(deg * Math.PI / 180); g.drawImage(cv, -w / 2, -h / 2, w, h); return c;
}
/* Слова с уверенностью, рядки и «вес» результата: сумма длин уверенно прочитанных слов (больше хорошего текста = лучше) */
function ocrParse(data, cw, ch) {
  const lines = [];
  (data.blocks || []).forEach(b => (b.paragraphs || []).forEach((p, pi) => (p.lines || []).forEach((l, li) => lines.push({ words: (l.words || []).filter(w => w && /\S/.test(w.text || '')), para: pi === 0 && li === 0 ? 1 : (li === 0 ? 1 : 0) }))));
  if (!lines.length && data.words) lines.push({ words: data.words.filter(w => /\S/.test(w.text || '')), para: 1 });
  let score = 0, good = [], keep = [];
  lines.forEach(l => {
    const ws = l.words.filter(w => w.confidence >= 40), alnum = ws.reduce((a, w) => a + (w.text.match(/[0-9A-Za-zА-Яа-яЁё]/g) || []).length, 0), mean = ws.length ? ws.reduce((a, w) => a + w.confidence, 0) / ws.length : 0;
    ws.forEach(w => { if (w.confidence >= 50) score += w.text.length * w.confidence / 100; if (w.confidence >= 60 && w.bbox) good.push(w); });
    if (ws.length && !(mean < 55 && alnum < 3) && !(ws.length === 1 && alnum < 2 && mean < 75)) keep.push({ text: ws.map(w => w.text).join(' '), para: l.para });
  });
  let text = ''; keep.forEach((l, i) => { text += (i ? (l.para ? '\n\n' : '\n') : '') + l.text; });
  return { text: text.trim() || (data.text || '').trim(), words: good.length, good, score, conf: data.confidence || 0, cw, ch };
}
/* Рамка текста в нормированных координатах исходного кадра (с учётом поворота холста по часовой стрелке) */
function ocrBox(r, rot) {
  if (!r.good.length) return null;
  const box = { x0: 1, y0: 1, x1: 0, y1: 0 };
  r.good.forEach(w => [[w.bbox.x0, w.bbox.y0], [w.bbox.x1, w.bbox.y1]].forEach(([px, py]) => {
    let rx = px / r.cw, ry = py / r.ch, u = rx, v = ry;
    if (rot === 90) { u = ry; v = 1 - rx; } else if (rot === 270) { u = 1 - ry; v = rx; } else if (rot === 180) { u = 1 - rx; v = 1 - ry; }
    box.x0 = Math.min(box.x0, u); box.y0 = Math.min(box.y0, v); box.x1 = Math.max(box.x1, u); box.y1 = Math.max(box.y1, v);
  }));
  return box;
}
/* Кириллические буквы, похожие на латинские: слово только из них («ОРЕМ» вместо «OPEN») в английском тексте — ошибка выбора алфавита */
const OCR_LOOK = /^[АВЕКМНОРСТХаеорсухАВСЕНКМОРТХ]+$/, OCR_PURE_CYR = /[БГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯбвгдёжзийклмнптфцчшщъыьэюя]/;
/* Слова из разных проходов на одном кадре: добавляем к лучшему результату те, что он пропустил, и собираем строки заново */
function ocrMerge(base, others) {
  const ws = base.good.slice(), ov = (a, b) => { const x = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), y = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)), ar = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)); return ar > 0 ? x * y / ar : 0; };
  let added = 0;
  others.forEach(o => o.good.forEach(w => { if (w.confidence >= 70 && /[0-9A-Za-zА-Яа-яЁё]{2}/.test(w.text) && !ws.some(v => ov(v.bbox, w.bbox) > 0.25)) { ws.push(w); added++; } }));
  if (!added) return null;
  ws.sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const lines = [];
  ws.forEach(w => { const yc = (w.bbox.y0 + w.bbox.y1) / 2, h = w.bbox.y1 - w.bbox.y0, l = lines.find(L => Math.abs(L.yc - yc) < Math.max(L.h, h) * 0.6); if (l) { l.w.push(w); l.yc = (l.yc * (l.w.length - 1) + yc) / l.w.length; l.h = Math.max(l.h, h); } else lines.push({ yc, h, w: [w] }); });
  lines.sort((a, b) => a.yc - b.yc);
  let text = ''; lines.forEach((l, i) => { l.w.sort((a, b) => a.bbox.x0 - b.bbox.x0); text += (i ? (lines[i].yc - lines[i - 1].yc > lines[i].h * 2.4 ? '\n\n' : '\n') : '') + l.w.map(w => w.text).join(' '); });
  return { text: text.trim(), good: ws, words: ws.length, added };
}
const OCR_PASS = { base: 'обычный', bin: 'выровнен свет', inv: 'обратный контраст', rot: 'повёрнут' };
async function ocrRecognize(item, lang, onStatus, ctl, mode) {
  await loadScript(OCR_DIR + 'tesseract.min.js');
  const bmp = await loadBitmap(item); let src;
  try { src = ocrCanvas(bmp); } finally { closeBmp(bmp); }
  const worker = await window.Tesseract.createWorker(lang.split('+'), 1, {
    workerPath: vendorUrl(OCR_DIR + 'worker.min.js'), corePath: vendorUrl(OCR_DIR + 'tesseract-core-simd-lstm.wasm.js'), langPath: vendorUrl(OCR_DIR),
    gzip: true, cacheMethod: 'none', workerBlobURL: false,
    logger: m => { if (onStatus && m && m.status === 'recognizing text') onStatus(Math.round((m.progress || 0) * 100) + '%'); },
  });
  if (ctl) ctl.cancel = () => { ctl.cancelled = true; try { worker.terminate(); } catch (e) { /* уже остановлен */ } };
  const canv = [src];
  const chk = () => { if (ctl && ctl.cancelled) throw new Error('cancel'); };
  const run = async (cv, rot) => { chk(); const { data } = await worker.recognize(cv, {}, { text: true, blocks: true }); const r = ocrParse(data, cv.width, cv.height); r.rot = rot || 0; r.cv = cv; return r; };
  try {
    await worker.setParameters({ tessedit_pageseg_mode: mode === 'sparse' ? '11' : '3', preserve_interword_spaces: '1' });
    const g = ocrGrayData(src), dark = g.mean < 105; 
    const mk = (y, inv) => { const c = ocrToCanvas(y, g.w, g.h, inv); canv.push(c); return c; };
    onStatus && onStatus('');
    let best = await run(mk(g.y, dark), 0); best.how = 'base';
    const tried = [best], sparse = mode === 'sparse';
    const consider = r => { tried.push(r); if (r.score > best.score * 1.08 + 0.5) best = r; };
    if (sparse || best.conf < 75 || best.words < 2) { onStatus && onStatus('усиливаю'); const r = await run(mk(ocrBinarize(g), dark), 0); r.how = 'bin'; consider(r); }
    if (sparse || best.conf < 60) { onStatus && onStatus('меняю контраст'); const r = await run(mk(g.y, !dark), 0); r.how = 'inv'; consider(r); }
    if (best.words < 3 || best.conf < 45) {                                      // вдруг фото повёрнуто: быстрая проба на уменьшенном кадре
      onStatus && onStatus('ищу поворот');
      const small = ocrToCanvas(g.y, g.w, g.h, dark); canv.push(small); let bp = null;
      for (const deg of [90, 270, 180]) { const rc = ocrRotate(small, deg, OCR_PROBE); canv.push(rc); const r = await run(rc, deg); if (!bp || r.score > bp.score) bp = r; }
      if (bp && bp.score > Math.max(4, best.score * 2)) { const full = ocrRotate(ocrToCanvas(g.y, g.w, g.h, dark), bp.rot); canv.push(full); const r = await run(full, bp.rot); r.how = 'rot'; consider(r); }
    }
    // «ОРЕМ» вместо «OPEN»: ни в одном проходе нет однозначно русской буквы, значит, это латиница; перечитываем кадры только по-английски
    const cyr = r => /[А-Яа-яЁё]/.test(r.text), look = r => r.text.split(/\s+/).some(w => OCR_LOOK.test(w));
    if (lang.includes('rus') && lang.includes('eng') && tried.some(cyr) && !tried.some(r => OCR_PURE_CYR.test(r.text)) && tried.some(look)) {
      onStatus && onStatus('проверяю алфавит');
      try {
        await worker.reinitialize(['eng']); const again = [];
        for (const r of tried) { const n = await run(r.cv, r.rot); n.how = r.how; again.push(n); }
        if (again.reduce((a, r) => a + r.score, 0) >= tried.reduce((a, r) => a + r.score, 0) * 0.85 && !again.some(r => /[А-Яа-яЁё]/.test(r.text))) { tried.splice(0, tried.length, ...again); best = again.reduce((m, r) => r.score > m.score * 1.08 + 0.5 ? r : m, again[0]); }
      } catch (e) { if (ctl && ctl.cancelled) throw e; }
    }
    // слова, которые лучший проход пропустил, а другой нашёл (разная полярность и свет в одном кадре)
    if (best.rot === 0 && tried.length > 1) { const m = ocrMerge(best, tried.filter(r => r !== best && r.rot === 0)); if (m) { best = Object.assign({}, best, m); best.how = best.how === 'base' ? 'bin' : best.how; best.merged = true; } }
    return { text: best.text, words: best.words, box: ocrBox(best, best.rot), conf: best.conf, how: OCR_PASS[best.how] || '', rot: best.rot, passes: tried.length };
  } finally { try { await worker.terminate(); } catch (e) {} canv.forEach(c => { if (c) c.width = c.height = 0; }); }
}
(function () {
  const btn = $('#ocrBtn'), out = $('#ocrOut'), txt = $('#ocrText'), info = $('#ocrInfo'), copy = $('#ocrCopy'), save = $('#ocrSave'), focus = $('#ocrFocus');
  if (!btn) return;
  let running = false, last = null;
  window.ocrSync = () => { btn.disabled = !cur() || running || exporting; if (!cur() || (last && last.item !== cur())) { out.hidden = true; } };
  btn.addEventListener('click', async () => {
    const it = cur(); if (!it || running || exporting) return;
    if (!compInstalled('ocr')) { compWarn(['ocr'], 'Распознавание текста'); return; }
    running = true; btn.disabled = true; const label = btn.textContent, ctl = {};
    const bz = window.busy ? window.busy('Распознаю текст…', () => { ctl.cancelled = true; if (ctl.cancel) ctl.cancel(); if (ctl.abort) ctl.abort(); }) : null;
    try {
      const r = await Promise.race([new Promise((res, rej) => { ctl.abort = () => rej(new Error('cancel')); }), ocrRecognize(it, S.ocrLang, s => { btn.textContent = s ? 'Распознаю… ' + s : 'Готовлю…'; if (bz && s) bz.text('Распознаю текст… ' + s); }, ctl, S.ocrMode)]);
      if (ctl.cancelled) { toast('Распознавание отменено'); return; }
      last = { item: it, ...r };
      out.hidden = false; txt.value = r.text; focus.hidden = !r.box;
      const parts = r.text ? [`Слов: ${r.words}. Уверенность распознавания: ${Math.round(r.conf || 0)}%.`] : ['Текст не найден. Попробуй режим «Надписи» или другой язык.'];
      if (r.text && r.how && r.how !== OCR_PASS.base) parts.push(`Лучший результат: ${r.rot ? 'повёрнут на ' + r.rot + '°' : r.how}.`);
      if (r.text && r.conf < 60) parts.push('Текст мелкий, смазанный или нестандартный: проверь результат.');
      info.textContent = ''; parts.forEach((t, i) => { const sp = document.createElement('span'); sp.textContent = (i ? ' ' : '') + t; info.append(sp); });
      save.hidden = !r.text;
      if (!r.text) toast('Текст на фото не найден');
    } catch (e) { if (ctl.cancelled) { toast('Распознавание отменено'); return; } console.error(e); toast(e instanceof FormatError ? e.message : 'Не удалось распознать текст: ' + friendlyError(e), true); }
    finally { if (bz) bz.done(); running = false; btn.textContent = label; window.ocrSync(); }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(txt.value); toast('Текст скопирован'); }
    catch (e) { txt.select(); toast('Выдели текст и скопируй вручную', true); }
  });
  save.addEventListener('click', () => { const it = cur(); const nm = ((it && it.name) || 'photo').replace(/\.[^.]+$/, '') + '.txt'; saveBlob(new Blob([txt.value], { type: 'text/plain;charset=utf-8' }), nm); toast('Сохранено: ' + nm); });
  focus.addEventListener('click', () => {
    const it = cur(); if (!it || !last || last.item !== it || !last.box) return;
    histPush('ocrFocus');
    it.focus = { x: (last.box.x0 + last.box.x1) / 2, y: (last.box.y0 + last.box.y1) / 2 }; it.manual = true;
    syncUI(); schedule(); toast('Кадр «Заполнить» теперь смотрит на текст');
  });
})();
