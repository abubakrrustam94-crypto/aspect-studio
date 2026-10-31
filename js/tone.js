'use strict';
/* Aspect Studio — тон и цвет: ручные ползунки, готовые стили, «Автотон» по гистограмме и выравнивание горизонта.
   Тон применяется к готовому кадру перед водяным знаком, поэтому одинаково работает в предпросмотре и в экспорте. */

const TONE_STYLES = {
  none: {},
  bw: { sat: -100, con: 12 },
  warm: { warm: 32, sat: 8 },
  cool: { warm: -32, sat: 4 },
  film: { con: -8, sat: -14, warm: 10, lift: 0.07 },
  vivid: { sat: 42, con: 16 },
  fade: { con: -14, sat: -22, lift: 0.14 },
};
const TONE_KEYS = ['toneExp', 'toneCon', 'toneSat', 'toneWarm'];
const toneIsOn = c => !!(c && (c.toneExp || c.toneCon || c.toneSat || c.toneWarm || (c.toneStyle && c.toneStyle !== 'none')));

function toneParams(c) {
  const st = TONE_STYLES[c.toneStyle] || {};
  const cl = (v, a) => Math.max(-a, Math.min(a, v));
  return {
    ev: cl(c.toneExp || 0, 100) / 100 * 1.5,
    con: cl((c.toneCon || 0) + (st.con || 0), 100),
    sat: cl((c.toneSat || 0) + (st.sat || 0), 100),
    warm: cl((c.toneWarm || 0) + (st.warm || 0), 100),
    lift: st.lift || 0,
  };
}
function toneLUTs(P) {
  const gain = 2 ** P.ev, k = P.con >= 0 ? 1 + P.con / 100 * 0.8 : 1 + P.con / 100 * 0.6;
  const lut = wg => {
    const t = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = i / 255 * gain * wg;
      v = (v - 0.5) * k + 0.5;
      v = P.lift + v * (1 - P.lift);
      t[i] = Math.round(v * 255);
    }
    return t;
  };
  const w = P.warm / 100 * 0.25;
  return [lut(1 + w), lut(1), lut(1 - w)];
}
function toneApplyData(d, P, L) {
  const [lr, lg, lb] = L, s = 1 + P.sat / 100, doSat = P.sat !== 0;
  for (let i = 0; i < d.length; i += 4) {
    let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
    if (doSat) {
      const y = .299 * r + .587 * g + .114 * b;
      r = y + (r - y) * s; g = y + (g - y) * s; b = y + (b - y) * s;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;       // Uint8ClampedArray сама обрежет и округлит
  }
}
function applyTone(ctx, cw, ch, c) {
  if (!toneIsOn(c)) return;
  const P = toneParams(c), L = toneLUTs(P), STRIP = 256;
  for (let y = 0; y < ch; y += STRIP) {
    const h = Math.min(STRIP, ch - y), img = ctx.getImageData(0, y, cw, h);
    toneApplyData(img.data, P, L);
    ctx.putImageData(img, 0, y);
  }
}

/* ---------- Автотон ---------- */
function toneAnalyze(data) {            // data: RGBA маленькой копии кадра
  const hist = new Uint32Array(256);
  let sc = 0, cnt = 0, nr = 0, nb = 0, nn = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2], y = Math.round(.299 * r + .587 * g + .114 * b);
    hist[y]++; cnt++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
    sc += s;
    if (s < .22 && y > 50 && y < 205) { nr += r; nb += b; nn++; }     // баланс белого — только по почти нейтральным пикселям
  }
  if (!cnt) return null;
  const pct = p => { let a = 0; const t = cnt * p; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= t) return i / 255; } return 1; };
  let clip = 0; for (let i = 250; i < 256; i++) clip += hist[i];
  return { p2: pct(.02), p5: pct(.05), p50: pct(.5), p95: pct(.95), p98: pct(.98), p985: pct(.985), clip: clip / cnt, sat: sc / cnt,
    rb: nn > cnt * .08 ? (nr / nn) / Math.max(1, nb / nn) : 1 };
}
function toneSuggest(a, o) {            // → { toneExp, toneCon, toneSat, toneWarm } (целые, -100…100); o.faces — на кадре есть люди
  const out = { toneExp: 0, toneCon: 0, toneSat: 0, toneWarm: 0 };
  if (!a || a.p98 - a.p2 < 0.02) return out;
  const faces = !!(o && o.faces);
  const med = Math.max(.02, a.p50);
  let ev = Math.log2(.46 / med) * .8;
  const lowKey = a.p95 < .38 && med < .22;                       // намеренно тёмная сцена: не вытягиваем до «серой»
  ev = Math.max(-.9, Math.min(lowKey ? .3 : .9, ev));
  if (a.p5 > .62 && ev < 0) ev *= .5;                              // светлая сцена (high-key) — не затемняем
  if (ev > 0) {                                                    // не выжигаем света
    ev = Math.min(ev, Math.max(0, Math.log2(.98 / Math.max(.05, a.p985))));
    if (a.clip > .015) ev = 0;
  }
  if (a.clip > .03 && ev > -.3) ev = Math.max(-.3, ev - Math.min(.3, a.clip * 4));
  const hi = Math.min(1, a.p98 * 2 ** ev), lo = Math.min(1, a.p2 * 2 ** ev), spread = Math.max(.05, hi - lo);
  let con = spread < .85 ? (.85 / spread - 1) / .8 * 100 : (spread > .97 ? -8 : 0);
  if (lowKey) con = Math.min(con, 10);
  const q = 1 / Math.max(.5, Math.min(2, a.rb)), aW = (q - 1) / (q + 1);
  let warm = Math.abs(aW / .25 * 100) < 6 ? 0 : aW / .25 * 100 * .5;
  let sat = (.32 - a.sat) * 100;
  if (faces) { warm *= .5; sat *= .5; }                              // кожа легко уходит в красный/оранжевый
  const R = (v, lim) => Math.round(Math.max(-lim, Math.min(lim, v)));
  out.toneExp = R(ev / 1.5 * 100, 60); out.toneCon = R(con, 40); out.toneWarm = R(warm, faces ? 15 : 25); out.toneSat = R(sat, faces ? 12 : 20);
  if (Math.abs(out.toneExp) < 3) out.toneExp = 0;
  if (Math.abs(out.toneCon) < 4) out.toneCon = 0;
  if (Math.abs(out.toneSat) < 4) out.toneSat = 0;
  return out;
}
async function toneAutoFor(item) {
  const bmp = await loadBitmap(item);
  try {
    const { w, h } = dimsOf(bmp), k = Math.min(1, 160 / Math.max(w, h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const c = mkCanvas(cw, ch), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, cw, ch);
    const r = toneSuggest(toneAnalyze(g.getImageData(0, 0, cw, ch).data), { faces: !!(item.an && item.an.faces > 0) });
    c.width = c.height = 0; return r;
  } finally { closeBmp(bmp); }
}

/* ---------- Горизонт ---------- */
// Возвращает { angle, conf }: на сколько градусов (по часовой) линии на фото отклонены от горизонтали/вертикали.
function boxBlur(src, W, H, r) {        // быстрый размыв: сглаживает ступеньки на наклонных краях, иначе углы градиента «слипаются»
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let a = 0; for (let x = -r; x <= r; x++) a += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) { tmp[y * W + x] = a / n; a += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < W; x++) {
    let a = 0; for (let y = -r; y <= r; y++) a += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) { out[y * W + x] = a / n; a += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
  }
  return out;
}
function tiltFromGray(gray, W, H) {
  gray = boxBlur(boxBlur(gray, W, H, 2), W, H, 2);
  const BIN = 0.25, R = 15, NB = Math.round(2 * R / BIN) + 1, hist = new Float64Array(NB);
  let maxMag = 0; const mags = new Float32Array(W * H), ang = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const gx = -gray[i - W - 1] - 2 * gray[i - 1] - gray[i + W - 1] + gray[i - W + 1] + 2 * gray[i + 1] + gray[i + W + 1];
    const gy = -gray[i - W - 1] - 2 * gray[i - W] - gray[i - W + 1] + gray[i + W - 1] + 2 * gray[i + W] + gray[i + W + 1];
    const m = Math.hypot(gx, gy); mags[i] = m; if (m > maxMag) maxMag = m;
    ang[i] = Math.atan2(gy, gx) * 180 / Math.PI;
  }
  if (maxMag < 1e-6) return { angle: 0, conf: 0 };
  const thr = maxMag * .2; let total = 0;
  for (let i = 0; i < mags.length; i++) {
    if (mags[i] < thr) continue;
    let a = ang[i] + 90; a = ((a % 90) + 135) % 90 - 45;      // направление линии, свёрнуто в [-45, 45)
    total += mags[i];
    if (a < -R || a > R) continue;
    hist[Math.round((a + R) / BIN)] += mags[i];
  }
  let best = 0, bestV = -1;
  for (let b = 0; b < NB; b++) {
    let v = 0; for (let d = -4; d <= 4; d++) { const j = b + d; if (j >= 0 && j < NB) v += hist[j]; }      // окно ±1°
    if (v > bestV) { bestV = v; best = b; }
  }
  let sw = 0, sa = 0;                                          // уточнение: средневзвешенный угол вокруг пика (±1,5°)
  for (let d = -6; d <= 6; d++) { const j = best + d; if (j >= 0 && j < NB) { sw += hist[j]; sa += hist[j] * (j * BIN - R); } }
  const angle = sw ? sa / sw : best * BIN - R;
  return { angle, conf: total ? bestV / total : 0, bins: NB };
}
async function tiltDetect(item) {
  const bmp = await loadBitmap(item);
  try {
    const { w, h } = dimsOf(bmp), k = Math.min(1, 480 / Math.max(w, h)), cw = Math.max(8, Math.round(w * k)), ch = Math.max(8, Math.round(h * k));
    const c = mkCanvas(cw, ch), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, cw, ch);
    const d = g.getImageData(0, 0, cw, ch).data, gray = new Float32Array(cw * ch);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
    c.width = c.height = 0;
    return tiltFromGray(gray, cw, ch);
  } finally { closeBmp(bmp); }
}

/* ---------- Интерфейс ---------- */
(function () {
  const auto = $('#toneAuto'), reset = $('#toneReset'), tAuto = $('#tiltAuto'), tRange = $('#tiltRange'), tOut = $('#tiltOut'), tReset = $('#tiltReset');
  if (!auto) return;
  let working = false;
  function toneSync() {
    const it = cur(), has = !!it;
    [auto, reset, tAuto, tRange, tReset].forEach(b => { b.disabled = !has || exporting; });
    const t = has ? (it.tilt || 0) : 0;
    if (document.activeElement !== tRange) tRange.value = t;
    tOut.textContent = (t > 0 ? '+' : '') + t.toFixed(1) + '°';
    const E = has ? cfgFor(it) : S;
    reset.hidden = !toneIsOn(E);
    tReset.hidden = !t;
  }
  window.toneSync = toneSync;
  function ensureOv(it) { if (!it.ov) { it.ov = {}; OV_KEYS.forEach(k => { it.ov[k] = S[k]; }); } return it.ov; }
  auto.addEventListener('click', async () => {
    const it = cur(); if (!it || working || exporting) return;
    working = true; auto.disabled = true;
    try {
      const r = await toneAutoFor(it);
      histPush('toneAuto');
      const prev = it.ov ? { ...it.ov } : null;
      Object.assign(ensureOv(it), r, { toneStyle: it.ov.toneStyle });
      renderThumbs(); syncUI(); schedule();
      const none = !TONE_KEYS.some(k => r[k]);
      toast(none ? 'Фото уже хорошо сбалансировано — менять нечего' : 'Автотон применён к этому фото — подкрути ползунками', false, none ? undefined : { action: { label: 'Отменить', fn: () => { it.ov = prev; renderThumbs(); syncUI(); schedule(); } }, ms: 9000 });
    } catch (e) { console.error(e); toast(friendlyError(e), true); }
    finally { working = false; toneSync(); }
  });
  reset.addEventListener('click', () => {
    const it = cur(); if (!it) return;
    histPush('toneReset');
    const t = it.ov || S; TONE_KEYS.forEach(k => { t[k] = 0; }); t.toneStyle = 'none';
    syncUI(); schedule();
  });
  async function setTilt(it, v) {
    v = Math.max(-15, Math.min(15, Math.round(v * 10) / 10));
    if ((it.tilt || 0) === v) { toneSync(); return; }
    histPush('tilt');
    it.tilt = v; it.crop = null;
    await commitXform(it);
    renderThumbs(); toneSync();
  }
  tRange.addEventListener('input', () => { const v = Number(tRange.value); tOut.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + '°'; });
  tRange.addEventListener('change', () => { const it = cur(); if (it && !exporting) setTilt(it, Number(tRange.value)); });
  tReset.addEventListener('click', () => { const it = cur(); if (it && !exporting) setTilt(it, 0); });
  tAuto.addEventListener('click', async () => {
    const it = cur(); if (!it || working || exporting) return;
    working = true; tAuto.disabled = true;
    try {
      const r = await tiltDetect(it);
      if (r.conf < .12 || Math.abs(r.angle) < .3) { toast(Math.abs(r.angle) < .3 && r.conf >= .12 ? 'Горизонт уже ровный' : 'Не нашёл чёткого горизонта или вертикалей — выровняй вручную ползунком', false); }
      else { await setTilt(it, (it.tilt || 0) - r.angle); toast(`Горизонт выровнен (${(-r.angle > 0 ? '+' : '') + (-r.angle).toFixed(1)}°). Края подрезаны, чтобы не было пустых углов`); }
    } catch (e) { console.error(e); toast(friendlyError(e), true); }
    finally { working = false; toneSync(); }
  });
})();
