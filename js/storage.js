// =====================================================
// SESIÓN LOCAL
// La base de datos vive en Supabase. Aquí solo se guarda la sesión del navegador
// (tokens de acceso y datos del perfil) y el bloqueo por intentos fallidos.
// =====================================================
const Store = (() => {
  const AUTH_KEY = 'toallas_sb_auth';
  const LOCKS_KEY = 'toallas_locks';
  const LOCK_MS = 15 * 60 * 1000;

  const getAuth = () => {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; }
  };

  // tokens = respuesta de Supabase Auth; profile = {username, full_name, role} (o null mientras se carga)
  function setAuth(tokens, profile) {
    const prev = getAuth() || {};
    localStorage.setItem(AUTH_KEY, JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at || Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
      user_id: (tokens.user && tokens.user.id) || prev.user_id,
      profile: profile === undefined ? prev.profile : profile
    }));
  }

  const clearAuth = () => localStorage.removeItem(AUTH_KEY);

  // Datos de la sesión para las pantallas (el rol real lo vuelve a validar Supabase en cada acción)
  function getSession() {
    const a = getAuth();
    if (!a || !a.profile || !a.refresh_token) return null;
    return { userId: a.user_id, role: a.profile.role, fullName: a.profile.full_name };
  }

  // ---- Bloqueo por intentos fallidos (se conserva aunque recargues la página) ----
  const readLocks = () => { try { return JSON.parse(localStorage.getItem(LOCKS_KEY)) || {}; } catch (e) { return {}; } };
  const writeLocks = l => localStorage.setItem(LOCKS_KEY, JSON.stringify(l));

  function lockRemaining(key) {
    const l = readLocks(), e = l[key];
    if (!e || !e.lockedUntil) return 0;
    if (e.lockedUntil <= Date.now()) { delete l[key]; writeLocks(l); return 0; }
    return e.lockedUntil - Date.now();
  }
  function registerFail(key, max) {
    const l = readLocks(), e = l[key] || { count: 0 };
    e.count += 1;
    if (e.count >= max) { e.lockedUntil = Date.now() + LOCK_MS; e.count = 0; }
    l[key] = e; writeLocks(l);
  }
  function clearFails(key) { const l = readLocks(); delete l[key]; writeLocks(l); }

  return { getAuth, setAuth, clearAuth, getSession, lockRemaining, registerFail, clearFails };
})();
