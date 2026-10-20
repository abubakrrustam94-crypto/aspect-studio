/* ---------- «Что нового»: список изменений и окно после обновления ---------- */
const SEEN_KEY = 'aspect-studio-seen';
const CHANGELOG = [
  {
    "v": "2.11.1",
    "t": "Исправления",
    "items": [
      "Окно «Что нового» всегда можно закрыть: кнопка видна на любом экране, закрывает и тап по затемнению",
      "Обновление подтягивает свежие стили и скрипты сразу, а не со второго открытия"
    ]
  },
  {
    "v": "2.11.0",
    "t": "Большие фото, доступность, «Что нового»",
    "items": [
      "Очень большие фото (десятки мегапикселей) открываются в уменьшенном виде, чтобы не вешать телефон; приложение говорит об этом и показывает пометку в информации о кадре",
      "Если памяти не хватает даже на это, размер автоматически уменьшается ещё, вместо ошибки",
      "Проверка доступности (axe) в тестах: исправлены низкий контраст в тёмной теме и подписи зоны загрузки; нижняя панель стала областью страницы",
      "Страница «Что нового»: окно с изменениями показывается после обновления, открыть можно в «Ещё → О программе»"
    ]
  },
  {
    "v": "2.10.0",
    "t": "Водяной знак мозаикой",
    "items": [
      "Водяной знак мозаикой: шаг, наклон, размер и прозрачность; работает с текстом и логотипом",
      "Шаблоны водяного знака вместе с логотипом",
      "Исправлена плашка «Формат» (показывала undefined)"
    ]
  },
  {
    "v": "2.9.0",
    "t": "Приватность и экспорт",
    "items": [
      "Метаданные по выбору: удалить всё или оставить только камеру и дату; геолокация не копируется никогда",
      "Автор и копирайт можно записать в JPG",
      "Перевод в sRGB или сохранение Display P3",
      "Сохранение сразу в выбранную папку (Chrome, Edge)",
      "Имена файлов: номер внутри группы, соотношение сторон, пресет, транслитерация, замена пробелов"
    ]
  },
  {
    "v": "2.8.0",
    "t": "Новые форматы на входе",
    "items": [
      "HEIC/HEIF, TIFF, JXL, ICO, BMP, GIF, SVG",
      "RAW (CR2, CR3, NEF, NRW, ARW, RAF, ORF, RW2, DNG, PEF, RWL) через встроенный превью-снимок",
      "PSD/PSB, XCF, EXR, HDR, AI, EPS"
    ]
  },
  {
    "v": "2.7.1",
    "t": "Проверка пресетов маркетплейсов",
    "items": [
      "Размеры пресетов маркетплейсов сверены с правилами площадок; часть требований помечена как непроверенная"
    ]
  },
  {
    "v": "2.7.0",
    "t": "Надёжность",
    "items": [
      "Защита от зависаний и нехватки памяти, журнал ошибок в приложении, автотесты нагрузки"
    ]
  },
  {
    "v": "2.6.0",
    "t": "Данные и приватность",
    "items": [
      "Экспорт и импорт настроек и наборов, сброс всех данных, офлайн-режим"
    ]
  },
  {
    "v": "2.5.0",
    "t": "Новый дизайн",
    "items": [
      "Material 3 Expressive: новые цвета, формы и анимации, тёмная тема, акценты"
    ]
  }
];
function wnRender() {
  const box = $('#wnList'); box.replaceChildren();
  CHANGELOG.forEach(e => {
    const h = document.createElement('h3'); h.textContent = 'v' + e.v + ' — ' + e.t;
    const ul = document.createElement('ul'); e.items.forEach(x => { const li = document.createElement('li'); li.textContent = x; ul.append(li); });
    box.append(h, ul);
  });
}
let wnOpener = null;
function wnOpen() { wnOpener = document.activeElement; wnRender(); $('#whatsnew').hidden = false; $('#wnClose').focus(); }
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
