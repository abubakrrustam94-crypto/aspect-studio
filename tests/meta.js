// Вкладка «Метаданные»: таблица «Было → Будет», GPS, профили, дата, авторские права, DPI, проверка готового файла.
const { chromium } = require('playwright'); const path = require('path');
const FX = path.join(__dirname, 'fixtures'), URL_ = 'file://' + path.resolve(__dirname, '..', 'index.html');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); }); await p.reload(); await p.waitForTimeout(500);
  const load = async f => { await p.evaluate(() => { items.length = 0; idx = 0; }); await p.setInputFiles('#fileInput', (Array.isArray(f) ? f : [f]).map(x => path.join(FX, x))); await p.waitForFunction(n => items.length === n, Array.isArray(f) ? f.length : 1); await p.waitForTimeout(500); };
  const out = async (fmt = 'jpg') => p.evaluate(async fmt => { S.format = fmt; S.enhOn = false; S.sizeMode = 'fixed'; S.outW = 300; S.outH = 200; const it = items[0], bmp = await loadBitmap(it), r = await exportBlob(it, bmp); closeBmp(bmp); const x = await inspectBlob(r.blob); let decodes = false; try { const m = await createImageBitmap(r.blob); decodes = m.width > 0; } catch (e) {} return { ...x, decodes, type: r.blob.type }; }, fmt);
  await load('exif_gps.jpg'); await p.evaluate(() => set('format', 'jpg')); await p.click('#settingsTabs [data-tab=meta]'); await p.waitForTimeout(400);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#metaTable tbody tr')].map(r => [...r.children].map(c => c.textContent)));
  const row = n => rows.find(r => r[0] === n) || [];
  ok(rows.length === 11, 'в таблице 11 строк');
  ok(row('Геолокация')[1] === 'есть' && /удалится всегда/.test(row('Геолокация')[2]), 'геолокация: есть → «удалится всегда»');
  ok(/TestCam/.test(row('Камера')[1]) && row('Камера')[2] === 'удалится', 'по умолчанию камера удаляется: ' + row('Камера').join(' | '));
  ok(/2024-05-01/.test(row('Дата съёмки')[1]), 'видна дата съёмки из исходника');
  ok(await p.evaluate(() => !document.getElementById('metaGps').hidden), 'красная подсказка про геолокацию показана');
  ok(await p.evaluate(() => !!document.querySelector('.thumb-gps') && /геолокация/.test(document.querySelector('.thumb-main').getAttribute('aria-label'))), 'на миниатюре значок GPS');
  // ---- режимы и таблица ----
  await p.click('#cardPrivacy [data-group=meta] [data-val=basic]'); await p.waitForTimeout(300);
  const rows2 = await p.evaluate(() => [...document.querySelectorAll('#metaTable tbody tr')].map(r => [...r.children].map(c => c.textContent)));
  ok(/TestCam/.test(rows2.find(r => r[0] === 'Камера')[2]) && /2024-05-01/.test(rows2.find(r => r[0] === 'Дата съёмки')[2]), '«Дата и камера»: в колонке «Будет» камера и дата остаются');
  ok(rows2.find(r => r[0] === 'Геолокация')[2].includes('удалится'), 'геолокация удаляется и в этом режиме');
  let r = await out(); ok(r.decodes && !r.gps && /TestCam/.test(r.model + r.make) && r.dto.startsWith('2024:05:01'), 'файл: есть камера и дата, геолокации нет');
  // свой выбор
  await p.click('#cardPrivacy [data-group=meta] [data-val=custom]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById('metaCustom').hidden), '«Свой выбор» открывает группы');
  await p.evaluate(() => { set('metaCam', false); set('metaDate', 'keep'); }); r = await out(); ok(!r.make && !r.model && r.dto.startsWith('2024:05:01') && !r.gps, 'только дата: камеры нет, дата как в оригинале');
  await p.evaluate(() => { set('metaCam', true); set('metaDate', 'none'); }); r = await out(); ok(/TestCam/.test(r.make + r.model) && !r.dto && !r.gps, 'только камера: даты нет');
  await p.evaluate(() => { set('metaCam', false); set('metaDate', 'today'); }); r = await out(); const now = new Date(), y = String(now.getFullYear());
  ok(r.dto.startsWith(y + ':') && !r.make && r.decodes, 'сегодняшняя дата: ' + r.dto);
  const rowsT = await p.evaluate(() => [...document.querySelectorAll('#metaTable tbody tr')].map(r => [...r.children].map(c => c.textContent)));
  ok(/сегодня/.test(rowsT.find(r => r[0] === 'Дата съёмки')[2]), 'в таблице написано «(сегодня)»');
  // ---- автор и права ----
  await p.evaluate(() => { set('metaCam', false); set('metaDate', 'none'); set('author', 'Иван'); }); r = await out(); r = await out(); ok(r.artist === 'Иван' && r.copyright === '© Иван' && r.decodes, 'кириллица в авторе и правах записывается и читается: ' + r.artist + ' / ' + r.copyright); 
  await p.evaluate(() => { set('author', 'Ivan Petrov'); set('metaCopy', ''); }); r = await out(); ok(r.artist === 'Ivan Petrov' && r.copyright === '© Ivan Petrov', 'пустой шаблон: «© Автор»');
  await p.evaluate(() => { set('metaCopy', 'Все права защищены {год}, {автор}'); }); r = await out(); ok(r.copyright === `Все права защищены ${y}, Ivan Petrov`, 'шаблон прав подставляет год и автора: ' + r.copyright);
  await p.evaluate(() => { set('metaCopy', '© {год} {автор}'); }); r = await out(); ok(r.copyright === `© ${y} Ivan Petrov`, 'шаблон «© {год} {автор}»: ' + r.copyright);
  // ---- DPI ----
  await p.evaluate(() => { set('metaCam', false); set('metaDate', 'none'); set('author', ''); set('metaCopy', ''); set('metaDpi', 300); });
  r = await out('jpg'); ok(r.dpi === 300 && r.decodes && !r.gps, 'JPG: записано 300 dpi (JFIF и EXIF), файл открывается');
  r = await out('png'); ok(r.type === 'image/png' && r.dpi === 300 && r.decodes && r.chunks.includes('pHYs'), 'PNG: чанк pHYs с 300 dpi, файл открывается');
  r = await out('webp'); ok(!r.exif && !r.xmp && r.dpi === 0, 'WebP: метаданные не пишутся');
  await p.evaluate(() => { S.format = 'webp'; renderMetaInfo(); }); await p.waitForTimeout(400); const rowsP = await p.evaluate(() => [...document.querySelectorAll('#metaTable tbody tr')].map(r => [...r.children].map(c => c.textContent)));
  ok(/не записывается/.test(rowsP.find(r => r[0] === 'Разрешение')[2]), 'таблица для WebP: разрешение «не записывается»');
  await p.evaluate(() => { S.format = 'jpg'; });
  // ---- профили ----
  await p.evaluate(() => { set('author', 'Ivan Petrov'); });
  await p.click('#metaProfiles [data-p=public]'); r = await out(); ok(await p.evaluate(() => S.meta === 'none' && S.metaDpi === 0) && !r.make && !r.dto && r.dpi === 0, 'профиль «Для публикации»: ничего лишнего (автор из поля остаётся, это выбор пользователя)');
  await p.click('#metaProfiles [data-p=portfolio]'); r = await out(); ok(/TestCam/.test(r.make + r.model) && r.dto.startsWith('2024:05:01') && r.artist === 'Ivan Petrov' && !r.gps, 'профиль «Для портфолио»: камера, дата и автор');
  await p.click('#metaProfiles [data-p=print]'); r = await out(); ok(r.dpi === 300 && !r.make && !r.dto && !r.gps, 'профиль «Для печати»: 300 dpi без камеры и даты');
  // ---- проверка готового файла ----
  await p.evaluate(() => { S.format = 'jpg'; }); await p.click('#metaCheckBtn'); await p.waitForFunction(() => !document.getElementById('metaCheckBtn').disabled);
  const chk = await p.textContent('#metaCheck'); ok(/Геолокации в файле нет/.test(chk) && /300 dpi/.test(chk), 'проверка готового файла: «Геолокации в файле нет», разрешение 300 dpi');
  ok(await p.evaluate(() => !document.querySelector('#metaCheck .bad')), 'в проверке нет красных пунктов');
  // ---- пакет и не-JPG ----
  await load(['exif_gps.jpg', 'quad.jpg', 'p3_orange.png']); await p.waitForTimeout(500);
  ok(/1 из 3/.test(await p.textContent('#metaBatch')), 'сводка по пакету: «Геолокация найдена на 1 из 3 фото»');
  ok(await p.evaluate(() => document.querySelectorAll('.thumb-gps').length === 1), 'значок GPS только у одного фото из трёх');
  await p.evaluate(() => select(2)); await p.waitForTimeout(500);
  ok(/не JPG/.test(await p.textContent('#metaTable caption')), 'для PNG-исходника таблица объясняет, что метаданные не читаются');
  await p.evaluate(() => { S.format = 'png'; renderMetaInfo(); }); await p.waitForTimeout(400); ok(/В PNG метаданные камеры не записываются/.test(await p.textContent('#metaTable')), 'при выводе в PNG есть пояснение');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
