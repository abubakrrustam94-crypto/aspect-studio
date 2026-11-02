'use strict';
/* Aspect Studio — резервная копия всех настроек одним файлом: общие настройки, мои наборы, шаблон водяного знака, тема, акцент, недавние размеры.
   Фото и компоненты в файл не попадают. Импорт проверяет каждое значение (тип и допустимый ключ), чужие и испорченные поля отбрасывает. */
const BK_SKIP = ['view', 'pin'];
const BK_LS = { 'aspect-studio-presets': 'json', 'aspect-studio-wmtpl': 'json', 'aspect-studio-recent-presets': 'json', 'aspect-studio-accent': 'str', 'aspect-studio-theme': 'str' };
function bkBuild() {
  const out = {}; Object.keys(DEFAULTS).forEach(k => { if (!BK_SKIP.includes(k)) out[k] = S[k]; });
  const ls = {}; Object.keys(BK_LS).forEach(k => { try { const v = localStorage.getItem(k); if (v !== null) ls[k] = v; } catch (e) { /* пропускаем */ } });
  return { app: 'aspect-studio', kind: 'settings', version: APP_VERSION, saved: new Date().toISOString(), S: out, ls };
}
/* → { S, ls, nS, nLs } или null, если это не файл настроек */
function bkParse(text) {
  if (typeof text !== 'string' || text.length > 2e6) return null;
  let d; try { d = JSON.parse(text); } catch (e) { return null; }
  if (!d || d.app !== 'aspect-studio' || d.kind !== 'settings' || !d.S || typeof d.S !== 'object') return null;
  const s = {}; Object.keys(d.S).forEach(k => { if (k in DEFAULTS && !BK_SKIP.includes(k) && typeof d.S[k] === typeof DEFAULTS[k] && (typeof d.S[k] !== 'number' || Number.isFinite(d.S[k]))) s[k] = d.S[k]; });
  const ls = {};
  if (d.ls && typeof d.ls === 'object') Object.keys(d.ls).forEach(k => {
    const kind = BK_LS[k], v = d.ls[k]; if (!kind || typeof v !== 'string' || v.length > 5e5) return;
    if (kind === 'json') { try { JSON.parse(v); } catch (e) { return; } }
    if (k === 'aspect-studio-theme' && !['auto', 'light', 'dark'].includes(v)) return;
    if (k === 'aspect-studio-accent' && !(typeof ACCENTS !== 'undefined' && ACCENTS.some(a => a[0] === v))) return;
    ls[k] = v;
  });
  return { S: s, ls, nS: Object.keys(s).length, nLs: Object.keys(ls).length };
}
window.bkExport = function () {
  const data = bkBuild(), d = new Date(), stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `aspect-studio-settings-${stamp}.json`);
  toast('Настройки сохранены в файл');
};
window.bkImportText = function (text) {
  const r = bkParse(text);
  if (!r || !r.nS) { toast('Это не файл настроек Aspect Studio', true); return false; }
  histPush('importSettings');
  Object.assign(S, r.S);
  Object.keys(r.ls).forEach(k => { try { localStorage.setItem(k, r.ls[k]); } catch (e) { /* без хранилища */ } });
  if (r.ls['aspect-studio-presets']) { try { const l = JSON.parse(r.ls['aspect-studio-presets']); myPresets = (Array.isArray(l) ? l : []).filter(p => p && typeof p.name === 'string' && p.cfg && typeof p.cfg === 'object').slice(-30); renderPresets(); } catch (e) { /* пропускаем */ } }
  if (r.ls['aspect-studio-accent']) applyAccent(r.ls['aspect-studio-accent']);
  if (r.ls['aspect-studio-theme']) { const t = r.ls['aspect-studio-theme']; applyTheme(t === 'auto' ? sysTheme() : t, t); }
  save(); syncUI(); renderThumbs(); schedule();
  toast(`Настройки загружены: ${r.nS} параметров, остальное из файла тоже применено`, false, { action: { label: 'Отменить', fn: () => histUndo() }, ms: 9000 });
  return true;
};
