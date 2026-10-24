'use strict';
/* Aspect Studio — Экспорт: файл, поделиться, копировать, ZIP */
/* ===================================================================
   Экспорт: один файл, поделиться, копировать, ZIP
   =================================================================== */
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', jxl: 'image/jxl' };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif', 'image/jxl': 'jxl' };
/* Имя файла по шаблону: {name} {n} {w} {h} {date} */
/* ---------- Имя файла: шаблон, счётчики, транслитерация ---------- */
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ғ: 'g', ӣ: 'i', қ: 'k', ӯ: 'u', ҳ: 'h', ҷ: 'j' };
const translit = s => s.replace(/[А-Яа-яЁёІіЇїЄєҐґҒғӢӣҚқӮӯҲҳҶҷ]/g, ch => {
  const lo = ch.toLowerCase(), t = TRANSLIT[lo]; if (t === undefined) return ch;
  return ch === lo ? t : (t.length > 1 ? t[0].toUpperCase() + t.slice(1) : t.toUpperCase());
});
function ratioToken(c) {
  if (c.sizeMode === 'fixed') { const g = gcd(c.outW, c.outH) || 1; return `${c.outW / g}x${c.outH / g}`; }
  return `${c.ratioW}x${c.ratioH}`.replace(/\./g, '_');
}
const groupKey = c => c.sizeMode === 'fixed' ? `${c.outW}x${c.outH}` : `${c.ratioW}:${c.ratioH}`;
function makeName(item, w, h, ext) {
  const total = items.length, i0 = items.indexOf(item), pos = Math.max(0, i0) + 1, start = Number.isFinite(+S.nameStart) ? Math.max(0, Math.floor(+S.nameStart)) : 1;
  const pad = Math.max(2, String(total + start - 1).length), d = new Date(), p2 = v => String(v).padStart(2, '0');
  const c = cfgFor(item), key = groupKey(c);
  const k = 1 + items.slice(0, Math.max(0, i0)).filter(x => groupKey(cfgFor(x)) === key).length;
  const vals = { name: baseName(item.name), n: String(pos - 1 + start).padStart(pad, '0'), k: String(k).padStart(2, '0'), w, h, ratio: ratioToken(c), preset: c.presetId || 'custom', date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` };
  const tpl = (S.nameTpl || '').trim() || DEFAULTS.nameTpl;
  let s = tpl.replace(/\{(name|n|k|w|h|date|ratio|preset)\}/g, (m, t) => vals[t]);
  if (S.nameTranslit) s = translit(s);
  if (S.nameSpaces) s = s.replace(/\s+/g, '_');
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().replace(/^\.+/, '').slice(0, 120) || 'image';
  return `${s}.${ext}`;
}
const baseName = n => { const b = (n.replace(/\.[^.]+$/, '') || 'image').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80); return b; };
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ';

/* ---------- Метаданные: безопасный минимум (дата съёмки и камера). Геолокация, серийные номера и миниатюры не копируются никогда ---------- */
async function readExifBasics(file) {
  const v = new DataView(await file.slice(0, 131072).arrayBuffer());
  if (v.byteLength < 12 || v.getUint16(0) !== 0xFFD8) return null;
  let p = 2;
  while (p + 4 < v.byteLength) {
    if (v.getUint8(p) !== 0xFF) break;
    const mk = v.getUint8(p + 1), len = v.getUint16(p + 2);
    if (mk === 0xE1 && len > 14 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {   // «Exif\0\0»
      const t = p + 10, end = Math.min(v.byteLength, p + 2 + len);
      const le = v.getUint16(t) === 0x4949;
      if (!le && v.getUint16(t) !== 0x4D4D) return null;
      const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
      const ascii = (count, valOff) => {
        const o = count <= 4 ? valOff : u32(valOff);
        let str = '';
        for (let i = 0; i < count - 1 && t + o + i < end; i++) { const c = v.getUint8(t + o + i); if (!c) break; str += String.fromCharCode(c); }
        return str;
      };
      const readIFD = (ifdOff, want) => {
        const out = {}, n = u16(ifdOff);
        if (n > 200) return out;
        for (let i = 0; i < n; i++) {
          const e = ifdOff + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
          if (!want[tag]) continue;
          if (type === 2 && count > 0 && count < 128) out[tag] = ascii(count, e + 8);
          else if (type === 4 && count === 1) out[tag] = u32(e + 8);
        }
        return out;
      };
      const ifd0 = readIFD(u32(4), { 0x010F: 1, 0x0110: 1, 0x8769: 1, 0x8825: 1 });
      let dto = '';
      if (ifd0[0x8769]) { try { dto = readIFD(ifd0[0x8769], { 0x9003: 1 })[0x9003] || ''; } catch (e) {} }
      return { make: ifd0[0x010F] || '', model: ifd0[0x0110] || '', dto, gps: ifd0[0x8825] !== undefined };
    }
    p += 2 + len;
  }
  return null;
}

function buildExifTiff({ make, model, dto, artist, copyright, dpi }) {
  const enc = str => { const b = new TextEncoder().encode(str), a = new Uint8Array(b.length + 1); a.set(b); return a; };
  const items = [];
  if (make) items.push({ tag: 0x010F, type: 2, data: enc(make) });
  if (model) items.push({ tag: 0x0110, type: 2, data: enc(model) });
  items.push({ tag: 0x0112, type: 3, value: 1 });            // Orientation = 1: поворот уже применён к пикселям
  if (dpi) {                                                  // разрешение: два рационала dpi/1 и единица «дюйм»
    const rat = new Uint8Array(8); new DataView(rat.buffer).setUint32(0, dpi); new DataView(rat.buffer).setUint32(4, 1);
    items.push({ tag: 0x011A, type: 5, data: rat, count: 1 }, { tag: 0x011B, type: 5, data: rat.slice(), count: 1 }, { tag: 0x0128, type: 3, value: 2 });
  }
  if (artist) items.push({ tag: 0x013B, type: 2, data: enc(artist) });
  if (copyright) items.push({ tag: 0x8298, type: 2, data: enc(copyright) });
  if (dto) items.push({ tag: 0x8769, type: 4, value: 0 });   // смещение Exif IFD подставим ниже
  const n0 = items.length, hasExif = !!dto;
  const dataStart = 8 + (2 + n0 * 12 + 4) + (hasExif ? 2 + 12 + 4 : 0);
  let cursor = 0; const blobs = [];
  const place = it => { if (it.data.length <= 4) { it.inline = it.data; return; } it.off = dataStart + cursor; blobs.push(it.data); cursor += it.data.length + (it.data.length & 1); };
  items.forEach(it => { if (it.data) place(it); });
  const dtoItem = hasExif ? { tag: 0x9003, type: 2, data: enc(dto) } : null;
  if (dtoItem) place(dtoItem);
  const out = new Uint8Array(dataStart + cursor), dv = new DataView(out.buffer);
  out.set([0x4D, 0x4D, 0x00, 0x2A], 0); dv.setUint32(4, 8);
  const writeEntry = (o, it) => {
    dv.setUint16(o, it.tag); dv.setUint16(o + 2, it.type); dv.setUint32(o + 4, it.count || (it.data ? it.data.length : 1));
    if (it.data) { if (it.inline) out.set(it.inline, o + 8); else dv.setUint32(o + 8, it.off); }
    else if (it.type === 3) dv.setUint16(o + 8, it.value); else dv.setUint32(o + 8, it.value);
  };
  let o = 8; dv.setUint16(o, n0); o += 2;
  items.forEach(it => { if (it.tag === 0x8769) it.value = 8 + 2 + n0 * 12 + 4; writeEntry(o, it); o += 12; });
  dv.setUint32(o, 0); o += 4;
  if (hasExif) { dv.setUint16(o, 1); o += 2; writeEntry(o, dtoItem); o += 12; dv.setUint32(o, 0); }
  let c2 = dataStart; blobs.forEach(b => { out.set(b, c2); c2 += b.length + (b.length & 1); });
  return out;
}

/* Что писать в результат: режим «meta» (none / basic / custom) + автор, права и DPI, которые не зависят от режима */
const metaNowStr = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}:${z(d.getMonth() + 1)}:${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };
function metaOpts(c = S) {
  const m = c.meta, author = (c.author || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 80);
  const tpl = (c.metaCopy || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 120);
  const copyright = tpl ? tpl.replace(/\{(автор|author)\}/gi, author).replace(/\{(год|year)\}/gi, String(new Date().getFullYear())).replace(/\s+/g, ' ').trim() : (author ? '© ' + author : '');
  return { cam: m === 'basic' ? true : m === 'custom' ? !!c.metaCam : false, date: m === 'basic' ? 'keep' : m === 'custom' ? (c.metaDate || 'keep') : 'none', author, copyright, dpi: [72, 96, 150, 300].includes(+c.metaDpi) ? +c.metaDpi : 0 };
}
const metaWrites = (c = S) => { const o = metaOpts(c); return o.cam || o.date !== 'none' || !!o.author || !!o.copyright || o.dpi > 0; };

async function buildSafeExif(file, withCamera = true) {
  const o = metaOpts();
  const info = (o.cam || o.date === 'keep') ? await readExifBasics(file).catch(() => null) : null;
  const clean = str => (str || '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, 64);
  const make = o.cam ? clean(info && info.make) : '', model = o.cam ? clean(info && info.model) : '';
  const dto = o.date === 'today' ? metaNowStr() : o.date === 'keep' && info && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(info.dto || '') ? info.dto : '';
  const artist = o.author, copyright = o.copyright;
  if (!make && !model && !dto && !artist && !copyright && !o.dpi) return null;
  return buildExifTiff({ make, model, dto, artist, copyright, dpi: o.dpi });
}

/* JPEG: плотность пикселей в JFIF (единица — дюйм) */
async function setJfifDpi(blob, dpi) {
  const src = new Uint8Array(await blob.arrayBuffer());
  if (src[0] !== 0xFF || src[1] !== 0xD8 || src[2] !== 0xFF || src[3] !== 0xE0 || src[6] !== 0x4A || src[7] !== 0x46 || src[8] !== 0x49 || src[9] !== 0x46) return blob;   // нет JFIF — в EXIF всё равно запишем
  src[11] = 1; src[12] = dpi >> 8; src[13] = dpi & 255; src[14] = dpi >> 8; src[15] = dpi & 255;
  return new Blob([src], { type: 'image/jpeg' });
}
/* PNG: чанк pHYs (пикселей на метр) сразу после IHDR */
async function setPngDpi(blob, dpi) {
  const src = new Uint8Array(await blob.arrayBuffer());
  if (src.length < 40 || src[1] !== 0x50 || src[2] !== 0x4E || src[3] !== 0x47) return blob;
  const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 8 + 12 + new DataView(src.buffer).getUint32(8);      // после сигнатуры и IHDR
  for (let p = 8; p < src.length - 12;) { const len = new DataView(src.buffer).getUint32(p), nm = String.fromCharCode(src[p + 4], src[p + 5], src[p + 6], src[p + 7]); if (nm === 'pHYs') return blob; if (nm === 'IDAT') break; p += 12 + len; }
  return new Blob([src.subarray(0, at), chunk, src.subarray(at)], { type: 'image/png' });
}

async function injectExif(blob, tiff) {
  const src = new Uint8Array(await blob.arrayBuffer());
  if (src[0] !== 0xFF || src[1] !== 0xD8) return blob;
  const len = 2 + 6 + tiff.length;
  if (len > 65535) return blob;
  const seg = new Uint8Array(2 + len);
  seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = len >> 8; seg[3] = len & 255;
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); seg.set(tiff, 10);
  let at = 2;                                                  // после SOI; если есть JFIF (APP0) — после него
  if (src[2] === 0xFF && src[3] === 0xE0) at = 4 + ((src[4] << 8) | src[5]);
  return new Blob([src.subarray(0, at), seg, src.subarray(at)], { type: 'image/jpeg' });
}

/* Подгонка под размер файла: сначала качество (бинарный поиск), потом уменьшение картинки */
async function fitToSize(c, fmt, q0, limit) {
  const toB = (cv, q) => encodeBlob(cv, fmt, q);
  const qMin = Math.min(0.35, q0);
  let cv = c, scale = 1, best = null;
  try {
    for (let step = 0; step < 9; step++) {
      const w = Math.max(16, Math.round(c.width * scale)), h = Math.max(16, Math.round(c.height * scale));
      if (scale < 1) {
        if (cv !== c) cv.width = cv.height = 0;
        cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h);
      }
      const top = await toB(cv, q0);
      if (!top) break;
      if (top.size <= limit) return { blob: top, q: q0, w, h, met: true, scale };
      const low = await toB(cv, qMin);
      if (low && low.size <= limit) {
        let lo = qMin, hi = q0, ok = low, okq = qMin;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2, b = await toB(cv, mid);
          if (b && b.size <= limit) { ok = b; okq = mid; lo = mid; } else hi = mid;
        }
        return { blob: ok, q: okq, w, h, met: true, scale };
      }
      best = { blob: low || top, q: qMin, w, h, met: false, scale };
      scale *= 0.85; await yieldUI();
    }
  } finally { if (cv !== c) cv.width = cv.height = 0; }
  return best || { blob: await toB(c, qMin), q: qMin, w: c.width, h: c.height, met: false, scale: 1 };
}

async function exportBlob(item, bmp, formatOverride, work) {
  const fmt = formatOverride || S.format;
  const mime = MIME[fmt];
  let c = document.createElement('canvas');
  if (cfgFor(item).enhOn) await yieldUI();
  const { cw, ch } = await render(c, item, bmp, { opaque: fmt === 'jpg', p3: wantP3(item), ...(work ? { work } : {}) });
  let blob, outW = cw, outH = ch, fit = null, iccOut = null;
  if (typeof ICC_OUT !== 'undefined' && ICC_OUT[S.colorSpace]) {            // вывод в Adobe RGB / Rec.2020 / ProPhoto / профиль исходника
    try { const r = await iccApply(c, item, fmt); if (r) { c.width = c.height = 0; c = r.canvas; iccOut = r.icc; } } catch (e) { console.error('ICC', e); toast('Цветовой профиль не применился (' + friendlyError(e).replace(/^Ошибка: /, '') + '): сохранён обычный цвет', true, { ms: 7000 }); }
  }
  if (S.targetOn && fmt !== 'png') {
    fit = await fitToSize(c, fmt, S.quality / 100, Math.max(20, S.targetKB) * 1024 - (fmt === 'jpg' && metaWrites() ? 1600 : 0));
    blob = fit.blob; outW = fit.w; outH = fit.h;
  } else blob = await encodeBlob(c, fmt, S.quality / 100);
  c.width = c.height = 0;
  if (!blob) throw new Error('Не удалось создать файл (слишком большой холст?)');
  if (iccOut && (blob.type === 'image/jpeg' || blob.type === 'image/png')) { try { blob = await iccEmbed(blob, iccOut); } catch (e) { console.warn('icc embed', e); } }
  const mo = metaOpts();
  if (blob.type === 'image/jpeg' && metaWrites()) {
    try {
      if (mo.dpi) blob = await setJfifDpi(blob, mo.dpi);
      const tiff = await buildSafeExif((item.exifSrc || item.file)); if (tiff) blob = await injectExif(blob, tiff);
    } catch (e) { console.warn('exif', e); }
  } else if (blob.type === 'image/png' && mo.dpi) { try { blob = await setPngDpi(blob, mo.dpi); } catch (e) { console.warn('png dpi', e); } }
  const ext = EXT[blob.type] || fmt;
  return { blob, w: outW, h: outH, fit, name: makeName(item, outW, outH, ext), fellBack: blob.type !== mime };
}


/* ---------- Сохранение в выбранную папку (File System Access API: Chrome / Edge на компьютере) ---------- */
const FOLDER_OK = typeof window.showDirectoryPicker === 'function';
let dirHandle = null;
const idbOpen = () => new Promise((res, rej) => { const r = indexedDB.open('aspect-studio-fs', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbGet(k) { const db = await idbOpen(); return new Promise((res, rej) => { const q = db.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbSet(k, v) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function pickFolder() {
  dirHandle = await window.showDirectoryPicker({ id: 'aspect-studio', mode: 'readwrite' });
  try { await idbSet('dir', dirHandle); } catch (e) {}
  if (typeof updateFolderUI === 'function') updateFolderUI();
}
async function ensureFolder() {            // вызывается в начале действия, пока «жив» жест пользователя
  if (!S.folderOn || !FOLDER_OK) return false;
  if (!dirHandle) await pickFolder();
  let p = await dirHandle.queryPermission({ mode: 'readwrite' });
  if (p !== 'granted') p = await dirHandle.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') { toast('Нет доступа к папке — выбери её заново', true); throw Object.assign(new Error('perm'), { name: 'NotAllowedError' }); }
  return true;
}
async function writeToFolder(blob, name) {  // не затираем существующие файлы: добавляем _2, _3…
  let n = name, i = 2;
  for (;;) {
    try { await dirHandle.getFileHandle(n); n = name.replace(/(\.[^.]+)$/, `_${i++}$1`); }
    catch (e) { if (e && e.name === 'NotFoundError') break; throw e; }
  }
  const w = await (await dirHandle.getFileHandle(n, { create: true })).createWritable();
  await w.write(blob); await w.close();
  return n;
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function setToolbarBusy(b) { $$('.tb-btn').forEach(x => { x.disabled = b; }); }

async function withCurrent(fn) {
  const item = cur();
  if (!item || busy) return;
  busy = true; cancelFlag = false; setToolbarBusy(true);
  const heavy = cfgFor(item).enhOn;
  if (heavy) { showProgress('Улучшаю качество…'); progressFill.style.width = '45%'; $('#progressName').textContent = item.name; }
  try { const bmp = await getBitmap(item); await fn(item, bmp); }
  catch (e) {
    if (e && e.name === 'AbortError') toast('Отменено');
    else if (e && e.name !== 'NotAllowedError') { console.error(e); toast(friendlyError(e), true); }
  }
  finally { busy = false; setToolbarBusy(false); if (heavy) hideProgress(); }
}

const downloadCurrent = async () => {
  let useFolder = false;
  try { useFolder = await ensureFolder(); } catch (e) { if (e && e.name !== 'AbortError') console.error(e); return; }
  return withCurrent(async (item, bmp) => {
    const r = await exportBlob(item, bmp);
    let saved = r.name;
    if (useFolder) saved = await writeToFolder(r.blob, r.name); else saveBlob(r.blob, r.name);
    const where = useFolder ? ` в папку «${dirHandle.name}»` : '';
    if (r.fit && !r.fit.met) { toast(`Не удалось уложиться в ${S.targetKB} КБ: получилось ${fmtSize(r.blob.size)}`, true); return; }
    toast(r.fit ? `Сохранено${where} · ${r.w}×${r.h} · ${fmtSize(r.blob.size)} · качество ${Math.round(r.fit.q * 100)}%` : r.fellBack ? (ENC_COMP[S.format] && !compInstalled(ENC_COMP[S.format]) ? `Для ${S.format.toUpperCase()} нужен компонент (вкладка «Компоненты») — сохранён ${saved.split('.').pop().toUpperCase()}${where}` : `Браузер не умеет ${S.format.toUpperCase()} — сохранён ${saved.split('.').pop().toUpperCase()}${where}`) : `Сохранено${where} · ${saved} · ${r.w}×${r.h} · ${fmtSize(r.blob.size)}`);
  });
};

const shareCurrent = () => withCurrent(async (item, bmp) => {
  const r = await exportBlob(item, bmp);
  const file = new File([r.blob], r.name, { type: r.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Aspect Studio' });
  else { saveBlob(r.blob, r.name); toast('Поделиться не поддерживается — файл сохранён'); }
});

const copyCurrent = () => withCurrent(async (item, bmp) => {
  if (!navigator.clipboard || !window.ClipboardItem) { toast('Копирование изображений не поддерживается в этом браузере', true); return; }
  const r = await exportBlob(item, bmp, 'png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob })]);
  toast('Скопировано в буфер обмена');
});

/* ---------- ZIP (store, без сжатия — картинки и так сжаты) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/* Заголовки одной записи ZIP (без сжатия) */
function zipEntry(name, data, offset) {
  const enc = new TextEncoder().encode(name), d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const crc = crc32(data), size = data.length;
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
  lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
  lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, enc.length, true); lh.setUint16(28, 0, true);
  const ch = new DataView(new ArrayBuffer(46));
  ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
  ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
  ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, enc.length, true);
  ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
  ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
  return { local: [lh.buffer, enc, data], central: [ch.buffer, enc], size: 30 + enc.length + size };
}
function zipEnd(count, cdSize, offset) {
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, count, true); end.setUint16(10, count, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return end.buffer;
}

/* ZIP в памяти */
class ZipWriter {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; this.disk = false; }
  async add(name, data) {
    const e = zipEntry(name, data, this.offset);
    this.parts.push(...e.local); this.central.push(...e.central);
    this.offset += e.size; this.count++;
  }
  async finish() {
    let cdSize = 0; for (const p of this.central) cdSize += p.byteLength;
    return new Blob([...this.parts, ...this.central, zipEnd(this.count, cdSize, this.offset)], { type: 'application/zip' });
  }
  async abort() { this.parts = []; this.central = []; }
}

/* ZIP на диске: пишется потоком во временный файл приватной файловой системы браузера (OPFS),
   в памяти держится только текущая фотография. В конце файл отдаётся на скачивание. */
const OPFS_OK = !!(navigator.storage && navigator.storage.getDirectory && window.FileSystemFileHandle && FileSystemFileHandle.prototype.createWritable);
const OPFS_PREFIX = 'as-tmp-';
const ZIP_PART_DISK = 2 * 1024 ** 3;   // ZIP без Zip64 не больше 4 ГБ — режем с запасом
class DiskZip {
  constructor(root, fh, w, fname) { this.root = root; this.fh = fh; this.w = w; this.fname = fname; this.central = []; this.offset = 0; this.count = 0; this.disk = true; }
  static async create() {
    const root = await navigator.storage.getDirectory();
    const fname = `${OPFS_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}.zip`;
    const fh = await root.getFileHandle(fname, { create: true });
    return new DiskZip(root, fh, await fh.createWritable(), fname);
  }
  async add(name, data) {
    const e = zipEntry(name, data, this.offset);
    for (const p of e.local) await this.w.write(p);
    this.central.push(...e.central); this.offset += e.size; this.count++;
  }
  async finish() {
    let cdSize = 0; for (const p of this.central) { await this.w.write(p); cdSize += p.byteLength; }
    await this.w.write(zipEnd(this.count, cdSize, this.offset));
    await this.w.close();
    return await this.fh.getFile();      // файл на диске, не в памяти
  }
  async abort() { try { await this.w.abort(); } catch (e) {} this.remove(); }
  remove() { return this.root.removeEntry(this.fname).catch(() => {}); }
}
async function newZip(useDisk) {
  if (useDisk) { try { return await DiskZip.create(); } catch (e) { console.warn('OPFS недоступна, ZIP пойдёт через память', e); } }
  return new ZipWriter();
}
// временные файлы удаляем с запасом по времени: браузер может ещё читать их при скачивании
async function cleanStaleTmp(maxAgeMs) {
  if (!OPFS_OK) return;
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      if (!name.startsWith(OPFS_PREFIX)) continue;
      const t = Number(name.slice(OPFS_PREFIX.length).split('-')[0]) || 0;
      if (Date.now() - t > maxAgeMs) await root.removeEntry(name).catch(() => {});
    }
  } catch (e) {}
}

/* ---------- Параллельная обработка: несколько фото в работе одновременно, результаты принимаем строго по порядку ---------- */
const HW = navigator.hardwareConcurrency || 2;
function exportConcurrency(list) {
  if (typeof window.EXPORT_CONC === 'number') return Math.max(1, window.EXPORT_CONC);
  if (list.length < 2) return 1;
  let n = DEV_MEM <= 2 || HW < 4 ? 1 : DEV_MEM <= 4 ? 2 : HW >= 6 ? 3 : 2;
  if (list.some(it => (cfgFor(it).srModel !== 'off' || cfgFor(it).dnModel !== 'off') && cfgFor(it).enhOn)) n = 1;           // нейросеть считает по одному фото: память и один движок
  if (S.format === 'avif' || S.format === 'jxl') n = Math.min(n, DEV_MEM >= 6 ? 2 : 1);   // кодеры тяжёлые по памяти
  let big = 0; list.forEach(it => { const s = computeSize(it.w, it.h, 0, cfgFor(it)); big = Math.max(big, s.cw * s.ch); });
  if (big > MAX_AREA * 0.45) n = 1;          // большие кадры: две копии в памяти не нужны
  return Math.min(n, list.length);
}
async function pooledExport(list, conc, consume) {
  const works = [exWork]; while (works.length < conc) works.push(new Work());
  exPool.splice(0, exPool.length, ...works);
  const free = works.slice(), q = []; let next = 0;
  const produce = async (item, w) => {
    let bmp; try { bmp = await loadBitmap(item); return await exportBlob(item, bmp, undefined, w); } finally { closeBmp(bmp); }
  };
  const fill = () => {
    while (next < list.length && free.length && !cancelFlag) {
      const item = list[next++], w = free.pop();
      q.push({ item, p: produce(item, w).then(r => ({ r }), e => ({ e })).then(x => { free.push(w); return x; }) });
    }
  };
  fill();
  try {
    while (q.length) {
      const { item, p } = q.shift(), res = await p;
      if (await consume(item, res.r, res.e) || cancelFlag) break;
      fill();
    }
  } finally {
    exPool.forEach(w => w.cancel());          // остановить то, что ещё считается, и дождаться
    for (const x of q) await x.p;
    works.slice(1).forEach(w => w.cancel());
    exPool.splice(0, exPool.length, exWork);
  }
}

async function exportToFolder() {
  const list = items.filter(i => !i.skip), total = list.length;
  if (!total) { toast('Отметь хотя бы одно фото', true); return; }
  busy = true; cancelFlag = false; setToolbarBusy(true); exporting = true; $('.layout').classList.add('locked');
  items.forEach(i => { i.status = ''; });
  let ok = 0, unmet = 0, diskFull = false; const failed = [];
  showProgress('Сохранение в папку…');
  try {
    let done = 0;
    await pooledExport(list, exportConcurrency(list), async (item, r, e) => {
      setProgress(done, total, item.name); await yieldUI();
      try {
        if (e) throw e;
        await writeToFolder(r.blob, r.name); ok++; item.status = 'ok'; if (r.fit && !r.fit.met) unmet++;
      } catch (err) {
        if (err && err.name === 'AbortError') return true;
        console.error(err); failed.push(item.name); item.status = 'bad';
        if (err && err.name === 'QuotaExceededError') { diskFull = true; return true; }
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) { failed.push('(нет доступа)'); return true; }
      }
      setProgress(++done, total, item.name);
    });
    const nf = failed.filter(x => !x.startsWith('(')).length, name = dirHandle ? dirHandle.name : '';
    if (cancelFlag) toast(`Отменено. Сохранено файлов: ${ok}`);
    else if (diskFull) toast(`На диске не хватило места. Сохранено файлов: ${ok}`, true);
    else if (failed.includes('(нет доступа)')) toast(`Нет доступа к папке. Сохранено файлов: ${ok}`, true);
    else if (nf) toast(`Готово: ${ok} из ${total} в «${name}». Ошибки: ${nf}`, true);
    else if (unmet) toast(`Готово · ${ok} файлов в «${name}». ${unmet} не уложились в ${S.targetKB} КБ`, true);
    else toast(`Сохранено в «${name}»: ${ok} файлов`);
  } finally {
    busy = false; setToolbarBusy(false); exporting = false; $('.layout').classList.remove('locked');
    renderThumbs(); updateZipLabel(); hideProgress();
  }
}

async function exportAll() {
  if (busy || !items.length) return;
  let useFolder = false;
  try { useFolder = await ensureFolder(); } catch (e) { if (e && e.name !== 'AbortError') console.error(e); return; }
  if (useFolder) return exportToFolder();
  busy = true; cancelFlag = false; setToolbarBusy(true);
  const list = items.filter(i => !i.skip), total = list.length, used = new Set(), failed = [];
  if (!total) { busy = false; setToolbarBusy(false); toast('Отметь хотя бы одно фото для ZIP', true); return; }
  exporting = true; $('.layout').classList.add('locked');
  items.forEach(i => { i.status = ''; });
  const useDisk = S.diskZip && OPFS_OK;
  let zip = await newZip(useDisk), parts = 0, ok = 0, unmet = 0, diskFull = false;
  const flush = async isFinal => {
    const z = zip;
    if (!z.count) { await z.abort(); return; }
    const multi = !isFinal || parts > 0;
    const name = multi ? `aspect-studio_part${++parts}.zip` : `aspect-studio_${ok}-photos.zip`;
    saveBlob(await z.finish(), name);
    if (z.disk) setTimeout(() => z.remove(), 10 * 60 * 1000);   // файл нужен браузеру, пока идёт скачивание
  };
  showProgress('Обработка…');
  try {
    let done = 0;
    await pooledExport(list, exportConcurrency(list), async (item, r, e) => {
      setProgress(done, total, item.name);
      await yieldUI();
      try {
        if (e) throw e;
        let name = r.name, n = 2;
        while (used.has(name)) name = r.name.replace(/(\.[^.]+)$/, `_${n++}$1`);
        used.add(name);
        const data = new Uint8Array(await r.blob.arrayBuffer());
        if (zip.count && zip.offset + data.length > (zip.disk ? ZIP_PART_DISK : ZIP_PART)) {   // часть заполнена — отдаём и освобождаем память
          await flush(false); zip = await newZip(useDisk); await sleep(400);
        }
        await zip.add(name, data); ok++; item.status = 'ok';
        if (r.fit && !r.fit.met) unmet++;
      } catch (err) {
        if (err && err.name === 'AbortError') return true;
        console.error(err); failed.push(item.name); item.status = 'bad';
        if (err && err.name === 'QuotaExceededError') { diskFull = true; return true; }
        if (err instanceof RangeError || /memory|alloc/i.test(String(err && err.message))) { failed.push('(мало памяти)'); return true; }
      }
      setProgress(++done, total, item.name);
    });
    if (cancelFlag) { await zip.abort(); toast(parts ? `Отменено. Уже сохранено частей: ${parts}` : 'Отменено'); }
    else if (diskFull) { await zip.abort(); toast('На устройстве не хватило места для архива. Освободи память и повтори.', true); }
    else if (ok) {
      await yieldUI();
      await flush(true);
      const memFail = failed.includes('(мало памяти)'), nf = failed.filter(x => x !== '(мало памяти)').length;
      if (memFail) toast(`Остановлено: не хватило памяти. Сохранено ${ok} из ${total}. Уменьши увеличение.`, true);
      else if (nf) toast(`Готово: ${ok} из ${total}. Ошибки: ${nf}`, true);
      else if (unmet) toast(`Готово · ${ok} файлов. ${unmet} не уложились в ${S.targetKB} КБ`, true);
      else toast(parts > 1 ? `Готово · ${ok} файлов в ${parts} архивах` : `ZIP готов · ${ok} файлов`);
    } else { await zip.abort(); toast('Не удалось обработать файлы', true); }
  } finally {
    busy = false; setToolbarBusy(false); exporting = false; $('.layout').classList.remove('locked');
    renderThumbs(); updateZipLabel();
    hideProgress();
  }
}

$('#btnDownload').addEventListener('click', downloadCurrent);
$('#btnShare').addEventListener('click', shareCurrent);
$('#btnCopy').addEventListener('click', copyCurrent);
$('#btnZip').addEventListener('click', exportAll);
