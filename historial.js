/* ═════════════════════════════════════════════════════════════
   Pestaña Historial: tabla, filtros por tipo y borrado.
   ═════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   TABLA HISTORIAL
   ───────────────────────────────────────────────────────────── */

// Devuelve { tipo, detalle } ya escapado, listo para innerHTML
function describir(r) {
  const d = r.datos || {};
  const nota = d.nota ? `<span class="nota-txt">📝 ${esc(d.nota)}</span>` : '';

  if (r.tipo === 'extraccion') {
    return {
      tipo:    d.pecho === 'izquierdo' ? '🍼 Izq.' : '🍼 Der.',
      detalle: `${esc(d.ml)} ml`
    };
  }
  if (r.tipo === 'peso') {
    return { tipo: '⚖️ Peso', detalle: `${esc(d.gramos)} g` };
  }
  if (r.tipo === 'caca') {
    const c = infoColor(d.color);
    return {
      tipo: '💩 Caca',
      detalle: `<span class="color-swatch" style="background:${c.hex};`
             + `display:inline-block;vertical-align:-3px;margin-right:6px"></span>`
             + `${esc(d.cantidad)} · ${esc(c.label)}${nota}`
    };
  }
  if (r.tipo === 'pipi') {
    return {
      tipo: '💧 Pipí',
      detalle: `${esc(d.cantidad)} · ${d.transparente ? 'transparente' : 'no transparente'}${nota}`
    };
  }
  // Tipo desconocido (por si en el futuro se añade otro)
  return { tipo: esc(r.tipo), detalle: esc(JSON.stringify(d)) };
}

function renderTabla() {
  const tbody = document.getElementById('histBody');
  const thAcc = document.getElementById('thAcc');
  if (modoVer) thAcc.style.display = 'none';

  const filas = registros
    .filter(r => filtroHist === 'todo' || r.tipo === filtroHist)
    .sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));  // más reciente primero

  if (!filas.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">
      ${filtroHist === 'todo' ? 'No hay registros todavía.' : 'No hay registros de este tipo.'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filas.map(r => {
    const { tipo, detalle } = describir(r);

    const accCell = modoVer ? '' : `
      <td style="white-space:nowrap">
        <button class="btn-edit-sm"   onclick="editar('${r.id}')" aria-label="Editar">✏️</button>
        <button class="btn-danger-sm" onclick="borrar('${r.id}')" style="margin-left:4px" aria-label="Borrar">🗑️</button>
      </td>`;

    return `<tr>
      <td style="white-space:nowrap">${esc(fmtFechaHora(r.fecha_hora))}</td>
      <td style="white-space:nowrap">${tipo}</td>
      <td>${detalle}</td>
      ${accCell}
    </tr>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────
   BORRAR REGISTRO
   ───────────────────────────────────────────────────────────── */
window.borrar = async function(id) {
  const r = registros.find(x => x.id === id);
  const q = r ? `¿Borrar el registro de ${fmtFechaHora(r.fecha_hora)}?` : '¿Borrar este registro?';
  if (!confirm(q)) return;

  const { error } = await sb.from('registros').delete().eq('id', id);
  if (error) {
    console.error(error);
    toast('❌ No se pudo borrar: ' + (error.message || ''), 4000);
  } else {
    toast('🗑️ Registro borrado');
    await cargarDatos();
  }
};
