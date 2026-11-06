'use strict';
/* Aspect Studio — подсказки на старте (грузится лениво, через пару секунд после загрузки):
   1) примеры «было → стало» на пустом экране (нажатие выбирает сценарий);
   2) кнопка «Оригинал» на превью: пока держишь — виден оригинал;
   3) индикатор «работает без интернета» в «О программе» и сообщения при потере сети. */
(function () {
  const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища */ } } };

  /* стили — конструируемая таблица, чтобы не раздувать стартовый css */
  try {
    const sh = new CSSStyleSheet();
    sh.replaceSync(`
.ex-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 0 0; }
.ex-row[hidden] { display: none; }
.ex-title { grid-column: 1 / -1; font-size: .78rem; font-weight: 600; color: var(--md-sys-color-on-surface-variant); text-align: center; }
.ex-tile { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 6px 10px; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 16px; background: var(--md-sys-color-surface-container-low, transparent); color: inherit; font: inherit; cursor: pointer; min-width: 0; }
.ex-tile:hover, .ex-tile:focus-visible { border-color: var(--md-sys-color-primary); }
.ex-pair { display: flex; align-items: center; justify-content: center; gap: 3px; height: 54px; min-width: 0; max-width: 100%; overflow: hidden; }
.ex-pair canvas { display: block; flex: none; max-width: none; border-radius: 6px; box-shadow: 0 0 0 1px var(--md-sys-color-outline-variant); }
.ex-pair i { font-style: normal; font-size: .8rem; color: var(--md-sys-color-on-surface-variant); }
.ex-tile b { font-size: .78rem; line-height: 1.2; }
.ex-tile small { font-size: .7rem; color: var(--md-sys-color-on-surface-variant); line-height: 1.2; }
.hold-cmp { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.hold-cmp.on { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
.off-chip { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 10px 12px; border-radius: 14px; font-size: .85rem; background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }
.off-chip.warn { background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
@media (min-width: 600px) { .ex-pair { gap: 8px; } }
@media (prefers-reduced-motion: no-preference) { .ex-tile { transition: border-color .2s; } }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sh];
  } catch (e) { /* старый браузер: примеры не показываем */ window.__hintsNoCss = true; }

  /* ---------- 1. Примеры ---------- */
  function scene(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#6aa8e8'); g.addColorStop(.62, '#f6c58a'); g.addColorStop(1, '#e98f6b');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff6c9'; x.beginPath(); x.arc(w * .68, h * .36, h * .13, 0, 7); x.fill();
    x.fillStyle = '#4b6a52'; x.beginPath(); x.moveTo(0, h); x.lineTo(0, h * .72); x.quadraticCurveTo(w * .3, h * .5, w * .55, h * .74); x.quadraticCurveTo(w * .8, h * .56, w, h * .7); x.lineTo(w, h); x.fill();
    x.fillStyle = '#2f4a3a'; x.beginPath(); x.moveTo(0, h); x.lineTo(0, h * .86); x.quadraticCurveTo(w * .4, h * .7, w, h * .9); x.lineTo(w, h); x.fill();
    return c;
  }
  const SRC = scene(160, 120);
  function result(w, h, mode) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const k = Math.min(w / SRC.width, h / SRC.height), pw = SRC.width * k, ph = SRC.height * k;
    if (mode === 'blur') {
      const cv = Math.max(w / SRC.width, h / SRC.height);
      try { x.filter = 'blur(5px)'; } catch (e) { /* без размытия */ }
      x.drawImage(SRC, (w - SRC.width * cv) / 2, (h - SRC.height * cv) / 2, SRC.width * cv, SRC.height * cv);
      try { x.filter = 'none'; } catch (e) { /* ok */ }
    } else { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    x.drawImage(SRC, (w - pw) / 2, (h - ph) / 2, pw, ph);
    return c;
  }
  const EX = [
    { id: 'story', t: 'Сторис', s: '9:16, без обрезки', w: 28, h: 50, mode: 'blur' },
    { id: 'shop', t: 'Маркетплейс', s: '3:4, белые поля', w: 38, h: 50, mode: 'white' },
    { id: 'feed', t: 'Пост 4:5', s: 'без обрезки', w: 40, h: 50, mode: 'blur' },
  ];
  function buildExamples() {
    if (window.__hintsNoCss || document.getElementById('exRow')) return;
    const host = $('#pasteRow'); if (!host) return;
    const row = el('div', 'ex-row'); row.id = 'exRow';
    row.appendChild(el('div', 'ex-title', 'Так это выглядит: нажми на пример'));
    EX.forEach(e => {
      const b = el('button', 'ex-tile'); b.type = 'button'; b.setAttribute('aria-label', `${e.t}: ${e.s}. Выбрать этот сценарий`);
      const pair = el('div', 'ex-pair'); pair.setAttribute('aria-hidden', 'true');
      const a = scene(160, 120); a.style.width = '26px'; a.style.height = '20px';
      const r = result(e.w * 2, e.h * 2, e.mode); r.style.width = e.w + 'px'; r.style.height = e.h + 'px';
      pair.append(a, el('i', '', '→'), r);
      b.append(pair, el('b', '', e.t), el('small', '', e.s));
      b.addEventListener('click', async () => { if (await lazyOk('start')) window.stApply(e.id); });
      row.appendChild(b);
    });
    host.after(row);
    const pc = $('#previewCard');
    const sync = () => { row.hidden = !pc.hidden || (typeof items !== 'undefined' && items.length > 0); };
    new MutationObserver(sync).observe(pc, { attributes: true, attributeFilter: ['hidden'] }); sync();
  }

  /* ---------- 2. «Оригинал» по удержанию ---------- */
  function buildHold() {
    const g = $('#abBtn'); if (!g || document.getElementById('holdCmp')) return;
    const b = el('button', 'btn btn-tonal btn-sm hold-cmp', 'Оригинал'); b.type = 'button'; b.id = 'holdCmp';
    b.title = 'Удерживай, чтобы увидеть оригинал'; b.setAttribute('aria-label', 'Удерживай, чтобы увидеть оригинал. С клавиатуры: Пробел или Enter включают и выключают');
    let saved = null;
    const on = () => { if (saved !== null) return; saved = S.view; S.view = 'before'; b.classList.add('on'); applyView(); };
    const off = () => { if (saved === null) return; S.view = saved; saved = null; b.classList.remove('on'); applyView(); };
    b.addEventListener('pointerdown', e => { if (e.button > 0) return; try { b.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } on(); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, off));
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); saved === null ? on() : off(); } });
    b.addEventListener('blur', off);
    g.before(b);
  }

  /* ---------- 3. Работа без интернета ---------- */
  async function offlineReady() {
    if (!('caches' in window) || !navigator.serviceWorker || !navigator.serviceWorker.controller) return false;
    try {
      const keys = (await caches.keys()).filter(k => /^aspect-studio-v\d+/.test(k)); if (!keys.length) return false;
      const c = await caches.open(keys.sort().pop());
      const need = ['./index.html', './js/core.js', './js/ocr.js', './js/changelog-data.js'];
      return (await Promise.all(need.map(u => c.match(u)))).every(Boolean);
    } catch (e) { return false; }
  }
  async function buildOffline() {
    const host = $('#cardAbout .note'); if (!host) return;
    let chip = document.getElementById('offChip'); if (!chip) { chip = el('div', 'off-chip'); chip.id = 'offChip'; chip.setAttribute('role', 'status'); host.after(chip); }
    const draw = async () => {
      const ok = await offlineReady();
      chip.classList.toggle('warn', !ok);
      chip.textContent = ok ? 'Сайт скачан: работает без интернета. Нужны только нейросети, которые ты ещё не ставил в «Компонентах».'
        : (navigator.serviceWorker && navigator.serviceWorker.controller ? 'Файлы ещё докачиваются. Подожди минуту и открой вкладку снова.' : 'Офлайн-режим включится после первой полной загрузки по https (на «Установить» или обычном посещении).');
      return ok;
    };
    if (await draw() && ls.get('aspect-studio-offline-ok') !== '1') { ls.set('aspect-studio-offline-ok', '1'); toast('Готово: сайт работает без интернета', false, { ms: 5000 }); }
    addEventListener('offline', async () => { draw(); toast((await offlineReady()) ? 'Нет сети. Всё нужное скачано, можно работать' : 'Нет сети. Часть функций может не открыться', false, { ms: 5000 }); });
    addEventListener('online', () => { draw(); });
    $('#settingsTabs').addEventListener('click', e => { if (e.target.closest('[data-tab="about"]')) draw(); });
  }

  /* ---------- 4. «Сохранить как набор» во вкладке «Экспорт» ---------- */
  function buildPresetShortcut() {
    const cards = document.querySelectorAll('.card[data-tab="export"]'), last = cards[cards.length - 1];
    if (!last || document.getElementById('presetShortcut')) return;
    const row = el('div', 'row'); row.style.marginTop = '12px';
    const b = el('button', 'btn btn-tonal btn-sm', '★ Сохранить настройки как набор'); b.type = 'button'; b.id = 'presetShortcut';
    b.addEventListener('click', () => {
      if (window.setSettingsTab) window.setSettingsTab('extra');
      const c = document.getElementById('cardPresets'), i = document.getElementById('presetName');
      if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (i) setTimeout(() => i.focus({ preventScroll: true }), 250);
      toast('Назови набор и нажми «Сохранить»', false, { ms: 4000 });
    });
    row.appendChild(b); last.appendChild(row);
  }

  /* ---------- 5. «Как это работает и безопасно ли» ---------- */
  const HOW = [
    ['Фото не уходят на сервер', 'Всё считает твой браузер. У сайта нет сервера, куда можно что-то загрузить: адреса, куда страница вообще может обращаться, ограничены защитой самой страницы (CSP) и ведут только на этот же сайт.'],
    ['Что скачивается', 'Только сам сайт и, если ты сам нажал «Установить» в «Компонентах», файлы нейросетей. Они лежат на том же сайте, а не на чужих серверах. Без этого работают размер, фон, водяной знак, экспорт.'],
    ['Что хранится на устройстве', 'Настройки, твои наборы и (если включишь) прошлая сессия. Хранится в самом браузере. «Забыть» в баннере сессии и «Сбросить все настройки» в «О программе» стирают это.'],
    ['Как проверить самому', 'Загрузи страницу, выключи интернет (авиарежим) и обработай фото: всё продолжит работать. Либо открой вкладку «Сеть» в инструментах браузера: во время обработки там нет запросов. Исходный код открыт на GitHub.'],
  ];
  let howBox = null, howOpener = null;
  function howClose() { if (!howBox) return; howBox.hidden = true; if (howOpener && howOpener.focus) howOpener.focus(); }
  function howOpen() {
    howOpener = document.activeElement;
    if (!howBox) {
      howBox = el('div', 'modal onb'); howBox.id = 'howDlg'; howBox.setAttribute('role', 'dialog'); howBox.setAttribute('aria-modal', 'true'); howBox.setAttribute('aria-labelledby', 'howTitle');
      const card = el('div', 'onb-card'); card.style.cssText = 'text-align:left;max-height:86vh;max-height:86dvh;display:flex;flex-direction:column;width:min(100%,460px)';
      const h = el('h2', '', 'Как это работает'); h.id = 'howTitle'; h.style.textAlign = 'center';
      const list = el('div', 'how-list'); list.tabIndex = 0; list.style.cssText = 'overflow:auto;min-height:0;flex:1 1 auto';
      HOW.forEach(([t, d]) => { const b = el('div', 'how-item'); b.style.margin = '0 0 14px'; const tt = el('b', '', t); tt.style.display = 'block'; const dd = el('p', '', d); dd.style.margin = '4px 0 0'; b.append(tt, dd); list.appendChild(b); });
      const act = el('div', 'onb-actions'); const ok = el('button', 'btn btn-main', 'Понятно'); ok.type = 'button'; act.appendChild(ok);
      card.append(h, list, act); howBox.appendChild(card); document.body.appendChild(howBox);
      ok.addEventListener('click', howClose);
      howBox.addEventListener('click', e => { if (e.target === howBox) howClose(); });
      howBox.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); howClose(); } });
    }
    howBox.hidden = false; howBox.querySelector('button').focus();
  }
  function buildHow() {
    if (document.getElementById('howBtn')) return;
    const row = document.querySelector('#cardAbout .row'); if (row) { const b = el('button', 'btn btn-outlined btn-sm', 'Как это работает'); b.type = 'button'; b.id = 'howBtn'; b.addEventListener('click', howOpen); row.insertBefore(b, row.children[1] || null); }
    const ex = document.getElementById('exRow');
    if (ex) { const a = el('button', 'btn btn-outlined btn-sm', 'Фото не уходят на сервер. Как это работает?'); a.type = 'button'; a.id = 'howLink'; a.style.cssText = 'grid-column:1/-1;justify-self:center'; a.addEventListener('click', howOpen); ex.appendChild(a); }
  }

  /* ---------- 7. Счётчик, «Сообщить о проблеме», переход со страниц-сценариев ---------- */
  const REPO = 'https://github.com/abubakrrustam94-crypto/aspect-studio';
  function buildAboutExtras() {
    const host = document.querySelector('#cardAbout .about-line'); if (!host || document.getElementById('cntLine')) return;
    const cnt = el('p', 'note'); cnt.id = 'cntLine'; cnt.style.marginTop = '4px';
    const draw = () => { const n = +ls.get('aspect-studio-count') || 0; cnt.textContent = n ? `Сохранено на этом устройстве: ${n} фото. Счёт хранится только в браузере.` : ''; cnt.hidden = !n; };
    draw(); host.after(cnt);
    const tabs = document.getElementById('settingsTabs'); if (tabs) tabs.addEventListener('click', e => { if (e.target.closest('[data-tab="about"]')) draw(); });
    const row = document.querySelector('#cardAbout .row');
    if (row && !document.getElementById('reportBtn')) {
      const b = el('button', 'btn btn-outlined btn-sm', 'Сообщить о проблеме'); b.type = 'button'; b.id = 'reportBtn';
      b.addEventListener('click', () => {
        let log = ''; try { log = typeof errLogText === 'function' ? errLogText() : ''; } catch (e) { /* без журнала */ }
        const body = `**Что случилось** (опиши своими словами; фото прикладывать не нужно)\n\n\n**Что ожидал(а)**\n\n\n---\nСлужебные сведения (без фото и имён файлов):\n\`\`\`\n${String(log).slice(0, 2200)}\n\`\`\`\n`;
        const url = `${REPO}/issues/new?title=${encodeURIComponent('Проблема: ')}&body=${encodeURIComponent(body)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      row.appendChild(b);
    }
  }
  /* страницы-сценарии (?scenario=stories) ведут сюда: сразу выбираем нужный размер */
  async function takeScenario() {
    const id = new URLSearchParams(location.search).get('scenario'); if (!id) return;
    const MAP = { stories: 'story', feed: 'feed', marketplace: 'shop', youtube: 'thumb', pinterest: 'pin', avatar: 'avatar', print: 'print', vk: 'vk' };
    const sc = MAP[id]; try { history.replaceState(null, '', location.pathname); } catch (e) { /* ok */ }
    if (sc && await lazyOk('start')) { window.stApply(sc); toast('Размер выбран. Добавь фото', false, { ms: 4000 }); }
  }

  buildExamples(); buildHold(); buildOffline(); buildPresetShortcut(); buildHow(); buildAboutExtras(); takeScenario();
})();
