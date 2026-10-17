// Автотесты Aspect Studio. Запуск:  npm i playwright && node tests/run.js
// (в Termux: pkg install chromium-подобный не нужен — запускай на ПК/CI)
const { chromium } = require('playwright');
const path = require('path'), url = 'file://' + path.resolve(__dirname, '../index.html');
const img = path.resolve(__dirname, 'quad.png');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.setInputFiles('#fileInput', [img]); await p.waitForTimeout(800);
  ok(await p.evaluate(() => items.length) === 1, 'фото загружено');
  ok(await p.evaluate(() => document.fonts.check('16px "Roboto Flex"')), 'шрифт Roboto Flex доступен локально');
  // кроппер: фокус и ловушка Tab
  await p.focus('#cropBtn'); await p.$eval('#cropBtn', e => e.click()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.activeElement.id) === 'cpDone', 'фокус ушёл в окно обрезки');
  for (let i = 0; i < 30; i++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.closest('#cropper') !== null), 'Tab не выходит из окна обрезки');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.activeElement.id) === 'cropBtn', 'фокус вернулся на кнопку');
  // поворот + отражение
  await p.$eval('#cropBtn', e => e.click()); await p.waitForTimeout(300);
  await p.$eval('#cpRotR', e => e.click()); await p.$eval('#cpFlipH', e => e.click()); await p.$eval('#cpDone', e => e.click()); await p.waitForTimeout(600);
  const q = await p.evaluate(async () => { const m = await loadBitmap(items[0]), c = document.createElement('canvas'); c.width = m.width; c.height = m.height; const x = c.getContext('2d'); x.drawImage(m, 0, 0); const g = (a, b) => [...x.getImageData(a, b, 1, 1).data].slice(0, 3).join(); return [g(5, 5), g(m.width - 5, 5), g(5, m.height - 5), g(m.width - 5, m.height - 5)]; });
  ok(q.join('|') === '255,0,0|0,200,0|0,0,255|255,255,0', 'поворот 90° + отражение: цвета углов верные');
  // индивидуальные настройки
  await p.$eval('#scopeSeg [data-s="one"]', e => e.click()); await p.evaluate(() => set('ratioW', 1)); await p.evaluate(() => set('ratioH', 1));
  ok(await p.evaluate(() => items[0].ov && items[0].ov.ratioW === 1 && S.ratioW !== 1), 'настройки только для этого фото не трогают общие');
  // aria-pressed
  ok(await p.$$eval('.seg button', n => n.every(x => x.hasAttribute('aria-pressed'))), 'aria-pressed у всех переключателей');
  // отмена удаления
  await p.evaluate(() => removeItem(0)); ok(await p.evaluate(() => items.length) === 0, 'удаление');
  await p.evaluate(() => undoTrash()); ok(await p.evaluate(() => items.length) === 1, 'отмена удаления');
  // блок 5: пресеты, размер файла, выбор для ZIP, акцент
  ok(await p.$$eval('#presetChips .chip-title', e => e.length) >= 3, 'пресеты разбиты на группы');
  await p.$eval('#scopeSeg [data-s="all"]', e => e.click());
  await p.$eval('#presetChips [data-id="wb"]', e => e.click());
  ok(await p.evaluate(() => S.outW === 900 && S.outH === 1200), 'пресет Wildberries 900×1200');
  await p.evaluate(() => { S.format = 'jpg'; S.targetOn = true; S.targetKB = 40; S.sizeMode = 'fixed'; S.enhOn = false; });
  const kb = await p.evaluate(async () => { const it = items[0], bmp = await loadBitmap(it); const r = await exportBlob(it, bmp); return r.blob.size / 1024; });
  ok(kb <= 40, 'сжатие до 40 КБ: ' + kb.toFixed(1) + ' КБ');
  await p.evaluate(() => { S.targetOn = false; });
  await p.$eval('.thumb .thumb-sel', e => e.click());
  ok(await p.evaluate(() => items[0].skip === true) && /0 из 1|ZIP/.test(await p.textContent('#zipLabel')), 'фото можно исключить из ZIP');
  await p.$eval('#accentRow [data-id="green"]', e => e.click());
  ok(await p.evaluate(() => document.getElementById('accentStyle').textContent.includes('hsl(142')), 'акцентный цвет применяется');
  // вкладки настроек
  const tabsOk = await p.evaluate(() => {
    const res = {};
    for (const t of ['frame', 'bg', 'quality', 'extra', 'export']) {
      document.querySelector(`#settingsTabs [data-tab="${t}"]`).click();
      res[t] = [...document.querySelectorAll('#colSettings > .card[data-tab]')].filter(c => c.offsetParent).map(c => c.dataset.tab);
    }
    return Object.entries(res).every(([t, v]) => v.length && v.every(x => x === t));
  });
  ok(tabsOk, 'вкладки показывают только свои карточки');
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
