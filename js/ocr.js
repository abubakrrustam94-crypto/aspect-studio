'use strict';
/* Aspect Studio — распознавание текста на фото (Tesseract.js в WebAssembly, русский и английский).
   Результат: текст можно скопировать, а кадр «Заполнить» можно повернуть к тексту, чтобы обрезка его не задела. */
const OCR_DIR = 'vendor/tesseract/', OCR_SIDE = 2200;
async function ocrRecognize(item, lang, onStatus) {
  await loadScript(OCR_DIR + 'tesseract.min.js');
  const bmp = await loadBitmap(item);
  let canvas;
  try {
    const { w, h } = dimsOf(bmp), k = Math.min(1, OCR_SIDE / Math.max(w, h));
    canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
    const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  } finally { closeBmp(bmp); }
  const worker = await window.Tesseract.createWorker(lang.split('+'), 1, {
    workerPath: vendorUrl(OCR_DIR + 'worker.min.js'), corePath: vendorUrl(OCR_DIR + 'tesseract-core-simd-lstm.wasm.js'), langPath: vendorUrl(OCR_DIR),
    gzip: true, cacheMethod: 'none', workerBlobURL: false,
    logger: m => { if (onStatus && m && m.status) onStatus(m.status === 'recognizing text' ? Math.round((m.progress || 0) * 100) + '%' : ''); },
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const words = [];
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(w => words.push(w)))));
    if (!words.length && data.words) data.words.forEach(w => words.push(w));
    const good = words.filter(w => w.confidence >= 60 && /\S/.test(w.text) && w.bbox);
    let box = null;
    if (good.length) {
      box = { x0: 1, y0: 1, x1: 0, y1: 0 };
      good.forEach(w => { box.x0 = Math.min(box.x0, w.bbox.x0 / canvas.width); box.y0 = Math.min(box.y0, w.bbox.y0 / canvas.height); box.x1 = Math.max(box.x1, w.bbox.x1 / canvas.width); box.y1 = Math.max(box.y1, w.bbox.y1 / canvas.height); });
    }
    return { text: (data.text || '').trim(), words: good.length, box, conf: data.confidence };
  } finally { try { await worker.terminate(); } catch (e) {} canvas.width = canvas.height = 0; }
}
(function () {
  const btn = $('#ocrBtn'), out = $('#ocrOut'), txt = $('#ocrText'), info = $('#ocrInfo'), copy = $('#ocrCopy'), focus = $('#ocrFocus');
  if (!btn) return;
  let running = false, last = null;
  window.ocrSync = () => { btn.disabled = !cur() || running || exporting; if (!cur() || (last && last.item !== cur())) { out.hidden = true; } };
  btn.addEventListener('click', async () => {
    const it = cur(); if (!it || running || exporting) return;
    if (!compInstalled('ocr')) { compWarn(['ocr'], 'Распознавание текста'); return; }
    running = true; btn.disabled = true; const label = btn.textContent;
    try {
      const r = await ocrRecognize(it, S.ocrLang, s => { btn.textContent = s ? 'Распознаю… ' + s : 'Готовлю…'; });
      last = { item: it, ...r };
      out.hidden = false; txt.value = r.text; focus.hidden = !r.box;
      info.textContent = r.text ? `Слов: ${r.words}. Уверенность распознавания: ${Math.round(r.conf || 0)}%.` : 'Текст не найден.';
      if (!r.text) toast('Текст на фото не найден');
    } catch (e) { console.error(e); toast(e instanceof FormatError ? e.message : 'Не удалось распознать текст: ' + friendlyError(e), true); }
    finally { running = false; btn.textContent = label; window.ocrSync(); }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(txt.value); toast('Текст скопирован'); }
    catch (e) { txt.select(); toast('Выдели текст и скопируй вручную', true); }
  });
  focus.addEventListener('click', () => {
    const it = cur(); if (!it || !last || last.item !== it || !last.box) return;
    histPush('ocrFocus');
    it.focus = { x: (last.box.x0 + last.box.x1) / 2, y: (last.box.y0 + last.box.y1) / 2 }; it.manual = true;
    syncUI(); schedule(); toast('Кадр «Заполнить» теперь смотрит на текст');
  });
})();
