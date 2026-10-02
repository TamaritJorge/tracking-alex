/* ═════════════════════════════════════════════════════════════
   TUS DATOS

   Los dos derechos que el RGPD no deja como opcionales:
     · portabilidad (art. 20) → llevarte todo en un formato abierto
     · supresión   (art. 17) → que desaparezca de verdad

   No son funciones "de cumplimiento" que se arrinconan en un pie de
   página: son las dos cosas que debería poder hacer cualquiera con
   datos de salud de su hijo guardados en un servidor ajeno.
   ═════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   EXPORTAR

   Se exporta TODA la familia, no sólo el hijo que estás mirando:
   quien se lleva sus datos se los lleva enteros.

   JSON porque la portabilidad pide un formato estructurado y de uso
   común, y porque es el único que no pierde nada: las notas, los
   colores y la estructura de `datos` sobreviven tal cual. El CSV va
   aparte para lo práctico, que es abrirlo en una hoja de cálculo.
   ───────────────────────────────────────────────────────────── */
async function reunirDatos() {
  if (!familia) return { error: 'No hay ninguna familia cargada.' };

  const idsHijos = hijos.map(h => h.id);

  // Si la familia aún no tiene hijos, un .in() con lista vacía devuelve
  // todo en algunas versiones del cliente. Se corta antes.
  const porHijo = async tabla => {
    if (!idsHijos.length) return [];
    const { data, error } = await sb.from(tabla).select('*').in('nino_id', idsHijos);
    if (error) throw error;
    return data || [];
  };

  try {
    const [miembros, ajustes, registrosTodos, alimentos, alimAjustes,
           medPautasTodas, medTomasTodas] = await Promise.all([
      sb.from('familia_miembros').select('*').eq('familia_id', familia.id)
        .then(r => { if (r.error) throw r.error; return r.data || []; }),
      sb.from('familia_ajustes').select('*').eq('familia_id', familia.id)
        .then(r => { if (r.error) throw r.error; return r.data || []; }),
      porHijo('registros'),
      porHijo('alim_registros'),
      porHijo('alim_ajustes'),
      porHijo('med_pautas'),
      porHijo('med_tomas')
    ]);

    return {
      paquete: {
        aplicacion:   'Tracking Álex',
        exportado_en: new Date().toISOString(),
        formato:      1,
        nota: 'Exportación completa de los datos de la familia. '
            + 'Las fechas van en ISO 8601 y en UTC.',
        familia:         familia,
        adultos:         miembros,
        hijos:           hijos,
        registros:       registrosTodos,
        alimentacion:    alimentos,
        ajustes_familia: ajustes,
        ajustes_comida:  alimAjustes,
        medicacion:      medPautasTodas,
        medicacion_tomas: medTomasTodas
      },
      resumen: {
        hijos: hijos.length,
        registros: registrosTodos.length,
        alimentacion: alimentos.length,
        medicacion: medTomasTodas.length
      }
    };
  } catch (e) {
    console.error(e);
    return { error: e.message || 'No se pudieron leer los datos.' };
  }
}

/* Descarga un texto como fichero, sin pasar por el servidor */
function descargar(texto, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function nombreFicheroDatos(ext) {
  const limpio = (familia ? familia.nombre : 'familia')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return 'tracking-alex-' + (limpio || 'familia') + '-'
       + new Date().toISOString().slice(0, 10) + '.' + ext;
}

/* La medicación, en su propio CSV.

   Son dos cosas distintas —la pauta y lo que de verdad se dio— y aquí van
   juntas: una fila por toma, con la pauta repetida al lado. Es lo que se
   enseña en la consulta, y una hoja de cálculo no entiende de dos tablas.

   Un tratamiento sin ninguna toma apuntada sale igualmente, con las
   columnas de la toma vacías: si no, un tratamiento recién empezado
   desaparecería del fichero sin avisar. */
window.exportarMedicacionCSV = async function() {
  const btn = document.getElementById('btnExportMed');
  const txt = '\u2b07\ufe0f Medicinas (CSV)';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparando\u2026'; }

  const r = await reunirDatos();

  if (btn) { btn.disabled = false; btn.textContent = txt; }
  if (r.error) { toast('\u274c ' + r.error, 4000); return; }

  const pautas = r.paquete.medicacion || [];
  const tomas  = r.paquete.medicacion_tomas || [];

  if (!pautas.length) { toast('No hay ning\u00fan tratamiento que exportar.', 3500); return; }

  const nombreDe = {};
  r.paquete.hijos.forEach(h => { nombreDe[h.id] = h.nombre; });
  const pautaDe = {};
  pautas.forEach(p => { pautaDe[p.id] = p; });

  const sep = separadorCSV();
  const celda = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return (s.indexOf(sep) >= 0 || /["\n\r]/.test(s))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const cols = ['hijo', 'medicamento', 'dosis', 'horas_pauta', 'desde', 'hasta',
                'nota_pauta', 'dia_previsto', 'hora_prevista', 'dada_en',
                'estado', 'nota_toma'];

  const fila = (p, x) => [
    nombreDe[p.nino_id] || '',
    p.nombre, p.dosis, (p.horas || []).join(' '), p.desde, p.hasta, p.nota,
    x ? x.fecha_slot : '', x ? x.hora_slot : '', x ? x.dada_en : '',
    x ? x.estado : '', x ? x.nota : ''
  ].map(celda).join(sep);

  const filas = [];
  tomas.slice()
       .sort((a, b) => (a.fecha_slot + a.hora_slot < b.fecha_slot + b.hora_slot ? -1 : 1))
       .forEach(x => { const p = pautaDe[x.pauta_id]; if (p) filas.push(fila(p, x)); });

  pautas.filter(p => !tomas.some(x => x.pauta_id === p.id))
        .forEach(p => filas.push(fila(p, null)));

  descargar('\ufeff' + cols.join(sep) + '\r\n' + filas.join('\r\n'),
            nombreFicheroDatos('csv').replace('.csv', '-medicinas.csv'),
            'text/csv;charset=utf-8');
  toast('\u2705 ' + pautas.length + ' ' + plural(pautas.length, 'tratamiento', 'tratamientos')
        + ' y ' + tomas.length + ' ' + plural(tomas.length, 'toma', 'tomas'));
};

window.exportarJSON = async function() {
  const btn = document.getElementById('btnExportJSON');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparando…'; }

  const r = await reunirDatos();

  if (btn) { btn.disabled = false; btn.textContent = '⬇️ Descargar todo (JSON)'; }
  if (r.error) { toast('❌ ' + r.error, 4000); return; }

  descargar(JSON.stringify(r.paquete, null, 2), nombreFicheroDatos('json'),
            'application/json');
  toast(`✅ ${r.resumen.registros} registros descargados`);
};

/* CSV sólo de los registros del día a día, que es lo que la gente
   quiere abrir en Excel. El JSON sigue siendo la copia completa. */
window.exportarCSV = async function() {
  const btn = document.getElementById('btnExportCSV');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparando…'; }

  const r = await reunirDatos();

  if (btn) { btn.disabled = false; btn.textContent = '⬇️ Registros (CSV)'; }
  if (r.error) { toast('❌ ' + r.error, 4000); return; }

  const nombreDe = {};
  r.paquete.hijos.forEach(h => { nombreDe[h.id] = h.nombre; });

  const cols = ['hijo', 'fecha_hora', 'tipo', 'cantidad', 'color',
                'transparente', 'gramos', 'pecho', 'ml', 'nota'];

  // Las comillas dobles se escapan duplicándolas: es lo que espera el
  // formato, y sin esto una nota con comillas parte la fila en dos.
  const sep = separadorCSV();
  const celda = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Se entrecomilla si lleva el separador activo, comillas o saltos de linea
    return (s.indexOf(sep) >= 0 || /["\n\r]/.test(s))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const filas = r.paquete.registros
    .slice()
    .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))
    .map(x => {
      const d = x.datos || {};
      return [
        nombreDe[x.nino_id] || '',
        x.fecha_hora,
        x.tipo,
        d.cantidad,
        d.color ? infoColor(d.color).label : '',
        d.transparente === undefined ? '' : (d.transparente ? 'si' : 'no'),
        d.gramos,
        d.pecho,
        d.ml,
        d.nota
      ].map(celda).join(separadorCSV());
    });

  // Punto y coma y BOM: es lo que Excel en español espera. Con comas y sin
  // BOM, Excel mete toda la fila en una celda y rompe los acentos.
  descargar('﻿' + cols.join(separadorCSV()) + '\r\n' + filas.join('\r\n'),
            nombreFicheroDatos('csv'), 'text/csv;charset=utf-8');
  toast(`✅ ${filas.length} registros en CSV`);
};

/* ─────────────────────────────────────────────────────────────
   BORRAR LA CUENTA

   El trabajo de verdad lo hace borrar_mi_cuenta() en la base de
   datos; aquí sólo se explica bien lo que va a pasar y se pide una
   confirmación que no se pueda dar sin querer.

   Lo que pasa depende de si queda otro adulto, y eso cambia tanto
   la consecuencia que hay que decirlo ANTES, no después.
   ───────────────────────────────────────────────────────────── */
window.abrirBorradoCuenta = async function() {
  if (!familia) return;

  const { count, error } = await sb.from('familia_miembros')
    .select('*', { count: 'exact', head: true }).eq('familia_id', familia.id);

  if (error) { toast('❌ No se pudo comprobar la familia: ' + error.message, 4000); return; }

  const solo = (count || 1) <= 1;
  let registros = 0;
  for (const h of hijos) {
    const c = await contarRegistrosDe(h.id);
    if (c > 0) registros += c;
  }

  document.getElementById('comidaModalTitulo').textContent = '🗑️ Borrar mi cuenta';
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="aviso ${solo ? 'aviso-stop' : 'aviso-ojo'}" style="margin-bottom:14px">
      ${solo
        ? `Eres el único adulto de <strong>${esc(familia.nombre)}</strong>. Al borrar tu cuenta
           se borra también la familia entera: ${hijos.length}
           ${plural(hijos.length, 'hijo', 'hijos', 'hijo')} y <strong>${registros}</strong>
           ${plural(registros, 'registro', 'registros', 'registro')}. No se puede deshacer.`
        : `Hay otro adulto en <strong>${esc(familia.nombre)}</strong>. Se borra
           <strong>tu cuenta</strong>, pero los datos de ${hijos.length === 1 ? 'tu hijo' : 'tus hijos'}
           siguen siendo suyos y no se tocan. Tú perderás el acceso.`}
    </div>

    <p class="hint-txt" style="margin-bottom:14px">
      Si quieres quedarte con una copia, descárgala antes: una vez borrado no
      hay forma de recuperarlo, tampoco para nosotros.
    </p>

    <div class="field">
      <label for="confCuenta">Escribe <strong>BORRAR</strong> para confirmar</label>
      <input type="text" id="confCuenta" autocomplete="off" placeholder="BORRAR">
    </div>
    <p id="borrarCuentaErr" class="error-txt" style="display:none"></p>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn" id="btnBorrarCuenta" onclick="confirmarBorradoCuenta()"
            style="background:var(--danger);color:#fff">Borrar mi cuenta</button>
    <button class="btn" onclick="abrirAjustes()"
            style="background:var(--surface2);color:var(--text)">Cancelar</button>`;

  document.getElementById('comidaModal').style.display = '';
};

window.confirmarBorradoCuenta = async function() {
  const err   = document.getElementById('borrarCuentaErr');
  const campo = document.getElementById('confCuenta');

  if (!campo || campo.value.trim().toUpperCase() !== 'BORRAR') {
    err.textContent = 'Escribe BORRAR para confirmar.';
    err.style.display = '';
    return;
  }

  const btn = document.getElementById('btnBorrarCuenta');
  btn.disabled = true;
  btn.textContent = 'Borrando…';

  const { data, error } = await sb.rpc('borrar_mi_cuenta');

  if (error || (data && data.error)) {
    btn.disabled = false;
    btn.textContent = 'Borrar mi cuenta';
    err.textContent = (error && error.message) || data.error;
    err.style.display = '';
    return;
  }

  // La sesión ya no apunta a ningún usuario: hay que cerrarla igualmente para
  // que el cliente suelte el token guardado en el navegador.
  cerrarComidaModal();
  limpiarEstado();
  await sb.auth.signOut();
  familia = null; hijos = []; ninoActivo = null;
  localStorage.removeItem(CLAVE_ULTIMO_HIJO);
  mostrarLogin();
  toast('Tu cuenta ha sido borrada.', 5000);
};
