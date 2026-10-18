# Aspect Studio

Смена формата фото без обрезки: размытый фон, пресеты для соцсетей и маркетплейсов, улучшение качества, пакетная обработка и ZIP.
Всё работает в браузере, фото никуда не загружаются. Без фреймворков и сборки.

## Структура

```
index.html          разметка
css/style.css       стили
js/core.js          константы, состояние, тема, загрузка изображений
js/render.js        раскладка, рендер, улучшение качества (Web Worker)
js/analyze.js       анализ фото: резкость, шум, главный объект
js/preview.js       предпросмотр и слайдер
js/ui.js            настройки, миниатюры
js/export.js        экспорт, ZIP
js/features.js      горячие клавиши, просмотр 100%, обрезка, наборы, вкладки
js/main.js          старт
fonts/              шрифт Roboto Flex (локально)
sw.js, manifest.json, icon*.png   PWA и офлайн
tests/run.js        автотесты (Playwright)
```

Скрипты подключаются в index.html по порядку, менять порядок нельзя.

## Запуск локально (Termux)

```bash
pkg install python
cd aspect-studio
python -m http.server 8080
# открыть http://localhost:8080
```

## Деплой на GitHub Pages

1. Создай репозиторий на github.com (например `aspect-studio`), публичный.
2. В папке проекта:
   ```bash
   git init
   git add .
   git commit -m "Aspect Studio"
   git branch -M main
   git remote add origin https://github.com/ТВОЙ_НИК/aspect-studio.git
   git push -u origin main
   ```
   В Termux перед этим: `pkg install git`. При push GitHub попросит логин и токен
   (Settings → Developer settings → Personal access tokens, право `repo`) вместо пароля.
3. В репозитории: Settings → Pages → Build and deployment → Source: «Deploy from a branch»,
   Branch: `main`, папка `/ (root)` → Save.
4. Через 1–2 минуты сайт будет по адресу `https://ТВОЙ_НИК.github.io/aspect-studio/`.

Все пути в проекте относительные, поэтому сайт работает и в подпапке репозитория.

## Обновление сайта

```bash
git add .
git commit -m "Обновление"
git push
```

Если менял файлы, поменяй номер версии `VERSION` в `sw.js` (например `aspect-studio-v6`),
иначе у пользователей может остаться старая офлайн-копия. Если страница не обновилась, нажми Ctrl+Shift+R.

## Имя файла

В настройках экспорта можно задать шаблон: `{name}` исходное имя, `{n}` номер по порядку (01, 02…), `{w}` и `{h}` размер, `{date}` дата.
Например `{n}_{name}` даст `01_photo.jpg`. Порядок фото меняется кнопками ◀ ▶, сортировкой или перетаскиванием.

## ZIP на диске

В «Экспорте» есть переключатель «Собирать ZIP на диске». Архив пишется потоком во временный файл
приватной файловой системы браузера (OPFS), в памяти остаётся только текущее фото. Нужен https или localhost:
при открытии файла напрямую (file://) или в старых браузерах сайт сам соберёт ZIP в памяти.
Временные файлы удаляются через 10 минут и при следующем запуске.

## Тесты

```bash
npm i playwright
node tests/run.js
```
