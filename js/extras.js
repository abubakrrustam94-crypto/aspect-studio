'use strict';
/* Aspect Studio — дополнительные виды выдачи: PDF из фото и набор иконок (ICO + PWA) */

/* ---------- PDF ---------- */
const enc8 = s => new TextEncoder().encode(s);
function buildPdf(pages) {            // pages: [{ jpeg: Uint8Array, w, h, pw, ph, x, y, dw, dh }] → Uint8Array
  const parts = [], offs = [];
  let pos = 0;
  const push = u => { parts.push(u); pos += u.length; };
  const str = s => push(enc8(s));
  str('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  const obj = (n, body) => { offs[n] = pos; str(`${n} 0 obj\n${body}\nendobj\n`); };
  const n = pages.length, kids = pages.map((_, i) => `${5 + 3 * i} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    const im = 3 + 3 * i, ct = 4 + 3 * i, pg = 5 + 3 * i, f = v => +v.toFixed(2);
    offs[im] = pos;
    str(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); str('\nendstream\nendobj\n');
    const cs = `q ${f(p.dw)} 0 0 ${f(p.dh)} ${f(p.x)} ${f(p.y)} cm /Im0 Do Q`;
    obj(ct, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.pw)} ${f(p.ph)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
  });
  const total = 3 + 3 * n, xr = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  str(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0; parts.forEach(u => { out.set(u, o); o += u.length; });
  return out;
}
function pdfPageBox(w, h, mode) {      // размеры страницы в пунктах (1/72 дюйма) и положение картинки
  if (mode === 'image') { const k = 72 / 150; return { pw: w * k, ph: h * k, x: 0, y: 0, dw: w * k, dh: h * k }; }
  const land = w > h, PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89, m = 28.35, s = Math.min((PW - 2 * m) / w, (PH - 2 * m) / h);
  return { pw: PW, ph: PH, x: (PW - w * s) / 2, y: (PH - h * s) / 2, dw: w * s, dh: h * s };
}
async function exportPdf() {
  if (busy || !items.length) return;
  const list = items.filter(i => !i.skip);
  if (!list.length) { toast('Отметь хотя бы одно фото для PDF', true); return; }
  busy = true; cancelFlag = false; setToolbarBusy(true); exporting = true; $('.layout').classList.add('locked');
  showProgress('Собираю PDF…');
  const pages = []; let bytes = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      if (cancelFlag) break;
      const item = list[i]; setProgress(i, list.length, item.name); await yieldUI();
      const bmp = await loadBitmap(item);
      let r; try { r = await exportBlob(item, bmp, 'jpg'); } finally { closeBmp(bmp); }
      const jpeg = new Uint8Array(await r.blob.arrayBuffer()), im = await createImageBitmap(r.blob), w = im.width, h = im.height; im.close();
      bytes += jpeg.length;
      if (bytes > 600 * 1024 * 1024) throw new RangeError('memory');
      pages.push({ jpeg, w, h, ...pdfPageBox(w, h, S.pdfPage) });
    }
    if (cancelFlag) { toast('Отменено'); return; }
    const pdf = buildPdf(pages);
    saveBlob(new Blob([pdf], { type: 'application/pdf' }), `aspect-studio_${pages.length}-${pages.length === 1 ? 'page' : 'pages'}.pdf`);
    toast(`PDF готов · страниц: ${pages.length}, ${(pdf.length / 1048576).toFixed(1)} МБ`);
  } catch (e) {
    if (e && e.name === 'AbortError') toast('Отменено');
    else { console.error(e); toast(e instanceof RangeError ? 'Не хватило памяти для PDF. Выбери меньше фото или уменьши размер.' : friendlyError(e), true); }
  } finally {
    busy = false; setToolbarBusy(false); exporting = false; $('.layout').classList.remove('locked'); hideProgress(); renderThumbs();
  }
}

/* ---------- Иконки ---------- */
const ICON_SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
function buildIco(pngs) {              // pngs: [{ size, data: Uint8Array }]
  const n = pngs.length, head = 6 + 16 * n, out = new Uint8Array(head + pngs.reduce((a, p) => a + p.data.length, 0)), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, n, true);
  let off = head;
  pngs.forEach((p, i) => {
    const o = 6 + 16 * i; out[o] = p.size >= 256 ? 0 : p.size; out[o + 1] = p.size >= 256 ? 0 : p.size; out[o + 4] = 1; out[o + 6] = 32;
    dv.setUint32(o + 8, p.data.length, true); dv.setUint32(o + 12, off, true); out.set(p.data, off); off += p.data.length;
  });
  return out;
}
function iconCanvas(bmp, size, cover) {
  const { w, h } = dimsOf(bmp), c = mkCanvas(size, size), g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const k = cover ? Math.max(size / w, size / h) : Math.min(size / w, size / h), dw = w * k, dh = h * k;
  g.drawImage(bmp, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return c;
}
const canvasPng = c => new Promise(r => c.toBlob(r, 'image/png'));
async function exportIcons() {
  const item = cur(); if (!item || busy) return;
  busy = true; setToolbarBusy(true);
  try {
    const bmp = await loadBitmap(item), cover = S.fit === 'fill', zip = new ZipWriter(), pngs = {};
    try {
      for (const s of ICON_SIZES) {
        const c = iconCanvas(bmp, s, cover), blob = await canvasPng(c); c.width = c.height = 0;
        pngs[s] = new Uint8Array(await blob.arrayBuffer());
        await zip.add(`icon-${s}.png`, pngs[s]);
      }
    } finally { closeBmp(bmp); }
    await zip.add('apple-touch-icon.png', pngs[180]);
    await zip.add('favicon.ico', buildIco(ICO_SIZES.filter(s => pngs[s]).map(s => ({ size: s, data: pngs[s] }))));
    await zip.add('manifest-icons.json', enc8(JSON.stringify({ icons: [192, 512].map(s => ({ src: `icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })) }, null, 2)));
    await zip.add('head.html', enc8('<link rel="icon" href="favicon.ico" sizes="any">\n<link rel="icon" type="image/png" sizes="32x32" href="icon-32.png">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<link rel="manifest" href="manifest.json">\n'));
    const base = (item.name || 'icons').replace(/\.[^.]+$/, '');
    saveBlob(await zip.finish(), `${base}_icons.zip`);
    toast(`Набор иконок готов · ${ICON_SIZES.length} размеров и favicon.ico`);
  } catch (e) { console.error(e); toast(friendlyError(e), true); }
  finally { busy = false; setToolbarBusy(false); }
}
(function () {
  const pdf = $('#pdfBtn'), ico = $('#iconsBtn');
  if (!pdf) return;
  pdf.addEventListener('click', exportPdf); ico.addEventListener('click', exportIcons);
  window.exSync = () => { const has = items.length > 0; pdf.disabled = !has || exporting; ico.disabled = !has || exporting; };
})();
