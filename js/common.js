// Las pantallas siguen llamando api('/api/...'): ahora lo atiende Backend (backend.js) en el propio navegador.
async function api(url, options = {}) {
  try {
    return await Backend.handle(url, options);
  } catch (err) {
    if (err && err.status === 401 && !url.includes('/api/login')) {
      window.location.href = 'login.html';
      throw new Error('Sesión expirada');
    }
    throw err;
  }
}

async function logout() {
  try {
    await Backend.handle('/api/logout', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  window.location.href = 'login.html';
}

// Protección de páginas (antes la hacía el servidor): sin sesión o sin el rol adecuado se redirige.
const ROLE_HOME = { admin: 'admin.html', recepcion: 'recepcion.html', toallero: 'toallero.html' };

function guardPage() {
  const allowed = (document.body.dataset.roles || '').split(',').filter(Boolean);
  if (!allowed.length) return true;                       // página pública (login)
  const session = Store.getSession();
  if (!session) { window.location.replace('login.html'); return false; }
  if (!allowed.includes(session.role)) { window.location.replace(ROLE_HOME[session.role] || 'login.html'); return false; }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const _msgTimers = {};

function showMessage(elementId, message, type = 'error') {
  const el = document.getElementById(elementId);
  if (!el) return;

  clearTimeout(_msgTimers[elementId]);
  el.className = `alert ${type}`;
  el.textContent = message;

  _msgTimers[elementId] = setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', (e) => {
      if (e.animationName === 'alertOut') el.classList.add('hidden');
    }, { once: true });
  }, 6000);
}

// Anima las filas solo en la primera carga (evita parpadeo en actualizaciones en tiempo real)
function animateRows(tbody) {
  if (!tbody || tbody.dataset.seen) return;
  tbody.dataset.seen = '1';
  tbody.classList.add('stagger');
  setTimeout(() => tbody.classList.remove('stagger'), 900);
}

// Cambia un texto y resalta el valor si cambió
function setTextAnimated(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const next = String(value ?? '');
  const changed = el.textContent !== '' && el.textContent !== next;
  el.textContent = next;
  if (changed) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}

// Acciones de botones (sustituye a onclick en línea, bloqueado por la política CSP)
const actions = { logout };

guardPage();

// Menú para pasar entre pantallas: el administrador ve las tres; la recepcionista ve Recepción y Toallero
const NAV_PAGES = {
  admin: [['admin.html', 'Administración'], ['recepcion.html', 'Recepción'], ['toallero.html', 'Toallero']],
  recepcion: [['recepcion.html', 'Recepción'], ['toallero.html', 'Toallero']]
};

function buildAdminNav() {
  const session = Store.getSession();
  const bar = document.querySelector('.topbar');
  if (!session || !NAV_PAGES[session.role] || !bar || bar.querySelector('[data-nav]')) return;

  const current = window.location.pathname.split('/').pop() || 'index.html';
  const nav = document.createElement('div');
  nav.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; flex: 1; margin-left: 16px;';

  NAV_PAGES[session.role].forEach(([page, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.nav = page;
    if (page !== current) btn.className = 'secondary';
    else btn.setAttribute('aria-current', 'page');
    nav.appendChild(btn);
  });

  const title = bar.querySelector('strong');
  if (title) title.after(nav); else bar.prepend(nav);
}

buildAdminNav();

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-nav]');
  if (btn && btn.dataset.nav !== (window.location.pathname.split('/').pop() || '')) window.location.href = btn.dataset.nav;
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const fn = actions[btn.dataset.action];
  if (typeof fn === 'function') {
    const raw = btn.dataset.id;
    // Los ids de huéspedes son números; los de usuarios son UUID (texto)
    fn(raw === undefined ? undefined : (/^\d+$/.test(raw) ? Number(raw) : raw), btn);
  }
});

// Actualización entre dispositivos: cada pocos segundos se consulta un número de versión
// (data_version en Supabase). Solo cuando cambia se vuelven a cargar los datos de la pantalla.
const _pollers = [];
let _lastVersion = null, _pollTimer = null, _polling = false;

async function pollVersion() {
  if (_polling || document.hidden || !Store.getSession()) return;
  _polling = true;
  try {
    const v = await Backend.handle('/api/version');
    if (_lastVersion !== null && v !== _lastVersion) {
      _pollers.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    }
    _lastVersion = v;
  } catch (e) {
    // sin conexión o sesión vencida: se reintenta en el siguiente ciclo
  } finally {
    _polling = false;
  }
}

function startSocket(callback) {
  if (typeof callback !== 'function') return;
  _pollers.push(callback);
  if (_pollTimer) return;
  pollVersion();
  _pollTimer = setInterval(pollVersion, CONFIG.POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollVersion(); });
}

function debounce(fn, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}
