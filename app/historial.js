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
      tipo:    d.pecho === 'izquierdo'
        ? t('hist.izq', '🍼 Izq.')
        : t('hist.der', '🍼 Der.'),
      detalle: `${esc(d.ml)} ml`
    };
  }
  if (r.tipo === 'peso') {
    // Si se descontó ropa se dice de dónde sale el número. Sin esto, un
    // peso que baja 300 g respecto al anterior parece un problema de
    // salud en vez de un jersey menos.
    const ropa = d.ropa
      ? ` <span class="hint-txt">(${esc(numero(d.bruto))} − ${esc(numero(d.ropa.g))} `
        + `${esc(t('hist.deRopa', 'g de ropa'))})</span>`
      : '';
    return { tipo: t('hist.pesoTipo', '⚖️ Peso'), detalle: `${esc(d.gramos)} g${ropa}` };
  }
  if (r.tipo === 'caca') {
    const c = infoColor(d.color);
    return {
      tipo: t('hist.cacaTipo', '💩 Caca'),
      detalle: `<span class="color-swatch" style="background:${c.hex};`
             + `display:inline-block;vertical-align:-3px;margin-right:6px"></span>`
             + `${esc(d.cantidad)} · ${esc(c.label)}${nota}`
    };
  }
  if (r.tipo === 'pipi') {
    return {
      tipo: t('hist.pipiTipo', '💧 Pipí'),
      detalle: `${esc(d.cantidad)} · ${d.transparente
          ? t('hist.transp',   'transparente')
          : t('hist.noTransp', 'no transparente')}${nota}`
    };
  }
  // Tipo desconocido (por si en el futuro se añade otro)
  return { tipo: esc(r.tipo), detalle: esc(JSON.stringify(d)) };
}

function renderTabla() {
  const tbody = document.getElementById('histBody');
  const thAcc = document.getElementById('thAcc');
  if (modoVer) thAcc.style.display = 'none';

  // tipoVisible() descarta lo de los módulos apagados. Las filas siguen
  // en la base de datos: volver a encender el módulo las devuelve todas.
  const filas = registros
    .filter(r => tipoVisible(r.tipo))
    .filter(r => filtroHist === 'todo' || r.tipo === filtroHist)
    .sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));  // más reciente primero

  if (!filas.length) {
    const vacio = !Object.keys(MODULO_DE_TIPO).some(t => tipoVisible(t))
      ? t('hist.todoOculto', 'Están todos los módulos ocultos. Se encienden en ⚙️ Ajustes.')
      : filtroHist === 'todo' ? t('hist.vacio',     'No hay registros todavía.')
      :                         t('hist.vacioTipo', 'No hay registros de este tipo.');
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">${vacio}</td></tr>`;
    return;
  }

  tbody.innerHTML = filas.map(r => {
    const { tipo, detalle } = describir(r);

    const accCell = modoVer ? '' : `
      <td style="white-space:nowrap">
        <button class="btn-edit-sm"   onclick="editar('${r.id}')" aria-label="${esc(t('aria.editar', 'Editar'))}">✏️</button>
        <button class="btn-danger-sm" onclick="borrar('${r.id}')" style="margin-left:4px" aria-label="${esc(t('aria.borrar', 'Borrar'))}">🗑️</button>
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
  const q = r
    ? t2('hist.borrarQ', '¿Borrar el registro de {f}?', { f: fmtFechaHora(r.fecha_hora) })
    : t('hist.borrarQ2', '¿Borrar este registro?');
  if (!confirm(q)) return;

  const { error } = await sb.from('registros').delete().eq('id', id);
  if (error) {
    console.error(error);
    toast(t('hist.noBorrado', '❌ No se pudo borrar: ') + (error.message || ''), 4000);
  } else {
    toast(t('hist.borrado', '🗑️ Registro borrado'));
    await cargarDatos();
  }
};
