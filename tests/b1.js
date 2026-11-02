// Блок B1: «Улучшить», шум после ночного света, маски, фокус касанием.
// Запуск: node tests/b1.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
const EXP = `async (o) => { Object.assign(S, o.g || {}); const it = items[0]; for (const k in (o.ov || {})) set(k, o.ov[k]); const bmp = await loadBitmap(it); let r, err = null;
  try { r = await exportBlob(it, bmp); } catch (e) { err = e.name + ':' + e.message; } finally { closeBmp(bmp); }
  if (err) return { err }; const m = await createImageBitmap(r.blob), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, px: Array.from(d) }; }`;
(async () => {
  await new Promise(r => server.listen(8809, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8809/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  await p.evaluate(async () => { await lazyLoad('lowlight'); await lazyLoad('fxmask'); await lazyLoad('oneclick'); });
  // --- шум после ночного света ---
  const dn = await p.evaluate(() => {
    const W = 64, H = 64; let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - .5; };
    const mk = () => { const d = new Uint8ClampedArray(W * H * 4), l0 = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, base = x < 32 ? 70 : 170; l0[i] = x < 32 ? 20 : 150; const n = x < 32 ? rnd() * 40 : 0; for (let k = 0; k < 3; k++) d[i * 4 + k] = base + n; d[i * 4 + 3] = 255; }
      return { d, l0 }; };
    const std = (d, x0, x1) => { let s = 0, s2 = 0, n = 0; for (let y = 8; y < 56; y++) for (let x = x0; x < x1; x++) { const v = d[(y * W + x) * 4]; s += v; s2 += v * v; n++; } const m = s / n; return Math.sqrt(s2 / n - m * m); };
    const a = mk(), n0 = std(a.d, 4, 28), edge0 = a.d[(30 * W + 33) * 4] - a.d[(30 * W + 30) * 4];
    const t = lowDenoiseData(a.d, a.l0, W, H, 1, .5), n1 = std(a.d, 4, 28);
    const bright = []; const c = mk(); const before = Array.from(c.d.slice((30 * W + 40) * 4, (30 * W + 40) * 4 + 3)); lowDenoiseData(c.d, c.l0, W, H, 1, 1); const after = Array.from(c.d.slice((30 * W + 40) * 4, (30 * W + 40) * 4 + 3));
    const e = mk(); lowDenoiseData(e.d, e.l0, W, H, 1, 1); const edge1 = e.d[(30 * W + 33) * 4] - e.d[(30 * W + 30) * 4];
    const z = mk(); const z0 = Array.from(z.d); const tz = lowDenoiseData(z.d, z.l0, W, H, 2, 0);
    return { n0, n1, t, before, after, edge0, edge1, tz, same: z0.every((v, i) => v === z.d[i]) };
  });
  ok(dn.n1 < dn.n0 * .75, `шум в осветлённой тёмной области падает (${dn.n0.toFixed(1)} → ${dn.n1.toFixed(1)})`);
  ok(dn.before.join() === dn.after.join(), 'места без подъёма света не размываются');
  ok(dn.edge1 > 0 && Math.abs(dn.edge1 - dn.edge0) < 12, `резкая граница сохраняется (шаг ${dn.edge0.toFixed(0)} → ${dn.edge1.toFixed(0)})`);
  ok(dn.tz === 0 && dn.same, 'сила 0 ничего не меняет');
  // --- небо ---
  const sk = await p.evaluate(() => { const W = 48, H = 48, px = new Uint8ClampedArray(W * H * 4); let s = 3; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 90; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (y < 20) { px[i] = 120; px[i + 1] = 170; px[i + 2] = 235; } else { px[i] = 40 + r(); px[i + 1] = 90 + r(); px[i + 2] = 30 + r() / 2; } px[i + 3] = 255; }
    const m = fxSkyMap(px, W, H); return m && { cover: m.cover, top: m.m[5 * W + 24], bot: m.m[40 * W + 24] }; });
  ok(sk && sk.cover > .3 && sk.cover < .5 && sk.top > .9 && sk.bot < .1, `небо находится сверху и не заходит на землю (доля ${sk && sk.cover.toFixed(2)})`);
  const none = await p.evaluate(() => { const W = 32, H = 32, px = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) { px[i * 4] = 60 + (i * 37) % 90; px[i * 4 + 1] = 50 + (i * 53) % 80; px[i * 4 + 2] = 20; px[i * 4 + 3] = 255; } return fxSkyMap(px, W, H); });
  ok(none === null, 'если неба нет — маска не строится');
  // --- план «Улучшить» ---
  const pl = await p.evaluate(() => {
    const dark = { p2: .01, p5: .02, p50: .1, p95: .4, p98: .5, p985: .55, clip: 0, sat: .3, rb: 1 }, norm = { p2: .08, p5: .15, p50: .46, p95: .85, p98: .92, p985: .95, clip: 0, sat: .35, rb: 1 };
    const has = { lowlight: true, retouch: true };
    return { d: ocPlan(dark, { faces: 0, noise: 6 }, has, null), dn: ocPlan(dark, { faces: 0, noise: 1 }, { lowlight: false, retouch: true }, null), n: ocPlan(norm, { faces: 0, noise: 1 }, has, null), f: ocPlan(norm, { faces: 2, noise: 1 }, has, null), e: ocPlan(norm, { faces: 0, noise: 5 }, has, { enhOn: true, denoise: 35 }) };
  });
  ok(pl.d.patch.lowOn === true && pl.d.patch.lowAmt >= 60 && pl.d.patch.lowDn >= 70, 'тёмное шумное фото: ночной свет и сильное шумоподавление');
  ok(pl.dn.patch.lowOn !== true && pl.dn.missing.includes('Ночной свет'), 'нет компонента: ночной свет не включается, он назван в списке недостающих');
  ok(!pl.n.patch.lowOn && pl.n.patch.retouchOn, 'нормальное фото: без ночного света, с ретушью');
  ok(pl.f.patch.retouchStyle === 'exp' && pl.f.patch.retouchAmt <= 55, 'на фото люди: мягкая ретушь');
  ok(pl.e.notes.includes('шумоподавление') && pl.e.patch.denoise === 35, 'шумное фото: включено шумоподавление');
  // --- фото ---
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  await p.evaluate(() => { set('enhOn', false); set('sizeMode', 'auto'); set('ratioW', 1); set('ratioH', 1); set('fit', 'fill'); S.format = 'png'; S.maxSide = 8192; });
  await p.click('#settingsTabs [data-tab=quality]');
  ok(await p.evaluate(() => !!document.querySelector('#cardOne #oneEnh') && !!document.querySelector('#cardMask [data-val=sky]') && !!document.querySelector('[data-key=lowDn]')), 'карточки «Улучшить фото», «Где применять» и ползунок шума на месте');
  await p.evaluate(() => set('fxMask', 'face')); ok(await p.evaluate(() => S.fxMask === 'all'), 'маска «Лица» без компонента не включается');
  await p.evaluate(async () => { await compInstall('faces'); await compInstall('lowlight'); await compInstall('retouch'); });
  await p.evaluate(() => ensureAnalysis(items[0]));
  const nf = await p.evaluate(() => (items[0].an && items[0].an.faceList || []).length);
  ok(nf > 0, `анализ отдаёт список лиц (${nf})`);
  // кнопка «Улучшить»
  await p.click('#oneEnh'); await p.waitForFunction(() => !document.querySelector('#oneEnh').disabled, null, { timeout: 30000 });
  const ov = await p.evaluate(() => items[0].ov && { r: items[0].ov.retouchOn, s: items[0].ov.retouchStyle, e: items[0].ov.enhOn });
  ok(ov && ov.r === true && ov.s === 'exp', `«Улучшить» включил ретушь для фото с лицом (${JSON.stringify(ov)})`);
  await p.evaluate(() => { histUndo && histUndo(); });
  // маска лиц: тон только на лицах
  await p.evaluate(() => { items[0].ov = null; set('retouchOn', false); });
  const base = await p.evaluate(`(${EXP})({ ov: {} })`);
  const all = await p.evaluate(`(${EXP})({ ov: { toneExp: 50 } })`);
  const fc = await p.evaluate(`(${EXP})({ ov: { toneExp: 50, fxMask: 'face' } })`);
  const cd = (a, bb, x, y) => { const i = (y * a.w + x) * 4; return Math.abs(a.px[i] - bb.px[i]) + Math.abs(a.px[i + 1] - bb.px[i + 1]) + Math.abs(a.px[i + 2] - bb.px[i + 2]); };
  const fb = await p.evaluate(() => items[0].an.faceList[0]);
  const cx = Math.round((fb.x0 + fb.x1) / 2 * base.w), cy = Math.round((fb.y0 + fb.y1) / 2 * base.h);
  let corner = 0; [[2, 2], [base.w - 3, 2], [2, base.h - 3]].forEach(([x, y]) => { corner = Math.max(corner, cd(fc, base, x, y)); });
  ok(cd(all, base, 2, 2) > 20, 'тон «везде» меняет и углы кадра');
  ok(cd(fc, base, cx, cy) > 20 && corner <= 3, `маска «Лица»: лицо изменилось (${cd(fc, base, cx, cy)}), углы остались прежними (${corner})`);
  // --- фокус касанием ---
  await p.evaluate(() => lazyLoad('depth')); await p.click('#settingsTabs [data-tab=bg]');
  await p.evaluate(() => set('fxMask', 'all'));
  ok(await p.evaluate(() => document.querySelector('#depthPickReset').hidden), 'без выбранного фокуса кнопка сброса скрыта');
  await p.click('#depthPick');
  ok(await p.evaluate(() => window.dpPicking && document.querySelector('#frame').classList.contains('picking')), 'режим выбора включён, рамка подсвечена');
  const box = await p.evaluate(() => { const r = document.querySelector('#frame').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.mouse.click(box.x + box.w * .25, box.y + box.h * .75);
  const df = await p.evaluate(() => ({ f: items[0].depthFocus, pick: window.dpPicking, ring: !!document.querySelector('.focus-ring'), sub: depthSubject(items[0]) }));
  ok(df.f && Math.abs(df.f.x - .25) < .08 && Math.abs(df.f.y - .75) < .08 && !df.pick && df.ring, `касание задало фокус (${df.f && df.f.x.toFixed(2)}, ${df.f && df.f.y.toFixed(2)}), кольцо показано, режим выключен`);
  ok(df.sub === df.f, 'depthSubject берёт точку фокуса');
  ok(await p.evaluate(() => !document.querySelector('#depthPickReset').hidden), 'кнопка «Сбросить фокус» появилась');
  ok(await p.evaluate(() => JSON.parse(histSnap()) !== null && XF_KEYS.includes('depthFocus')), 'фокус входит в сохраняемые данные сессии');
  await p.click('#depthPickReset'); ok(await p.evaluate(() => !items[0].depthFocus && document.querySelector('#depthPickReset').hidden), 'сброс убирает точку фокуса');
  await p.evaluate(() => { items[0].depthFocus = { x: .3, y: .3 }; return commitXform(items[0]); }); ok(await p.evaluate(() => items[0].depthFocus === null), 'поворот или обрезка сбрасывают точку (координаты изменились)');
  ok(errs.length === 0, 'ошибок страницы нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `ПРОВАЛ: ${fail}` : 'Все проверки пройдены'); process.exit(fail ? 1 : 0);
})();
