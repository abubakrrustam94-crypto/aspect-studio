'use strict';
/* Aspect Studio — «Перенести настройки на другие фото»: окно с выбором, какие группы настроек копировать. Грузится при первом нажатии. */
const CS_GROUPS = [
  { id: 'frame', name: 'Формат и размер кадра', keys: ['sizeMode', 'ratioW', 'ratioH', 'outW', 'outH', 'presetId', 'fit', 'align'] },
  { id: 'bg', name: 'Фон и поля', keys: ['bg', 'color', 'blur', 'dim', 'grad1', 'grad2', 'gradAngle'] },
  { id: 'cut', name: 'Удаление фона', keys: ['cutOn', 'cutBg', 'cutColor', 'cutEdge', 'cutQuality'] },
  { id: 'tone', name: 'Тон и цвет', keys: ['toneExp', 'toneCon', 'toneSat', 'toneWarm', 'toneGrain', 'toneStyle'] },
  { id: 'retouch', name: 'Умная ретушь', keys: ['retouchOn', 'retouchStyle', 'retouchAmt'] },
  { id: 'low', name: 'Ночной свет', keys: ['lowOn', 'lowAmt'] },
  { id: 'depth', name: 'Размытие по глубине', keys: ['depthOn', 'depthBlur'] },
  { id: 'qual', name: 'Улучшение, шум, увеличение', keys: ['enhOn', 'enhScale', 'enhLevel', 'sharp', 'denoise', 'dnModel', 'dnLevel', 'smart', 'srModel'] },
];
/* Чистая логика: что получится у целевого фото. Возвращает новый ov. */
function csMerge(targetOv, src, groups) {
  const out = targetOv ? { ...targetOv } : {}; if (!targetOv) OV_KEYS.forEach(k => { out[k] = S[k]; });
  CS_GROUPS.forEach(g => { if (groups.includes(g.id)) g.keys.forEach(k => { if (OV_KEYS.includes(k)) out[k] = src[k]; }); });
  return out;
}
(function () {
  let box = null, onApply = null, lastFocus = null;
  function build() {
    box = document.createElement('div'); box.className = 'modal onb'; box.id = 'copyset'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'csTitle'); box.hidden = true;
    const card = document.createElement('div'); card.className = 'onb-card'; card.style.cssText = 'text-align:left;max-height:88dvh;display:flex;flex-direction:column;width:min(100%,440px)';
    const h = document.createElement('h2'); h.id = 'csTitle'; h.textContent = 'Перенести настройки'; h.style.textAlign = 'center';
    const info = document.createElement('p'); info.id = 'csInfo'; info.style.marginBottom = '10px';
    const list = document.createElement('div'); list.id = 'csList'; list.style.cssText = 'overflow:auto;min-height:0;flex:1 1 auto;display:grid;gap:4px';
    CS_GROUPS.forEach(g => {
      const l = document.createElement('label'); l.className = 'switch'; l.style.margin = '0';
      const i = document.createElement('input'); i.type = 'checkbox'; i.dataset.g = g.id; i.checked = true;
      const t = document.createElement('span'); t.className = 'track'; const n = document.createElement('span'); n.textContent = g.name;
      l.append(i, t, n); list.appendChild(l);
    });
    const tg = document.createElement('div'); tg.className = 'seg'; tg.id = 'csTarget'; tg.setAttribute('role', 'group'); tg.setAttribute('aria-label', 'Кому перенести'); tg.style.margin = '12px 0 0';
    [['sel', 'Отмеченным ✓'], ['all', 'Всем остальным']].forEach(([v, name]) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = name; b.setAttribute('aria-pressed', 'false'); tg.appendChild(b); });
    const act = document.createElement('div'); act.className = 'onb-actions'; act.style.cssText = 'display:flex;gap:8px;margin-top:14px';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn btn-main'; ok.id = 'csOk'; ok.textContent = 'Перенести';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn-outlined'; no.id = 'csNo'; no.textContent = 'Отмена';
    act.append(ok, no); card.append(h, info, list, tg, act); box.appendChild(card); document.body.appendChild(box);
    tg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setTarget(b.dataset.v); refresh(); } });
    list.addEventListener('change', refresh);
    no.addEventListener('click', close); box.addEventListener('click', e => { if (e.target === box) close(); });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    ok.addEventListener('click', () => { const groups = $$('#csList input:checked').map(i => i.dataset.g), tgt = targets(); close(); if (onApply) onApply(groups, tgt); });
  }
  let mode = 'sel';
  function setTarget(v) { mode = v; $$('#csTarget button').forEach(b => { const on = b.dataset.v === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
  function targets() { const src = cur(); return items.filter(i => i !== src && (mode === 'all' || !i.skip)); }
  function refresh() {
    const n = targets().length, g = $$('#csList input:checked').length;
    $('#csInfo').textContent = n ? `Настройки этого фото получат ещё ${n} фото. Выбери, что переносить.` : (mode === 'sel' ? 'Нет отмеченных ✓ фото. Отметь миниатюры галочкой или выбери «Всем остальным».' : 'Других фото нет.');
    $('#csOk').disabled = !n || !g;
  }
  function close() { box.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  window.csOpen = function (apply) {
    if (!box) build(); onApply = apply; lastFocus = document.activeElement; setTarget('sel'); refresh(); box.hidden = false; $('#csOk').focus();
  };
})();
