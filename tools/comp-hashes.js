'use strict';
/* Записывает SHA-256 каждого файла компонентов в js/components.js (третий элемент: ['путь', размер, 'хеш']).
   Запуск после любого обновления файлов в vendor/:  node tools/comp-hashes.js
   Проверка без записи (её делает tests/components.js и CI):  node tools/comp-hashes.js --check */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..'), file = path.join(ROOT, 'js/components.js'), check = process.argv.includes('--check');
let src = fs.readFileSync(file, 'utf8'), bad = 0, n = 0;
src = src.replace(/\['(vendor\/[^']+)', (\d+)(?:, '([0-9a-f]{64})')?\]/g, (m, p, size, old) => {
  const f = path.join(ROOT, p); n++;
  if (!fs.existsSync(f)) { console.log('нет файла: ' + p); bad++; return m; }
  const buf = fs.readFileSync(f), h = crypto.createHash('sha256').update(buf).digest('hex');
  if (buf.length !== +size) { console.log(`размер не совпал: ${p} (${buf.length} вместо ${size})`); bad++; }
  if (check && old !== h) { console.log(`хеш не совпал: ${p}`); bad++; }
  return `['${p}', ${size}, '${h}']`;
});
if (!check) fs.writeFileSync(file, src);
console.log(`${check ? 'Проверено' : 'Записано'} файлов: ${n}${bad ? ', проблем: ' + bad : ''}`); process.exit(bad ? 1 : 0);
