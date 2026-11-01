'use strict';
/* Отчёт о весе сайта: что грузится при старте (скрипты из index.html), что лениво, что тяжелее всего.
   Запуск:  node tools/size-report.js          — таблица
            node tools/size-report.js --check  — ещё и проверка бюджета из tools/budget.json (падает при превышении) */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..'), check = process.argv.includes('--check');
const read = f => fs.readFileSync(path.join(ROOT, f));
const gz = b => zlib.gzipSync(b, { level: 9 }).length;
const html = read('index.html').toString('utf8');
const eager = [...html.matchAll(/<script[^>]*\bsrc="(js\/[^"]+)"/g)].map(m => m[1]);
const all = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
const workers = all.filter(f => /-worker\.js$/.test(f));
const lazy = all.filter(f => !eager.includes(f) && !workers.includes(f));
const rows = f => { const b = read(f); return { f, raw: b.length, gz: gz(b) }; };
const E = eager.map(rows), Lz = lazy.map(rows), Wk = workers.map(rows);
const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
const kb = n => (n / 1024).toFixed(1).padStart(7) + ' КБ';
console.log('Грузится при старте (' + E.length + ' скриптов):');
[...E].sort((a, b) => b.raw - a.raw).slice(0, 8).forEach(r => console.log('  ' + r.f.padEnd(24) + kb(r.raw) + '  (сжато ' + kb(r.gz).trim() + ')'));
console.log('  ИТОГО скрипты'.padEnd(26) + kb(sum(E, 'raw')) + '  (сжато ' + kb(sum(E, 'gz')).trim() + ')');
console.log('Лениво (по требованию): ' + Lz.map(r => r.f.replace('js/', '') + ' ' + (r.raw / 1024).toFixed(0) + ' КБ').join(', '));
console.log('Воркеры: ' + Wk.map(r => r.f.replace('js/', '') + ' ' + (r.raw / 1024).toFixed(0) + ' КБ').join(', '));
const css = read('css/style.css'), idx = read('index.html');
console.log(`HTML ${kb(idx.length).trim()} (сжато ${kb(gz(idx)).trim()}), CSS ${kb(css.length).trim()} (сжато ${kb(gz(css)).trim()})`);
const startGz = sum(E, 'gz') + gz(css) + gz(idx);
console.log('Старт всего (сжато): ' + kb(startGz).trim());
const du = d => { let s = 0; const w = p => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); e.isDirectory() ? w(f) : s += fs.statSync(f).size; } }; if (fs.existsSync(d)) w(d); return s; };
console.log('Vendor (по требованию): ' + fs.readdirSync(path.join(ROOT, 'vendor'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).map(n => n + ' ' + (du(path.join(ROOT, 'vendor', n)) / 1048576).toFixed(1) + ' МБ').join(', '));
if (check) {
  const B = JSON.parse(read('tools/budget.json').toString('utf8')), cur = { startGz, eagerRaw: sum(E, 'raw'), eagerCount: E.length };
  let bad = 0;
  for (const k of Object.keys(B)) { const over = cur[k] > B[k]; console.log(`${over ? '✘' : '✔'} бюджет ${k}: ${cur[k]} из ${B[k]}`); if (over) bad++; }
  if (bad) { console.log('\nСтарт стал тяжелее бюджета. Если это осознанно — подними значение в tools/budget.json.'); process.exit(1); }
}
