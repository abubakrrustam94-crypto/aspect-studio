/* Генерация иконок из одного рисунка: node tools/gen-icons.js (нужен playwright). Результат кладётся в корень проекта.
   icon-192/512.png: скруглённые, для «any». icon-maskable-192/512.png и icon-180.png: непрозрачный квадрат без скруглений
   (лаунчер сам вырежет форму; apple-touch-icon не должен быть прозрачным, иначе Android кладёт под него белую плашку).
   icon-mono-512.png: белый силуэт на прозрачном фоне для тематических иконок Android 13+. */
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const art = (s, ink) => `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">
  <rect x="96" y="176" width="320" height="180" rx="28" fill="none" stroke="${ink || '#fff'}" ${ink ? '' : 'stroke-opacity=".7"'} stroke-width="14" stroke-dasharray="26 18"/>
  <rect x="176" y="124" width="160" height="264" rx="22" fill="${ink || '#fff'}"/>
  ${ink ? '' : '<circle cx="256" cy="212" r="26" fill="#7c3aed" fill-opacity=".9"/><path d="M176 350l62-74 46 52 28-32 24 54z" fill="#0891b2" fill-opacity=".95"/>'}
</g>`;
const grad = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs>';
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${inner}</svg>`;
const ICONS = {
  'icon-192.png': [192, svg(`${grad}<rect width="512" height="512" rx="128" fill="url(#g)"/>${art(1)}`), true],
  'icon-512.png': [512, svg(`${grad}<rect width="512" height="512" rx="128" fill="url(#g)"/>${art(1)}`), true],
  'icon-maskable-192.png': [192, svg(`${grad}<rect width="512" height="512" fill="url(#g)"/>${art(.8)}`), false],
  'icon-maskable-512.png': [512, svg(`${grad}<rect width="512" height="512" fill="url(#g)"/>${art(.8)}`), false],
  'icon-180.png': [180, svg(`${grad}<rect width="512" height="512" fill="url(#g)"/>${art(.9)}`), false],
  'icon-mono-512.png': [512, svg(`<mask id="m"><rect width="512" height="512" fill="#000"/><g transform="translate(256 256) scale(.8) translate(-256 -256)"><rect x="96" y="176" width="320" height="180" rx="28" fill="none" stroke="#fff" stroke-width="14" stroke-dasharray="26 18"/><rect x="176" y="124" width="160" height="264" rx="22" fill="#fff"/><circle cx="256" cy="212" r="26" fill="#000"/><path d="M176 350l62-74 46 52 28-32 24 54z" fill="#000"/></g></mask><rect width="512" height="512" fill="#fff" mask="url(#m)"/>`), true],
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, [size, markup, transparent]] of Object.entries(ICONS)) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<style>html,body{margin:0;background:${transparent ? 'transparent' : '#fff'}}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
    await p.screenshot({ path: path.join(ROOT, name), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('✔', name);
  }
  await b.close();
})();
