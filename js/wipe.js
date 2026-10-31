'use strict';
/* Aspect Studio — «Стереть все данные сайта»: настройки, сохранённая сессия, компоненты, кэши и фоновый сервис-воркер на этом устройстве */
async function wipeAllData() {
  window.wiping = true;
  const errors = [];
  const step = async (name, fn) => { try { await fn(); } catch (e) { errors.push(name); console.warn('wipe', name, e); } };
  await step('localStorage', async () => { Object.keys(localStorage).filter(k => k.startsWith('aspect-studio')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); });
  await step('IndexedDB', async () => {
    const names = new Set([SESS_DB]);
    if (indexedDB.databases) (await indexedDB.databases()).forEach(d => d.name && names.add(d.name));
    await Promise.all([...names].map(n => new Promise(res => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
  });
  await step('Cache Storage', async () => { if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map(k => caches.delete(k))); });
  await step('OPFS', async () => {
    if (!(navigator.storage && navigator.storage.getDirectory)) return;
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
  });
  await step('Service Worker', async () => { if (navigator.serviceWorker) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister())); });
  return errors;
}
(function () {
  const btn = $('#wipeBtn'); if (!btn) return;
  let armed = 0, timer = 0; const label = btn.textContent;
  const disarm = () => { armed = 0; clearTimeout(timer); btn.textContent = label; btn.classList.remove('armed'); };
  btn.addEventListener('click', async () => {
    if (exporting || busy) { toast('Дождись окончания обработки', true); return; }
    if (!armed) { armed = 1; btn.textContent = 'Точно стереть? Нажми ещё раз'; btn.classList.add('armed'); timer = setTimeout(disarm, 6000); return; }
    disarm(); btn.disabled = true;
    const errs = await wipeAllData();
    toast(errs.length ? `Стёрто, кроме: ${errs.join(', ')}. Страница перезагрузится` : 'Все данные сайта стёрты. Страница перезагрузится');
    setTimeout(() => location.reload(), 1200);
  });
})();
