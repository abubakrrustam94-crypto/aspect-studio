# Внешние декодеры

Подгружаются **лениво**, только когда пользователь открывает файл соответствующего формата. Обычные JPG/PNG/WebP их не затрагивают.
Всё лежит на твоём же сайте; во внешние сервисы ничего не отправляется. Service Worker кэширует их при первом использовании, дальше они работают без сети.

| Папка | Для чего | Библиотека | Лицензия |
|---|---|---|---|
| `heif/` | HEIC / HEIF | [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5 (libheif в WebAssembly) | LGPL-3.0 (текст в `LICENSE-libheif`) |
| `utif/` + `pako/` | TIFF и превью DOS EPS | [UTIF.js (utif2)](https://github.com/photopea/UTIF.js) 4.1.0, [pako](https://github.com/nodeca/pako) 3.0.2 | MIT |
| `exr/` | OpenEXR | [parse-exr](https://github.com/dmnsgn/parse-exr) 1.0.2 (+ fflate), собрано esbuild в один файл | MIT |
| `jxl/` | JPEG XL (если браузер не открывает сам) | [@jsquash/jxl](https://github.com/jamsinclair/jSquash) 1.3.0 (libjxl в WebAssembly) | Apache-2.0 |
| `pdfjs/` | AI (PDF-совместимые) | [pdf.js](https://github.com/mozilla/pdf.js) 6.4.299, legacy-сборка | Apache-2.0 |

Остальные форматы (RAW, PSD/PSB, HDR, SVG, EPS, XCF) разбираются собственным кодом в `js/formats.js`.

## Обновление библиотек

```
npm i libheif-js utif2 pako parse-exr @jsquash/jxl pdfjs-dist esbuild
# затем скопировать файлы в vendor/ (см. список выше) и пересобрать exr и jxl:
npx esbuild exr-entry.js --bundle --minify --format=iife --outfile=vendor/exr/parse-exr.js
npx esbuild jxl-entry.js --bundle --minify --format=iife --define:import.meta.url='"https://localhost/vendor/jxl/"' --outfile=vendor/jxl/jxl-decode.js
```
где `exr-entry.js`: `import parseExr from 'parse-exr'; globalThis.parseExr = parseExr;`,
а `jxl-entry.js`: `import decode, { init } from '@jsquash/jxl/decode.js'; globalThis.jxlDecoder = { decode, init };`.
