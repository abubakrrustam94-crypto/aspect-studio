// Проверка доступности (axe-core): светлая и тёмная темы, все вкладки настроек, окна.  Запуск: node tests/a11y.js
// Падает на нарушениях уровня serious/critical; остальные выводит как замечания.
const { chromium } = require('playwright');
const path = require('path');
let axeSrc; try { axeSrc = require.resolve('axe-core/axe.min.js'); } catch (e) { console.log('axe-core не установлен: npm i axe-core'); process.exit(1); }
const url = 'file://' + path.resolve(__dirname, '../index.html'), FX = path.join(__dirname, 'fixtures');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SHOW = process.argv.includes('-v');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } });
  await ctx.addInitScript(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(500);
  await p.addScriptTag({ path: axeSrc });
  await p.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });   // иначе axe ловит цвета посреди анимации
  const minor = new Map();
  const scan = async label => {
    const r = await p.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] })).violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' → ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 160)), n: v.nodes.length })));
    const bad = r.filter(v => v.impact === 'serious' || v.impact === 'critical'), rest = r.filter(v => !(v.impact === 'serious' || v.impact === 'critical'));
    rest.forEach(v => minor.set(v.id, v));
    ok(!bad.length, `${label}: нет серьёзных нарушений` + (bad.length ? '\n' + bad.map(v => `    · [${v.impact}] ${v.id} ×${v.n}: ${v.help}\n      ${v.nodes.join('\n      ')}`).join('\n') : ''));
  };
  await scan('пустой экран, светлая тема');
  await p.setInputFiles('#fileInput', [path.join(FX, 'quad.jpg'), path.join(FX, 'quad.gif'), path.join(FX, 'exif_gps.jpg')]); await p.waitForFunction(() => items.length === 3); await p.waitForTimeout(600);
  for (const tab of ['frame', 'bg', 'quality', 'extra', 'export', 'meta', 'components', 'about']) {
    await p.click(`#settingsTabs [data-tab=${tab}]`); await p.waitForTimeout(250);
    if (tab === 'extra') await p.evaluate(() => set('wmOn', true));
    if (tab === 'bg') await p.evaluate(() => { set('cutOn', true); set('cutBg', 'color'); });
    if (tab === 'meta') await p.evaluate(() => { set('meta', 'custom'); set('metaDpi', 300); });
    if (tab === 'export') await p.evaluate(() => { set('targetOn', true); });
    await scan('вкладка «' + tab + '», светлая тема');
  }
  await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await p.waitForTimeout(300);
  for (const tab of ['frame', 'bg', 'quality', 'extra', 'export', 'meta', 'components', 'about']) { await p.click(`#settingsTabs [data-tab=${tab}]`); await p.waitForTimeout(200); await scan('вкладка «' + tab + '», тёмная тема'); }
  await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });
  // окно обрезки и справка
  await p.click('#cropBtn'); await p.waitForFunction(() => cp.open, null, { timeout: 8000 }); await p.waitForTimeout(500);
  await scan('окно обрезки'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.evaluate(() => typeof onbOpen === 'function' && onbOpen()); await p.waitForTimeout(500); await scan('подсказки для новичка'); await p.keyboard.press('Escape');
  await p.evaluate(() => wnOpen()); await p.waitForTimeout(300); await scan('окно «Что нового»'); await p.keyboard.press('Escape');
  if (SHOW || minor.size) { console.log('\nЗамечания (не серьёзные):'); minor.forEach(v => console.log(`  · [${v.impact}] ${v.id} ×${v.n}: ${v.help}\n      ${v.nodes.slice(0, 2).join('\n      ')}`)); }
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
