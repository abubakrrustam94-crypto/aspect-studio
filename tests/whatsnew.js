// «Что нового»: окно после обновления, кнопка в «О программе», согласованность версий.  Запуск: node tests/whatsnew.js
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const url = 'file://' + path.resolve(__dirname, '../index.html'), ROOT = path.resolve(__dirname, '..');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
(async () => {
  const b = await chromium.launch();
  const mk = async (store) => { const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto(url); if (store) { await p.evaluate(s => { for (const k in s) localStorage.setItem(k, s[k]); }, store); await p.reload(); } await p.waitForTimeout(1500); return p; };
  const ver = fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
  // 1. первый запуск: показывается обучение, а не «Что нового»; версия запоминается молча
  let p = await mk(null);
  ok(await p.evaluate(() => document.getElementById('whatsnew').hidden && !document.getElementById('onboard').hidden), 'первый запуск: только обучение');
  ok(await p.evaluate(v => localStorage.getItem('aspect-studio-seen') === v, ver), 'версия запомнена без показа окна');
  // 2. обновление со старой версии
  p = await mk({ 'aspect-studio-onboarded': '1', 'aspect-studio-seen': '2.0.0' });
  ok(await p.evaluate(() => !document.getElementById('whatsnew').hidden), 'после обновления окно открывается само');
  const txt = await p.textContent('#wnList');
  ok(txt.includes('v' + ver) && txt.includes('мозаик'), 'в окне есть список изменений с текущей версией');
  ok(await p.evaluate(() => document.activeElement.id === 'wnClose'), 'фокус на кнопке «Понятно»');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.evaluate(v => document.getElementById('whatsnew').hidden && localStorage.getItem('aspect-studio-seen') === v, ver), 'Esc закрывает и запоминает версию');
  await p.reload(); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => document.getElementById('whatsnew').hidden), 'после перезагрузки окно не повторяется');
  // 3. кнопка в «О программе»
  await p.click('#settingsTabs [data-tab=extra]'); await p.click('#wnOpenBtn'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => !document.getElementById('whatsnew').hidden && document.querySelectorAll('#wnList h3').length >= 5), 'кнопка «Что нового» открывает полный список');
  await p.click('#wnClose'); ok(await p.evaluate(() => document.getElementById('whatsnew').hidden), 'кнопка «Понятно» закрывает окно');
  ok(!p.errs.length, 'нет ошибок JS');
  // 4. более новая сохранённая версия (откат) окно не открывает
  p = await mk({ 'aspect-studio-onboarded': '1', 'aspect-studio-seen': '99.0.0' });
  ok(await p.evaluate(() => document.getElementById('whatsnew').hidden), 'при откате на старую версию окно не показывается');
  // 5. согласованность версий и файлов
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const list = await p.evaluate(() => CHANGELOG.map(e => e.v));
  ok(list[0] === ver && pj.version === ver, `версии совпадают: приложение ${ver}, package.json ${pj.version}, список ${list[0]}`);
  ok(list.every(v => md.includes('## ' + v + ' ')), 'CHANGELOG.md содержит все версии из окна');
  ok(/aspect-studio-v\d+/.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')) && fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/changelog.js'), 'service worker кэширует changelog.js');
  await b.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
