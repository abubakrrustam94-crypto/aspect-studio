// Блок I: параллельный экспорт. Результат должен совпадать с последовательным, отмена и ошибки — работать.
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const FX = path.join(__dirname, 'fixtures'), URL_ = 'file://' + path.resolve(__dirname, '..', 'index.html');
let fail = 0; const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) fail++; };
const names = buf => { const out = []; for (let i = 0; i < buf.length - 30; i++) if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 3 && buf[i + 3] === 4) { const n = buf.readUInt16LE(i + 26), e = buf.readUInt16LE(i + 28); out.push(buf.slice(i + 30, i + 30 + n).toString('utf8')); i += 29 + n + e; } return out; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1000, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_); await p.evaluate(() => { localStorage.setItem('aspect-studio-onboarded', '1'); localStorage.setItem('aspect-studio-seen', '999'); }); await p.reload(); await p.waitForTimeout(500);
  await p.setInputFiles('#fileInput', ['face_two.jpg', 'noface_coffee.jpg', 'noface_rocket.jpg', 'face_astronaut.jpg', 'face_small.jpg', 'quad.jpg'].map(f => path.join(FX, f)));
  await p.waitForFunction(() => items.length === 6, null, { timeout: 30000 }); await p.waitForTimeout(600);
  await p.evaluate(() => { S.fit = 'fill'; S.format = 'jpg'; S.faceAI = false; S.diskZip = false; S.enhOn = true; S.enhScale = 1; });
  const run = async n => {
    await p.evaluate(n => { window.EXPORT_CONC = n; }, n);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.evaluate(() => exportAll())]);
    const f = await dl.path(); return fs.readFileSync(f);
  };
  const z1 = await run(1), z3 = await run(3), n1 = names(z1), n3 = names(z3);
  ok(n1.length === 6 && JSON.stringify(n1) === JSON.stringify(n3), 'ZIP из трёх потоков: те же 6 файлов в том же порядке, что и из одного: ' + n3.join(', '));
  ok(Math.abs(z1.length - z3.length) / z1.length < 0.02, `размер архивов совпадает (${z1.length} и ${z3.length} байт)`);
  // ошибка в одном фото не останавливает остальные
  const r = await p.evaluate(async () => {
    window.EXPORT_CONC = 3; const bad = items[2]; const orig = bad.file; bad.file = new File([new Uint8Array(10)], 'bad.jpg', { type: 'image/jpeg' }); bad.url = URL.createObjectURL(bad.file);
    const got = []; await pooledExport(items.slice(), 3, async (it, res, e) => { got.push(it.name + ':' + (e ? 'err' : 'ok')); });
    bad.file = orig; return got;
  });
  ok(r.length === 6 && r.filter(x => /err/.test(x)).length === 1 && r.filter(x => /ok/.test(x)).length === 5, 'одно битое фото из шести: остальные пять обработаны, ошибка передана отдельно: ' + r.join(' '));
  // порядок приёма — как в списке
  const ord = await p.evaluate(async () => { const got = []; await pooledExport(items.slice(), 3, async it => { got.push(it.name); }); return got.join('|') === items.map(i => i.name).join('|'); });
  ok(ord, 'результаты принимаются строго в порядке списка');
  // отмена
  const c = await p.evaluate(async () => { S.enhScale = 2; let n = 0; window.cancelFlag = false; const t = pooledExport(items.slice(), 3, async () => { n++; cancelFlag = true; return true; }); await t; cancelFlag = false; S.enhScale = 1; return { n, pool: exPool.length }; });
  ok(c.n === 1 && c.pool === 1, 'остановка из обработчика прекращает работу, пул возвращается к одному воркеру');
  // выбор числа потоков
  const cc = await p.evaluate(() => { delete window.EXPORT_CONC; const one = exportConcurrency([items[0]]), many = exportConcurrency(items); S.sizeMode = 'fixed'; S.outW = 6000; S.outH = 6000; const big = exportConcurrency(items); S.sizeMode = 'auto'; return { one, many, big, max: MAX_AREA }; });
  ok(cc.one === 1 && cc.big === 1 && cc.many >= 1 && cc.many <= 3, `потоков: одно фото ${cc.one}, шесть фото ${cc.many}, огромные кадры ${cc.big}`);
  ok(!errs.length, 'нет ошибок JS' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close(); console.log(fail ? `\nПровалено: ${fail}` : '\nВсе тесты пройдены'); process.exit(fail ? 1 : 0);
})();
