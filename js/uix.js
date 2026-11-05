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
  let bzCur = null, tick = 0;
  function render() { if (bzCur) busText.textContent = bzCur.label + (bzCur.sec > 2 ? ' · ' + bzCur.sec + ' с' : ''); }
  window.busy = function (label, onCancel) {
    const h = { label, sec: 0, onCancel, text(t) { h.label = t; if (bzCur === h) render(); }, done() { if (bzCur === h) { clearInterval(tick); bzCur = null; bus.hidden = true; document.body.classList.remove('busy-on'); } } };
    if (bzCur) bzCur.done();
    bzCur = h; busCancel.hidden = !onCancel; bus.hidden = false; document.body.classList.add('busy-on'); render();
    tick = setInterval(() => { h.sec++; render(); }, 1000);
    return h;
  };
  busCancel.addEventListener('click', () => { const h = bzCur; if (!h) return; h.done(); try { if (h.onCancel) h.onCancel(); } catch (e) { console.warn(e); } });

  /* ---------- Разовая подсказка про A/B и закрепление ---------- */
  const hint = $('#uiHint'), HK = 'aspect-studio-ui-hint';
  if (hint) {
    new MutationObserver(() => { if (!LS(HK) && !previewCard.hidden) hint.hidden = false; }).observe(previewCard, { attributes: true, attributeFilter: ['hidden'] });
    $('#uiHintOk').addEventListener('click', () => { hint.hidden = true; LS(HK, '1'); });
  }

  /* ---------- Кнопка «Добавить» в карточке с фото ---------- */
  const add = $('#addMoreBtn'); if (add) add.addEventListener('click', () => $('#fileInput').click());

  /* ---------- Текст на фото: модуль ocr.js подгружается при первом нажатии ---------- */
  const ocrBtn = $('#ocrBtn');
  if (ocrBtn) {
    let ocrLoaded = false;
    window.ocrSync = () => { ocrBtn.disabled = !cur() || exporting; };           // до загрузки модуля: кнопка активна, когда есть фото
    ocrBtn.addEventListener('click', async e => {
      if (ocrLoaded) return;
      e.stopImmediatePropagation(); ocrBtn.disabled = true;
      try { await lazyLoad('ocr'); ocrLoaded = true; } catch (x) { toast(x.message, true); window.ocrSync(); return; }
      window.ocrSync(); ocrBtn.click();                                             // теперь у кнопки есть настоящий обработчик
    }, true);
  }

  /* ---------- Проверка скорости (модуль speed.js грузится по кнопке) ---------- */
  const sp = $('#speedBtn');
  if (sp) sp.addEventListener('click', async () => {
    const out = $('#speedOut'); out.hidden = false; out.textContent = 'Измеряю…'; sp.disabled = true;
    try { await lazyLoad('speed'); out.replaceChildren(...(await window.speedRun())); }
    catch (e) { out.textContent = 'Не удалось измерить: ' + e.message; }
    finally { sp.disabled = false; }
  });

  /* ---------- Вибро-отклик ---------- */
  const BUZZ = '#resetPhoto, #toneAuto, #toneReset, #tiltAuto, #tiltReset, #clearAll, #abKeep, .tb-btn.primary';
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('click', e => { if (!calm && navigator.vibrate && e.target.closest(BUZZ)) { try { navigator.vibrate(12); } catch (x) { /* не поддерживается */ } } }, true);
})();

/* ---------- Язык, размер текста, контраст, анимация, режим слабого телефона, «Начало работы» ---------- */
(function () {
  const root = document.documentElement;
  let lastLang = 'ru';
  function applyUiPrefs() {
    root.style.fontSize = S.uiScale && S.uiScale !== 100 ? S.uiScale + '%' : '';
    root.dataset.contrast = S.uiContrast ? 'high' : '';
    root.dataset.motion = S.uiMotion ? 'reduce' : '';
    const why = liteReason(), note = $('#cardLiteNote');
    if (note) { note.hidden = !why; const w = $('#liteWhy'); if (w) w.textContent = why ? 'Причина: ' + why + '.' : ''; }
    const li = $('#liteInfo'); if (li) li.textContent = why ? 'Сейчас режим включён: ' + why + '.' : 'Сейчас режим выключен: все функции доступны.';
    if (S.lang !== lastLang) { lastLang = S.lang; langApply(); }
  }
  async function langApply() {
    root.lang = S.lang === 'en' ? 'en' : 'ru';
    if (S.lang === 'en') { if (await lazyOk('i18n')) window.i18nSet(true); }
    else if (window.i18nSet) window.i18nSet(false);
  }
  window.applyUiPrefs = applyUiPrefs;
  if (S.lang === 'en') { lastLang = 'ru'; }
  applyUiPrefs();
  try { if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { if (e.quota && e.quota - (e.usage || 0) < 300 * 1048576) { liteSpace = true; applyUiPrefs(); } }).catch(() => { /* нет данных */ }); } catch (e) { /* нет API */ }
  const sb = $('#startBtn'); if (sb) sb.addEventListener('click', async () => { if (await lazyOk('start')) window.stOpen(); });
})();

/* ===== v2.52: меню «⋯», панель действий в карточке превью на компьютере, размер файла на кнопке «Скачать» ===== */
(function () {
  const more = $('#moreMenu');
  if (more) {
    document.addEventListener('click', e => { if (more.open && !more.contains(e.target)) more.open = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && more.open) { more.open = false; const s = more.querySelector('summary'); if (s) s.focus(); } });
    more.addEventListener('toggle', () => {                                       // окошко не должно вылезать за край экрана
      const pop = more.querySelector('.more-pop'); if (!more.open) return;
      if (matchMedia('(max-width: 759px)').matches) { pop.style.left = ''; pop.style.right = ''; return; }   // на телефоне меню само занимает ширину ряда
      pop.style.left = '0px'; pop.style.right = 'auto'; const r = pop.getBoundingClientRect();
      pop.style.left = Math.min(0, document.documentElement.clientWidth - 8 - r.right) + 'px';
    });
    more.addEventListener('change', () => { more.open = false; });                // выбрал сортировку: меню закрывается
    const rb = $('#resetPhoto'); if (rb) rb.addEventListener('click', () => { more.open = false; });
  }
  /* На компьютере панель «Скачать / ZIP / Поделиться» лежит под превью и ничего не закрывает; на телефоне плавает внизу экрана */
  const mq = window.matchMedia('(min-width: 760px)');
  const place = () => { if (mq.matches) { if (toolbar.parentNode !== previewCard) previewCard.appendChild(toolbar); } else if (toolbar.parentNode !== document.body) document.body.appendChild(toolbar); };
  place(); if (mq.addEventListener) mq.addEventListener('change', place);
  /* Вес файла из плашки «Вес …» дублируем на кнопке: решение «скачать» принимают, глядя на неё */
  const tb = $('#tbSize');
  if (tb && infoRow) {
    const sync = () => {
      const p = infoRow.querySelector('.info-weight'), m = p && /^Вес\s+(.*?)(?:\s·.*)?$/.exec(p.textContent.trim());
      const v = m && /\d/.test(m[1]) && !/…/.test(m[1]) ? m[1] : '';
      tb.textContent = v ? '· ' + v : ''; tb.hidden = !v;
    };
    new MutationObserver(sync).observe(infoRow, { childList: true, subtree: true, characterData: true }); sync();
  }
})();

/* ===== v2.54: подсказки на старте подгружаются лениво (js/hints.js) ===== */
addEventListener('load', () => setTimeout(() => lazyLoad('hints').catch(() => {}), 1500));
