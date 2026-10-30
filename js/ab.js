'use strict';
/* Aspect Studio — A/B: два набора настроек для одного фото, переключаемые кнопкой, чтобы сравнить результат */
const ab = { on: false, item: null, slots: { A: null, B: null }, cur: 'A', orig: null };
(function () {
  const btn = $('#abBtn'), bar = $('#abBar'), keep = $('#abKeep'), cancel = $('#abCancel'), tabs = $$('#abBar [data-ab]');
  if (!btn) return;
  const snap = it => ({ S: JSON.parse(JSON.stringify(S)), ov: it.ov ? JSON.parse(JSON.stringify(it.ov)) : null });
  function apply(it, sn) {
    Object.keys(S).forEach(k => { delete S[k]; }); Object.assign(S, JSON.parse(JSON.stringify(sn.S)));
    it.ov = sn.ov ? JSON.parse(JSON.stringify(sn.ov)) : null;
    save(); renderThumbs(); syncUI(); applyView(); schedule();
  }
  function paint() {
    bar.hidden = !ab.on; btn.hidden = ab.on;
    tabs.forEach(t => { const on = t.dataset.ab === ab.cur; t.classList.toggle('active', on); t.setAttribute('aria-pressed', on); });
  }
  window.abSync = function () {
    const it = cur();
    btn.disabled = !it || exporting;
    if (ab.on && (cur() !== ab.item)) { ab.on = false; ab.item = null; }
    paint();
  };
  btn.addEventListener('click', () => {
    const it = cur(); if (!it || exporting) return;
    histPush('ab');
    ab.on = true; ab.item = it; ab.cur = 'A'; ab.orig = snap(it); ab.slots = { A: snap(it), B: snap(it) };
    paint(); toast('Сравнение A/B: менять настройки можно в любом наборе, переключай A и B кнопками под фото', false);
  });
  tabs.forEach(t => t.addEventListener('click', () => {
    const it = cur(); if (!ab.on || it !== ab.item || t.dataset.ab === ab.cur || exporting) return;
    ab.slots[ab.cur] = snap(it); ab.cur = t.dataset.ab; apply(it, ab.slots[ab.cur]); paint();
  }));
  keep.addEventListener('click', () => { ab.on = false; ab.item = null; paint(); toast('Оставлены текущие настройки'); });
  cancel.addEventListener('click', () => {
    const it = cur(); if (ab.on && it === ab.item) apply(it, ab.orig);
    ab.on = false; ab.item = null; paint(); toast('Вернул настройки, какими они были до сравнения');
  });
})();
