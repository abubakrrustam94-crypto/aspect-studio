/* ---------- «Что нового»: список изменений и окно после обновления ---------- */
const SEEN_KEY = 'aspect-studio-seen';
async function wnRender() {
  const box = $('#wnList');
  if (typeof CHANGELOG === 'undefined') { box.textContent = 'Загружаю…'; try { await lazyLoad('changelog-data'); } catch (e) { box.textContent = 'Не удалось загрузить список изменений. Проверь соединение.'; return; } }
  box.replaceChildren();
  CHANGELOG.forEach(e => {
    const h = document.createElement('h3'); h.textContent = 'v' + e.v + ' — ' + e.t;
    const ul = document.createElement('ul'); e.items.forEach(x => { const li = document.createElement('li'); li.textContent = x; ul.append(li); });
    box.append(h, ul);
  });
}
let wnOpener = null;
function wnOpen() { wnOpener = document.activeElement; $('#whatsnew').hidden = false; $('#wnClose').focus(); return wnRender(); }
function wnClose() {
  $('#whatsnew').hidden = true;
  try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch (e) {}
  if (wnOpener && wnOpener.focus) wnOpener.focus();
}
$('#wnClose').addEventListener('click', wnClose);
$('#whatsnew').addEventListener('click', e => { if (e.target.id === 'whatsnew') wnClose(); });          // тап по затемнению тоже закрывает
$('#wnOpenBtn').addEventListener('click', wnOpen);
$('#whatsnew').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); wnClose(); }
  else if (e.key === 'Tab') { e.preventDefault(); $('#wnClose').focus(); }          // в окне одна кнопка, фокус остаётся на ней
});
(function () {            // после обновления (не при первом запуске) показываем изменения один раз
  let seen = null, onb = null;
  try { seen = localStorage.getItem(SEEN_KEY); onb = localStorage.getItem(ONB_KEY); } catch (e) {}
  const num = v => String(v || '0').split('.').map(Number);
  const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  if (seen && !newer(APP_VERSION, seen)) return;
  if (seen || onb === '1') setTimeout(() => { if ($('#onboard').hidden) wnOpen(); else wnClose(); }, 900);
  else { try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch (e) {} }
})();
