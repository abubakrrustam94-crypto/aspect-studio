/* ---------- Мини-обучение при первом запуске ---------- */
const ONB_KEY = 'aspect-studio-onboarded';
const ONB_STEPS = [
  ['camera', 'Добавь фото', 'Нажми на область загрузки или перетащи файлы. Можно сразу много — они обработаются пачкой.'],
  ['frame', 'Выбери формат', 'Во вкладке «Рамка» укажи нужные пропорции или готовый пресет. Фото не обрезается — недостающее поле заполняется фоном.'],
  ['download', 'Скачай результат', 'Кнопка внизу сохранит одно фото, а «ZIP» — все сразу. Всё работает на твоём устройстве, ничего не отправляется.']
];
let onbStep = 0, onbOpener = null;
function onbRender() {
  const [ic, t, p] = ONB_STEPS[onbStep];
  // eslint-disable-next-line no-restricted-syntax -- статичные значения
  $('#onbIc').innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${ic}"/></svg>`;
  $('#onbTitle').textContent = t; $('#onbText').textContent = p;
  // eslint-disable-next-line no-restricted-syntax -- статичные значения
  $('#onbDots').innerHTML = ONB_STEPS.map((_, i) => `<i class="${i === onbStep ? 'on' : ''}"></i>`).join('');
  $('#onbNext').textContent = onbStep === ONB_STEPS.length - 1 ? 'Понятно' : 'Далее';
  $('#onbSkip').hidden = onbStep === ONB_STEPS.length - 1;
}
function onbOpen() { onbOpener = document.activeElement; onbStep = 0; onbRender(); $('#onboard').hidden = false; $('#onbNext').focus(); }
function onbClose() {
  $('#onboard').hidden = true;
  try { localStorage.setItem(ONB_KEY, '1'); } catch (e) {}
  if (onbOpener && onbOpener.focus) onbOpener.focus();
}
$('#onbNext').addEventListener('click', () => { if (onbStep >= ONB_STEPS.length - 1) onbClose(); else { onbStep++; onbRender(); } });
$('#onbSkip').addEventListener('click', onbClose);
$('#helpBtn').addEventListener('click', onbOpen);
$('#onboard').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); onbClose(); }
  else if (e.key === 'Tab') { // ловушка фокуса
    const f = [...$('#onboard').querySelectorAll('button:not([hidden])')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
(function () { let seen = false; try { seen = localStorage.getItem(ONB_KEY) === '1'; } catch (e) {} if (!seen) setTimeout(onbOpen, 400); })();
