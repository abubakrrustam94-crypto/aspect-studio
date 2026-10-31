/* Запуск тестов: node tools/run-tests.js [--fast] [--jobs N]
   По умолчанию все тесты, по 2 одновременно (у каждого свой порт); --fast пропускает тяжёлые тесты нейросетей и больших фото.
   Сначала всегда идёт статический аудит (tools/audit.js), если установлен eslint. */
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), args = process.argv.slice(2), fast = args.includes('--fast');
const jobs = +(args[args.indexOf('--jobs') + 1]) || 2;
const HEAVY = ['formats', 'stress', 'large', 'speed', 'quality', 'cutout', 'cutout2', 'sr', 'detect', 'denoise', 'erase', 'raw', 'encode'];
const all = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => /^[a-z0-9]+\.js$/.test(f)).map(f => f.replace('.js', '')).filter(n => !['make_raw'].includes(n));
const list = all.filter(n => !(fast && HEAVY.includes(n)));
const run = (cmd, argv) => new Promise(res => { const t = Date.now(), p = spawn(cmd, argv, { cwd: ROOT, env: { ...process.env, NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --require ' + path.join(ROOT, 'tools/csp-watch.js')).trim() } }); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); p.on('close', code => res({ code, out, ms: Date.now() - t })); });
(async () => {
  const t0 = Date.now(); let bad = 0;
  try { require.resolve('eslint'); const a = await run('node', ['tools/audit.js']); console.log(`${a.code ? '✘' : '✔'} audit (${(a.ms / 1000).toFixed(0)} с)`); if (a.code) { bad++; console.log(a.out); } } catch (e) { console.log('- audit пропущен: eslint не установлен'); }
  const queue = list.slice(); const results = [];
  await Promise.all(Array.from({ length: jobs }, async () => { for (let n; (n = queue.shift());) { const r = await run('node', ['tests/' + n + '.js']); const okk = r.code === 0; results.push([n, okk, r.ms]); console.log(`${okk ? '✔' : '✘'} ${n} (${(r.ms / 1000).toFixed(0)} с)`); if (!okk) { bad++; console.log(r.out.split('\n').filter(l => /✘|Error|Провал/.test(l)).slice(0, 12).join('\n')); } } }));
  console.log(`\n${bad ? 'Провалено наборов: ' + bad : 'Все тесты пройдены'} · ${list.length} наборов${fast ? ' (быстрый режим)' : ''} за ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
  process.exit(bad ? 1 : 0);
})();
