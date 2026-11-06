'use strict';
/* Генератор страниц-сценариев, sitemap.xml и robots.txt.
   Запуск: node tools/gen-seo.js   (адрес сайта: SITE_URL=https://... node tools/gen-seo.js)
   Страницы — обычный статичный HTML без скриптов: работает на GitHub Pages без сборки. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = (process.env.SITE_URL || 'https://abubakrrustam94-crypto.github.io/aspect-studio/').replace(/\/?$/, '/');
const DATA = require('./seo-data.js');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const T = {
  ru: { app: 'Aspect Studio', tag: 'Смена формата фото без обрезки', open: 'Открыть редактор с этим размером', size: 'Размер', how: 'Как это сделать', faq: 'Частые вопросы', other: 'Другие сценарии', local: 'Фото не загружаются на сервер: всё считает твой браузер.',
    steps: ['Открой редактор и добавь фото.', 'Размер уже выбран, при желании поменяй фон или поля.', 'Нажми «Скачать».'], lang: 'English', free: 'Бесплатно, без регистрации' },
  en: { app: 'Aspect Studio', tag: 'Change a photo’s aspect ratio without cropping', open: 'Open the editor with this size', size: 'Size', how: 'How to do it', faq: 'FAQ', other: 'Other scenarios', local: 'Photos are never uploaded: your browser does all the work.',
    steps: ['Open the editor and add your photo.', 'The size is already selected; change the background or margins if you like.', 'Tap “Download”.'], lang: 'Русский', free: 'Free, no sign-up' },
};
const url = (lang, slug) => SITE + (lang === 'en' ? 'en/' : '') + slug + '/';
function page(lang, p) {
  const c = p[lang], t = T[lang], other = lang === 'ru' ? 'en' : 'ru', up = lang === 'en' ? '../../' : '../';
  const title = `${c.name} | ${t.app}`;
  const desc = c.lead.length > 160 ? c.lead.slice(0, 157).replace(/\s+\S*$/, '') + '…' : c.lead;
  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebApplication', name: t.app, url: SITE, applicationCategory: 'MultimediaApplication', operatingSystem: 'Any', inLanguage: lang, description: desc, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  const links = DATA.filter(x => x.slug !== p.slug).map(x => `<li><a href="${up}${lang === 'en' ? 'en/' : ''}${x.slug}/">${esc(x[lang].short)}</a></li>`).join('\n      ');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url(lang, p.slug)}">
<link rel="alternate" hreflang="ru" href="${url('ru', p.slug)}">
<link rel="alternate" hreflang="en" href="${url('en', p.slug)}">
<link rel="alternate" hreflang="x-default" href="${url('ru', p.slug)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url(lang, p.slug)}">
<meta property="og:image" content="${SITE}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${up}icon-192.png" type="image/png">
<link rel="stylesheet" href="${up}css/seo.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header class="top"><a class="brand" href="${up}">${t.app}</a><a class="lang" hreflang="${other}" href="${url(other, p.slug)}">${t.lang}</a></header>
<main>
  <h1>${esc(c.name)}</h1>
  <p class="lead">${esc(c.lead)}</p>
  <p class="cta"><a class="btn" href="${up}?scenario=${p.slug}">${t.open}</a><span class="muted">${t.free}. ${t.local}</span></p>
  <h2>${t.size}</h2>
  <p class="size"><strong>${esc(p.size)}</strong> (${esc(p.ratio)})</p>
  <ul>
${c.points.map(x => `    <li>${esc(x)}</li>`).join('\n')}
  </ul>
  <h2>${t.how}</h2>
  <ol>
${t.steps.map(x => `    <li>${esc(x)}</li>`).join('\n')}
  </ol>
  <h2>${t.faq}</h2>
${c.faq.map(([q, a]) => `  <h3>${esc(q)}</h3>\n  <p>${esc(a)}</p>`).join('\n')}
  <p class="cta"><a class="btn" href="${up}?scenario=${p.slug}">${t.open}</a></p>
  <nav class="more" aria-label="${t.other}"><h2>${t.other}</h2>
    <ul>
      ${links}
    </ul>
  </nav>
</main>
</body>
</html>
`;
}
const out = [];
for (const p of DATA) for (const lang of ['ru', 'en']) {
  const dir = path.join(ROOT, lang === 'en' ? 'en' : '', p.slug); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(lang, p)); out.push(url(lang, p.slug));
}
const today = new Date().toISOString().slice(0, 10);
const alt = (s) => `    <xhtml:link rel="alternate" hreflang="ru" href="${url('ru', s)}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${url('en', s)}"/>`;
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>
${DATA.flatMap(p => ['ru', 'en'].map(l => `  <url>\n    <loc>${url(l, p.slug)}</loc>\n    <lastmod>${today}</lastmod>\n${alt(p.slug)}\n  </url>`)).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sm);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
console.log(`Создано страниц: ${out.length}, sitemap.xml, robots.txt (адрес ${SITE})`);
