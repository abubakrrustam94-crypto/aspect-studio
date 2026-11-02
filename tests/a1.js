// Блок A1: пресеты размеров (поиск, недавние), шаблоны имён ({shot}, {time}, {fmt}), перенос настроек по группам.
// Запуск: node tests/a1.js
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
  const d = x.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, px: o.px ? Array.from(d) : null }; }`;
(async () => {
  await new Promise(r => server.listen(8808, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8808/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(700);
  // --- пресеты ---
  const pr = await p.evaluate(() => ({ n: PRESETS.length, uniq: new Set(PRESETS.map(x => x.id)).size, bad: PRESETS.filter(x => !(x.w >= 100 && x.h >= 100 && x.w <= 16384 && x.h <= 16384)).map(x => x.id), groups: [...new Set(PRESETS.map(x => x.g))], chips: document.querySelectorAll('#presetChips .chip').length, titles: document.querySelectorAll('#presetChips .chip-title').length }));
  ok(pr.n >= 50 && pr.n === pr.uniq && !pr.bad.length, `пресетов ${pr.n}, id уникальны, размеры в пределах`);
  ok(pr.chips === pr.n && pr.titles === pr.groups.length, `все пресеты выведены (${pr.chips} кнопок, ${pr.titles} групп)`);
  ok(await p.evaluate(() => ['wastatus', 'tgsticker', 'vkcover', 'ytthumb', 'appstore', 'gplay', 'us2x2', 'cn33x48', 'iphone', 'p20x30'].every(id => PRESETS.some(x => x.id === id))), 'новые размеры на месте (WhatsApp, VK, YouTube, магазины, визы, печать, обои)');
  await p.setInputFiles('#fileInput', [path.join(FX, 'face_astronaut.jpg'), path.join(FX, 'noface_coffee.jpg')]); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(600);
  await p.evaluate(() => set('sizeMode', 'fixed')); await p.waitForTimeout(200);
  await p.fill('#presetSearch', 'паспорт'); await p.waitForTimeout(150);
  const s1 = await p.evaluate(() => ({ vis: [...document.querySelectorAll('#presetChips .chip')].filter(c => !c.hidden).map(c => c.dataset.id), none: !document.querySelector('#presetNone').hidden }));
  ok(s1.vis.includes('p35x45') && s1.vis.length <= 3 && !s1.none, `поиск «паспорт» оставляет нужное (${s1.vis.join(', ')})`);
  await p.fill('#presetSearch', '1080×1920'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => { const v = [...document.querySelectorAll('#presetChips .chip')].filter(c => !c.hidden).map(c => c.dataset.id); return v.includes('story') && v.includes('wastatus') && !v.includes('yt'); }), 'поиск по размеру «1080×1920» находит сторис и статусы');
  await p.fill('#presetSearch', 'такого точно нет'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => !document.querySelector('#presetNone').hidden && [...document.querySelectorAll('#presetChips .chip-title')].every(t => t.hidden)), 'если ничего не найдено — подсказка, заголовки групп скрыты');
  await p.fill('#presetSearch', ''); await p.waitForTimeout(150);
  ok(await p.evaluate(() => [...document.querySelectorAll('#presetChips .chip, #presetChips .chip-title')].every(c => !c.hidden)), 'очистка поиска возвращает весь список');
  // недавние
  await p.click('#presetChips [data-id=wastatus]'); await p.click('#presetChips [data-id=gplay]'); await p.click('#presetChips [data-id=wastatus]'); await p.waitForTimeout(200);
  const rc = await p.evaluate(() => [...document.querySelectorAll('#presetRecent .chip')].map(c => c.dataset.id));
  ok(rc.join() === 'wastatus,gplay', `недавние: последний выбранный первым, без повторов (${rc.join(', ')})`);
  ok(await p.evaluate(() => cfgFor(items[0]).outW === 1080 && cfgFor(items[0]).outH === 1920 && cfgFor(items[0]).presetId === 'wastatus'), 'выбор пресета ставит размер 1080×1920');
  await p.reload(); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(600);
  ok(await p.evaluate(() => [...document.querySelectorAll('#presetRecent .chip')].map(c => c.dataset.id).join()) === 'wastatus,gplay', 'недавние сохраняются после перезагрузки');
  // --- имена ---
  await p.setInputFiles('#fileInput', [path.join(FX, 'face_astronaut.jpg'), path.join(FX, 'noface_coffee.jpg')]); await p.waitForFunction(() => items.length === 2); await p.waitForTimeout(500);
  const nm = await p.evaluate(async () => {
    const it = items[0]; it.metaInfo = { dto: '2024:05:03 14:22:11' }; S.nameTpl = '{shot}_{name}_{time}.{fmt}';
    const a = makeName(it, 100, 50, 'webp');
    it.metaInfo = null; const b2 = makeName(it, 100, 50, 'png');
    S.nameTpl = '{shot}'; it.metaInfo = undefined; await ensureShot(it); const c = makeName(it, 1, 1, 'jpg');
    return { a, b2, c, mod: new Date(it.file.lastModified).getFullYear() };
  });
  ok(/^2024-05-03_face_astronaut_\d{6}\.webp\.webp$/.test(nm.a), `{shot} из EXIF, {time} из шести цифр, {fmt} формат (${nm.a})`);
  ok(/^\d{4}-\d{2}-\d{2}_face_astronaut_\d{6}\.\w+\.png$/.test(nm.b2), `без EXIF {shot} берётся из даты файла (${nm.b2})`);
  ok(/^\d{4}-\d{2}-\d{2}\.jpg$/.test(nm.c), 'ensureShot читает EXIF до экспорта и не падает на фото без него');
  await p.evaluate(() => { S.nameTpl = '{name}_{w}x{h}'; syncUI(); });
  await p.click('#settingsTabs [data-tab=export]');
  await p.selectOption('#nameTplSel', '{shot}_{name}'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => S.nameTpl === '{shot}_{name}' && document.querySelector('#nameRow input').value === '{shot}_{name}' && document.querySelector('#nameTplSel').value === ''), 'готовый шаблон из списка подставляется в поле');
  ok(await p.evaluate(() => !!document.querySelector('#nameTokens [data-t="{shot}"]') && !!document.querySelector('#nameTokens [data-t="{fmt}"]')), 'кнопки новых токенов есть');
  // --- перенос настроек по группам ---
  await p.evaluate(() => { select(0); items[0].ov = {}; OV_KEYS.forEach(k => { items[0].ov[k] = S[k]; }); set('toneExp', 30); set('toneStyle', 'film'); set('sizeMode', 'fixed'); const t = tgt(); t.presetId = 'p20x30'; t.outW = 2362; t.outH = 3543; syncUI(); });
  await p.evaluate(() => lazyLoad('copyset'));
  const pure = await p.evaluate(() => { const src = { ...cfgFor(items[0]), toneExp: 55, sizeMode: 'fixed' }; const o = csMerge({ toneExp: 1, sizeMode: 'auto' }, src, ['tone']); const o2 = csMerge(null, src, ['frame']); return { o: [o.toneExp, o.sizeMode], o2: [o2.sizeMode, o2.toneExp], keys: Object.keys(o2).length === OV_KEYS.length }; });
  ok(pure.o[0] === 55 && pure.o[1] === 'auto', 'csMerge: переносит только выбранную группу');
  ok(pure.o2[0] === 'fixed' && pure.keys, 'csMerge: у фото без своих настроек создаёт полный набор');
  await p.click('#settingsTabs [data-tab=frame]'); await p.click('#copyToSel'); await p.waitForSelector('#copyset:not([hidden])', { timeout: 8000 });
  ok(await p.evaluate(() => document.querySelectorAll('#csList input').length === 9 && /1 фото/.test(document.querySelector('#csInfo').textContent)), 'окно открылось: 8 групп, получит 1 фото');
  await p.evaluate(() => { document.querySelector('#csList input[data-g=frame]').click(); });          // снимаем «Формат и размер кадра»
  await p.click('#csOk'); await p.waitForTimeout(400);
  const cp = await p.evaluate(() => { const o = items[1].ov; return { ov: !!o, tone: o && o.toneExp, style: o && o.toneStyle, mode: o && o.sizeMode, preset: o && o.presetId, hidden: document.querySelector('#copyset').hidden }; });
  ok(cp.ov && cp.tone === 30 && cp.style === 'film', 'тон и стиль перенесены на второе фото');
  ok(cp.mode !== 'fixed' || cp.preset !== 'p20x30', 'формат кадра НЕ перенесён (группа была снята)');
  ok(cp.hidden, 'окно закрылось после «Перенести»');
  await p.click('#toast .toast-act'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !items[1].ov), '«Отменить» в уведомлении возвращает прежние настройки второго фото');
  // отмеченные
  await p.evaluate(() => { items[1].skip = true; });
  await p.click('#copyToSel'); await p.waitForSelector('#copyset:not([hidden])');
  ok(await p.evaluate(() => document.querySelector('#csOk').disabled && /Нет отмеченных/.test(document.querySelector('#csInfo').textContent)), 'если отмеченных нет, кнопка неактивна и объяснение понятно');
  await p.click('#csTarget [data-v=all]'); await p.waitForTimeout(100);
  ok(await p.evaluate(() => !document.querySelector('#csOk').disabled), '«Всем остальным» включает кнопку, даже если фото не отмечено');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.querySelector('#copyset').hidden), 'Escape закрывает окно');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсё прошло'); process.exit(fail ? 1 : 0);
})();
