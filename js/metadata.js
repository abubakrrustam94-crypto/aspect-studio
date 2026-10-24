'use strict';
/* Aspect Studio — вкладка «Метаданные»: таблица «Было → Будет», GPS на миниатюрах, профили, проверка готового файла */

/* ---------- Чтение метаданных (JPEG): всё, что может выдать автора ---------- */
async function readMetaFull(file) {
  const res = { jpeg: false, exif: false, gps: false, make: '', model: '', lens: '', dto: '', software: '', artist: '', copyright: '', serial: false, thumb: false, xmp: false, iptc: false, icc: false, dpi: 0, segs: [] };
  let v; try { v = new DataView(await file.slice(0, 262144).arrayBuffer()); } catch (e) { return res; }
  if (v.byteLength < 12 || v.getUint16(0) !== 0xFFD8) return res;
  res.jpeg = true;
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && o + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
  let p = 2;
  while (p + 4 < v.byteLength) {
    if (v.getUint8(p) !== 0xFF) break;
    const mk = v.getUint8(p + 1); if (mk === 0xDA || mk === 0xD9) break;
    const len = v.getUint16(p + 2); if (len < 2) break;
    res.segs.push(mk.toString(16));
    try {
      if (mk === 0xE0 && str(p + 4, 4) === 'JFIF') { const u = v.getUint8(p + 11), x = v.getUint16(p + 12); res.dpi = u === 1 ? x : u === 2 ? Math.round(x * 2.54) : 0; }
      else if (mk === 0xE1 && str(p + 4, 6) === 'Exif\0\0') parseExifSeg(v, p, len, res);
      else if (mk === 0xE1 && str(p + 4, 28).startsWith('http://ns.adobe.com/xap/1.0/')) res.xmp = true;
      else if (mk === 0xED && str(p + 4, 13) === 'Photoshop 3.0') res.iptc = true;
      else if (mk === 0xE2 && str(p + 4, 11) === 'ICC_PROFILE') res.icc = true;
    } catch (e) { /* битый сегмент: пропускаем */ }
    p += 2 + len;
  }
  return res;
}
function parseExifSeg(v, p, len, res) {
  const t = p + 10, end = Math.min(v.byteLength, p + 2 + len), le = v.getUint16(t) === 0x4949;
  if (!le && v.getUint16(t) !== 0x4D4D) return;
  res.exif = true;
  const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
  const ascii = (count, valOff) => { const o = count <= 4 ? valOff : u32(valOff), bytes = []; for (let i = 0; i < count - 1 && t + o + i < end; i++) { const c = v.getUint8(t + o + i); if (!c) break; bytes.push(c); } return new TextDecoder('utf-8').decode(new Uint8Array(bytes)).replace(/[\u0000-\u001f\u007f]/g, '').trim(); };
  const readIFD = (off, want) => {
    const out = {}, n = u16(off); if (n > 300 || t + off + 2 + n * 12 > end) return out;
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4); if (!want[tag]) continue;
      if (type === 2 && count > 0 && count < 256) out[tag] = ascii(count, e + 8);
      else if (type === 3 && count === 1) out[tag] = u16(e + 8);
      else if (type === 4 && count === 1) out[tag] = u32(e + 8);
      else if (type === 5 && count === 1) { const d = u32(u32(e + 8) + 4); out[tag] = d ? u32(u32(e + 8)) / d : 0; }
      else out[tag] = true;
    }
    out.next = u32(off + 2 + n * 12); return out;
  };
  const i0 = readIFD(u32(4), { 0x010F: 1, 0x0110: 1, 0x0131: 1, 0x013B: 1, 0x8298: 1, 0x011A: 1, 0x0128: 1, 0x8769: 1, 0x8825: 1 });
  res.make = i0[0x010F] || ''; res.model = i0[0x0110] || ''; res.software = i0[0x0131] || ''; res.artist = i0[0x013B] || ''; res.copyright = i0[0x8298] || '';
  res.gps = i0[0x8825] !== undefined; res.thumb = !!i0.next;
  if (!res.dpi && typeof i0[0x011A] === 'number' && i0[0x011A] > 1) res.dpi = Math.round(i0[0x0128] === 3 ? i0[0x011A] * 2.54 : i0[0x011A]);
  if (typeof i0[0x8769] === 'number') { const ie = readIFD(i0[0x8769], { 0x9003: 1, 0xA434: 1, 0xA431: 1, 0xA435: 1 }); res.dto = ie[0x9003] || ''; res.lens = ie[0xA434] || ''; res.serial = !!(ie[0xA431] || ie[0xA435]); }
}
const ensureMetaFull = it => it.metaFull ? Promise.resolve(it.metaFull) : (it._metaP || (it._metaP = readMetaFull(it.exifSrc || it.file).then(m => (it.metaFull = m)).catch(() => (it.metaFull = { jpeg: false }))));

/* ---------- Проверка готового файла: JPEG, PNG, WebP ---------- */
async function inspectBlob(blob) {
  const buf = new Uint8Array(await blob.slice(0, 262144).arrayBuffer()), dv = new DataView(buf.buffer);
  if (blob.type === 'image/jpeg') { const m = await readMetaFull(blob); return { type: 'jpg', ...m }; }
  if (blob.type === 'image/avif' || blob.type === 'image/jxl') return { type: blob.type === 'image/avif' ? 'avif' : 'jxl', gps: false, exif: false, xmp: false, iptc: false, dpi: 0, chunks: [] };   // кодеры не пишут метаданные
  const r = { type: blob.type === 'image/png' ? 'png' : 'webp', gps: false, exif: false, xmp: false, iptc: false, dpi: 0, chunks: [] };
  if (r.type === 'png') {
    for (let p = 8; p + 12 <= buf.length;) {
      const len = dv.getUint32(p), nm = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]); r.chunks.push(nm);
      if (nm === 'pHYs' && buf[p + 16] === 1) r.dpi = Math.round(dv.getUint32(p + 8) * 0.0254);
      if (nm === 'eXIf') r.exif = true; if (nm === 'tEXt' || nm === 'iTXt' || nm === 'zTXt') { r.xmp = true; }
      if (nm === 'IDAT') break; p += 12 + len;
    }
  } else {
    for (let p = 12; p + 8 <= buf.length;) { const nm = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]), len = dv.getUint32(p + 4, true); r.chunks.push(nm); if (nm === 'EXIF') r.exif = true; if (nm === 'XMP ') r.xmp = true; p += 8 + len + (len & 1); }
  }
  return r;
}

/* ---------- Таблица «Было → Будет» ---------- */
const fmtDto = d => d ? d.slice(0, 10).replace(/:/g, '-') + ' ' + d.slice(11) : '';
function metaRows(m, o, fmt) {
  const jpg = fmt === 'jpg', png = fmt === 'png', yes = 'есть', no = '—', drop = 'удалится', na = 'не записывается';
  const row = (label, was, will, kind) => ({ label, was: was || no, will, kind });
  const wasCam = [m.make, m.model].filter(Boolean).join(' ');
  const rows = [];
  rows.push(row('Геолокация', m.gps ? yes : '', m.gps ? drop + ' всегда' : no, m.gps ? 'drop' : 'none'));
  rows.push(row('Камера', wasCam, !jpg ? (wasCam ? drop : no) : (o.cam && wasCam ? wasCam : (wasCam ? drop : no)), jpg && o.cam && wasCam ? 'keep' : wasCam ? 'drop' : 'none'));
  rows.push(row('Объектив', m.lens, m.lens ? drop : no, m.lens ? 'drop' : 'none'));
  let dateWill = no, dateKind = 'none';
  if (jpg && o.date === 'keep' && m.dto) { dateWill = fmtDto(m.dto); dateKind = 'keep'; }
  else if (jpg && o.date === 'today') { dateWill = fmtDto(metaNowStr()) + ' (сегодня)'; dateKind = 'new'; }
  else if (m.dto) { dateWill = drop; dateKind = 'drop'; }
  rows.push(row('Дата съёмки', fmtDto(m.dto), dateWill, dateKind));
  rows.push(row('Серийный номер', m.serial ? yes : '', m.serial ? drop : no, m.serial ? 'drop' : 'none'));
  rows.push(row('Программа', m.software, m.software ? drop : no, m.software ? 'drop' : 'none'));
  rows.push(row('Автор', m.artist, jpg && o.author ? o.author : (m.artist ? drop : (o.author ? na : no)), jpg && o.author ? 'new' : m.artist ? 'drop' : 'none'));
  rows.push(row('Авторские права', m.copyright, jpg && o.copyright ? o.copyright : (m.copyright ? drop : (o.copyright ? na : no)), jpg && o.copyright ? 'new' : m.copyright ? 'drop' : 'none'));
  rows.push(row('Миниатюра внутри файла', m.thumb ? yes : '', m.thumb ? drop : no, m.thumb ? 'drop' : 'none'));
  rows.push(row('XMP и IPTC (подписи, адрес)', m.xmp || m.iptc ? yes : '', m.xmp || m.iptc ? drop : no, m.xmp || m.iptc ? 'drop' : 'none'));
  rows.push(row('Разрешение', m.dpi ? m.dpi + ' dpi' : '', o.dpi && (jpg || png) ? o.dpi + ' dpi' : (o.dpi ? na : no), o.dpi && (jpg || png) ? 'new' : 'none'));
  return rows;
}
let metaTabTok = 0;
async function renderMetaTable(it) {
  const box = $('#metaTable'); if (!box) return;
  const tok = ++metaTabTok;
  if (!it) { box.replaceChildren(); $('#metaGps').hidden = true; $('#metaBatch').hidden = true; return; }
  const m = await ensureMetaFull(it); if (tok !== metaTabTok) return;
  const o = metaOpts(), fmt = S.format, rows = metaRows(m.jpeg ? m : { jpeg: false }, o, fmt);
  const tbl = document.createElement('table'); tbl.className = 'meta-table';
  const cap = document.createElement('caption'); cap.textContent = m.jpeg ? 'Что было в исходном фото и что будет в результате' : 'Исходник не JPG: метаданные из него не читаются и не переносятся'; tbl.append(cap);
  const hd = document.createElement('thead'), hr = document.createElement('tr');
  ['Поле', 'Было', 'Будет'].forEach(t => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = t; hr.append(th); }); hd.append(hr); tbl.append(hd);
  const tb = document.createElement('tbody');
  rows.forEach(r => { const tr = document.createElement('tr'); tr.className = 'mt-' + r.kind; const a = document.createElement('th'); a.scope = 'row'; a.textContent = r.label; const b = document.createElement('td'); b.textContent = r.was; const c = document.createElement('td'); c.textContent = r.will; tr.append(a, b, c); tb.append(tr); });
  tbl.append(tb); box.replaceChildren(tbl);
  const g = $('#metaGps'); g.hidden = !m.gps;
  if (fmt !== 'jpg') { const n = document.createElement('p'); n.className = 'note'; n.textContent = fmt === 'png' ? 'В PNG метаданные камеры не записываются; можно записать только разрешение (DPI).' : 'В ' + fmt.toUpperCase() + ' метаданные не записываются, файл получается «чистым».'; box.append(n); }
  const bt = $('#metaBatch');
  if (items.length > 1) {
    const all = await Promise.all(items.map(ensureMetaFull)); if (tok !== metaTabTok) return;
    const n = all.filter(x => x.gps).length; bt.hidden = false;
    bt.textContent = n ? `Геолокация найдена на ${n} из ${items.length} фото. Во всех результатах её не будет.` : `Геолокации нет ни на одном из ${items.length} фото.`;
  } else bt.hidden = true;
}

/* ---------- Профили ---------- */
const META_PROFILES = {
  public: { meta: 'none', metaCam: false, metaDate: 'none', metaDpi: 0, name: 'Для публикации: из файла удалено всё' },
  portfolio: { meta: 'custom', metaCam: true, metaDate: 'keep', metaDpi: 0, name: 'Для портфолио: камера и дата остаются, автор берётся из поля ниже' },
  print: { meta: 'custom', metaCam: false, metaDate: 'none', metaDpi: 300, name: 'Для печати: записано 300 dpi' },
};
$$('#metaProfiles [data-p]').forEach(b => b.addEventListener('click', () => {
  const pr = META_PROFILES[b.dataset.p]; if (!pr || exporting) return;
  histPush('metaProfile');
  ['meta', 'metaCam', 'metaDate', 'metaDpi'].forEach(k => { S[k] = pr[k]; });
  save(); syncUI(); schedule(); toast(pr.name);
}));
/* Выбор отдельной группы переводит режим в «Свой выбор» */
['metaCam', 'metaDate'].forEach(k => { const el = $(`[data-key="${k}"], [data-group="${k}"]`); if (el) el.addEventListener('click', () => { if (S.meta !== 'custom') { S.meta = 'custom'; save(); syncUI(); } }, true); });

/* ---------- Проверить готовый файл ---------- */
$('#metaCheckBtn').addEventListener('click', async () => {
  const it = cur(), btn = $('#metaCheckBtn'), out = $('#metaCheck'); if (!it || btn.disabled) return;
  btn.disabled = true; btn.textContent = 'Проверяю…'; out.hidden = false; out.replaceChildren();
  try {
    const bmp = await getBitmap(it), r = await exportBlob(it, bmp), x = await inspectBlob(r.blob);
    const lines = [];
    const add = (ok, text) => lines.push([ok, text]);
    add(!x.gps, x.gps ? 'В файле ЕСТЬ геолокация' : 'Геолокации в файле нет');
    if (x.type === 'jpg') {
      add(true, `Камера: ${[x.make, x.model].filter(Boolean).join(' ') || 'не записана'}`);
      add(true, `Дата: ${x.dto ? fmtDto(x.dto) : 'не записана'}`);
      add(true, `Автор: ${x.artist || 'не записан'}; права: ${x.copyright || 'не записаны'}`);
      add(!x.thumb && !x.xmp && !x.iptc && !x.serial && !x.software && !x.lens, x.thumb || x.xmp || x.iptc || x.serial || x.software || x.lens ? 'Остались лишние данные: ' + [x.thumb && 'миниатюра', x.xmp && 'XMP', x.iptc && 'IPTC', x.serial && 'серийный номер', x.software && 'программа', x.lens && 'объектив'].filter(Boolean).join(', ') : 'Миниатюры, XMP, IPTC, серийных номеров, объектива и программы нет');
    } else {
      add(!x.exif && !x.xmp, x.exif || x.xmp ? 'В файле есть служебные блоки: ' + x.chunks.filter(c => /EXIF|eXIf|XMP|tEXt|iTXt|zTXt/.test(c)).join(', ') : 'Блоков метаданных (EXIF, XMP, текст) нет');
    }
    add(true, x.dpi ? `Разрешение: ${x.dpi} dpi` : 'Разрешение не записано');
    lines.forEach(([ok, t]) => { const li = document.createElement('li'); li.className = ok ? 'ok' : 'bad'; li.textContent = (ok ? '✓ ' : '✗ ') + t; out.append(li); });
    out.dataset.result = JSON.stringify({ gps: x.gps, type: x.type });
  } catch (e) { console.error(e); const li = document.createElement('li'); li.className = 'bad'; li.textContent = 'Не удалось проверить файл'; out.append(li); }
  finally { btn.disabled = false; btn.textContent = 'Проверить готовый файл'; }
});

/* Значок GPS на миниатюрах: читаем заголовки новых фото в фоне и перерисовываем один раз */
let metaThumbTimer = 0;
function scanMetaForThumbs() {
  const pend = items.filter(i => !i.metaFull);
  if (!pend.length) return;
  Promise.all(pend.map(ensureMetaFull)).then(() => { clearTimeout(metaThumbTimer); metaThumbTimer = setTimeout(() => { renderThumbs(); if (typeof renderMetaInfo === 'function') renderMetaInfo(); }, 120); });
}
const _updChrome2 = updateChrome; updateChrome = function () { _updChrome2.apply(this, arguments); scanMetaForThumbs(); };
