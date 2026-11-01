'use strict';
/* Aspect Studio — удобство интерфейса: сворачиваемые карточки, подсказки на вкладках, индикатор «занято» с отменой,
   разовая подсказка про A/B и закрепление, лёгкий вибро-отклик. Всё необязательное: без этого файла сайт работает. */
(function () {
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } return null; };

  /* ---------- Сворачиваемые карточки настроек ---------- */
  const FOLD = 'aspect-studio-fold';
  let folded = []; try { folded = JSON.parse(LS(FOLD) || '[]'); if (!Array.isArray(folded)) folded = []; } catch (e) { folded = []; }
  const cards = $$('#colSettings > .card[data-tab]').filter(c => c.querySelector('.card-title'));
  const keyOf = c => c.id || c.querySelector('.card-title').textContent.trim();
  const titleOf = c => { const t = c.querySelector('.card-title').cloneNode(true); t.querySelectorAll('button, svg').forEach(n => n.remove()); return t.textContent.trim(); };
  function paintFold(c, b) {
    const f = folded.includes(keyOf(c)); c.classList.toggle('folded', f);
    b.setAttribute('aria-expanded', f ? 'false' : 'true'); b.setAttribute('aria-label', (f ? 'Развернуть: ' : 'Свернуть: ') + titleOf(c));
  }
  cards.forEach(c => {
    const t = c.querySelector('.card-title'), b = document.createElement('button');
    b.type = 'button'; b.className = 'card-fold'; b.innerHTML = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const toggle = () => { const k = keyOf(c), i = folded.indexOf(k); if (i < 0) folded.push(k); else folded.splice(i, 1); LS(FOLD, JSON.stringify(folded)); paintFold(c, b); };
    b.addEventListener('click', toggle);
    t.addEventListener('click', e => { if (!e.target.closest('button')) toggle(); });
    t.append(b); paintFold(c, b);
  });

  /* ---------- Вкладки: затухание по краям и прокрутка к выбранной ---------- */
  const tabs = $('#settingsTabs');
  function tabsFade() {
    const max = tabs.scrollWidth - tabs.clientWidth, x = tabs.scrollLeft;
    tabs.classList.toggle('fade-l', max > 4 && x > 4); tabs.classList.toggle('fade-r', max > 4 && x < max - 4);
  }
  tabs.addEventListener('scroll', tabsFade, { passive: true }); window.addEventListener('resize', tabsFade); tabsFade();
  tabs.addEventListener('click', e => { const b = e.target.closest('[role="tab"]'); if (b) requestAnimationFrame(() => { try { b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (x) { /* старый браузер */ } }); });

  /* ---------- Индикатор «занято» с отменой (нейросети без процентов) ---------- */
  const bus = $('#busy'), busText = $('#busyText'), busCancel = $('#busyCancel');
  let cur = null, tick = 0;
  function render() { if (cur) busText.textContent = cur.label + (cur.sec > 2 ? ' · ' + cur.sec + ' с' : ''); }
  window.busy = function (label, onCancel) {
    const h = { label, sec: 0, onCancel, text(t) { h.label = t; if (cur === h) render(); }, done() { if (cur === h) { clearInterval(tick); cur = null; bus.hidden = true; document.body.classList.remove('busy-on'); } } };
    if (cur) cur.done();
    cur = h; busCancel.hidden = !onCancel; bus.hidden = false; document.body.classList.add('busy-on'); render();
    tick = setInterval(() => { h.sec++; render(); }, 1000);
    return h;
  };
  busCancel.addEventListener('click', () => { const h = cur; if (!h) return; h.done(); try { if (h.onCancel) h.onCancel(); } catch (e) { console.warn(e); } });

  /* ---------- Разовая подсказка про A/B и закрепление ---------- */
  const hint = $('#uiHint'), HK = 'aspect-studio-ui-hint';
  if (hint) {
    new MutationObserver(() => { if (!LS(HK) && !previewCard.hidden) hint.hidden = false; }).observe(previewCard, { attributes: true, attributeFilter: ['hidden'] });
    $('#uiHintOk').addEventListener('click', () => { hint.hidden = true; LS(HK, '1'); });
  }

  /* ---------- Кнопка «Добавить» в карточке с фото ---------- */
  const add = $('#addMoreBtn'); if (add) add.addEventListener('click', () => $('#fileInput').click());

  /* ---------- Вибро-отклик ---------- */
  const BUZZ = '#resetPhoto, #toneAuto, #toneReset, #tiltAuto, #tiltReset, #clearAll, #abKeep, .tb-btn.primary';
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('click', e => { if (!calm && navigator.vibrate && e.target.closest(BUZZ)) { try { navigator.vibrate(12); } catch (x) { /* не поддерживается */ } } }, true);
})();
