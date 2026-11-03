'use strict';
/* Aspect Studio — «Проверить скорость»: короткие замеры на этом устройстве (уменьшение, правка тона, память, потоки).
   Грузится только по кнопке в «О программе». Ничего никуда не отправляется. */
async function speedRun() {
  const t = async (f) => { const t0 = performance.now(); await f(); return performance.now() - t0; };
  const rows = [];
  const add = (label, val, unit) => rows.push([label, val + (unit ? ' ' + unit : '')]);
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  await frame();
  // 1) уменьшение большого кадра 12 МП → 1200 px
  const big = document.createElement('canvas'); big.width = 4000; big.height = 3000; const bg = big.getContext('2d');
  bg.fillStyle = '#7a8'; bg.fillRect(0, 0, 4000, 3000); bg.fillStyle = '#c52'; bg.fillRect(500, 400, 2000, 1500);
  const small = document.createElement('canvas'); small.width = 1200; small.height = 900; const sg = small.getContext('2d'); sg.imageSmoothingQuality = 'high';
  const tScale = await t(async () => { for (let i = 0; i < 3; i++) sg.drawImage(big, 0, 0, 1200, 900); });
  add('Уменьшение кадра 12 МП', Math.round(tScale / 3), 'мс');
  big.width = big.height = 0;
  // 2) правка тона 2 МП (экспозиция, контраст, зерно)
  const W = 1600, H = 1200, d = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < d.length; i++) d[i] = (i * 7) & 255;
  const P = toneParams({ toneExp: 30, toneCon: 20, toneGrain: 20, toneStyle: 'film' }), L = toneLUTs(P);
  const tTone = await t(async () => { toneApplyData(d, P, L, W, 0, 1); });
  add('Тон и зерно на кадре 2 МП', Math.round(tTone), 'мс');
  // 3) чтение и запись пикселей
  const pc = document.createElement('canvas'); pc.width = 1600; pc.height = 1200; const pg = pc.getContext('2d', { willReadFrequently: true });
  const tPix = await t(async () => { const im = pg.getImageData(0, 0, 1600, 1200); pg.putImageData(im, 0, 0); });
  add('Чтение и запись пикселей 2 МП', Math.round(tPix), 'мс');
  pc.width = pc.height = 0;
  // 4) среда
  add('Ядра процессора', navigator.hardwareConcurrency || '?', '');
  add('Память устройства', navigator.deviceMemory ? '≥ ' + navigator.deviceMemory + ' ГБ' : 'не сообщается', '');
  add('Несколько потоков для нейросетей', self.crossOriginIsolated ? 'да' : 'нет', '');
  try { const e = await navigator.storage.estimate(); add('Место для компонентов', Math.round((e.quota - e.usage) / 1048576) + ' МБ свободно', ''); } catch (err) { /* нет данных */ }
  const score = tScale / 3 + tTone + tPix;
  const verdict = score < 400 ? 'Быстро: тяжёлые функции пойдут без проблем.' : score < 1100 ? 'Нормально: большие фото и нейросети займут заметное время.' : 'Медленно: для больших фото лучше уменьшить «Макс. сторону» и не включать несколько нейросетей сразу.';
  try { localStorage.setItem(SPEED_KEY, JSON.stringify({ score: Math.round(score), t: Date.now() })); } catch (e) { /* без хранилища */ }
  if (typeof syncUI === 'function') syncUI();
  const out = rows.map(([a, b]) => { const r = document.createElement('div'); r.className = 'sp-row'; const x = document.createElement('span'); x.textContent = a; const y = document.createElement('b'); y.textContent = b; r.append(x, y); return r; });
  const sum = document.createElement('div'); sum.className = 'sp-sum'; sum.textContent = verdict; out.push(sum);
  return out;
}
window.speedRun = speedRun;
