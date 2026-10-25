'use strict';
/* Aspect Studio — жесты на телефоне: свайп влево/вправо по предпросмотру листает фото.
   Не мешает слайдеру «до/после» и сдвигу кадра: внутри самого кадра свайп работает только когда он ничего другого не делает (режимы «До» и «После», вписывание без сдвига). */
(function () {
  const card = $('#previewCard'), frameEl = $('#frame'); let g = null;
  const MIN_DX = 56, MAX_MS = 900;
  function allowed(e) {
    if (!items.length || items.length < 2 || e.pointerType === 'mouse') return false;
    if (e.target.closest('button, input, select, textarea, a, [role="slider"], .nav-group')) return false;
    if (frameEl.contains(e.target)) { const E = cfgFor(cur()); return S.view !== 'slider' && E.fit !== 'fill'; }
    return true;
  }
  card.addEventListener('pointerdown', e => { g = allowed(e) ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null; });
  card.addEventListener('pointerup', e => {
    if (!g || g.id !== e.pointerId) return; const d = g; g = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (performance.now() - d.t > MAX_MS || Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    select(idx + (dx < 0 ? 1 : -1));
  });
  card.addEventListener('pointercancel', () => { g = null; });
})();
