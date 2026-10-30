// Si ya hay una sesión abierta, entra directo a la pantalla del rol
(function () {
  const session = Store.getSession();
  if (session && ROLE_HOME[session.role]) window.location.replace(ROLE_HOME[session.role]);
})();

document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const msg = document.getElementById('loginMsg');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const card = document.getElementById('loginCard');
  const btn = e.target.querySelector('button[type="submit"]');

  msg.className = 'hidden';
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const data = await Backend.handle('/api/login', { method: 'POST', body: { username, password } });

    window.location.href = ROLE_HOME[data.role] || 'login.html';
  } catch (err) {
    msg.className = 'alert error';
    msg.textContent = err.message;
    btn.disabled = false;
    btn.textContent = 'Entrar';
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  }
});
