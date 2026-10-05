/* ═════════════════════════════════════════════════════════════
   Alta de registros (los cuatro formularios) y modal de edición.
   ═════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────
   QUÉ FORMULARIO SE VE

   Antes estaban los cuatro apilados y había que bajar hasta el de peso.
   Ahora se elige arriba y sólo se ve uno.

   El selector NO desaparece al elegir: pasar de pipí a caca es un toque.
   Con una pantalla aparte y botón de volver serían tres, y entre pipí y
   caca está el 90 % de lo que se apunta.

   Las tarjetas se ocultan, no se quitan del DOM: los listeners de este
   fichero y los ids que busca resetFechas() se enganchan una sola vez al
   cargar la página y petarían si el nodo desapareciera.
   ────────────────────────────────────────────────────────── */
let formRegistro = 'pipi';

function mostrarFormulario(cual) {
  const cards = Array.from(document.querySelectorAll('#tab-registrar .card[data-reg]'));
  if (!cards.length) return;

  const hay = r => {
    const c = cards.find(x => x.dataset.reg === r);
    return !!c && moduloActivo(c.dataset.modulo);
  };

  // Si el pedido está apagado (o no se pide ninguno), el primero que quede
  if (!hay(cual)) {
    const primera = cards.find(c => moduloActivo(c.dataset.modulo));
    cual = primera ? primera.dataset.reg : null;
  }
  formRegistro = cual;

  cards.forEach(c => { c.style.display = (c.dataset.reg === cual) ? '' : 'none'; });

  document.querySelectorAll('#selectorRegistro .chip').forEach(b => {
    const sel = b.dataset.reg === cual;
    b.classList.toggle('sel', sel);
    b.setAttribute('aria-pressed', String(sel));
  });

  const vacio = document.getElementById('registrarVacio');
  if (vacio) vacio.style.display = cual ? 'none' : '';

  // Puede llamarse antes de que la app esté montada (aplicarModulos)
  if (typeof refrescarFechas === 'function') refrescarFechas();
}

/* ─────────────────────────────────────────────────────────────
   GUARDAR — helper común a los cuatro formularios
   ───────────────────────────────────────────────────────────── */
async function guardarRegistro(btnId, textoBtn, tipo, fechaISO, datos, alTerminar) {
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.textContent = t('btn.guardando', 'Guardando…');

  if (!ninoActivo) { toast(t('reg.sinHijo', '⚠️ No hay ningún hijo seleccionado.')); return; }

  const { error } = await sb.from('registros')
    .insert({ tipo, fecha_hora: fechaISO, datos, nino_id: ninoActivo.id });

  btn.disabled = false;
  btn.textContent = textoBtn;

  if (error) {
    console.error(error);
    toast(t('reg.noGuardado', '❌ No se pudo guardar: ')
      + (error.message || t('reg.errorRaro', 'error desconocido')), 4500);
    return;
  }
  if (alTerminar) alTerminar();
}

/* ── Extracción ────────────────────────────────────────────── */
document.getElementById('btnExt').addEventListener('click', () => {
  const ml    = parseFloat(document.getElementById('extMl').value);
  const fecha = leerFechaISO('extFecha');

  if (!fecha || isNaN(ml) || ml < 0) {
    toast(t('reg.faltaMlFecha', '⚠️ Indica los ml y la fecha.'));
    return;
  }

  guardarRegistro('btnExt', t('reg.guardaExt', 'Guardar extracción'), 'extraccion', fecha,
    { pecho: valorSel('rowPecho', 'izquierdo'), ml },
    () => {
      toast(t('reg.okExt', '✅ Extracción guardada'));
      document.getElementById('extMl').value    = '';
      reiniciarFecha('extFecha');
    });
});

/* ── Peso ────────────────────────────────────────────────────

   Lo que se escribe en `gramos` es el peso SIN ropa, porque es lo que
   leen la gráfica, el percentil de la OMS, la tendencia, el historial,
   el CSV y el enlace que ve la abuela — siete sitios, uno de ellos en
   SQL dentro de Supabase. Guardando ya el neto, los siete son
   correctos sin tocar ninguno; restando al leer, el que se olvidara
   mentiría en silencio.

   `bruto` guarda lo que marcaba la báscula y `ropa` el desglose, para
   que una tabla mejor dentro de un año se pueda aplicar sin haber
   perdido el dato de partida.

   Sin ropa marcada, `datos` es exactamente `{ gramos }` como siempre:
   nada que migrar y nada que distinga un registro antiguo de uno
   nuevo sin ropa.
   ──────────────────────────────────────────────────────────── */
function construirDatosPeso(idBruto, idTalla, idFila) {
  const bruto = parseInt(document.getElementById(idBruto).value, 10);
  if (isNaN(bruto) || bruto < 500) {
    toast(t('reg.faltaPeso', '⚠️ Indica el peso (mínimo 500 g).'));
    return null;
  }

  const talla   = parseInt((document.getElementById(idTalla) || {}).value, 10);
  const prendas = prendasSel(idFila);
  if (!prendas.length) return { gramos: bruto };

  const g      = pesoRopa(prendas, talla);
  const gramos = bruto - g;

  if (gramos < 500) {
    toast(t('reg.ropaDemasiado',
      '⚠️ La ropa marcada pesa casi tanto como el bebé. Revísala.'), 4500);
    return null;
  }

  return { gramos, bruto, ropa: { talla, g, prendas, v: ROPA_V } };
}

document.getElementById('btnPeso').addEventListener('click', () => {
  const fecha = leerFechaISO('pesoFecha');
  if (!fecha) { toast(t('reg.faltaPesoFecha', '⚠️ Indica el peso (mínimo 500 g) y la fecha.')); return; }

  const datos = construirDatosPeso('pesoG', 'pesoTalla', 'rowPesoRopa');
  if (!datos) return;

  guardarRegistro('btnPeso', t('reg.guardaPeso', 'Guardar peso'), 'peso', fecha, datos,
    () => {
      toast(t('reg.okPeso', '✅ Peso guardado'));
      document.getElementById('pesoG').value = '';
      // La ropa y la talla NO se limpian: la de la semana que viene es
      // casi la misma, y volver a marcar cinco botones cada vez es
      // justo donde la gente deja de usar una cosa así.
      refrescarEcoPeso();
      reiniciarFecha('pesoFecha');
    });
});

// El eco se actualiza también al teclear el peso. #pesoG es estático,
// así que esto se engancha una sola vez.
document.getElementById('pesoG').addEventListener('input', () => {
  if (typeof refrescarEcoPeso === 'function') refrescarEcoPeso();
});

/* ── Caca ──────────────────────────────────────────────────── */
document.getElementById('btnCaca').addEventListener('click', () => {
  const cantidad = cantidadSel('rowCacaQty');
  const color    = valorSel('rowCacaColor', COLOR_CACA_DEF);
  const nota     = document.getElementById('cacaNota').value.trim();
  const fecha    = leerFechaISO('cacaFecha');

  if (cantidad === null || !fecha) {
    toast(t('reg.faltaCantFecha', '⚠️ Indica la cantidad y la fecha.'));
    return;
  }

  const datos = { cantidad, color };
  if (nota) datos.nota = nota;

  guardarRegistro('btnCaca', t('reg.guardaCaca', 'Guardar caca'), 'caca', fecha, datos, () => {
    toast(t('reg.okCaca', '✅ Caca guardada'));
    document.getElementById('cacaNota').value  = '';
    reiniciarFecha('cacaFecha');
  });
});

/* ── Pipí ──────────────────────────────────────────────────── */
document.getElementById('btnPipi').addEventListener('click', () => {
  const cantidad = cantidadSel('rowPipiQty');
  const nota     = document.getElementById('pipiNota').value.trim();
  const fecha    = leerFechaISO('pipiFecha');

  if (cantidad === null || !fecha) {
    toast(t('reg.faltaCantFecha', '⚠️ Indica la cantidad y la fecha.'));
    return;
  }

  const datos = { cantidad, transparente: valorSel('rowPipiTrans', 'si') === 'si' };
  if (nota) datos.nota = nota;

  guardarRegistro('btnPipi', t('reg.guardaPipi', 'Guardar pipí'), 'pipi', fecha, datos, () => {
    toast(t('reg.okPipi', '✅ Pipí guardado'));
    document.getElementById('pipiNota').value  = '';
    reiniciarFecha('pipiFecha');
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
    /* El campo enseña el BRUTO, que es lo que la persona vio en la
       báscula y lo único que puede reconocer. Un registro anterior a
       esto no tiene `bruto`: su `gramos` es lo que marcaba, así que
       sirve igual. */
    html = `
      <div class="field">
        <label for="editGramos">${esc(t('reg.peso.lbl', 'Peso en la báscula (gramos)'))}</label>
        <input type="number" id="editGramos" value="${esc(d.bruto !== undefined ? d.bruto : d.gramos)}"
               min="500" max="10000" inputmode="numeric">
        <p class="hint-txt" id="editEco" style="margin:8px 0 0"></p>
      </div>
      ${htmlBloqueRopa('edit', d.ropa)}${campoFecha}`;

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
    toast(t('reg.noEditable', 'Este tipo de registro no se puede editar aquí.'));
    return;
  }

  document.getElementById('editForm').innerHTML = html;
  document.getElementById('editModal').style.display = '';
  // Los selectores del modal los gestiona el listener delegado global.
  // El eco de la ropa no: necesita engancharse a estos dos campos, que
  // acaban de nacer con el innerHTML de arriba.
  if (r.tipo === 'peso') {
    const g = document.getElementById('editGramos');
    const s = document.getElementById('editTalla');
    if (g) g.addEventListener('input',  refrescarEcoEdit);
    if (s) s.addEventListener('change', refrescarEcoEdit);
    refrescarEcoEdit();
  }
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
  if (!fecha_hora) { toast(t('reg.fechaMala', '⚠️ La fecha no es válida.')); return; }

  let datos;

  if (editandoTipo === 'extraccion') {
    const ml = parseFloat(document.getElementById('editMl').value);
    if (isNaN(ml) || ml < 0) { toast(t('reg.faltaMl', '⚠️ Indica los ml.')); return; }
    datos = { pecho: valorSel('rowEditPecho', 'izquierdo'), ml };

  } else if (editandoTipo === 'peso') {
    // Se reconstruye entero porque el UPDATE de abajo REEMPLAZA `datos`,
    // no lo fusiona: si la ropa no se volviera a construir aquí, se
    // perdería al corregir sólo la hora de un registro.
    datos = construirDatosPeso('editGramos', 'editTalla', 'rowEditRopa');
    if (!datos) return;

  } else if (editandoTipo === 'caca' || editandoTipo === 'pipi') {
    const cantidad = cantidadSel('rowEditQty');
    if (cantidad === null) { toast(t('reg.faltaCant', '⚠️ Indica la cantidad.')); return; }
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
  btn.textContent = t('btn.guardando', 'Guardando…');

  // .select() nos dice cuántas filas se han modificado de verdad:
  // si RLS bloquea el UPDATE, Supabase no da error pero devuelve 0.
  const { data, error } = await sb
    .from('registros')
    .update({ fecha_hora, datos })
    .eq('id', editandoId)
    .select();

  btn.disabled = false;
  btn.textContent = t('btn.guardar2', 'Guardar cambios');

  if (error) {
    console.error(error);
    toast(t('reg.noGuardado', '❌ No se pudo guardar: ') + (error.message || ''), 4500);
    return;
  }

  if (!data || !data.length) {
    toast(t('reg.sinCambios',
        '⚠️ No se modificó nada. Falta la policy de UPDATE en Supabase (migracion.sql).'), 6000);
    return;
  }

  toast(t('reg.okEditado', '✅ Registro actualizado'));
  cerrarModal();
  await cargarDatos();
});
