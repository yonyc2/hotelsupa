// =====================================================
// CAPA DE DATOS CON SUPABASE
// Mantiene las rutas /api/... que usan las pantallas, pero ahora cada una llama a Supabase.
// Las reglas de negocio (límites, check-out, códigos únicos...) viven en la base de datos
// como funciones (ver supabase/schema.sql); aquí solo se traducen las peticiones.
// =====================================================
const Backend = (() => {
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const fail = (status, message) => { throw new ApiError(status, message); };

  const emailFor = u => (u.includes('@') ? u : `${u}@${CONFIG.EMAIL_DOMAIN}`);
  const q = v => encodeURIComponent(v);
  const toJsonText = v => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));

  const fmtCdmx = iso => !iso ? '' : new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(iso));

  // Convierte errores de Supabase en errores con estado HTTP para las pantallas
  function normalize(e) {
    if (e instanceof ApiError) return e;
    const msg = e && e.message ? e.message : 'Error inesperado';
    let status = e && e.status;
    if (msg === 'No autenticado' || msg === 'Sesión expirada') status = 401;
    if (!status || status === 0) status = 400;
    if (/permission denied|row-level security/i.test(msg)) return new ApiError(403, 'Sin permiso para esta acción');
    return new ApiError(status, msg);
  }

  // ---------- Login / logout ----------
  async function login(body) {
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) fail(400, 'Usuario y contraseña requeridos');
    if (username.length > 100 || password.length > 128) fail(401, 'Usuario o contraseña incorrectos');

    const uname = username.trim();
    const userKey = `u|${uname.toLowerCase()}`, navKey = 'i|navegador';
    const wait = Math.max(Store.lockRemaining(userKey), Store.lockRemaining(navKey));
    if (wait > 0) fail(429, `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(wait / 60000)} minuto(s).`);

    let tokens;
    try {
      tokens = await Supa.signIn(emailFor(uname), password);
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 422) {
        Store.registerFail(userKey, 5); Store.registerFail(navKey, 30);
        fail(401, 'Usuario o contraseña incorrectos');
      }
      if (e.status === 429) fail(429, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
      throw e;
    }

    Store.setAuth(tokens, null);
    let profile;
    try {
      const rows = await Supa.select('profiles', `select=username,full_name,role,active&id=eq.${q(tokens.user.id)}`);
      profile = rows[0];
    } catch (e) {
      Store.clearAuth();
      throw e;
    }

    if (!profile) { await Supa.signOut(); Store.clearAuth(); fail(403, 'Este usuario no tiene perfil. Avisa a un administrador.'); }
    if (!profile.active) { await Supa.signOut(); Store.clearAuth(); fail(403, 'Tu usuario está inactivo. Pide a un administrador que lo active.'); }

    Store.clearFails(userKey);
    Store.setAuth(tokens, profile);
    try { await Supa.rpc('log_event', { p_action: 'LOGIN' }); } catch (e) { /* no bloquea el acceso */ }
    return { role: profile.role, fullName: profile.full_name };
  }

  async function logout() {
    try { await Supa.rpc('log_event', { p_action: 'LOGOUT' }); } catch (e) { /* ignore */ }
    await Supa.signOut();
    Store.clearAuth();
    return { ok: true };
  }

  // ---------- Huéspedes ----------
  function listStays(params) {
    const status = ['activo', 'salido', 'todos'].includes(params.get('status')) ? params.get('status') : 'activo';
    // Se quitan caracteres que rompen el filtro (* , ( ) : % _ \ comillas)
    const text = (params.get('q') || '').slice(0, 100).replace(/[*,():%_\\"']/g, '').trim();

    let query = 'select=*&order=status.asc,id.desc&limit=300';
    if (status !== 'todos') query += `&status=eq.${status}`;
    if (text) {
      const t = q(text);
      query += `&or=(guest_name.ilike.*${t}*,room_number.ilike.*${t}*,guest_barcode.ilike.*${t}*)`;
    }
    return Supa.select('v_stays', query);
  }

  async function getStay(id) {
    const rows = await Supa.select('v_stays', `select=*&id=eq.${id}`);
    if (!rows.length) fail(404, 'Huésped no encontrado');
    const movements = await Supa.select('v_movements', `select=*&stay_id=eq.${id}&order=id.desc&limit=30`);
    return { ...rows[0], movements };
  }

  const createStay = body => Supa.rpc('create_stay', {
    p_guest_name: body.guest_name, p_room_number: body.room_number, p_guest_barcode: body.guest_barcode,
    p_towel_limit: body.towel_limit, p_initial_towels: body.initial_towels, p_comment: body.comment
  });

  const updateStay = (id, body) => Supa.rpc('update_stay', {
    p_id: id, p_towel_limit: body.towel_limit, p_comment: body.comment, p_guest_name: body.guest_name,
    p_room_number: body.room_number, p_guest_barcode: body.guest_barcode
  });

  const moveTowels = (id, body) => Supa.rpc('move_towels', { p_stay_id: id, p_action: body.action, p_qty: body.qty, p_reason: body.reason });
  const checkout = id => Supa.rpc('checkout_stay', { p_id: id });
  const scan = code => Supa.rpc('scan_stay', { p_code: code });

  // ---------- Historial ----------
  async function history(params) {
    const limit = Math.min(Number(params.get('limit')) || 200, 1000);
    const stayId = Number(params.get('stay_id')) || 0;
    const rows = await Supa.select('v_history', `select=*&order=id.desc&limit=${limit}${stayId ? `&stay_id=eq.${stayId}` : ''}`);
    return rows.map(h => ({ ...h, old_values: toJsonText(h.old_values), new_values: toJsonText(h.new_values) }));
  }

  // ---------- Usuarios ----------
  async function listUsers() {
    const rows = await Supa.select('profiles', 'select=id,username,full_name,role,active,created_at&order=created_at.asc');
    return rows.map(u => ({ ...u, created_at_cdmx: fmtCdmx(u.created_at) }));
  }

  async function createUser(body) {
    const { username, password, full_name, role } = body;
    if (!username || !password || !full_name || !role) fail(400, 'Todos los campos son requeridos');
    if (!['admin', 'recepcion', 'toallero'].includes(role)) fail(400, 'Rol inválido');
    const uname = String(username).trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(uname)) fail(400, 'El usuario debe tener de 3 a 32 caracteres (letras, números, punto, guion)');
    const pw = String(password);
    if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) fail(400, 'La contraseña debe tener al menos 8 caracteres, con letras y números');

    try {
      await Supa.callFunction('create-user', { username: uname, email: emailFor(uname).toLowerCase(), password: pw, full_name: String(full_name).trim(), role });
    } catch (e) {
      // Si la función no existe, el navegador la reporta como 404 o como "sin conexión" (el 404 no trae permisos CORS)
      if (e.status === 404 || e.status === 0) {
        fail(404, 'No se pudo llamar a la función "create-user": lo más probable es que no esté publicada en Supabase (ver supabase/LEEME.md, punto 4). Mientras tanto crea el usuario en Authentication > Users.');
      }
      throw e;
    }
    return { ok: true };
  }

  async function toggleUser(id) {
    const rows = await Supa.select('profiles', `select=id,active&id=eq.${q(id)}`);
    if (!rows.length) fail(404, 'Usuario no encontrado');
    await Supa.rpc('admin_set_profile', { p_id: id, p_active: !rows[0].active });
    return { ok: true };
  }

  // ---------- Exportar a Excel / respaldo ----------
  async function readAll() {
    const [profiles, stays, movements, history] = await Promise.all([
      Supa.selectAll('profiles', 'select=*&order=created_at.asc,id.asc'),
      Supa.selectAll('v_stays'),
      Supa.selectAll('v_movements'),
      Supa.selectAll('v_history')
    ]);
    return { profiles, stays, movements, history };
  }

  async function snapshot() {
    const s = await readAll();
    // Las vistas traen columnas de más (nombres, fechas CDMX): el respaldo guarda las tablas base
    const strip = (rows, extra) => rows.map(r => { const o = { ...r }; extra.forEach(k => delete o[k]); return o; });
    return {
      app: 'hotel-toallas', version: 3, exported_at: new Date().toISOString(),
      data: {
        profiles: s.profiles,
        stays: strip(s.stays, ['entry_date_cdmx', 'exit_date_cdmx']),
        movements: strip(s.movements, ['created_at_cdmx', 'username', 'guest_name', 'room_number']),
        history: strip(s.history, ['created_at_cdmx', 'username', 'full_name', 'guest_name', 'room_number'])
      }
    };
  }

  async function exportDatabase() {
    const { profiles, stays, movements, history } = await readAll();
    const un = id => (profiles.find(u => u.id === id) || {}).username || '';

    const blob = Xlsx.build([
      ['Usuarios', ['ID', 'Usuario', 'Nombre', 'Rol', 'Activo', 'Creado (CDMX)'],
        profiles.map(u => [u.id, u.username, u.full_name, u.role, u.active ? 'Sí' : 'No', fmtCdmx(u.created_at)])],
      ['Huespedes', ['ID', 'Código', 'Huésped', 'Habitación', 'Estado', 'Entrada (CDMX)', 'Salida (CDMX)', 'Límite toallas',
        'Toallas iniciales', 'Toallas actuales', 'Comentario', 'Creado por', 'Actualizado por'],
        stays.map(s => [s.id, s.guest_barcode, s.guest_name, s.room_number, s.status, s.entry_date_cdmx, s.exit_date_cdmx || '',
          s.towel_limit, s.initial_towels, s.current_towels, s.comment, un(s.created_by), un(s.updated_by)])],
      ['Movimientos', ['ID', 'Fecha (CDMX)', 'Huésped', 'Habitación', 'Usuario', 'Tipo', 'Cantidad', 'Saldo después', 'Motivo'],
        movements.map(m => [m.id, m.created_at_cdmx, m.guest_name, m.room_number, m.username, m.movement_type, m.quantity, m.balance_after, m.reason || ''])],
      ['Historial', ['ID', 'Fecha (CDMX)', 'Usuario', 'Acción', 'Huésped', 'Habitación', 'Valores anteriores', 'Valores nuevos'],
        history.map(h => [h.id, h.created_at_cdmx, h.username || '', h.action, h.guest_name || '', h.room_number || '', toJsonText(h.old_values) || '', toJsonText(h.new_values) || ''])]
    ]);

    // Solo se borra el historial que ya quedó dentro del Excel
    const maxId = history.length ? Math.max(...history.map(h => h.id)) : 0;
    await Supa.rpc('purge_history', { p_max_id: maxId });

    const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date()).replace(/[-: ]/g, '');
    return { blob, filename: `toallas-respaldo-${stamp}.xlsx` };
  }

  // ---------- Enrutador ----------
  async function handle(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const u = new URL(url, 'http://local');
    const path = u.pathname, params = u.searchParams;
    const body = options.body && typeof options.body === 'object' ? options.body : {};
    let m;

    try {
      if (method === 'POST' && path === '/api/login') return await login(body);
      if (method === 'POST' && path === '/api/logout') return await logout();
      if (method === 'GET' && path === '/api/version') return await Supa.rpc('data_version');

      if (method === 'GET' && path === '/api/stays') return await listStays(params);
      if (method === 'POST' && path === '/api/stays') return await createStay(body);
      if ((m = path.match(/^\/api\/stays\/(\d+)$/))) {
        if (method === 'GET') return await getStay(Number(m[1]));
        if (method === 'PATCH') return await updateStay(Number(m[1]), body);
      }
      if (method === 'POST' && (m = path.match(/^\/api\/stays\/(\d+)\/towels$/))) return await moveTowels(Number(m[1]), body);
      if (method === 'POST' && (m = path.match(/^\/api\/stays\/(\d+)\/checkout$/))) return await checkout(Number(m[1]));
      if (method === 'GET' && (m = path.match(/^\/api\/scan\/(.+)$/))) return await scan(decodeURIComponent(m[1]));

      if (method === 'GET' && path === '/api/report/towels') return await Supa.rpc('towel_report', { p_from: params.get('from'), p_to: params.get('to') });
      if (method === 'GET' && path === '/api/history') return await history(params);

      if (method === 'GET' && path === '/api/users') return await listUsers();
      if (method === 'POST' && path === '/api/users') return await createUser(body);
      if (method === 'POST' && (m = path.match(/^\/api\/users\/([0-9a-fA-F-]{36})\/toggle$/))) return await toggleUser(m[1]);
      if (method === 'GET' && path === '/api/security/default-passwords') return [];   // ya no hay usuarios con contraseña por defecto

      if (method === 'POST' && path === '/api/export-db') return await exportDatabase();
      if (method === 'POST' && path === '/api/purge-stays') return await Supa.rpc('purge_stays_until', { p_until: body.until, p_apply: !!body.apply });
    } catch (e) {
      throw normalize(e);
    }

    throw new ApiError(404, 'Ruta no encontrada');
  }

  return { handle, snapshot, ApiError };
})();
