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
| `models/scrfd-500m.onnx` | Точный поиск лиц (с 5 точками) | SCRFD-500M из пакета `buffalo_sc` проекта [InsightFace](https://github.com/deepinsight/insightface) (`det_500m.onnx`) | MIT (код); веса моделей InsightFace — для некоммерческого использования, сайт личный |
| `models/yolox-nano.onnx`, `yolox-s.onnx` | Поиск объектов (80 классов COCO) | [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) (релиз 0.1.1rc0; `yolox-s` хранит веса в fp16, скрипт `tools/onnx_half_storage.py`) | Apache-2.0 |
| `models/sr-fast-x4.onnx`, `sr-general-x4.onnx`, `sr-max-x4.onnx.p1/.p2` | Нейро-увеличение ×4 | [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (веса `realesr-animevideov3`, `realesr-general-x4v3`, `RealESRGAN_x4plus` с GitHub Releases), граф ONNX собран скриптом `tools/build_esrgan_onnx.py` (веса «максимума» и «обычной» хранятся в fp16 с приведением к fp32 при загрузке) | BSD-3-Clause |
| `models/dn-ffdnet.onnx`, `dn-scunet.onnx.p1/.p2` | Нейро-шумоподавление | [FFDNet](https://github.com/cszn/FFDNet) и [SCUNet](https://github.com/cszn/SCUNet) Кай Чжана (веса `ffdnet_color.pth`, `scunet_color_real_psnr.pth` из релиза KAIR v1.0), экспорт под плитку 256 скриптом `tools/build_denoise_onnx.py` (fp16-хранение весов) | MIT (FFDNet/KAIR), Apache-2.0 (SCUNet) |
| `models/migan.onnx` | Убрать лишнее | [MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN) (трассировка `migan_traced.pt` из релиза Sanster/models; экспорт в ONNX, onnxsim, fp16-хранение) | MIT |
| `raw/` | Проявление RAW | [libraw-wasm-nothread](https://www.npmjs.com/package/libraw-wasm-nothread) 1.6.0 (`worker.js` со встроенным загрузчиком, `libraw.wasm`; однопоточная сборка LibRaw, обёртка libraw-wasm Яна Буана) | ISC (обёртка); сам LibRaw — LGPL 2.1 / CDDL 1.0 |
| `enc/` | Кодеры: MozJPEG, oxipng, AVIF, JPEG XL | [jSquash](https://github.com/jamsinclair/jSquash) (`@jsquash/jpeg` 1.6.0, `oxipng` 2.3.0, `avif` 2.1.1, `jxl` 1.3.0; сборки из Squoosh), коды: mozjpeg (BSD), oxipng (MIT), libavif (BSD), libjxl (BSD) | Apache-2.0 (обёртки) |
| `ort/` | Общий движок ONNX (WASM) | [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.30.0 (`ort.wasm.min.js`, `ort-wasm-simd-threaded.{mjs,wasm}`) | MIT |
| `models/isnet-int8.onnx.p1`, `.p2` (две половины одной модели, склеиваются в воркере; так файлы не больше ~22 МБ) | Точное удаление фона | IS-Net (DIS), квантованная версия из [@imgly/background-removal-data](https://www.npmjs.com/package/@imgly/background-removal-data) 1.4.5 | Apache-2.0 (модель), для личного использования |

| `tfjs/` | Общий рантайм для лиц и удаления фона | [TensorFlow.js](https://github.com/tensorflow/tfjs) core + cpu + wasm + converter 4.22.0, собрано esbuild в `runtime.js`, плюс `tfjs-backend-wasm*.wasm` | Apache-2.0 |
| `blazeface/` | Определение лиц (грузится при первом анализе фото) | [BlazeFace](https://github.com/google-ai-edge/mediapipe) (MediaPipe), веса в формате tfjs из [human-models](https://github.com/vladmandic/human-models) | Apache-2.0 / MIT |
| `cutout/` | Удаление фона (грузится при первом включении) | [U²-Net-P](https://github.com/xuebinqin/U-2-Net) (`u2netp.onnx` из rembg), упрощён и переведён в float16 скриптом `tools/build_u2netp.py` | Apache-2.0 |

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

## Рантайм и модель лиц (tfjs/, blazeface/)

Файлы: `tfjs/runtime.js` (tfjs, собран в один файл), `tfjs/tfjs-backend-wasm*.wasm`, `blazeface/blazeface-back.json/.bin` (веса, вход 256×256). Воркер `js/faces-worker.js` подключает их, разбор результатов (якоря SSD, взвешенный NMS) написан вручную.
Пересборка рантайма:
```
npm i @tensorflow/tfjs-core @tensorflow/tfjs-converter @tensorflow/tfjs-backend-cpu @tensorflow/tfjs-backend-wasm @vladmandic/human-models esbuild
npx esbuild bf-entry.js --bundle --minify --format=iife --outfile=vendor/tfjs/runtime.js
```
где `bf-entry.js`:
```
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
self.BlazeFaceLib = { tf, loadGraphModel, setWasmPaths };
```
Веса: `node_modules/@vladmandic/human-models/models/blazeface-back.{json,bin}`, wasm: `node_modules/@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm{,-simd}.wasm`.

## Модель удаления фона (cutout/)

`u2netp.json` — граф (365 операций: Conv, Relu, MaxPool, Resize, Concat, Add, Sigmoid) без динамических форм, `u2netp.f16.bin` — веса float16 (2,2 МБ). Граф исполняет `js/cutout-worker.js` на операциях tfjs; результат совпадает с onnxruntime (среднее отличие маски меньше 0,3 из 255).
Пересборка:
```
pip install onnx onnxsim numpy
curl -L -o u2netp.onnx https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
python3 tools/build_u2netp.py u2netp.onnx vendor/cutout
```

Компоненты не скачиваются автоматически: реестр файлов и размеров — `COMPONENTS` в `js/components.js`; при замене файла обнови размер (проверит `tests/components.js`).
