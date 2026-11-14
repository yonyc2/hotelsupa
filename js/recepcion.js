let staysCache = [];
let currentStay = null;

document.addEventListener('DOMContentLoaded', () => {
  loadStays();

  startSocket(() => {
    loadStays();
    if (currentStay && currentStay.id) {
      selectStay(currentStay.id);
    }
  });

  document.getElementById('newStayForm').addEventListener('submit', createStay);
  document.getElementById('searchInput').addEventListener('input', debounce(loadStays, 300));
  document.getElementById('showAll').addEventListener('change', loadStays);
  document.getElementById('saveStayBtn').addEventListener('click', saveCurrentStay);
  document.getElementById('editStayBtn').addEventListener('click', startEditStay);
  document.getElementById('giveTowelsBtn').addEventListener('click', () => moveTowels('entrega'));
  document.getElementById('receiveTowelsBtn').addEventListener('click', () => moveTowels('devolucion'));
  document.getElementById('cancelEditBtn').addEventListener('click', cancelEditStay);
  document.getElementById('checkoutBtn').addEventListener('click', checkoutCurrentStay);
});

async function loadStays() {
  try {
    const q = document.getElementById('searchInput').value.trim();
    const showAll = document.getElementById('showAll').checked;
    const status = showAll ? 'todos' : 'activo';

    const data = await api(`/api/stays?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    staysCache = data;
    renderStays();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

function renderStays() {
  const tbody = document.getElementById('staysBody');
  tbody.innerHTML = '';

  if (!staysCache.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">No hay huéspedes registrados</td>
      </tr>
    `;
    return;
  }

  for (const stay of staysCache) {
    const remaining = stay.towel_limit - stay.current_towels;
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escapeHtml(stay.room_number)}</td>
      <td>${escapeHtml(stay.guest_name)}</td>
      <td>${escapeHtml(stay.guest_barcode || '')}</td>
      <td>${escapeHtml(stay.towel_limit)}</td>
      <td>${escapeHtml(stay.current_towels)}</td>
      <td>${escapeHtml(remaining)}</td>
      <td>
        ${
          stay.status === 'activo'
            ? '<span class="badge ok">Activo</span>'
            : '<span class="badge error">Salido</span>'
        }
      </td>
      <td>
        <button class="small" data-action="selectStay" data-id="${escapeHtml(stay.id)}">Ver</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  animateRows(tbody);
}

async function createStay(e) {
  e.preventDefault();

  const payload = {
    guest_name: document.getElementById('guest_name').value,
    room_number: document.getElementById('room_number').value,
    guest_barcode: document.getElementById('guest_barcode').value.trim(),
    towel_limit: Number(document.getElementById('towel_limit').value),
    initial_towels: Number(document.getElementById('initial_towels').value),
    comment: document.getElementById('comment').value
  };

  try {
    const stay = await api('/api/stays', {
      method: 'POST',
      body: payload
    });

    showMessage('recepcionMsg', `Huésped registrado. Código de tarjeta: ${stay.guest_barcode}`, 'success');
    loadStays();
    e.target.reset();

    document.getElementById('towel_limit').value = 5;
    document.getElementById('initial_towels').value = 0;
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

let editingStayId = null;   // id del huésped que se está editando (null = modo lectura)

async function selectStay(id) {
  try {
    const stay = await api(`/api/stays/${id}`);
    // Si se elige a otro huésped mientras se edita, se cancela la edición
    if (editingStayId !== null && editingStayId !== stay.id) editingStayId = null;
    currentStay = stay;
    renderDetail();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

function fillEditInputs() {
  document.getElementById('editName').value = currentStay.guest_name;
  document.getElementById('editRoom').value = currentStay.room_number;
  document.getElementById('editBarcode').value = currentStay.guest_barcode;
  document.getElementById('detailLimit').value = currentStay.towel_limit;
  document.getElementById('detailComment').value = currentStay.comment || '';
}

function renderDetail() {
  if (!currentStay) return;

  document.getElementById('stayDetail').classList.remove('hidden');

  document.getElementById('detailName').textContent = currentStay.guest_name;
  document.getElementById('detailRoom').textContent = currentStay.room_number;
  document.getElementById('detailBarcode').textContent = currentStay.guest_barcode;
  document.getElementById('detailEntry').textContent = currentStay.entry_date_cdmx;
  document.getElementById('detailExit').textContent = currentStay.exit_date_cdmx || 'Pendiente';
  document.getElementById('detailStatus').textContent = currentStay.status;
  document.getElementById('detailLimitText').textContent = currentStay.towel_limit;
  document.getElementById('detailCommentText').textContent = currentStay.comment || '—';
  setTextAnimated('detailCurrent', currentStay.current_towels);
  setTextAnimated('detailRemaining', currentStay.towel_limit - currentStay.current_towels);

  // Mientras se edita no se pisan los datos que la persona está escribiendo
  const editing = editingStayId === currentStay.id;
  if (!editing) fillEditInputs();

  document.getElementById('editBlock').classList.toggle('hidden', !editing);
  document.getElementById('saveStayBtn').classList.toggle('hidden', !editing);
  document.getElementById('cancelEditBtn').classList.toggle('hidden', !editing);
  document.getElementById('editStayBtn').disabled = editing;

  // Dar y recibir toallas (solo en modo lectura y con el huésped activo)
  document.getElementById('towelBlock').classList.toggle('hidden', editing);
  const canMove = currentStay.status === 'activo';
  document.getElementById('giveTowelsBtn').disabled = !canMove;
  document.getElementById('receiveTowelsBtn').disabled = !canMove;
  renderDetailMovements();

  const checkoutBtn = document.getElementById('checkoutBtn');
  checkoutBtn.classList.toggle('hidden', editing);
  checkoutBtn.disabled = currentStay.status !== 'activo' || currentStay.current_towels !== 0;
}

function renderDetailMovements() {
  const tbody = document.getElementById('detailMovs');
  const movs = (currentStay.movements || []).slice(0, 10);

  if (!movs.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin movimientos</td></tr>';
    return;
  }

  tbody.innerHTML = movs.map(m => `
    <tr>
      <td>${escapeHtml(m.created_at_cdmx)}</td>
      <td>${escapeHtml(m.username || '')}</td>
      <td>${escapeHtml(m.movement_type)}</td>
      <td>${m.quantity > 0 ? '+' : ''}${escapeHtml(m.quantity)}</td>
      <td>${escapeHtml(m.balance_after)}</td>
    </tr>
  `).join('');
}

async function moveTowels(action) {
  if (!currentStay) return;

  const qty = Number(document.getElementById('towelQty').value);
  if (!Number.isInteger(qty) || qty <= 0) {
    showMessage('recepcionMsg', 'Cantidad inválida', 'error');
    return;
  }

  try {
    await api(`/api/stays/${currentStay.id}/towels`, {
      method: 'POST',
      body: { action, qty }
    });

    document.getElementById('towelQty').value = 1;
    showMessage('recepcionMsg', 'Movimiento registrado correctamente', 'success');
    await selectStay(currentStay.id);
    await loadStays();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

function startEditStay() {
  if (!currentStay) return;
  editingStayId = currentStay.id;
  fillEditInputs();
  renderDetail();
  document.getElementById('editName').focus();
}

function cancelEditStay() {
  editingStayId = null;
  renderDetail();
}

async function saveCurrentStay() {
  if (!currentStay) return;

  const payload = {
    guest_name: document.getElementById('editName').value,
    room_number: document.getElementById('editRoom').value,
    guest_barcode: document.getElementById('editBarcode').value,
    towel_limit: Number(document.getElementById('detailLimit').value),
    comment: document.getElementById('detailComment').value
  };

  try {
    await api(`/api/stays/${currentStay.id}`, {
      method: 'PATCH',
      body: payload
    });

    editingStayId = null;
    showMessage('recepcionMsg', 'Datos actualizados correctamente', 'success');
    await selectStay(currentStay.id);
    await loadStays();
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');   // se queda en modo edición para corregir
  }
}

async function checkoutCurrentStay() {
  if (!currentStay) return;

  if (currentStay.current_towels !== 0) {
    showMessage('recepcionMsg', 'No se puede hacer check-out si el huésped tiene toallas pendientes', 'error');
    return;
  }

  if (!confirm('¿Confirmas la salida del huésped?')) return;

  try {
    await api(`/api/stays/${currentStay.id}/checkout`, {
      method: 'POST'
    });

    showMessage('recepcionMsg', 'Check-out realizado correctamente', 'success');
    await loadStays();
    await selectStay(currentStay.id);
  } catch (err) {
    showMessage('recepcionMsg', err.message, 'error');
  }
}

actions.selectStay = selectStay;
actions.reload = loadStays;
