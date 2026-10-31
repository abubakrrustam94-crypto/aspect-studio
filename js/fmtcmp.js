'use strict';
/* Aspect Studio — «Сравнить форматы»: текущее фото кодируется в каждый формат с текущими настройками качества (или под лимит веса),
   рядом показаны размер и точность (PSNR к исходному кадру), отмечен лучший вариант. Выбор формата — одной кнопкой. */
const fc = { open: false, item: null, bmp: null, seq: 0, rows: [] };
const fcEl = $('#fmtCmp'), fcList = $('#fmtRows'), fcInfo = $('#fmtInfo');
const FC_FORMATS = ['png', 'jpg', 'webp', 'avif', 'jxl'], FC_NAMES = { png: 'PNG', jpg: 'JPG', webp: 'WebP', avif: 'AVIF', jxl: 'JPEG XL' }, FC_SIDE = 512;

function fcPix(src, w, h) {
  const c = mkCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data; c.width = c.height = 0; return d;
}
/* PSNR двух наборов пикселей по RGB, дБ (чем больше, тем ближе к исходному) */
function fcPsnr(a, b) {
  let s = 0, n = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = a[i + k] - b[i + k]; s += d * d; n++; }
  const mse = s / n; return mse < 1e-9 ? Infinity : 10 * Math.log10(255 * 255 / mse);
}
const fcKB = b => b >= 1048576 ? (b / 1048576).toFixed(2).replace('.', ',') + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ';

/* Лучший: среди сжатых форматов с точностью не хуже лучшей на 2 дБ берём самый лёгкий; при лимите веса — только уложившиеся */
function fcBest(rows, transparent) {
  const ok = rows.filter(r => r.blob && r.psnr != null && r.fmt !== 'png' && (!transparent || r.fmt !== 'jpg') && (!S.targetOn || r.met));
  if (!ok.length) return null;
  const top = Math.max(...ok.map(r => r.psnr)); return ok.filter(r => r.psnr >= top - 2).sort((a, b) => a.size - b.size)[0];
}
function fcPaint() {
  const have = fc.rows.filter(r => r.blob), smallest = have.length ? Math.min(...have.map(r => r.size)) : 0;
  const tr = !!(fc.item && cfgFor(fc.item).bg === 'transparent'), best = fcBest(fc.rows, tr);
  fcList.replaceChildren(...fc.rows.map(r => {
    const li = document.createElement('li'); li.className = 'fc-row' + (best === r ? ' best' : '') + (S.format === r.fmt ? ' cur' : '');
    const name = document.createElement('strong'); name.textContent = FC_NAMES[r.fmt];
    const meta = document.createElement('span'); meta.className = 'fc-meta';
    if (r.state === 'wait') meta.textContent = 'ждёт…';
    else if (r.state === 'run') meta.textContent = 'считаю…';
    else if (r.state === 'na') meta.textContent = r.note;
    else if (r.state === 'err') meta.textContent = 'не получилось';
    else {
      const bits = [`<b>${fcKB(r.size)}</b>`];
      if (smallest && r.size > smallest * 1.01) bits.push(`+${Math.round((r.size / smallest - 1) * 100)}%`);
      bits.push(r.fmt === 'png' ? 'без потерь' : `${r.psnr == null ? 'точность не определена' : 'точность ' + r.psnr.toFixed(1) + ' дБ'}${r.q != null ? ` · качество ${Math.round(r.q * 100)}%` : ''}`);
      if (S.targetOn && r.fmt !== 'png') bits.push(r.met ? 'в лимите' : 'не уложился');
      if (r.w && fc.ref && r.w !== fc.ref.w) bits.push(`уменьшено до ${r.w}×${r.h}`);
      if (best === r) bits.push('★ лучший баланс');
      // eslint-disable-next-line no-restricted-syntax -- в bits только числа и статичный текст
      meta.innerHTML = bits.join(' · ');
    }
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + (S.format === r.fmt ? 'btn-tonal' : 'btn-outlined');
    b.textContent = S.format === r.fmt ? 'Выбран' : 'Выбрать'; b.disabled = r.state !== 'ok' || S.format === r.fmt;
    b.addEventListener('click', () => { set('format', r.fmt); fcClose(); toast(`Формат: ${FC_NAMES[r.fmt]}`); });
    const left = document.createElement('div'); left.className = 'fc-left'; left.append(name, meta); li.append(left, b); return li;
  }));
}
async function fcRun() {
  const my = ++fc.seq, item = fc.item, bmp = fc.bmp, cfg = cfgFor(item), lim = S.targetOn ? Math.max(20, S.targetKB) * 1024 : 0;
  fcInfo.textContent = `${item.name} · ${S.targetOn ? `под лимит ${S.targetKB} КБ` : `качество ${S.quality}%`}`;
  fc.rows = FC_FORMATS.map(f => ({ fmt: f, state: 'wait' })); fcPaint();
  busy = true; setToolbarBusy(true); let cv = null, cvOpaque = null;
  try {
    const needOpaque = cfg.bg === 'transparent';
    cv = document.createElement('canvas'); const rr = await render(cv, item, bmp, { opaque: false, p3: wantP3(item) });
    if (needOpaque) { cvOpaque = document.createElement('canvas'); await render(cvOpaque, item, bmp, { opaque: true, p3: wantP3(item) }); }
    const k = Math.min(1, FC_SIDE / Math.max(rr.cw, rr.ch)), sw = Math.max(1, Math.round(rr.cw * k)), sh = Math.max(1, Math.round(rr.ch * k));
    fc.ref = { w: rr.cw, h: rr.ch };
    const refA = fcPix(cv, sw, sh), refB = cvOpaque ? fcPix(cvOpaque, sw, sh) : refA;
    for (const r of fc.rows) {
      if (my !== fc.seq || !fc.open) return;
      r.state = 'run'; fcPaint(); await yieldUI();
      const src = r.fmt === 'jpg' && cvOpaque ? cvOpaque : cv, ref = r.fmt === 'jpg' ? refB : refA;
      try {
        let blob, q = null, met = true, w = rr.cw, h = rr.ch;
        if (lim && r.fmt !== 'png') { const f = await fitToSize(src, r.fmt, S.quality / 100, lim); blob = f.blob; q = f.q; met = f.met; w = f.w; h = f.h; }
        else { blob = await encodeBlob(src, r.fmt, S.quality / 100); if (r.fmt !== 'png') q = S.quality / 100; }
        if (my !== fc.seq || !fc.open) return;
        if (!blob || blob.type !== MIME[r.fmt]) { r.state = 'na'; r.note = ENC_COMP[r.fmt] && !compInstalled(ENC_COMP[r.fmt]) ? 'нужен компонент (вкладка «Компоненты»)' : 'браузер не умеет этот формат'; }
        else {
          let psnr = r.fmt === 'png' ? Infinity : null;
          if (psnr === null) { try { const dec = await createImageBitmap(blob); psnr = fcPsnr(ref, fcPix(dec, sw, sh)); dec.close && dec.close(); } catch (e) { psnr = null; } }      // браузер не декодирует (например JXL): точность не определить
          Object.assign(r, { state: 'ok', blob, size: blob.size, q, met, w, h, psnr });
        }
      } catch (e) { console.warn('fmtcmp', r.fmt, e); r.state = 'err'; }
      fcPaint(); await yieldUI();
    }
  } catch (e) { if (!e || e.name !== 'AbortError') { console.error(e); toast(friendlyError(e), true); } }
  finally { for (const c of [cv, cvOpaque]) if (c) c.width = c.height = 0; busy = false; setToolbarBusy(false); if (my === fc.seq && fc.open) fcPaint(); }
}
async function fcOpen() {
  const item = cur(); if (!item || busy || fc.open) return;
  try { fc.bmp = await getBitmap(item); } catch (e) { toast(friendlyError(e), true); return; }
  Object.assign(fc, { open: true, item, rows: [], ref: null });
  rememberFocus(fcEl); fcEl.classList.add('show'); $('#fmtClose').focus(); fcRun();
}
function fcClose() {
  if (!fc.open) return; fc.open = false; fc.seq++; cancelFlag = true; (typeof exPool !== 'undefined' ? exPool : [exWork]).forEach(w => w.cancel());
  fcEl.classList.remove('show'); restoreFocus(fcEl); fc.rows = []; fc.item = fc.bmp = null; fcList.replaceChildren();
}
$('#fmtCmpBtn').addEventListener('click', fcOpen); $('#fmtClose').addEventListener('click', fcClose); $('#fmtDone').addEventListener('click', fcClose);
addEventListener('keydown', e => { if (e.key === 'Escape' && fc.open) fcClose(); });
