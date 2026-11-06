'use strict';
/* Картинка для превью ссылок (og.png, 1200×630). Запуск: node tools/gen-og.js  (нужен playwright) */
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), icon = fs.readFileSync(path.join(ROOT, 'icon-512.png')).toString('base64');
const html = `<html><body style="margin:0;width:1200px;height:630px;background:linear-gradient(135deg,#4b1fa3,#8b5cf6 55%,#c4a8ff);font-family:Roboto,system-ui,sans-serif;color:#fff;display:flex;align-items:center;padding:0 90px;box-sizing:border-box;gap:60px">
<div style="flex:1"><div style="font-size:84px;font-weight:800;letter-spacing:-2px;line-height:1">Aspect Studio</div>
<div style="font-size:40px;margin-top:22px;opacity:.95;line-height:1.3">Смена формата фото<br>без обрезки</div>
<div style="font-size:28px;margin-top:34px;opacity:.85">Бесплатно · работает в браузере</div></div>
<img src="data:image/png;base64,${icon}" style="width:300px;height:300px;border-radius:64px;box-shadow:0 20px 60px rgba(0,0,0,.35)"></body></html>`;
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1200, height: 630 } }); await p.setContent(html); await p.screenshot({ path: path.join(ROOT, 'og.png') }); await b.close(); console.log('og.png готов'); })();
