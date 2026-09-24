/* ═════════════════════════════════════════════════════════════
   Alta de registros (los cuatro formularios) y modal de edición.
   ═════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   GUARDAR — helper común a los cuatro formularios
   ───────────────────────────────────────────────────────────── */
async function guardarRegistro(btnId, textoBtn, tipo, fechaISO, datos, alTerminar) {
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const { error } = await sb.from('registros')
    .insert({ tipo, fecha_hora: fechaISO, datos });

  btn.disabled = false;
  btn.textContent = textoBtn;

  if (error) {
    console.error(error);
    toast('❌ No se pudo guardar: ' + (error.message || 'error desconocido'), 4500);
    return;
  }
  if (alTerminar) alTerminar();
}

/* ── Extracción ────────────────────────────────────────────── */
document.getElementById('btnExt').addEventListener('click', () => {
  const ml    = parseFloat(document.getElementById('extMl').value);
  const fecha = leerFechaISO('extFecha');

  if (!fecha || isNaN(ml) || ml < 0) {
    toast('⚠️ Indica los ml y la fecha.');
    return;
  }

  guardarRegistro('btnExt', 'Guardar extracción', 'extraccion', fecha,
    { pecho: valorSel('rowPecho', 'izquierdo'), ml },
    () => {
      toast('✅ Extracción guardada');
      document.getElementById('extMl').value    = '';
      document.getElementById('extFecha').value = ahoraLocal();
    });
});

/* ── Peso ──────────────────────────────────────────────────── */
document.getElementById('btnPeso').addEventListener('click', () => {
  const gramos = parseInt(document.getElementById('pesoG').value, 10);
  const fecha  = leerFechaISO('pesoFecha');

  if (!fecha || isNaN(gramos) || gramos < 500) {
    toast('⚠️ Indica el peso (mínimo 500 g) y la fecha.');
    return;
  }

  guardarRegistro('btnPeso', 'Guardar peso', 'peso', fecha, { gramos },
    () => {
      toast('✅ Peso guardado');
      document.getElementById('pesoG').value     = '';
      document.getElementById('pesoFecha').value = ahoraLocal();
    });
});

/* ── Caca ──────────────────────────────────────────────────── */
document.getElementById('btnCaca').addEventListener('click', () => {
  const cantidad = cantidadSel('rowCacaQty');
  const color    = valorSel('rowCacaColor', COLOR_CACA_DEF);
  const nota     = document.getElementById('cacaNota').value.trim();
  const fecha    = leerFechaISO('cacaFecha');

  if (cantidad === null || !fecha) {
    toast('⚠️ Indica la cantidad y la fecha.');
    return;
  }

  const datos = { cantidad, color };
  if (nota) datos.nota = nota;

  guardarRegistro('btnCaca', 'Guardar caca', 'caca', fecha, datos, () => {
    toast('✅ Caca guardada');
    document.getElementById('cacaNota').value  = '';
    document.getElementById('cacaFecha').value = ahoraLocal();
  });
});

/* ── Pipí ──────────────────────────────────────────────────── */
document.getElementById('btnPipi').addEventListener('click', () => {
  const cantidad = cantidadSel('rowPipiQty');
  const nota     = document.getElementById('pipiNota').value.trim();
  const fecha    = leerFechaISO('pipiFecha');

  if (cantidad === null || !fecha) {
    toast('⚠️ Indica la cantidad y la fecha.');
    return;
  }

  const datos = { cantidad, transparente: valorSel('rowPipiTrans', 'si') === 'si' };
  if (nota) datos.nota = nota;

  guardarRegistro('btnPipi', 'Guardar pipí', 'pipi', fecha, datos, () => {
    toast('✅ Pipí guardado');
    document.getElementById('pipiNota').value  = '';
    document.getElementById('pipiFecha').value = ahoraLocal();
  });
});

/* ─────────────────────────────────────────────────────────────
   EDITAR REGISTRO
   ───────────────────────────────────────────────────────────── */
let editandoId   = null;
let editandoTipo = null;

window.editar = function(id) {
  const r = registros.find(x => x.id === id);
  if (!r) return;

  editandoId   = id;
  editandoTipo = r.tipo;
  const d = r.datos || {};

  const campoFecha = `
    <div class="field">
      <label for="editFecha">Fecha y hora</label>
      <input type="datetime-local" id="editFecha" value="${toLocalDT(r.fecha_hora)}">
    </div>`;

  let html = '';

  if (r.tipo === 'extraccion') {
    html = `
      <div class="field">
        <label>Pecho</label>
        <div class="toggle-row" id="rowEditPecho">
          <button type="button" class="toggle-opt ${d.pecho !== 'derecho' ? 'sel' : ''}" data-v="izquierdo">Izquierdo</button>
          <button type="button" class="toggle-opt ${d.pecho === 'derecho' ? 'sel' : ''}" data-v="derecho">Derecho</button>
        </div>
      </div>
      <div class="field">
        <label for="editMl">Cantidad (ml)</label>
        <input type="number" id="editMl" value="${esc(d.ml)}"
               min="0" max="500" inputmode="decimal" step="0.5">
      </div>${campoFecha}`;

  } else if (r.tipo === 'peso') {
    html = `
      <div class="field">
        <label for="editGramos">Peso (gramos)</label>
        <input type="number" id="editGramos" value="${esc(d.gramos)}"
               min="500" max="10000" inputmode="numeric">
      </div>${campoFecha}`;

  } else if (r.tipo === 'caca') {
    html = `
      <div class="field">
        <label>Cantidad</label>
        <div class="qty-row" id="rowEditQty">${htmlCantidad(Number(d.cantidad) || 0)}</div>
      </div>
      <div class="field">
        <label>Color</label>
        <div class="color-row" id="rowEditColor">${htmlColores(d.color || COLOR_CACA_DEF)}</div>
      </div>
      <div class="field">
        <label for="editNota">Nota (opcional)</label>
        <input type="text" id="editNota" value="${esc(d.nota || '')}" maxlength="200">
      </div>${campoFecha}`;

  } else if (r.tipo === 'pipi') {
    html = `
      <div class="field">
        <label>Cantidad</label>
        <div class="qty-row" id="rowEditQty">${htmlCantidad(Number(d.cantidad) || 0)}</div>
      </div>
      <div class="field">
        <label>Aspecto</label>
        <div class="toggle-row" id="rowEditTrans">
          <button type="button" class="toggle-opt ${d.transparente ? 'sel' : ''}"  data-v="si">Transparente</button>
          <button type="button" class="toggle-opt ${d.transparente ? '' : 'sel'}" data-v="no">No transparente</button>
        </div>
      </div>
      <div class="field">
        <label for="editNota">Nota (opcional)</label>
        <input type="text" id="editNota" value="${esc(d.nota || '')}" maxlength="200">
      </div>${campoFecha}`;

  } else {
    toast('Este tipo de registro no se puede editar aquí.');
    return;
  }

  document.getElementById('editForm').innerHTML = html;
  document.getElementById('editModal').style.display = '';
  // Los selectores del modal los gestiona el listener delegado global
};

function cerrarModal() {
  document.getElementById('editModal').style.display = 'none';
  editandoId = null;
}

document.getElementById('btnCancelEdit').addEventListener('click', cerrarModal);

// Cerrar tocando el fondo oscuro
document.getElementById('editModal').addEventListener('click', e => {
  if (e.target.id === 'editModal') cerrarModal();
});

document.getElementById('btnSaveEdit').addEventListener('click', async () => {
  if (!editandoId) return;

  const fecha_hora = leerFechaISO('editFecha');
  if (!fecha_hora) { toast('⚠️ La fecha no es válida.'); return; }

  let datos;

  if (editandoTipo === 'extraccion') {
    const ml = parseFloat(document.getElementById('editMl').value);
    if (isNaN(ml) || ml < 0) { toast('⚠️ Indica los ml.'); return; }
    datos = { pecho: valorSel('rowEditPecho', 'izquierdo'), ml };

  } else if (editandoTipo === 'peso') {
    const gramos = parseInt(document.getElementById('editGramos').value, 10);
    if (isNaN(gramos) || gramos < 500) { toast('⚠️ Indica el peso (mínimo 500 g).'); return; }
    datos = { gramos };

  } else if (editandoTipo === 'caca' || editandoTipo === 'pipi') {
    const cantidad = cantidadSel('rowEditQty');
    if (cantidad === null) { toast('⚠️ Indica la cantidad.'); return; }
    const nota = document.getElementById('editNota').value.trim();

    datos = editandoTipo === 'caca'
      ? { cantidad, color: valorSel('rowEditColor', COLOR_CACA_DEF) }
      : { cantidad, transparente: valorSel('rowEditTrans', 'si') === 'si' };

    if (nota) datos.nota = nota;

  } else {
    return;
  }

  const btn = document.getElementById('btnSaveEdit');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  // .select() nos dice cuántas filas se han modificado de verdad:
  // si RLS bloquea el UPDATE, Supabase no da error pero devuelve 0.
  const { data, error } = await sb
    .from('registros')
    .update({ fecha_hora, datos })
    .eq('id', editandoId)
    .select();

  btn.disabled = false;
  btn.textContent = 'Guardar cambios';

  if (error) {
    console.error(error);
    toast('❌ No se pudo guardar: ' + (error.message || ''), 4500);
    return;
  }

  if (!data || !data.length) {
    toast('⚠️ No se modificó nada. Falta la policy de UPDATE en Supabase (migracion.sql).', 6000);
    return;
  }

  toast('✅ Registro actualizado');
  cerrarModal();
  await cargarDatos();
});
