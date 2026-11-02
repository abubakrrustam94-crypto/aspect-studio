'use strict';
/* Aspect Studio — «Как это будет выглядеть»: готовый кадр показан так, как его увидят в телефоне, сторис, аватарке, ленте и карточке ссылки.
   Рамки нарисованы нейтрально (без логотипов и названий приложений). Видно, сколько края платформа обрежет. */
const MK_TABS = [['phone', 'Телефон'], ['story', 'История'], ['avatar', 'Аватар'], ['feed', 'Лента'], ['link', 'Ссылка']];
/* Доля кадра, которую срежет «cover» в контейнере с пропорцией cw:ch (0…1) */
function mkCropLoss(iw, ih, cw, ch) {
  const a = iw / ih, c = cw / ch; if (!(a > 0) || !(c > 0)) return 0;
  return a > c ? 1 - c / a : 1 - a / c;
}
const mkClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
(function () {
  let box = null, stage = null, note = null, tab = 'phone', lastFocus = null, src = null;
  const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt) n.textContent = txt; return n; };
  function cv(w, h, radius) {           // холст с кадром «как cover»; w×h — размер на экране
    const k = Math.min(2, Math.max(1, window.devicePixelRatio || 1)), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k); c.style.width = w + 'px'; c.style.height = h + 'px'; c.className = 'mk-pic';
    if (radius) c.style.borderRadius = radius;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const iw = src.width, ih = src.height, ar = c.width / c.height; let sw = iw, sh = ih;
    if (iw / ih > ar) sw = ih * ar; else sh = iw / ar;
    g.drawImage(src, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  function lines(n, cls) { const w = el('div', 'mk-lines ' + (cls || '')); for (let i = 0; i < n; i++) { const l = el('i'); l.style.width = (i === n - 1 ? 55 : 92 - i * 6) + '%'; w.appendChild(l); } return w; }
  const builders = {
    phone() {
      const ph = el('div', 'mk-phone'), scr = el('div', 'mk-phone-screen');
      scr.appendChild(cv(204, 424, '30px'));
      const top = el('div', 'mk-phone-top'); top.append(el('span', '', '9:41'), el('span', 'mk-notch'), el('span', '', '●●●'));
      scr.append(top, el('div', 'mk-homebar')); ph.appendChild(scr);
      return { node: ph, ratio: [204, 424], text: 'Во весь экран телефона' };
    },
    story() {
      const st = el('div', 'mk-story'); st.appendChild(cv(216, 384, '18px'));
      const bar = el('div', 'mk-prog'); bar.appendChild(el('i')); const who = el('div', 'mk-who'); who.append(el('span', 'mk-av'), el('span', '', 'ваш_аккаунт'), el('span', 'mk-dim', '2 ч'));
      const rep = el('div', 'mk-reply', 'Отправить сообщение');
      st.append(bar, who, rep, el('div', 'mk-safe mk-safe-t'), el('div', 'mk-safe mk-safe-b'));
      return { node: st, ratio: [216, 384], text: 'Пунктир — зоны, которые закроет интерфейс: важное держи между ними' };
    },
    avatar() {
      const row = el('div', 'mk-avs');
      [['Круг', 132, '50%'], ['Скруглённый квадрат', 96, '22%'], ['Маленький круг в чате', 44, '50%']].forEach(([n, s, r]) => { const f = el('figure'); f.append(cv(s, s, r), el('figcaption', '', n)); row.appendChild(f); });
      return { node: row, ratio: [1, 1], text: 'Аватар обрезается по кругу: лицо должно быть в центре' };
    },
    feed() {
      const ar = mkClamp(src.width / src.height, .8, 1.91), W = 260, H = Math.round(W / ar);
      const card = el('div', 'mk-feed'), hd = el('div', 'mk-feed-h'); hd.append(el('span', 'mk-av'), lines(2));
      const act = el('div', 'mk-feed-a', '♡   ✉   ➤'); card.append(hd, cv(W, H), act, lines(3, 'mk-pad'));
      return { node: card, ratio: [W, H], text: 'Лента показывает кадр в пропорциях от 4:5 до 1,91:1; за пределами обрезает' };
    },
    link() {
      const card = el('div', 'mk-link'); card.append(cv(280, Math.round(280 / 1.91)), (() => { const b = el('div', 'mk-link-b'); b.append(el('small', '', 'site.example'), lines(2)); return b; })());
      return { node: card, ratio: [191, 100], text: 'Превью ссылки в мессенджере обычно 1,91:1' };
    }
  };
  function draw() {
    stage.replaceChildren(); const b = builders[tab](); stage.appendChild(b.node);
    const loss = mkCropLoss(src.width, src.height, b.ratio[0], b.ratio[1]);
    note.textContent = b.text + '. ' + (loss > .02 ? `Края обрежутся: около ${Math.round(loss * 100)}% кадра.` : 'Кадр влезает целиком.');
    $$('#mkTabs button').forEach(x => { const on = x.dataset.t === tab; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  function build() {
    box = el('div', 'modal onb'); box.id = 'mockups'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'mkTitle'); box.hidden = true;
    const card = el('div', 'onb-card mk-card'), h = el('h2', '', 'Как это будет выглядеть'); h.id = 'mkTitle';
    const tabs = el('div', 'seg'); tabs.id = 'mkTabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Где показывать');
    MK_TABS.forEach(([id, name]) => { const b = el('button', '', name); b.type = 'button'; b.dataset.t = id; tabs.appendChild(b); });
    stage = el('div', 'mk-stage'); stage.id = 'mkStage'; note = el('p', 'note'); note.id = 'mkNote'; note.setAttribute('aria-live', 'polite');
    const close = el('button', 'btn btn-main', 'Закрыть'); close.type = 'button'; close.id = 'mkClose';
    card.append(h, tabs, stage, note, close); box.appendChild(card); document.body.appendChild(box);
    tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; draw(); } });
    close.addEventListener('click', hide); box.addEventListener('click', e => { if (e.target === box) hide(); });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
  }
  function hide() { box.hidden = true; stage.replaceChildren(); src = null; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  window.mkOpen = function (canvas) {
    if (!canvas || canvas.width < 2 || canvas.height < 2) { toast('Сначала добавь фото'); return false; }
    if (!box) build();
    src = canvas; lastFocus = document.activeElement; box.hidden = false; draw(); $('#mkClose').focus(); return true;
  };
})();
