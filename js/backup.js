// =====================================================
// RESPALDOS
// - Carpeta de respaldos automáticos diarios (Chrome/Edge): se guardan los últimos 14.
// - Respaldo manual (.json) con todas las tablas.
// =====================================================
const Backup = (() => {
  const LAST_KEY = 'toallas_last_backup';
  const supported = typeof window.showDirectoryPicker === 'function';

  // ---- Carpeta elegida (se recuerda en IndexedDB) ----
  const openIdb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('toallas-backup', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const idbGet = async key => { const db = await openIdb(); return new Promise((res, rej) => { const r = db.transaction('handles').objectStore('handles').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };
  const idbSet = async (key, val) => { const db = await openIdb(); return new Promise((res, rej) => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); };

  async function getFolder(askPermission = false) {
    if (!supported) return null;
    try {
      const handle = await idbGet('dir');
      if (!handle) return null;
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && askPermission) perm = await handle.requestPermission({ mode: 'readwrite' });
      return perm === 'granted' ? handle : null;
    } catch (e) { return null; }
  }

  async function chooseFolder() {
    if (!supported) throw new Error('Este navegador no permite elegir una carpeta. Usa Chrome o Edge.');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet('dir', handle);
    return handle;
  }

  async function hasFolderConfigured() {
    try { return !!(supported && await idbGet('dir')); } catch (e) { return false; }
  }

  async function writeFile(folder, name, text) {
    const fh = await folder.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  // ---- Contenido del respaldo ----
  const snapshotText = async () => JSON.stringify(await Backend.snapshot());
  const cdmxNow = () => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());
  const stamp = () => cdmxNow().replace(/[-: ]/g, '').slice(0, 12);

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Guarda un respaldo en la carpeta elegida; si no hay carpeta, lo descarga.
  // Devuelve 'carpeta' o 'descarga'.
  async function save(label) {
    const name = `toallas-${label}-${stamp()}.json`;
    const text = await snapshotText();
    const folder = await getFolder(true);
    if (folder) {
      await writeFile(folder, name, text);
      localStorage.setItem(LAST_KEY, cdmxNow());
      return 'carpeta';
    }
    download(new Blob([text], { type: 'application/json' }), name);
    localStorage.setItem(LAST_KEY, cdmxNow());
    return 'descarga';
  }

  // Respaldo automático diario (se ejecuta al abrir la administración). Conserva los últimos 14.
  async function auto() {
    const folder = await getFolder(false);
    if (!folder) return false;
    const name = `toallas-auto-${cdmxNow().slice(0, 10)}.json`;
    try {
      await folder.getFileHandle(name);           // ya existe el de hoy
      return true;
    } catch (e) { /* no existe: se crea */ }
    await writeFile(folder, name, await snapshotText());
    localStorage.setItem(LAST_KEY, cdmxNow());

    const names = [];
    for await (const [n] of folder.entries()) if (/^toallas-auto-.*\.json$/.test(n)) names.push(n);
    names.sort();
    while (names.length > 14) await folder.removeEntry(names.shift());
    return true;
  }

  async function statusText() {
    const last = localStorage.getItem(LAST_KEY);
    const lastTxt = last ? `Último respaldo: ${last}.` : 'Aún no se ha hecho ningún respaldo.';
    if (!supported) return `${lastTxt} Tu navegador no permite respaldos automáticos en carpeta; usa Chrome o Edge, o descarga respaldos manuales.`;
    if (!(await hasFolderConfigured())) return `${lastTxt} Respaldo automático: sin carpeta elegida.`;
    return `${lastTxt} Respaldo automático: carpeta elegida${(await getFolder(false)) ? ' (activo).' : ' (haz clic en "Respaldar ahora" para reactivar el permiso).'}`;
  }

  return { supported, chooseFolder, getFolder, save, auto, download, statusText };
})();
