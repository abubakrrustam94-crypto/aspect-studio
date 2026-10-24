/* Статический аудит кода сайта (ESLint + проверка глобальных имён между скриптами).
   Запуск: NODE_PATH=<путь к node_modules с eslint и globals> node tools/audit.js
   Основные скрипты страницы (порядок как в index.html) считаются одной общей областью видимости; воркеры и тесты проверяются отдельно. */
const fs = require('fs'), path = require('path');
let eslintVer = 0; try { eslintVer = +require('eslint/package.json').version.split('.')[0]; } catch (e) {}
if (eslintVer < 9) { console.log('Аудит пропущен: не установлен eslint 9 или новее.\nУстановка (один раз): npm i --no-save eslint@9 globals@15\nНа телефоне в Termux это долго и не обязательно: аудит запускается в GitHub Actions при каждом push.'); process.exit(0); }
const { ESLint } = require('eslint'); const globalsPkg = require('globals'); const espree = require('espree');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const main = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
const workers = fs.readdirSync(path.join(ROOT, 'js')).map(f => 'js/' + f).filter(f => /worker\.js$/.test(f));
// 1. все имена верхнего уровня основных скриптов и их дубли
const top = new Map(), dups = [];
for (const f of main) {
  const ast = espree.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'), { ecmaVersion: 2022, sourceType: 'script' });
  const add = n => { if (top.has(n) && top.get(n) !== f) dups.push(`${n}: ${top.get(n)} и ${f}`); else if (top.has(n)) dups.push(`${n}: объявлено дважды в ${f}`); top.set(n, f); };
  for (const s of ast.body) {
    if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') add(s.id.name);
    else if (s.type === 'VariableDeclaration') for (const d of s.declarations) { const walk = p => { if (p.type === 'Identifier') add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach(x => walk(x.value || x.argument)); else if (p.type === 'ArrayPattern') p.elements.forEach(x => x && walk(x)); else if (p.type === 'AssignmentPattern') walk(p.left); else if (p.type === 'RestElement') walk(p.argument); }; walk(d.id); }
  }
}
const g = {}; top.forEach((_, n) => { g[n] = 'writable'; });
const rules = { 'no-undef': 'error', 'no-const-assign': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-func-assign': 'error', 'no-unreachable': 'warn', 'no-self-assign': 'warn', 'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }], 'no-redeclare': ['error', { builtinGlobals: false }], 'no-shadow-restricted-names': 'error', 'no-use-before-define': 'off', 'no-empty': 'off', 'use-isnan': 'error', 'valid-typeof': 'error', 'no-cond-assign': 'warn', 'no-fallthrough': 'warn', 'no-loss-of-precision': 'warn', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-sparse-arrays': 'warn', 'no-prototype-builtins': 'off', 'getter-return': 'error', 'no-async-promise-executor': 'warn', 'require-atomic-updates': 'off' };
(async () => {
  const mk = (files, globals, extra = {}) => ({ files, languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals, ...extra } }, rules, linterOptions: { reportUnusedDisableDirectives: false } });
  const browser = { ...globalsPkg.browser, ...globalsPkg.es2021, FaceDetector: 'readonly', setSettingsTab: 'readonly', libheif: 'readonly', jxlDecoder: 'readonly', parseExr: 'readonly' };   // браузерный API и библиотеки из vendor/, которые подгружаются по требованию
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
    mk(main.map(f => f), { ...browser, ...g }),
    mk(workers, { ...globalsPkg.worker, ...globalsPkg.es2021, ort: 'readonly', importScripts: 'readonly', UTIF: 'readonly', pako: 'readonly' })
  ], cwd: ROOT });
  const res = await eslint.lintFiles([...main, ...workers]);
  let errors = 0, warns = 0; const out = [];
  for (const r of res) for (const m of r.messages) { (m.severity === 2 ? errors++ : warns++); out.push(`${m.severity === 2 ? 'ОШИБКА' : 'замечание'} ${path.relative(ROOT, r.filePath)}:${m.line} ${m.ruleId}: ${m.message}`); }
  // 2. офлайн: каждый скрипт и воркер должен быть в списке CORE service worker'а, а каждый файл из CORE — существовать
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), core = [...sw.slice(sw.indexOf('const CORE')).split('\n')[0].matchAll(/'\.\/([^']+)'/g)].map(m => m[1]);
  [...main, ...workers].forEach(f => { if (!core.includes(f)) { errors++; out.push('ОШИБКА офлайн: ' + f + ' нет в CORE service worker\'а'); } });
  core.forEach(f => { if (f && !fs.existsSync(path.join(ROOT, f))) { errors++; out.push('ОШИБКА офлайн: файл из CORE не существует → ' + f); } });
  // 3. утечки ссылок на файлы: на каждый createObjectURL должен быть revokeObjectURL в том же файле
  for (const f of main) { const t = fs.readFileSync(path.join(ROOT, f), 'utf8'), a = (t.match(/createObjectURL/g) || []).length, b = (t.match(/revokeObjectURL/g) || []).length; if (a && !b) { warns++; out.push(`замечание ${f}: createObjectURL (${a}) без revokeObjectURL`); } }
  dups.forEach(d => { errors++; out.push('ОШИБКА дубль глобального имени → ' + d); });
  console.log(out.join('\n') || 'Замечаний нет'); console.log(`\nФайлов: ${main.length + workers.length}, глобальных имён: ${top.size}, ошибок: ${errors}, замечаний: ${warns}`);
  process.exit(errors ? 1 : 0);
})();
