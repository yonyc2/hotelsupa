// =====================================================
// REPORTE DE TOALLAS POR DÍA
// Aparece en Recepción, Toallero y Administración (donde exista un <div id="towelReport">).
// Entregadas = toallas dadas a huéspedes (incluye las iniciales al registrar al huésped).
// Recibidas  = toallas devueltas. Los días se cuentan en horario de Ciudad de México.
// =====================================================
(function () {
  const host = document.getElementById('towelReport');
  if (!host) return;

  const pad = n => String(n).padStart(2, '0');
  const todayCdmx = () => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }

  const today = todayCdmx();

  host.innerHTML = `
    <h2>Reporte de toallas</h2>
    <div class="grid grid-2" style="margin-bottom: 14px;">
      <div>
        <div class="muted">Entregadas hoy</div>
        <strong id="rpTodayOut" style="font-size: 32px;">–</strong>
      </div>
      <div>
        <div class="muted">Recibidas hoy</div>
        <strong id="rpTodayIn" style="font-size: 32px;">–</strong>
      </div>
    </div>

    <div class="toolbar">
      <label style="display: inline-block; margin: 0;">Desde</label>
      <input type="date" id="rpFrom" style="width: 160px; min-width: 0;" value="${addDays(today, -6)}" max="${today}">
      <label style="display: inline-block; margin: 0;">Hasta</label>
      <input type="date" id="rpTo" style="width: 160px; min-width: 0;" value="${today}" max="${today}">
      <button type="button" id="rpGo" class="secondary">Consultar</button>
    </div>

    <div id="rpErr" class="hidden"></div>
    <p class="muted" id="rpMsg">Entregadas incluye las toallas iniciales asignadas al registrar al huésped. Los días son de hora de CDMX.</p>

    <table>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Entregadas</th>
          <th>Recibidas</th>
          <th>Diferencia</th>
        </tr>
      </thead>
      <tbody id="rpBody"><tr><td colspan="4">Cargando…</td></tr></tbody>
      <tfoot id="rpFoot"></tfoot>
    </table>
  `;

  const $ = id => document.getElementById(id);

  async function load() {
    const from = $('rpFrom').value, to = $('rpTo').value;
    const msg = $('rpMsg'), box = $('rpErr');
    const showError = text => { box.className = 'alert error'; box.textContent = text; };

    box.className = 'hidden';
    if (!from || !to) { showError('Elige las dos fechas'); return; }
    if (to < from) { showError('La fecha final no puede ser anterior a la inicial'); return; }

    try {
      const rows = await api(`/api/report/towels?from=${from}&to=${to}`);
      if (!Array.isArray(rows)) throw new Error('Respuesta inesperada del servidor');

      // Los totales de "hoy" salen del rango si lo incluye; si no, se consultan aparte
      let todayRow = rows.find(r => r.report_day === today);
      if (!todayRow) {
        const t = await api(`/api/report/towels?from=${today}&to=${today}`);
        todayRow = Array.isArray(t) ? t[0] : null;
      }
      $('rpTodayOut').textContent = todayRow ? todayRow.delivered : 0;
      $('rpTodayIn').textContent = todayRow ? todayRow.returned : 0;

      let out = 0, back = 0;
      $('rpBody').innerHTML = rows.map(r => {
        out += Number(r.delivered); back += Number(r.returned);
        const diff = Number(r.delivered) - Number(r.returned);
        return `<tr>
          <td>${escapeHtml(r.report_day)}</td>
          <td>${r.delivered}</td>
          <td>${r.returned}</td>
          <td>${diff > 0 ? '+' : ''}${diff}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="4">Sin datos</td></tr>';

      const total = out - back;
      $('rpFoot').innerHTML = `<tr>
        <th>Total</th><th>${out}</th><th>${back}</th><th>${total > 0 ? '+' : ''}${total}</th>
      </tr>`;

      msg.textContent = 'Entregadas incluye las toallas iniciales asignadas al registrar al huésped. Los días son de hora de CDMX.';
    } catch (err) {
      $('rpBody').innerHTML = '<tr><td colspan="4">Sin datos</td></tr>';
      if (/towel_report|schema cache|Could not find/i.test(err.message)) {
        showError('Falta activar el reporte en la base de datos: ejecuta supabase/migracion-reporte-toallas.sql en el SQL Editor de Supabase. (' + err.message + ')');
      } else {
        showError('No se pudo cargar el reporte: ' + err.message);
      }
    }
  }

  $('rpGo').addEventListener('click', load);
  load();
  startSocket(load);   // se actualiza solo cuando hay cambios
})();
