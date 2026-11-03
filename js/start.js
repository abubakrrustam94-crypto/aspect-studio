'use strict';
/* Aspect Studio — «Начало работы»: готовые сценарии под задачу. Одно нажатие ставит размер, режим кадра и нужные настройки; дальше остаётся добавить фото. */
const ST_SCENARIOS = [
  { id: 'story', icon: 'camera', name: 'Сторис и Reels', desc: 'Вертикально 9:16, фото целиком, фон — размытая копия.', p: { presetId: 'story', outW: 1080, outH: 1920 }, s: { sizeMode: 'fixed', fit: 'fit', bg: 'blur' } },
  { id: 'feed', icon: 'frame', name: 'Пост в ленту', desc: '4:5 для Instagram: больше места в ленте, без обрезки.', p: { presetId: 'ig45', outW: 1080, outH: 1350 }, s: { sizeMode: 'fixed', fit: 'fit', bg: 'blur' } },
  { id: 'avatar', icon: 'target', name: 'Аватарка', desc: 'Квадрат 640×640, кадр заполняется и смотрит на лицо.', p: { presetId: 'tgava', outW: 640, outH: 640 }, s: { sizeMode: 'fixed', fit: 'fill', autoCenter: true, faceAI: true } },
  { id: 'doc', icon: 'image', name: 'Фото на документы', desc: '35×45 мм, 300 dpi, кадр по лицу. Размеры проверь по требованиям организации.', p: { presetId: 'p35x45', outW: 413, outH: 531 }, s: { sizeMode: 'fixed', fit: 'fill', autoCenter: true, faceAI: true } },
  { id: 'shop', icon: 'package', name: 'Товар для маркетплейса', desc: '3:4 (900×1200), белые поля вокруг товара.', p: { presetId: 'wb', outW: 900, outH: 1200 }, s: { sizeMode: 'fixed', fit: 'fit', bg: 'color', color: '#ffffff' } },
  { id: 'wall', icon: 'frame', name: 'Обои на телефон', desc: 'Под экран iPhone или Android: заполнение без чёрных полос.', p: { presetId: 'android', outW: 1080, outH: 2400 }, s: { sizeMode: 'fixed', fit: 'fill', autoCenter: true } },
  { id: 'print', icon: 'save', name: 'Печать 10×15', desc: '300 dpi, фото целиком, белые поля по краям.', p: { presetId: 'p10x15', outW: 1181, outH: 1772 }, s: { sizeMode: 'fixed', fit: 'fit', bg: 'color', color: '#ffffff' } },
  { id: 'keep', icon: 'sparkles', name: 'Просто привести в порядок', desc: 'Размер не меняется: включаются улучшение, автотон и сжатие JPG.', p: {}, s: { sizeMode: 'auto', enhOn: true, format: 'jpg', quality: 90 } },
];
/* Чистая логика: какие настройки получатся (проверяется тестом) */
function stPlan(sc) { return Object.assign({}, sc.s, sc.p); }
(function () {
  let box = null, lastFocus = null;
  const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt) n.textContent = txt; return n; };
  function apply(sc) {
    histPush('scenario:' + sc.id);
    const it = cur(), plan = stPlan(sc);
    Object.keys(plan).forEach(k => { if (!(k in DEFAULTS) || typeof plan[k] !== typeof DEFAULTS[k]) return; const dst = (it && it.ov && OV_KEYS.includes(k)) ? it.ov : S; dst[k] = plan[k]; });
    save(); syncUI(); renderThumbs(); schedule();
    hide();
    if (!items.length) { toast(`«${sc.name}»: настройки выбраны. Теперь добавь фото`, false, { ms: 6000 }); const f = $('#fileInput'); if (f) setTimeout(() => { try { f.click(); } catch (e) { /* нужен жест пользователя */ } }, 0); }
    else toast(`«${sc.name}»: настройки применены`, false, { action: { label: 'Отменить', fn: () => histUndo() }, ms: 8000 });
  }
  function build() {
    box = el('div', 'modal onb'); box.id = 'startDlg'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'stTitle'); box.hidden = true;
    const card = el('div', 'onb-card st-card'), h = el('h2', '', 'Начало работы'); h.id = 'stTitle';
    const p = el('p', '', 'Выбери, что хочешь сделать. Настройки подберутся сами, потом их можно поправить во вкладках.');
    const list = el('div', 'st-list'); list.id = 'stList';
    ST_SCENARIOS.forEach(sc => {
      const b = el('button', 'st-item'); b.type = 'button'; b.dataset.id = sc.id;
      const ic = el('span', 'st-ic'); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + sc.icon); svg.appendChild(use); ic.appendChild(svg);
      const tx = el('span', 'st-tx'); tx.append(el('b', '', sc.name), el('small', '', sc.desc)); b.append(ic, tx);
      b.addEventListener('click', () => apply(sc)); list.appendChild(b);
    });
    const steps = el('p', 'note st-steps', 'Три шага: добавь фото, выбери размер, скачай результат. Всё считается на твоём устройстве, фото никуда не отправляются.');
    const close = el('button', 'btn btn-outlined', 'Закрыть'); close.type = 'button'; close.id = 'stClose';
    card.append(h, p, list, steps, close); box.appendChild(card); document.body.appendChild(box);
    close.addEventListener('click', hide); box.addEventListener('click', e => { if (e.target === box) hide(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); hide(); }
      else if (e.key === 'Tab') { const f = [...box.querySelectorAll('button')]; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    });
  }
  function hide() { box.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  window.stOpen = function () { if (!box) build(); lastFocus = document.activeElement; box.hidden = false; box.querySelector('.st-item').focus(); };
})();
