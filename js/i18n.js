'use strict';
/* Aspect Studio — английский интерфейс. Русский текст остаётся в коде и в index.html, а перевод подставляется поверх по словарю (js/i18n-en.js):
   обходим текст и подписи (aria-label, title, placeholder, alt), следим за новыми узлами через MutationObserver. Что в словаре не найдено — остаётся по-русски.
   Выключение возвращает исходный русский текст. */
(function () {
  const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'], CYR = /[А-Яа-яЁё]/, SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 };
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const orig = new WeakMap(), origAttr = new WeakMap(), rxCache = new Map();
  let D = null, on = false, mo = null, origTitle = null;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function trCap(x) { const c = norm(x); if (!c || !CYR.test(c)) return x; const t = trCore(c, 1); return t == null ? x : t; }
  /* Перевод одной строки (уже без внешних пробелов); null — перевода нет */
  function trCore(c, depth) {
    const v = D.x[c]; if (v !== undefined) return v;
    if (depth > 3) return null;
    const um = /^(.*\d) (КБ|МБ|ГБ|мм|см|Мп|МП|мс|мин|с|ч)$/.exec(c); if (um) return um[1] + ' ' + UNITS[um[2]];
    if (c.includes(' · ')) { const ps = c.split(' · '); let ch = false; const out = ps.map(x => { let t = CYR.test(x) ? trCore(x, depth + 1) : null; if (t == null && CYR.test(x)) { const f = x.replace(/\(вместе с /g, '(with ').replace(/«/g, '“').replace(/»/g, '”').replace(/(\d) (КБ|МБ|ГБ)/g, (_, n, u) => n + ' ' + UNITS[u]); if (f !== x) t = f; } if (t != null) ch = true; return t == null ? x : t; }); if (ch) return out.join(' · '); }
    for (let i = 0; i < D.p.length; i++) {
      let rx = rxCache.get(i);
      if (!rx) { rx = new RegExp('^' + D.p[i][0].map(p => esc(norm(p) === p ? p : p.replace(/\s+/g, ' '))).join('([\\s\\S]*?)') + '$'); rxCache.set(i, rx); }
      const m = rx.exec(c);
      if (m) return D.p[i][1].replace(/\{(\d+)\}/g, (_, k) => m[+k] === undefined ? '' : trCap(m[+k]));
    }
    for (const [k, en] of D.pre) { const key = k.trimEnd(); if (key.length >= 4 && c.length > key.length && c.startsWith(key) && (k === key || c[key.length] === ' ')) return en.trimEnd() + trCap(c.slice(key.length)); }
    for (const [k, en] of D.suf) { const key = k.trim(); if (c.length > key.length && c.endsWith(key)) { const head = c.slice(0, c.length - key.length); return trCap(head) + (k.startsWith(' ') && !en.startsWith(' ') ? ' ' : '') + en; } }
    return null;
  }
  const UNITS = { 'КБ': 'KB', 'МБ': 'MB', 'ГБ': 'GB', 'мм': 'mm', 'см': 'cm', 'Мп': 'MP', 'МП': 'MP', 'с': 's', 'мс': 'ms', 'мин': 'min', 'ч': 'h' };
  function tr(s) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s); if (!m[2] || !CYR.test(m[2])) return null;
    const t = trCore(norm(m[2]), 0); return t == null ? null : m[1] + t + m[3];
  }
  function doText(n) {
    const v = n.nodeValue; if (!v || !CYR.test(v)) return;
    const t = tr(v); if (t != null && t !== v) { orig.set(n, v); n.nodeValue = t; }
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a); if (!v || !CYR.test(v)) continue;
      const t = tr(v); if (t != null && t !== v) { let o = origAttr.get(el); if (!o) { o = {}; origAttr.set(el, o); } o[a] = v; el.setAttribute(a, t); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { if (!(root.parentNode && SKIP[root.parentNode.nodeName])) doText(root); return; }
    if (root.nodeType !== 1 || SKIP[root.nodeName] || (root.closest && root.closest('[data-no-i18n]'))) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && (SKIP[n.nodeName] || n.hasAttribute('data-no-i18n')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function revert(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 3) { const o = orig.get(n); if (o !== undefined) { n.nodeValue = o; orig.delete(n); } }
      else { const o = origAttr.get(n); if (o) { Object.keys(o).forEach(a => n.setAttribute(a, o[a])); origAttr.delete(n); } }
    }
  }
  function watch() {
    mo = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(n => walk(n));
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  window.i18nTr = s => { if (!D) return s; const t = tr(s); return t == null ? s : t; };       // для кода, которому нужна строка, а не узел
  window.i18nSet = async function (v) {
    if (v) {
      if (on) return;
      if (!window.I18N_EN) await lazyLoad('i18n-en');
      D = window.I18N_EN; on = true;
      origTitle = document.title; const tt = tr(origTitle); if (tt) document.title = tt;
      walk(document.body); watch();
    } else {
      if (!on) return;
      on = false; if (mo) { mo.disconnect(); mo = null; }
      revert(document.body); if (origTitle) document.title = origTitle;
    }
  };
})();
