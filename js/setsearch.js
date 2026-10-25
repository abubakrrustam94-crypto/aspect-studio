'use strict';
/* Aspect Studio — поиск по настройкам и закреплённые карточки («Избранное») */
(function () {
  const col = $('#colSettings'), box = $('#setSearch'), clr = $('#setSearchClear'), none = $('#setNone'), tabFav = $('#tabFav'), PIN = 'aspect-studio-pins';
  const cards = $$('#colSettings > .card[data-tab]').filter(c => c.querySelector('.card-title'));
  const keyOf = c => c.id || c.querySelector('.card-title').textContent.trim();
  let pins = []; try { pins = JSON.parse(localStorage.getItem(PIN) || '[]'); if (!Array.isArray(pins)) pins = []; } catch (e) { pins = []; }
  const save = () => { try { localStorage.setItem(PIN, JSON.stringify(pins)); } catch (e) {} };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
  /* Текст карточки без скрытых частей, плюс подписи кнопок и подсказки */
  function textOf(c) {
    const cl = c.cloneNode(true); cl.querySelectorAll('[hidden], script, style, .pin-btn').forEach(n => n.remove());
    const extra = [...cl.querySelectorAll('[aria-label], [title]')].map(n => (n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('title') || '')).join(' ');
    return norm(cl.textContent + ' ' + extra);
  }
  function paint() {
    cards.forEach(c => { const p = pins.includes(keyOf(c)); c.classList.toggle('pinned', p); const b = c.querySelector('.pin-btn'); if (b) { b.setAttribute('aria-pressed', p); b.title = p ? 'Убрать из «Избранного»' : 'Закрепить в «Избранном»'; b.setAttribute('aria-label', b.title); } });
    const n = cards.filter(c => c.classList.contains('pinned')).length;
    tabFav.hidden = !n;
    if (!n && col.dataset.tab === 'fav') window.setSettingsTab('frame');
  }
  cards.forEach(c => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pin-btn';
    b.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-star"/></svg>';
    b.addEventListener('click', () => { const k = keyOf(c), i = pins.indexOf(k); if (i < 0) pins.push(k); else pins.splice(i, 1); save(); paint(); });
    c.querySelector('.card-title').append(b);
  });
  function run() {
    const q = norm(box.value).trim(), words = q.split(/\s+/).filter(Boolean);
    clr.hidden = !q; col.classList.toggle('searching', !!q);
    let n = 0;
    cards.forEach(c => { const m = !!q && words.every(w => textOf(c).includes(w)); c.classList.toggle('match', m); if (m) n++; });
    none.hidden = !q || n > 0; none.textContent = q && !n ? `Ничего не нашлось по запросу «${box.value.trim()}». Попробуй другое слово.` : '';
  }
  box.addEventListener('input', run);
  box.addEventListener('keydown', e => { if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; run(); } });
  clr.addEventListener('click', () => { box.value = ''; run(); box.focus(); });
  $$('#settingsTabs [role="tab"]').forEach(b => b.addEventListener('click', () => { if (box.value) { box.value = ''; run(); } }));
  paint(); run();
  window.setPins = v => { pins = v; save(); paint(); };
})();
