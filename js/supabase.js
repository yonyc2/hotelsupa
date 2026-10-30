// =====================================================
// CLIENTE MÍNIMO DE SUPABASE (sin librerías): Auth + REST (PostgREST) + funciones RPC
// =====================================================
const Supa = (() => {
  const base = CONFIG.SUPABASE_URL.replace(/\/+$/, '');

  class HttpError extends Error {
    constructor(status, message, code) { super(message); this.status = status; this.code = code; }
  }

  async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
    const h = { apikey: CONFIG.SUPABASE_KEY, ...headers };
    if (token) h.Authorization = 'Bearer ' + token;
    if (body !== undefined) h['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new HttpError(0, 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
    }

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }

    if (!res.ok) {
      const msg = (data && typeof data === 'object' && (data.message || data.msg || data.error_description || data.error)) || `Error ${res.status}`;
      throw new HttpError(res.status, msg, data && typeof data === 'object' ? (data.code || data.error_code || data.error) : undefined);
    }
    return data;
  }

  // ---- Autenticación ----
  const signIn = (email, password) => raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });

  async function signOut() {
    const a = Store.getAuth();
    if (a) { try { await raw('/auth/v1/logout', { method: 'POST', token: a.access_token }); } catch (e) { /* ignore */ } }
  }

  // Devuelve un token vigente; lo renueva si le queda menos de 1 minuto (con candado entre pestañas)
  async function validToken(force = false) {
    const a = Store.getAuth();
    if (!a) throw new HttpError(401, 'No autenticado');
    if (!force && a.expires_at * 1000 - Date.now() > 60000) return a.access_token;

    const refresh = async () => {
      const cur = Store.getAuth();
      if (!cur) throw new HttpError(401, 'No autenticado');
      // Otra pestaña ya lo renovó mientras esperábamos el candado
      if (cur.access_token !== a.access_token && cur.expires_at * 1000 - Date.now() > 60000) return cur.access_token;
      try {
        const r = await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: cur.refresh_token } });
        Store.setAuth(r);
        return r.access_token;
      } catch (e) {
        if (e.status >= 400 && e.status < 500) { Store.clearAuth(); throw new HttpError(401, 'Sesión expirada'); }
        throw e;
      }
    };
    return navigator.locks ? navigator.locks.request('toallas-refresh', refresh) : refresh();
  }

  // Petición con sesión: renueva el token si hace falta y reintenta una vez si llega un 401
  async function authed(path, opts = {}) {
    let token = await validToken();
    try {
      return await raw(path, { ...opts, token });
    } catch (e) {
      if (e.status === 401) {
        token = await validToken(true);
        return raw(path, { ...opts, token });
      }
      throw e;
    }
  }

  const rpc = (fn, args = {}) => authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
  const select = (table, query) => authed(`/rest/v1/${table}?${query}`);

  // Lee TODAS las filas (PostgREST entrega máximo 1000 por petición)
  async function selectAll(table, query = 'select=*&order=id.asc') {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const rows = await select(table, `${query}&limit=1000&offset=${offset}`);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  const callFunction = (name, body) => authed(`/functions/v1/${name}`, { method: 'POST', body });

  return { HttpError, signIn, signOut, rpc, select, selectAll, callFunction };
})();
