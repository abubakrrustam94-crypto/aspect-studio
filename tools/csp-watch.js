'use strict';
/* Подключается к каждому тесту (node --require): следит за страницами Playwright и считает нарушения политики безопасности (CSP).
   Если хоть одно нарушение случилось, тест завершается с ошибкой, а в вывод попадает, что именно запретил браузер. */
const Module = require('module'), orig = Module.prototype.require, hits = [];
const watch = page => {
  // тест может отключить наблюдение (process.env.CSP_WATCH_OFF), если сам проверяет, что политика блокирует

  if (page.__cspWatch) return; page.__cspWatch = true;
  page.on('console', m => { if (process.env.CSP_WATCH_OFF) return; const t = m.text(); if (/Content Security Policy|Refused to (load|execute|connect|create|apply|evaluate|frame)/i.test(t)) hits.push(t.slice(0, 300)); });
};
Module.prototype.require = function (id) {
  const m = orig.apply(this, arguments);
  if (id === 'playwright' && m.chromium && !m.chromium.__cspWrapped) {
    m.chromium.__cspWrapped = true;
    const launch = m.chromium.launch.bind(m.chromium);
    m.chromium.launch = async (...a) => {
      const b = await launch(...a), newContext = b.newContext.bind(b);
      b.newContext = async (...c) => { const ctx = await newContext(...c); ctx.on('page', watch); const np = ctx.newPage.bind(ctx); ctx.newPage = async (...x) => { const p = await np(...x); watch(p); return p; }; return ctx; };
      const np = b.newPage.bind(b); b.newPage = async (...x) => { const p = await np(...x); watch(p); return p; };
      return b;
    };
  }
  return m;
};
process.on('exit', code => {
  if (!hits.length) return;
  console.log(`\n✘ Политика безопасности (CSP) запретила действия страницы: ${hits.length}`); [...new Set(hits)].slice(0, 5).forEach(h => console.log('  ' + h));
  if (!code) process.exitCode = 1;
});
