// Блок D1: начало работы, режим слабого телефона, доступность, английский интерфейс.
// Запуск: node tests/d1.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), FX = path.join(__dirname, 'fixtures');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const SEEN = () => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); };
(async () => {
  await new Promise(r => server.listen(8812, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8812/'); await p.evaluate(SEEN); await p.reload(); await p.waitForTimeout(800);
  // --- Начало работы ---
  await p.click('#startBtn'); await p.waitForSelector('#startDlg:not([hidden])');
  ok(await p.evaluate(() => document.querySelectorAll('#stList .st-item').length === ST_SCENARIOS.length && ST_SCENARIOS.length >= 8), 'окно «Начало работы»: сценарии показаны');
  const plan = await p.evaluate(() => ST_SCENARIOS.map(sc => { const pl = stPlan(sc), pr = PRESETS.find(x => x.id === pl.presetId); return { id: sc.id, ok: !pl.presetId || (pr && pr.w === pl.outW && pr.h === pl.outH), keys: Object.keys(pl).every(k => k in DEFAULTS && typeof pl[k] === typeof DEFAULTS[k]) }; }));
  ok(plan.every(x => x.ok && x.keys), 'у каждого сценария размеры совпадают с готовым размером, а ключи настроек существуют');
  await p.click('#stList [data-id=story]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => S.presetId === 'story' && S.outW === 1080 && S.outH === 1920 && S.sizeMode === 'fixed' && S.fit === 'fit' && document.querySelector('#startDlg').hidden), 'сценарий «Сторис» поставил 1080×1920, «Вписать», окно закрылось');
  await p.evaluate(() => histUndo()); await p.waitForTimeout(300);
  ok(await p.evaluate(() => S.presetId !== 'story' || S.sizeMode !== 'fixed'), 'шаг назад отменяет сценарий');
  await p.click('#startBtn'); await p.keyboard.press('Escape'); ok(await p.evaluate(() => document.querySelector('#startDlg').hidden && document.activeElement.id === 'startBtn'), 'Esc закрывает окно, фокус возвращается');
  // --- режим слабого телефона ---
  await p.setInputFiles('#fileInput', path.join(FX, 'face_astronaut.jpg')); await p.waitForFunction(() => items.length === 1); await p.waitForTimeout(500);
  const lt = await p.evaluate(() => { const r = {}; S.liteMode = 'off'; r.off = liteOn(); S.liteMode = 'on'; r.on = liteOn(); r.cfg = liteCfg({ depthOn: true, retouchOn: true, lowOn: true, srModel: 'x', dnModel: 'y', cutQuality: 'precise', enhScale: 3, format: 'png' });
    S.maxSide = 8192; r.cap = computeSize(6000, 4000, 0, { ...S, sizeMode: 'auto', ratioW: 3, ratioH: 2, fit: 'fit', enhOn: false }); S.liteMode = 'auto'; localStorage.setItem(SPEED_KEY, JSON.stringify({ score: 1500 })); r.slow = liteOn() && /скорост/.test(liteReason());
    localStorage.setItem(SPEED_KEY, JSON.stringify({ score: 200 })); r.fast = liteOn(); localStorage.removeItem(SPEED_KEY); return r; });
  ok(!lt.off && lt.on, 'режим «Выключен» и «Включён» работают');
  ok(lt.cfg.depthOn === false && lt.cfg.retouchOn === false && lt.cfg.lowOn === false && lt.cfg.srModel === 'off' && lt.cfg.dnModel === 'off' && lt.cfg.cutQuality === 'fast' && lt.cfg.enhScale === 1 && lt.cfg.format === 'png', 'в режиме отключаются нейросети, остальное не трогается');
  ok(Math.max(lt.cap.cw, lt.cap.ch) <= 3000 && lt.cap.limited, `результат ограничен 3000 px (${lt.cap.cw}×${lt.cap.ch})`);
  ok(lt.slow && !lt.fast, 'Авто включается после медленной проверки скорости и не включается после быстрой');
  await p.evaluate(() => { S.liteMode = 'on'; syncUI(); });
  ok(await p.evaluate(() => !document.querySelector('#cardLiteNote').hidden && /Причина/.test(document.querySelector('#liteWhy').textContent)), 'в «Качестве» показана плашка с причиной');
  await p.evaluate(() => set('depthOn', true)); ok(await p.evaluate(() => !S.depthOn), 'включить тяжёлую функцию в этом режиме нельзя, пользователь получает объяснение');
  const rr = await p.evaluate(async () => { set('lowOn', false); const it = items[0]; Object.assign(S, { retouchOn: true, retouchAmt: 100 }); const c = document.createElement('canvas'); const bmp = await loadBitmap(it); const r = await render(c, it, bmp, { cap: 300 }); closeBmp(bmp); return { cw: r.cw, rt: !!(it.rt && Object.keys(it.rt).length) }; });
  ok(rr.cw > 0 && !rr.rt, 'при включённой ретуши в режиме слабого телефона нейросеть даже не запускается');
  await p.evaluate(() => { S.retouchOn = false; S.liteMode = 'off'; syncUI(); });
  // --- доступность ---
  ok(await p.evaluate(() => [...document.querySelectorAll('.skip-link')].length === 2 && document.querySelector('.skip-link').getAttribute('href') === '#colSettings' && document.querySelector('#colSettings').tabIndex === -1), 'ссылки «К настройкам» и «К превью» на месте');
  await p.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex'); scrollTo(0, 0); });
  await p.keyboard.press('Tab');
  await p.waitForTimeout(400); ok(await p.evaluate(() => document.activeElement.classList.contains('skip-link') && document.activeElement.getBoundingClientRect().top >= 0), 'первый Tab попадает на ссылку пропуска, и она видна');
  await p.evaluate(() => { set('view', 'slider'); document.querySelector('#sliderHandle').focus(); });
  const sl = async k => { await p.keyboard.press(k); return p.evaluate(() => +document.querySelector('#sliderHandle').getAttribute('aria-valuenow')); };
  const s0 = await p.evaluate(() => +document.querySelector('#sliderHandle').getAttribute('aria-valuenow')); const sEnd = await sl('End'), sHome = await sl('Home'), sUp = await sl('PageUp'), sL = await sl('ArrowLeft');
  ok(sEnd === 97 && sHome === 3 && sUp === 23 && sL === 18 && s0 > 3, `граница «до/после» с клавиатуры: End=${sEnd}, Home=${sHome}, PageUp=${sUp}, ←=${sL}`);
  ok(await p.evaluate(() => /Оригинал \d+%, результат \d+%/.test(document.querySelector('#sliderHandle').getAttribute('aria-valuetext'))), 'у границы есть понятный aria-valuetext');
  await p.click('#settingsTabs [data-tab=extra]');
  await p.click('#cardAccess [data-val="130"]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.style.fontSize === '130%' && parseFloat(getComputedStyle(document.body).fontSize) > 17), 'размер текста 130% увеличивает шрифт');
  await p.evaluate(() => { set('uiContrast', true); set('uiMotion', true); });
  ok(await p.evaluate(() => document.documentElement.dataset.contrast === 'high' && document.documentElement.dataset.motion === 'reduce'), 'высокий контраст и «без анимации» включаются');
  const cr = await p.evaluate(() => { const rl = c => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; }; const t = getComputedStyle(document.querySelector('.card-title')).color, bg = getComputedStyle(document.body).backgroundColor; const a = rl(t), b = rl(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); });
  ok(cr >= 7, `в режиме высокого контраста заголовки читаются (контраст ${cr.toFixed(1)}:1)`);
  await p.waitForTimeout(500); await p.reload(); await p.waitForTimeout(800);
  ok(await p.evaluate(() => document.documentElement.style.fontSize === '130%' && document.documentElement.dataset.contrast === 'high'), 'настройки читаемости сохраняются после перезагрузки');
  await p.evaluate(() => { set('uiScale', 100); set('uiContrast', false); set('uiMotion', false); });
  ok(await p.evaluate(() => document.documentElement.style.fontSize === '' && !document.documentElement.dataset.contrast), 'возврат к обычному виду');
  // --- английский ---
  await p.click('#settingsTabs [data-tab=export]'); await p.waitForTimeout(150);
  await p.evaluate(() => { document.querySelector('#toast').textContent = ''; });
  const ruShot = await p.evaluate(() => document.body.innerText);
  await p.evaluate(() => set('lang', 'en')); await p.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('#settingsTabs [data-tab=frame]').textContent.includes('Frame'), null, { timeout: 8000 });
  const en = await p.evaluate(() => ({ title: document.title, start: document.querySelector('#startBtn').getAttribute('aria-label'), tab: [...document.querySelectorAll('#settingsTabs button')].map(b => b.textContent.trim()), preset: document.querySelector('#presetChips .chip').textContent, undo: document.querySelector('#undoBtn').getAttribute('aria-label') || document.querySelector('#undoBtn').title }));
  ok(/without cropping/.test(en.title) && en.start === 'Getting started' && en.tab.some(t => /Frame/.test(t)) && /YouTube|Instagram/.test(en.preset) && /Undo/i.test(en.undo), `интерфейс переключился (${en.tab.join(' / ')})`);
  await p.evaluate(() => toast('Настройки применены к 3 фото')); await p.waitForTimeout(100);
  ok((await p.textContent('#toast')).includes('Settings applied to 3 photos'), 'сообщения по шаблонам переводятся вместе с числами');
  await p.evaluate(() => toast('Скачивание: Real-ESRGAN')); await p.waitForTimeout(100); ok((await p.textContent('#toast')).startsWith('Downloading:'), 'сообщения с хвостом переводятся по началу');
  await p.evaluate(() => { const d = document.createElement('div'); d.id = 'dynTest'; d.textContent = 'Сохранить'; document.body.appendChild(d); }); await p.waitForTimeout(100);
  ok((await p.textContent('#dynTest')) === 'Save', 'новые элементы, добавленные позже, тоже переводятся');
  await p.click('#settingsTabs [data-tab=export]'); await p.waitForTimeout(150);
  const left = await p.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement && !['SCRIPT', 'STYLE', 'TEXTAREA'].includes(n.parentElement.nodeName) && /[А-Яа-я]/.test(n.nodeValue) ? 1 : 3 }); for (let n = w.nextNode(); n; n = w.nextNode()) if (!/[{]|Mozilla|^Язык|^Русский/.test(n.nodeValue)) out.push(n.nodeValue.trim()); let tot = 0; const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w2.nextNode(); n; n = w2.nextNode()) if (n.nodeValue.trim()) tot++; return { out, tot }; });
  console.log('   осталось по-русски:', left.out.length, 'из', left.tot, '\n'+left.out.join('\n'));
  ok(left.out.length <= left.tot * .02, `почти весь текст страницы переведён (по-русски осталось ${left.out.length} из ${left.tot})`);
  await p.evaluate(() => set('lang', 'ru')); await p.waitForFunction(() => document.documentElement.lang === 'ru' && document.querySelector('#settingsTabs [data-tab=frame]').textContent.includes('Кадр'), null, { timeout: 8000 });
  await p.evaluate(() => { document.querySelector('#dynTest').remove(); document.querySelector('#toast').textContent = ''; });
  const ruBack = await p.evaluate(() => document.body.innerText); { const a = ruShot.split('\n'), c = ruBack.split('\n'); for (let i = 0; i < Math.max(a.length, c.length); i++) if (a[i] !== c[i]) { console.log('   различие в строке', i, JSON.stringify(a[i]), '→', JSON.stringify(c[i])); break; } }
  ok(ruBack === ruShot, 'возврат на русский восстанавливает исходный текст полностью');
  ok(errs.length === 0, 'ошибок страницы нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); server.close(); console.log(fail ? `ПРОВАЛ: ${fail}` : 'Все проверки пройдены'); process.exit(fail ? 1 : 0);
})();
