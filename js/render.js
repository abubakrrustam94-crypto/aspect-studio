'use strict';
/* Aspect Studio — Раскладка, цвета, рендер, улучшение качества (Web Worker) */
/* ===================================================================
   Размеры и раскладка
   =================================================================== */
function computeSize(iw, ih, cap, c = S) {
  let cw, ch;
  if (c.sizeMode === 'fixed') { cw = c.outW; ch = c.outH; }
  else {
    const r = c.ratioW / c.ratioH, ir = iw / ih;
    if (c.fit === 'fit') { if (ir > r) { cw = iw; ch = iw / r; } else { ch = ih; cw = ih * r; } }
    else { if (ir > r) { ch = ih; cw = ih * r; } else { cw = iw; ch = iw / r; } }
  }
  if (c.enhOn && c.enhScale > 1) { cw *= c.enhScale; ch *= c.enhScale; }
  const kExport = Math.min(1, S.maxSide / Math.max(cw, ch), Math.sqrt(MAX_AREA / (cw * ch)));
  const k = cap ? Math.min(kExport, cap / Math.max(cw, ch)) : kExport;
  return { cw: Math.max(1, Math.round(cw * k)), ch: Math.max(1, Math.round(ch * k)), limited: kExport < 0.9999 };
}

/* Куда смотрит кадр в режиме «Заполнить»: вручную сдвинутый — как есть, иначе — на главный объект */
function focusOf(item, dw, dh, cw, ch) {
  const an = item.an;
  if (!S.autoCenter || item.manual || !an || !an.subject) return item.focus;
  const fx = dw - cw, fy = dh - ch, cl = v => Math.max(0, Math.min(1, v));
  const U = an.faces && an.faceBox;
  if (U) {          // лица: стараемся, чтобы все они остались в кадре, с запасом; по вертикали лицо чуть выше центра
    const axis = (u0, u1, size, full, bias) => {
      if (full < .5) return .5;
      const a = u0 * (size + full), b = u1 * (size + full), m = Math.min(size * .08, (b - a) * .25 + size * .02);
      let t = (a + b) / 2 - size * bias;                                  // желаемое начало окна
      if (b - a + 2 * m <= size) t = Math.max(b + m - size, Math.min(a - m, t));      // вписываем всю рамку лиц
      return cl(t / full);
    };
    return { x: axis(U.x0, U.x1, cw, fx, .5), y: axis(U.y0, U.y1, ch, fy, .42) };
  }
  return { x: fx > .5 ? cl((an.subject.x * dw - cw / 2) / fx) : .5, y: fy > .5 ? cl((an.subject.y * dh - ch / 2) / fy) : .5 };
}

function layout(iw, ih, cw, ch, item, c = S) {
  if (c.fit === 'fill') {
    const s = Math.max(cw / iw, ch / ih) * item.zoom;
    const dw = iw * s, dh = ih * s, f = focusOf(item, dw, dh, cw, ch);
    return { dx: -(dw - cw) * f.x, dy: -(dh - ch) * f.y, dw, dh };
  }
  const s = Math.min(cw / iw, ch / ih);
  const dw = iw * s, dh = ih * s;
  const a = { start: 0, center: .5, end: 1 }[c.align] ?? .5;
  return { dx: (cw - dw) * a, dy: (ch - dh) * a, dw, dh };
}

/* ===================================================================
   Цвета из фото
   =================================================================== */
function getSample(item, bmp) {
  if (item.sample) return item.sample;
  const N = 48;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, N, N);
  item.sample = { data: ctx.getImageData(0, 0, N, N).data, N };
  return item.sample;
}

function dominantColor(item, bmp) {
  if (item.dom) return item.dom;
  const { data } = getSample(item, bmp);
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const wgt = 1 + sat * 2;
    let e = buckets.get(key);
    if (!e) { e = { w: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
    e.w += wgt; e.r += r * wgt; e.g += g * wgt; e.b += b * wgt;
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
  item.dom = `rgb(${Math.round(best.r / best.w)},${Math.round(best.g / best.w)},${Math.round(best.b / best.w)})`;
  return item.dom;
}

function stripColor(sample, side) {
  const { data, N } = sample;
  const T = 3; // толщина полосы в пикселях выборки
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inStrip = side === 'top' ? y < T : side === 'bottom' ? y >= N - T : side === 'left' ? x < T : x >= N - T;
    if (!inStrip) continue;
    const i = (y * N + x) * 4;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

/* ===================================================================
   Рендер
   =================================================================== */
function fillGradient(ctx, cw, ch, mode, c1, c2) {
  let g;
  if (mode === 'h') g = ctx.createLinearGradient(0, 0, cw, 0);
  else if (mode === 'd') g = ctx.createLinearGradient(0, 0, cw, ch);
  else g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
}

// Широкий цвет: iPhone и многие Android снимают в Display P3. Если такое фото пропустить через sRGB-холст, цвета бледнеют.
const supportsP3 = (() => {
  try { const c = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' }); return !!(c && c.getContextAttributes && c.getContextAttributes().colorSpace === 'display-p3'); }
  catch (e) { return false; }
})();
const ctxCS = ctx => { try { return ctx.getContextAttributes().colorSpace || 'srgb'; } catch (e) { return 'srgb'; } };
const wantP3 = item => !!(S.colorSpace === 'p3' && supportsP3 && item && item.p3);
const getPix = (ctx, x, y, w, h, cs) => cs === 'srgb' ? ctx.getImageData(x, y, w, h) : ctx.getImageData(x, y, w, h, { colorSpace: cs });
const mkImageData = (arr, w, h, cs) => cs === 'srgb' ? new ImageData(arr, w, h) : new ImageData(arr, w, h, { colorSpace: cs });
const P3_RE = /Display ?P3|Display-P3|DisplayP3/i, P3_RE16 = /\x00D\x00i\x00s\x00p\x00l\x00a\x00y\x00 \x00P\x003/;
const latin1 = u8 => { let t = ''; for (let i = 0; i < u8.length; i += 8192) t += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return t; };
async function detectP3(file) {   // ищем профиль «Display P3» в начале файла: JPEG хранит ICC открыто, PNG — сжато (iCCP)
  try {
    const u8 = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
    const isPng = u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47;
    if (!isPng) { const t = latin1(u8); return P3_RE.test(t) || P3_RE16.test(t); }
    const dv = new DataView(u8.buffer);
    let p = 8;
    while (p + 12 <= u8.length) {
      const len = dv.getUint32(p), type = latin1(u8.subarray(p + 4, p + 8));
      if (type === 'IDAT' || type === 'IEND') break;
      if (type === 'iCCP') {
        const body = u8.subarray(p + 8, p + 8 + len);
        const z = body.indexOf(0);
        if (P3_RE.test(latin1(body.subarray(0, z)))) return true;     // имя профиля, напр. «Display P3» (скриншоты iPhone)
        if (typeof DecompressionStream === 'undefined') return false;
        const raw = await new Response(new Blob([body.subarray(z + 2)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
        const t = latin1(new Uint8Array(raw));
        return P3_RE.test(t) || P3_RE16.test(t);
      }
      p += 12 + len;
    }
    return false;
  } catch (e) { return false; }
}

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }

function drawBlurBg(ctx, bmp, iw, ih, cw, ch, c = S) {
  const s = Math.max(cw / iw, ch / ih);
  const sw = cw / s, sh = ch / s, sx = (iw - sw) / 2, sy = (ih - sh) / 2;
  const div = 2 + c.blur * 0.6, cs = ctxCS(ctx);
  const tw = Math.max(6, Math.round(cw / div)), th = Math.max(6, Math.round(ch / div));
  // 1) мягкое уменьшение в два шага (без «шума» от пропуска пикселей)
  const mid = mkCanvas(Math.min(cw, tw * 4), Math.min(ch, th * 4));
  let mctx = mid.getContext('2d', { colorSpace: cs }); mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, mid.width, mid.height);
  let curC = mkCanvas(tw, th);
  let cctx = curC.getContext('2d', { colorSpace: cs }); cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(mid, 0, 0, tw, th);
  // 2) плавное увеличение ступенями — получается гладкое размытие
  while (curC.width * 2 < cw) {
    const nx = mkCanvas(curC.width * 2, curC.height * 2);
    const nctx = nx.getContext('2d', { colorSpace: cs }); nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(curC, 0, 0, nx.width, nx.height);
    curC = nx;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(curC, 0, 0, cw, ch);
  if (c.dim > 0) { ctx.fillStyle = `rgba(0,0,0,${c.dim / 100})`; ctx.fillRect(0, 0, cw, ch); }
}

function paintBackground(ctx, bmp, item, cw, ch, L, opaque, c = S) {
  const mode = c.bg;
  if (mode === 'transparent') {
    if (opaque) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch); } else ctx.clearRect(0, 0, cw, ch);
  } else if (mode === 'color') { ctx.fillStyle = c.color; ctx.fillRect(0, 0, cw, ch); }
  else if (mode === 'dominant') { ctx.fillStyle = dominantColor(item, bmp); ctx.fillRect(0, 0, cw, ch); }
  else if (mode === 'gradient') fillGradient(ctx, cw, ch, c.gradAngle, c.grad1, c.grad2);
  else if (mode === 'edge') {
    const sample = getSample(item, bmp);
    const horizontal = (cw - L.dw) > (ch - L.dh);
    const c1 = stripColor(sample, horizontal ? 'left' : 'top');
    const c2 = stripColor(sample, horizontal ? 'right' : 'bottom');
    const g = horizontal ? ctx.createLinearGradient(0, 0, cw, 0) : ctx.createLinearGradient(0, 0, 0, ch);
    const total = horizontal ? cw : ch;
    const a = Math.min(.98, Math.max(.02, (horizontal ? L.dx : L.dy) / total));
    const b = Math.min(.99, Math.max(a + .01, ((horizontal ? L.dx + L.dw : L.dy + L.dh)) / total));
    g.addColorStop(0, c1); g.addColorStop(a, c1); g.addColorStop(b, c2); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  } else drawBlurBg(ctx, bmp, item.w, item.h, cw, ch, c);
}

function drawWatermark(ctx, cw, ch) {
  if (!S.wmOn) return;
  const hasText = S.wmText.trim().length > 0;
  if (!wmLogo && !hasText) return;
  const tile = S.wmMode === 'tile';
  const pad = tile ? 0 : Math.round(Math.min(cw, ch) * 0.03);
  const targetW = cw * S.wmSize / 100;
  ctx.save();
  ctx.globalAlpha = S.wmOpacity / 100;
  const ay = { t: 0, c: .5, b: 1 }[S.wmPos[0]] ?? 1;
  const ax = S.wmPos === 'c' ? .5 : ({ l: 0, c: .5, r: 1 }[S.wmPos[1]] ?? 1);
  // Размер одного знака и функция его рисования в точке (x, y) — левый верхний угол
  let w, h, paint;
  if (wmLogo) {
    const d = dimsOf(wmLogo);
    w = targetW; h = w * d.h / d.w;
    if (h > ch * .4) { h = ch * .4; w = h * d.w / d.h; }
    paint = (x, y) => ctx.drawImage(wmLogo, x, y, w, h);
  } else {
    const font = px => `700 ${px}px "Roboto Flex", system-ui, sans-serif`;
    ctx.font = font(100);
    const mw = ctx.measureText(S.wmText).width || 1;
    let fs = 100 * targetW / mw;
    fs = Math.max(8, Math.min(fs, ch * (tile ? .2 : .12)));
    ctx.font = font(fs);
    w = ctx.measureText(S.wmText).width; h = fs;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = fs * .18; ctx.shadowOffsetY = fs * .04;
    ctx.fillStyle = '#fff';
    paint = (x, y) => ctx.fillText(S.wmText, x, y);
  }
  if (!tile) {
    paint(pad + (cw - 2 * pad - w) * ax, pad + (ch - 2 * pad - h) * ay);
  } else {
    // Мозаика: сетка со сдвигом чётных рядов на полшага, повёрнутая вокруг центра кадра
    const gap = Math.max(0, S.wmGap) / 100;                 // шаг в долях размера знака
    const stepX = w * (1 + gap), stepY = h * (1 + gap * 1.2);
    const rad = S.wmAngle * Math.PI / 180;
    const R = Math.hypot(cw, ch) / 2 + Math.max(w, h);      // радиус, покрывающий кадр при любом повороте
    const rows = Math.min(400, Math.ceil(R / stepY)), cols = Math.min(400, Math.ceil(R / stepX));
    if (rows * cols * 4 > 40000) { ctx.restore(); return; }  // защита от слишком мелкого шага
    ctx.translate(cw / 2, ch / 2); ctx.rotate(rad);
    for (let j = -rows; j <= rows; j++) {
      const off = (j & 1) ? stepX / 2 : 0;
      for (let i = -cols; i <= cols; i++) paint(i * stepX + off - w / 2, j * stepY - h / 2);
    }
  }
  ctx.restore();
}

/* ===================================================================
   Улучшение качества: Lanczos-ресемплинг + шумоподавление + резкость
   (классические алгоритмы, без нейросетей — работает офлайн в браузере)
   =================================================================== */
let quick = false;   // true во время перетаскивания кадра: пропускаем тяжёлую обработку
const LEVELS = { low: { sharp: 25, denoise: 10 }, mid: { sharp: 45, denoise: 20 }, high: { sharp: 70, denoise: 35 } };

function lanczosWeights(srcN, dstN) {
  const scale = dstN / srcN, fs = Math.max(1, 1 / scale), support = 3 * fs;
  const taps = Math.ceil(support * 2) + 2;
  const starts = new Int32Array(dstN), counts = new Int32Array(dstN), w = new Float32Array(dstN * taps);
  for (let d = 0; d < dstN; d++) {
    const center = (d + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.ceil(center - support)), hi = Math.min(srcN - 1, Math.floor(center + support));
    let sum = 0, n = 0;
    for (let i = lo; i <= hi; i++) {
      const x = (i - center) / fs;
      const v = x === 0 ? 1 : (Math.abs(x) < 3 ? 3 * Math.sin(Math.PI * x) * Math.sin(Math.PI * x / 3) / (Math.PI * Math.PI * x * x) : 0);
      w[d * taps + n++] = v; sum += v;
    }
    if (sum) for (let k = 0; k < n; k++) w[d * taps + k] /= sum;
    starts[d] = lo; counts[d] = n;
  }
  return { starts, counts, w, taps };
}

function lanczosResize(src, sw, sh, dw, dh) {
  const X = lanczosWeights(sw, dw), Y = lanczosWeights(sh, dh);
  const tmp = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4;
    for (let x = 0; x < dw; x++) {
      const s = X.starts[x], n = X.counts[x], wo = x * X.taps;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < n; k++) {
        const p = row + (s + k) * 4, wt = X.w[wo + k];
        r += src[p] * wt; g += src[p + 1] * wt; b += src[p + 2] * wt; a += src[p + 3] * wt;
      }
      const o = (y * dw + x) * 4; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const s = Y.starts[y], n = Y.counts[y], wo = y * Y.taps;
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < n; k++) {
        const p = ((s + k) * dw + x) * 4, wt = Y.w[wo + k];
        r += tmp[p] * wt; g += tmp[p + 1] * wt; b += tmp[p + 2] * wt; a += tmp[p + 3] * wt;
      }
      const o = (y * dw + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return out;
}

function boxPass(a, b, w, h, r, horiz) {
  const inv = 1 / (2 * r + 1);
  const len = horiz ? w : h, lines = horiz ? h : w;
  const step = horiz ? 4 : w * 4, lineStep = horiz ? w * 4 : 4;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += a[base + Math.min(len - 1, Math.max(0, i)) * step + c];
      for (let i = 0; i < len; i++) {
        b[base + i * step + c] = sum * inv;
        sum += a[base + Math.min(len - 1, i + r + 1) * step + c] - a[base + Math.max(0, i - r) * step + c];
      }
    }
    for (let i = 0; i < len; i++) b[base + i * step + 3] = a[base + i * step + 3];
  }
}
function blurRGB(data, w, h, sigma) {
  const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
  let a = new Uint8ClampedArray(data), b = new Uint8ClampedArray(data.length);
  for (let n = 0; n < 3; n++) { boxPass(a, b, w, h, r, true); boxPass(b, a, w, h, r, false); }
  return a;
}

function enhancePixels(data, w, h, sharp, denoise, sigma, smart, gs) {
  if (w < 4 || h < 4) return;
  if (denoise > 0) {      // «умное» шумоподавление: сглаживаем только слабые отличия от соседей, края не трогаем
    const B = blurRGB(data, w, h, 1.2);
    const k = Math.min(1, denoise / 50), s2 = 2 * Math.pow(6 + denoise * 0.5, 2);
    for (let i = 0; i < data.length; i += 4) {
      const dr = B[i] - data[i], dg = B[i + 1] - data[i + 1], db = B[i + 2] - data[i + 2];
      const dl = 0.299 * dr + 0.587 * dg + 0.114 * db;
      const wt = k * Math.exp(-(dl * dl) / s2);
      data[i] += dr * wt; data[i + 1] += dg * wt; data[i + 2] += db * wt;
    }
  }
  if (sharp > 0) {        // нерезкая маска по яркости (цвета не «звенят»)
    const B = blurRGB(data, w, h, sigma), amt = sharp / 100 * 1.8, w4 = w * 4;
    const g0 = 3 * (gs || 1), g1 = 14 * (gs || 1);
    const Yb = i => 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dl = 0.299 * (data[i] - B[i]) + 0.587 * (data[i + 1] - B[i + 1]) + 0.114 * (data[i + 2] - B[i + 2]);
        if (dl > -2 && dl < 2) continue;
        let m = 1;
        if (smart) {      // умная маска: резкость только там, где есть реальный контраст (края, фактура), а не в шумном небе
          const l = x > 0 ? i - 4 : i, r = x < w - 1 ? i + 4 : i, u = y > 0 ? i - w4 : i, d = y < h - 1 ? i + w4 : i;
          const g = Math.abs(Yb(r) - Yb(l)) + Math.abs(Yb(d) - Yb(u));
          m = g <= g0 ? 0 : g >= g1 ? 1 : (g - g0) / (g1 - g0);
          m = m * m * (3 - 2 * m);
        }
        const add = amt * dl * m;
        data[i] += add; data[i + 1] += add; data[i + 2] += add;
      }
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (e instanceof RangeError || /memory|alloc|Array buffer|out of/i.test(m)) return 'Не хватило памяти. Уменьши «Увеличение» или «Макс. сторону».';
  return 'Ошибка: ' + m;
}

// Вся тяжёлая работа с пикселями — в одной функции, чтобы её можно было отдать Web Worker'у
function processPixels(m) {
  let px = new Uint8ClampedArray(m.buf), w = m.sw, h = m.sh;
  if (w !== m.dw || h !== m.dh) { px = lanczosResize(px, w, h, m.dw, m.dh); w = m.dw; h = m.dh; }
  if (m.sharp > 0 || m.denoise > 0) enhancePixels(px, w, h, m.sharp, m.denoise, m.sigma, m.smart, m.gs);
  return px.buffer;
}

// Код воркера собирается из тех же функций (один источник правды)
const WORKER_SRC = [lanczosWeights, lanczosResize, boxPass, blurRGB, enhancePixels, processPixels].map(f => f.toString()).join('\n') + `
self.onmessage = e => {
  const m = e.data;
  try { const buf = processPixels(m); self.postMessage({ id: m.id, buf }, [buf]); }
  catch (err) { self.postMessage({ id: m.id, err: String((err && err.message) || err) }); }
};`;
let workerUrl = null;

class Work {
  constructor() { this.w = null; this.pending = null; this.seq = 0; this.ok = false; }
  _spawn() {
    if (this.w) return this.w;
    if (!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    this.w = new Worker(workerUrl); this.ok = false;
    return this.w;
  }
  _kill() { if (this.w) { this.w.terminate(); this.w = null; } }
  _inline(msg) {   // запасной путь без воркера (старый браузер / заблокированный Worker)
    return new Promise((res, rej) => setTimeout(() => { try { res(processPixels(msg)); } catch (e) { rej(e); } }, 0));
  }
  run(msg) {
    if (this.pending) this.cancel();
    if (Work.off || typeof Worker === 'undefined') return this._inline(msg);
    let w;
    try { w = this._spawn(); } catch (e) { Work.off = true; return this._inline(msg); }
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending = { id, resolve, reject, msg };
      w.onmessage = e => {
        const p = this.pending;
        if (!p || e.data.id !== p.id) return;
        this.ok = true; this.pending = null;
        e.data.err ? p.reject(new Error(e.data.err)) : p.resolve(e.data.buf);
      };
      w.onerror = ev => {
        const p = this.pending; this.pending = null; this._kill();
        if (!p) return;
        if (!this.ok) { Work.off = true; this._inline(p.msg).then(p.resolve, p.reject); }   // воркер не запустился — считаем в основном потоке
        else p.reject(new Error(ev.message || 'worker error'));
      };
      w.postMessage({ ...msg, id });
    });
  }
  cancel() {
    const p = this.pending; this.pending = null;
    this._kill();
    if (p) { const err = new Error('Отменено'); err.name = 'AbortError'; p.reject(err); }
  }
}
Work.off = false;
const pvWork = new Work();   // предпросмотр: каждый новый кадр отменяет предыдущий
const exWork = new Work();   // экспорт и окно 100%
const exPool = [exWork];     // воркеры параллельного экспорта (первый — общий); отмена гасит все

// Рисует слой с фото; при включённом улучшении — Lanczos + шумоподавление + резкость в воркере (только область фото, фон и водяной знак не трогаем)
async function drawPhoto(ctx, bmp, item, L, cw, ch, useEnh, work, c = S) {
  if (!useEnh) { ctx.drawImage(bmp, L.dx, L.dy, L.dw, L.dh); return; }
  const sharp = c.sharp, denoise = c.denoise, smart = c.smart;
  const iw = item.w, ih = item.h, kx = L.dw / iw, ky = L.dh / ih;
  const sx0 = Math.max(0, Math.floor(-L.dx / kx)), sy0 = Math.max(0, Math.floor(-L.dy / ky));
  const sx1 = Math.min(iw, Math.ceil((cw - L.dx) / kx)), sy1 = Math.min(ih, Math.ceil((ch - L.dy) / ky));
  const sw = sx1 - sx0, sh = sy1 - sy0;
  if (sw <= 0 || sh <= 0) return;
  const dw = Math.max(1, Math.round(sw * kx)), dh = Math.max(1, Math.round(sh * ky));
  // сильное уменьшение сначала делаем нативно (до 2× от цели), чтобы не раздувать память
  const mid = mkCanvas(Math.round(Math.min(sw, dw * 2)), Math.round(Math.min(sh, dh * 2)));
  const cs = ctxCS(ctx);
  const mctx = mid.getContext('2d', { willReadFrequently: true, colorSpace: cs });
  if (!mctx) throw new RangeError('canvas');
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(bmp, sx0, sy0, sw, sh, 0, 0, mid.width, mid.height);
  let layer;
  if (mid.width === dw && mid.height === dh && sharp <= 0 && denoise <= 0) layer = mid;
  else {
    const id = getPix(mctx, 0, 0, mid.width, mid.height, cs);
    const sigma = Math.min(2.5, Math.max(0.8, 0.8 + 0.5 * Math.log2(Math.max(1, kx))));
    const gs = 1 / Math.max(1, Math.min(kx, 3));
    const buf = await work.run({ buf: id.data.buffer, sw: mid.width, sh: mid.height, dw, dh, sharp, denoise, sigma, smart, gs });
    mid.width = mid.height = 0;
    layer = mkCanvas(dw, dh);
    layer.getContext('2d', { colorSpace: cs }).putImageData(mkImageData(new Uint8ClampedArray(buf), dw, dh, cs), 0, 0);
  }
  ctx.drawImage(layer, Math.round(L.dx + sx0 * kx), Math.round(L.dy + sy0 * ky));
  layer.width = layer.height = 0;
}

async function render(canvas, item, bmp, { cap = 0, opaque = false, enh, work = exWork, p3 = false } = {}) {
  const c = cfgFor(item);
  if (c.fit === 'fill' && S.autoCenter && item.an === undefined) await ensureAnalysis(item, bmp);
  const { cw, ch } = computeSize(item.w, item.h, cap, c);
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d', p3 ? { colorSpace: 'display-p3' } : undefined);
  if (!ctx) throw new RangeError('canvas');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const L = layout(item.w, item.h, cw, ch, item, c);
  const cutAvail = !!(c.cutOn && compInstalled(cutComp(c)));
  if (c.cutOn && !cutAvail) compWarnOnce(cutComp(c), c.cutQuality === 'precise' ? 'Точное удаление фона' : 'Удаление фона');       // включено в настройках, но компонента нет: рисуем без вырезания
  if (cutAvail && typeof ensureMask === 'function') await ensureMask(item, bmp);
  const cut = !!(cutAvail && item.mask && !item.maskFail && item.mask.sig === coSig(item));
  if (cut) {                                       // фон удалён: вместо исходного фона и полей — выбранный
    if (c.cutBg === 'transparent' && !opaque) ctx.clearRect(0, 0, cw, ch);
    else { ctx.fillStyle = c.cutBg === 'color' ? c.cutColor : '#fff'; ctx.fillRect(0, 0, cw, ch); }
    const tmp = mkCanvas(cw, ch), tctx = tmp.getContext('2d', p3 ? { colorSpace: 'display-p3' } : undefined);
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
    await drawPhoto(tctx, bmp, item, L, cw, ch, (enh ?? c.enhOn) && !quick, work, c);
    tctx.globalCompositeOperation = 'destination-in';          // оставляем только объект
    tctx.drawImage(maskCanvas(item, c.cutEdge), L.dx, L.dy, L.dw, L.dh);
    ctx.drawImage(tmp, 0, 0); tmp.width = tmp.height = 0;
  } else {
    if (c.fit === 'fill') { if (opaque) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch); } }
    else paintBackground(ctx, bmp, item, cw, ch, L, opaque, c);
    await drawPhoto(ctx, bmp, item, L, cw, ch, (enh ?? c.enhOn) && !quick, work, c);
  }
  drawWatermark(ctx, cw, ch);
  return { cw, ch, L };
}
