'use strict';
/* Aspect Studio — Интерфейс настроек, миниатюры, загрузка файлов */
/* ===================================================================
   UI: настройки
   =================================================================== */
function buildChips() {
  const rc = $('#ratioChips');
  RATIOS.forEach(([w, h]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = `${w}:${h}`; b.dataset.w = w; b.dataset.h = h;
    b.addEventListener('click', () => { const t = tgt(); t.ratioW = w; t.ratioH = h; afterSet(); });
    rc.appendChild(b);
  });
  const pc = $('#presetChips');
  let lastG = null;
  PRESETS.forEach(p => {
    if (p.g !== lastG) { lastG = p.g; const h = document.createElement('div'); h.className = 'chip-title'; h.textContent = p.g; pc.appendChild(h); }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.id = p.id;
    b.innerHTML = `${p.name}<small>${p.w}×${p.h} · ${p.note}</small>`;
    b.addEventListener('click', () => { const t = tgt(); t.presetId = p.id; t.outW = p.w; t.outH = p.h; afterSet(); });
    pc.appendChild(b);
  });
}

function afterSet() { save(); syncUI(); schedule(); }

let exporting = false;
function set(key, val) {
  if (exporting) { toast('Идёт экспорт — настройки пока заблокированы'); return; }
  const it = cur();
  if (typeof DEFAULTS[key] === 'number' && typeof val === 'string') val = Number(val);
  const t = (it && it.ov && OV_KEYS.includes(key)) ? it.ov : S;
  t[key] = val;
  if (key === 'outW' || key === 'outH') t.presetId = null;
  if (key === 'enhLevel' && LEVELS[val]) Object.assign(t, LEVELS[val]);
  if (key === 'sharp' || key === 'denoise') t.enhLevel = 'custom';
  save(); syncUI();
  if (key === 'view' || key === 'fit') applyView();
  if (key === 'view') return;
  schedule();
}

function syncUI() {
  const it0 = cur(), E = cfgFor(it0);
  $$('[data-group]').forEach(g => {
    const v = String(E[g.dataset.group]);
    $$('button[data-val]', g).forEach(b => {
      const on = b.dataset.val === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  });
  $$('input[data-key], select[data-key]').forEach(el => {
    if (el === document.activeElement && el.type !== 'range' && el.type !== 'checkbox') return;
    const v = E[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  $$('[data-out]').forEach(o => { o.textContent = E[o.dataset.out] + (o.dataset.unit || ''); });

  $('#panelAuto').hidden = E.sizeMode !== 'auto';
  $('#panelFixed').hidden = E.sizeMode !== 'fixed';
  $('#alignRow').hidden = E.fit !== 'fit';
  $('#zoomRow').hidden = E.fit !== 'fill';
  $('#recenter').hidden = !(it0 && it0.manual && S.autoCenter);
  renderAnalysis();
  $('#cardMargins').hidden = E.fit === 'fill';
  $('#bgFillNote').hidden = E.fit !== 'fill';
  $$('[data-bgpanel]').forEach(p => { p.hidden = p.dataset.bgpanel !== E.bg; });
  $('#wmFields').hidden = !E.wmOn;
  $('#enhFields').hidden = !E.enhOn;
  $('#qualityRow').classList.toggle('disabled', E.format === 'png');
  $('#quality').disabled = E.format === 'png';
  $('#targetRow').classList.toggle('disabled', E.format === 'png');
  $$('#targetRow input').forEach(x => { x.disabled = E.format === 'png'; });
  $('#targetFields').hidden = !S.targetOn;
  updateNameExample();

  $$('#ratioChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.w === E.ratioW && +c.dataset.h === E.ratioH));
  $$('#presetChips .chip').forEach(c => c.classList.toggle('active', c.dataset.id === E.presetId));
  $$('#swatches .swatch').forEach(s => s.classList.toggle('active', s.dataset.color.toLowerCase() === String(E.color).toLowerCase()));

  syncScope();
  const it = cur();
  if (it) { $('#zoom').value = Math.round(it.zoom * 100); $('#zoomOut').textContent = Math.round(it.zoom * 100) + '%'; }
}

// Кнопки групп (сегменты, чипы, сетка позиций)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-group] > button[data-val]');
  if (!b) return;
  set(b.parentElement.dataset.group, b.dataset.val);
});

// Поля ввода
document.addEventListener('input', e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement) || !el.dataset.key) return;
  const key = el.dataset.key;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.dataset.num !== undefined) {
    v = Number(el.value);
    if (!isFinite(v) || (v <= 0 && el.type !== 'range')) return;
    if (key === 'outW' || key === 'outH') v = Math.min(16384, Math.max(16, Math.round(v)));
  } else v = el.value;
  set(key, v);
});

// Цвета-образцы
$$('#swatches .swatch').forEach(s => s.addEventListener('click', () => set('color', s.dataset.color)));

// Поменять местами
$$('.js-swap').forEach(b => b.addEventListener('click', () => {
  const t = tgt(), E = cfgFor(cur());
  if (E.sizeMode === 'fixed') { [t.outW, t.outH] = [E.outH, E.outW]; t.presetId = null; }
  else [t.ratioW, t.ratioH] = [E.ratioH, E.ratioW];
  afterSet();
}));

// Масштаб / сброс кадра
$('#zoom').addEventListener('input', e => {
  const it = cur(); if (!it) return;
  it.zoom = Number(e.target.value) / 100;
  $('#zoomOut').textContent = e.target.value + '%';
  schedule();
});
$('#resetFocus').addEventListener('click', () => {
  const it = cur(); if (!it) return;
  it.focus = { x: .5, y: .5 }; it.zoom = 1; it.manual = false; syncUI(); schedule();
});

// Логотип водяного знака
$('#wmLogoBtn').addEventListener('click', () => $('#wmLogoInput').click());
$('#wmLogoInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const url = URL.createObjectURL(f);
  try {
    const b = await loadBitmap({ file: f, url });
    closeBmp(wmLogo); wmLogo = b;
    $('#wmLogoName').textContent = f.name;
    $('#wmLogoClear').hidden = false;
    schedule();
  } catch (err) { toast('Не удалось открыть логотип', true); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
});
$('#wmLogoClear').addEventListener('click', () => {
  closeBmp(wmLogo); wmLogo = null;
  $('#wmLogoName').textContent = ''; $('#wmLogoClear').hidden = true; schedule();
});

/* ---------- Миниатюры и «хром» ---------- */
function renderThumbs() {
  thumbsEl.replaceChildren();
  items.forEach((it, i) => {
    const w = document.createElement('div'); w.draggable = true; w.className = 'thumb' + (i === idx ? ' active' : '') + (it.ov ? ' has-ov' : '') + (xformInfo(it).same ? '' : ' has-xf');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb-main';
    b.title = it.name; b.setAttribute('aria-label', `Фото ${i + 1}: ${it.name}`);
    const img = new Image(); img.src = it.thumb; img.alt = ''; b.append(img);
    b.addEventListener('click', () => select(i));
    const x = document.createElement('button'); x.type = 'button'; x.className = 'thumb-x'; x.textContent = '×';
    x.setAttribute('aria-label', `Удалить ${it.name}`);
    x.addEventListener('click', ev => { ev.stopPropagation(); removeItem(i); });
    const sl = document.createElement('button'); sl.type = 'button';
    sl.className = 'thumb-sel' + (it.skip ? ' off' : '') + (it.status ? ' ' + it.status : '');
    sl.textContent = it.status === 'bad' ? '!' : it.skip ? '' : '✓';
    sl.setAttribute('role', 'checkbox'); sl.setAttribute('aria-checked', String(!it.skip));
    sl.setAttribute('aria-label', `Включить в ZIP: ${it.name}`);
    sl.title = it.status === 'bad' ? 'Ошибка при обработке' : it.skip ? 'Не входит в ZIP' : 'Входит в ZIP';
    sl.addEventListener('click', ev => { ev.stopPropagation(); it.skip = !it.skip; it.status = ''; renderThumbs(); updateZipLabel(); });
    if (it.skip) w.classList.add('skip');
    w.append(b, x, sl); thumbsEl.append(w);
  });
  const active = thumbsEl.children[idx];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function updateZipLabel() {
  const n = items.length, k = items.filter(i => !i.skip).length;
  $('#zipLabel').textContent = k === n ? `ZIP · ${n}` : `ZIP · ${k} из ${n}`;
  $('#btnZip').disabled = busy || !k;
  const all = $('#selAll'); if (all) all.textContent = k === n ? 'Снять все' : 'Выбрать все';
}
function updateChrome() {
  const n = items.length, has = n > 0;
  thumbsRow.hidden = !has;
  previewCard.hidden = !has;
  uploadZone.classList.toggle('compact', has);
  toolbar.classList.toggle('show', has);
  document.body.classList.toggle('no-toolbar', !has);
  $('#btnZip').hidden = n < 2;
  updateZipLabel();
  $('#btnShare').hidden = !navigator.share;
  countPill.textContent = n ? `${idx + 1} / ${n}` : '';
  $('#navLabel').textContent = `${idx + 1} / ${n}`;
  $('#prevBtn').disabled = idx <= 0; $('#nextBtn').disabled = idx >= n - 1;
  $('#navGroup').hidden = n < 2;
  $('#orderRow').hidden = !has;
  $('#moveL').hidden = $('#moveR').hidden = $('#sortSel').hidden = n < 2;
  $('#moveL').disabled = idx <= 0; $('#moveR').disabled = idx >= n - 1;
  renderThumbs(); syncUI(); applyView();
  if (!has) { lastDims = null; infoRow.replaceChildren(); }
}

$('#prevBtn').addEventListener('click', () => select(idx - 1));
$('#nextBtn').addEventListener('click', () => select(idx + 1));
$('#clearAll').addEventListener('click', clearAll);
$('#selAll').addEventListener('click', () => { const on = items.some(i => i.skip); items.forEach(i => { i.skip = !on; i.status = ''; }); renderThumbs(); updateZipLabel(); });

/* ---------- Загрузка: клик, drag&drop, вставка ---------- */
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', async e => { const f = Array.from(e.target.files); e.target.value = ''; await addFiles(f); });
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('dragover');
  if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
addEventListener('paste', e => {
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addFiles(files); }
});

/* ---------- Шаблон имени файла: подсказка-пример и кнопки токенов ---------- */
function updateNameExample() {
  const it = cur(), ex = $('#nameExample');
  if (!ex) return;
  const ext = ({ png: 'png', jpg: 'jpg', webp: 'webp' })[S.format] || 'png';
  const sample = it || { name: 'photo.jpg' };
  const w = it ? (cfgFor(it).sizeMode === 'fixed' ? cfgFor(it).outW : it.w) : 1920, h = it ? (cfgFor(it).sizeMode === 'fixed' ? cfgFor(it).outH : it.h) : 1080;
  ex.textContent = 'Пример: ' + makeName(sample, w, h, ext);
}
$$('#nameTokens .chip').forEach(b => b.addEventListener('click', () => {
  const inp = $('#nameRow input'), v = inp.value, a = inp.selectionStart == null ? v.length : inp.selectionStart, z = inp.selectionEnd == null ? v.length : inp.selectionEnd;
  inp.value = v.slice(0, a) + b.dataset.t + v.slice(z);
  const pos = a + b.dataset.t.length; inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) {}
  set('nameTpl', inp.value);
}));
