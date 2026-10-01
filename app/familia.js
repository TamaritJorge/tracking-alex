/* ═════════════════════════════════════════════════════════════
   FAMILIA E HIJOS

   La pieza que faltaba entre "hay sesión iniciada" y "hay datos
   que cargar". Antes no existía porque la app era de una familia
   y un bebé: el aislamiento lo daba el proyecto de Supabase.

   Ahora cada fila de datos cuelga de un niño, cada niño de una
   familia, y RLS sólo deja ver lo de la familia propia. Este
   módulo resuelve quién eres y de qué niño estamos hablando.
   ═════════════════════════════════════════════════════════════ */

let familia    = null;   // { id, nombre, plan, trial_hasta, ... }
let hijos      = [];     // los de la familia, activos primero
let ninoActivo = null;   // el que se está viendo ahora mismo

const CLAVE_ULTIMO_HIJO = 'ultimoHijo';

/* ─────────────────────────────────────────────────────────────
   CARGA
   ───────────────────────────────────────────────────────────── */
async function cargarFamilia() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { familia = null; hijos = []; ninoActivo = null; return null; }

  // Una familia por usuario, así que basta con la primera
  const { data: mis, error: e1 } = await sb
    .from('familia_miembros').select('familia_id').limit(1);
  if (e1) { console.error(e1); return null; }
  if (!mis || !mis.length) { familia = null; hijos = []; ninoActivo = null; return null; }

  const { data: fams, error: e2 } = await sb
    .from('familias').select('*').eq('id', mis[0].familia_id).limit(1);
  if (e2) { console.error(e2); return null; }
  familia = fams && fams.length ? fams[0] : null;
  if (!familia) return null;

  const { data: ns, error: e3 } = await sb
    .from('ninos').select('*').eq('familia_id', familia.id)
    .order('activo', { ascending: false })
    .order('fecha_nacimiento', { ascending: true });
  if (e3) { console.error(e3); return null; }
  hijos = ns || [];

  // Recuperar el último hijo mirado, si sigue existiendo
  const guardado = localStorage.getItem(CLAVE_ULTIMO_HIJO);
  ninoActivo = hijos.find(n => n.id === guardado) || hijos[0] || null;

  return familia;
}

function hayFamilia() { return !!familia; }
function hayHijo()    { return !!ninoActivo; }

/* ─────────────────────────────────────────────────────────────
   DATOS DEL HIJO ACTIVO

   Sustituyen a las constantes que antes estaban escritas a mano
   en oms.js. `edadEnDias()` sigue siendo el único consumidor.
   ───────────────────────────────────────────────────────────── */
function fechaNacimiento() {
  // Mediodía local, no medianoche: así un desfase de zona horaria no
  // cambia el día y las edades en días no bailan.
  return ninoActivo
    ? new Date(ninoActivo.fecha_nacimiento + 'T12:00:00')
    : new Date();
}

function sexoHijo()   { return ninoActivo ? ninoActivo.sexo : 'nino'; }
function nombreHijo() { return ninoActivo ? ninoActivo.nombre : ''; }

/* ─────────────────────────────────────────────────────────────
   CAMBIAR DE HIJO

   Hay que limpiar de verdad: antes nada se reiniciaba porque no
   hacía falta. Con varios hijos, no hacerlo mezcla datos de uno
   en las gráficas del otro.
   ───────────────────────────────────────────────────────────── */
async function cambiarHijo(id) {
  const n = hijos.find(x => x.id === id);
  if (!n || (ninoActivo && n.id === ninoActivo.id)) return;

  ninoActivo = n;
  localStorage.setItem(CLAVE_ULTIMO_HIJO, n.id);

  limpiarEstado();
  pintarCabecera();

  await cargarDatos();
  if (moduloActivo('comida')) await cargarComida();

  // limpiarEstado() cierra los canales porque van filtrados por nino_id.
  // Sin volver a suscribirse aquí, el tiempo real dejaba de funcionar en
  // cuanto se cambiaba de hijo una vez.
  configurarRealtime();
  if (moduloActivo('comida')) configurarRealtimeComida();

  if (tabActual === 'graficas') renderCharts();
}

function limpiarEstado() {
  registros = [];
  comidas   = [];
  ajustes   = { plan: { retrasos: {}, descartados: [] }, inicio: null,
                preparacion: {}, personalizados: [] };

  Object.values(charts).forEach(c => { if (c) c.destroy(); });
  charts = {};

  // Los canales van filtrados por nino_id, así que hay que rehacerlos
  if (canalRT)       { sb.removeChannel(canalRT);       canalRT = null; }
  if (canalRTComida) { sb.removeChannel(canalRTComida); canalRTComida = null; }

  catAbierta = null;
  filtroHist = 'todo';
}

/* ─────────────────────────────────────────────────────────────
   CABECERA: nombre del hijo y selector si hay varios
   ───────────────────────────────────────────────────────────── */
function pintarCabecera() {
  const cont = document.getElementById('cabeceraHijo');
  if (!cont) return;

  if (!ninoActivo) { cont.innerHTML = ''; return; }

  if (hijos.length <= 1) {
    cont.innerHTML = `<span class="hijo-nombre">${esc(ninoActivo.nombre)}</span>`;
    return;
  }

  cont.innerHTML = `
    <select id="selectorHijo" class="hijo-select" aria-label="Cambiar de hijo">
      ${hijos.map(n => `<option value="${n.id}"${n.id === ninoActivo.id ? ' selected' : ''}>
        ${esc(n.nombre)}</option>`).join('')}
    </select>`;
  document.getElementById('selectorHijo')
          .addEventListener('change', e => cambiarHijo(e.target.value));
}

/* ─────────────────────────────────────────────────────────────
   ALTA DE FAMILIA Y DE HIJOS
   ───────────────────────────────────────────────────────────── */
async function crearFamilia(nombreFamilia, hijo) {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'Sin sesión' };

  const { data: f, error: e1 } = await sb
    .from('familias').insert({ nombre: nombreFamilia }).select().single();
  if (e1) return { error: mensajeFamilia(e1) };

  const { error: e2 } = await sb
    .from('familia_miembros').insert({ familia_id: f.id, user_id: user.id });
  if (e2) return { error: mensajeFamilia(e2) };

  const { error: e3 } = await sb.from('ninos').insert({
    familia_id: f.id, nombre: hijo.nombre,
    fecha_nacimiento: hijo.fecha, sexo: hijo.sexo
  });
  if (e3) return { error: mensajeFamilia(e3) };

  await cargarFamilia();
  return { ok: true };
}

async function anadirHijo(nombre, fecha, sexo) {
  if (!familia) return { error: 'Sin familia' };
  const { error } = await sb.from('ninos').insert({
    familia_id: familia.id, nombre, fecha_nacimiento: fecha, sexo
  });
  if (error) return { error: mensajeFamilia(error) };
  await cargarFamilia();
  return { ok: true };
}

/* ── Invitar al segundo adulto ── */
async function crearInvitacion() {
  if (!familia) return { error: 'Sin familia' };

  const { data: { user } } = await sb.auth.getUser();
  const codigo = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

  const { error } = await sb.from('invitaciones')
    .insert({ familia_id: familia.id, codigo, creada_por: user.id });
  if (error) return { error: mensajeFamilia(error) };
  return { ok: true, codigo };
}

/* Traduce los errores de la base de datos a algo legible */
function mensajeFamilia(error) {
  const m = (error && error.message) || '';
  if (/mas de 2 adultos/i.test(m))            return 'Una familia sólo puede tener dos adultos.';
  if (/familia_miembros_user_unico/i.test(m)) return 'Esa cuenta ya pertenece a otra familia.';
  if (/row-level security/i.test(m))          return 'No tienes permiso. ¿Se ha cerrado la sesión?';
  return m || 'Error desconocido';
}

/* ─────────────────────────────────────────────────────────────
   SUSCRIPCIÓN
   ───────────────────────────────────────────────────────────── */
function diasDePrueba() {
  if (!familia) return 0;
  return Math.ceil((new Date(familia.trial_hasta) - Date.now()) / 864e5);
}

function puedeEscribir() {
  if (!familia) return false;
  return familia.plan === 'activo' || diasDePrueba() > 0;
}

/* ─────────────────────────────────────────────────────────────
   PANTALLA DE ALTA
   ───────────────────────────────────────────────────────────── */
function engancharAlta() {
  const btn = document.getElementById('altaBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const err     = document.getElementById('altaErr');
    const nombreF = document.getElementById('altaFamilia').value.trim();
    const nombreH = document.getElementById('altaNombre').value.trim();
    const fecha   = document.getElementById('altaFecha').value;
    const sexo    = valorSel('rowAltaSexo', 'nino');

    const fallo =
      !nombreF ? 'Ponle nombre a la familia.' :
      !nombreH ? 'Ponle nombre al bebé.' :
      !fecha   ? 'Falta la fecha de nacimiento.' :
      new Date(fecha) > new Date() ? 'La fecha de nacimiento no puede ser futura.' :
      null;

    if (fallo) { err.textContent = fallo; err.style.display = ''; return; }

    btn.disabled = true; btn.textContent = 'Creando…';
    const r = await crearFamilia(nombreF, { nombre: nombreH, fecha, sexo });
    btn.disabled = false; btn.textContent = 'Crear';

    if (r.error) { err.textContent = r.error; err.style.display = ''; return; }
    err.style.display = 'none';
    mostrarApp();
  });

  document.getElementById('unirBtn').addEventListener('click', async () => {
    const err = document.getElementById('unirErr');
    const cod = document.getElementById('altaCodigo').value.trim().toUpperCase();
    if (!cod) { err.textContent = 'Pega el código que te han pasado.'; err.style.display = ''; return; }

    const r = await unirseAFamilia(cod);
    if (r.error) { err.textContent = r.error; err.style.display = ''; return; }
    err.style.display = 'none';
    await cargarFamilia();
    mostrarApp();
  });

  const salir = document.getElementById('logoutBtn2');
  if (salir) salir.addEventListener('click', () => sb.auth.signOut());

  const tema3 = document.getElementById('themeBtn3');
  if (tema3) tema3.addEventListener('click', toggleTema);
}

/* Unirse con un código de invitación.
   Va por RPC porque quien se une todavía NO es miembro, así que RLS
   no le deja ni leer la invitación ni insertarse en la familia. */
async function unirseAFamilia(codigo) {
  const { data, error } = await sb.rpc('unirse_a_familia', { p_codigo: codigo });
  if (error) return { error: mensajeFamilia(error) };
  if (data && data.error) return { error: data.error };
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
   AJUSTES: hijos, invitar al segundo adulto, plan
   ───────────────────────────────────────────────────────────── */
window.abrirAjustes = function() {
  if (!familia) return;

  document.getElementById('comidaModalTitulo').textContent = '⚙️ ' + t('ajustes.titulo', 'Ajustes');

  const dias = diasDePrueba();
  const plan = familia.plan === 'activo'
    ? '<span style="color:var(--ok)">Activo</span>'
    : dias > 0 ? `Prueba · quedan ${dias} ${plural(dias, 'día', 'días', 'dia')}`
               : '<span style="color:var(--danger)">Prueba terminada</span>';

  // Tres secciones plegables en vez de ocho bloques seguidos. Antes eran
  // 1.222 px de contenido en un modal de 690, todo al mismo peso visual:
  // había que leérselo entero para encontrar cualquier cosa.
  // Sólo se abre la primera; las otras dos son un toque.
  document.getElementById('comidaModalCuerpo').innerHTML = `

    <details class="secc" open>
      <summary>👪 ${t('ajustes.familia', 'Familia')}</summary>

      <div class="field">
        <div class="ali-fila" style="cursor:default">
          <span class="ali-nom">${esc(familia.nombre)}</span>
          <span class="ali-veces">${plan}</span>
          <button class="btn-edit-sm" onclick="editarFamilia()"
                  aria-label="Cambiar el nombre de la familia">✏️</button>
        </div>
      </div>

      <div class="field">
        <label>${t('ajustes.hijos', 'Hijos')}</label>
        ${hijos.map(n => `
          <div class="ali-fila" style="cursor:default">
            <span class="ali-nom">${esc(n.nombre)}</span>
            <span class="tag tag-pronto">${n.sexo === 'nina' ? 'niña' : 'niño'}</span>
            <span class="ali-veces">${esc(new Date(n.fecha_nacimiento + 'T12:00:00')
              .toLocaleDateString(localeActivo()))}</span>
            <button class="btn-edit-sm" onclick="editarHijo('${n.id}')"
                    aria-label="Editar a ${esc(n.nombre)}">✏️</button>
          </div>`).join('')}
      </div>

      <details class="mas">
        <summary>➕ ${t('ajustes.anadirHijo', 'Añadir otro hijo')}</summary>
        <div class="field">
          <label for="nuevoHijoNombre">Nombre</label>
          <input type="text" id="nuevoHijoNombre" maxlength="40">
        </div>
        <div class="field">
          <label for="nuevoHijoFecha">Fecha de nacimiento</label>
          <input type="date" id="nuevoHijoFecha">
        </div>
        <div class="field">
          <label>Sexo</label>
          <div class="toggle-row" id="rowNuevoHijoSexo">
            <button type="button" class="toggle-opt sel" data-v="nino">Niño</button>
            <button type="button" class="toggle-opt"     data-v="nina">Niña</button>
          </div>
        </div>
        <div class="field" style="margin-bottom:0">
          <button class="btn btn-secundario" onclick="guardarNuevoHijo()">Añadir</button>
        </div>
      </details>

      <div class="field" style="margin-bottom:0">
        <label>${t('ajustes.segundoAdulto', 'Segundo adulto')}</label>
        <p class="ficha-txt" id="estadoInvitacion">
          Genera un código y pásaselo. Una familia admite dos adultos como máximo.
        </p>
        <button class="btn btn-secundario" style="margin-top:8px"
                onclick="generarInvitacion()">Generar código de invitación</button>
      </div>
    </details>


    <details class="secc">
      <summary>🎛️ ${t('ajustes.app', 'La aplicación')}</summary>

      <div class="field">
        <label>${t('ajustes.idioma', 'Idioma')}</label>
        ${htmlSelectorIdioma()}
      </div>

      <div class="field" style="margin-bottom:0">
        <label>${t('ajustes.modulos', 'Qué quieres llevar')}</label>
        <p class="hint-txt" style="margin:0 0 10px">
          Lo que apagues desaparece de Registrar, Gráficas e Historial.
          <strong>No se borra nada</strong>: si lo vuelves a encender,
          todo lo guardado sigue ahí.
        </p>
        ${htmlModulos()}
      </div>
    </details>


    <details class="secc">
      <summary>🔐 ${t('ajustes.datos', 'Tus datos')}</summary>

      <div class="field">
        <p class="hint-txt" style="margin:0 0 10px">
          Llévatelo todo cuando quieras, sin pedir permiso a nadie. El JSON es la
          copia completa; el CSV se abre en una hoja de cálculo.
        </p>
        <button class="btn btn-secundario" id="btnExportJSON"
                onclick="exportarJSON()">⬇️ Descargar todo (JSON)</button>
        <button class="btn btn-secundario" id="btnExportCSV" style="margin-top:8px"
                onclick="exportarCSV()">⬇️ Registros (CSV)</button>
      </div>

      <div class="field" style="margin-bottom:0">
        <label>${t('ajustes.borrarCuenta', 'Borrar la cuenta')}</label>
        <p class="hint-txt" style="margin:0 0 10px">
          Borra tu cuenta y, si eres el único adulto de la familia, todo lo que
          hay dentro. No se puede deshacer y nosotros tampoco podremos recuperarlo.
        </p>
        <button class="btn btn-secundario"
                style="color:var(--danger);border-color:var(--danger)"
                onclick="abrirBorradoCuenta()">🗑️ Borrar mi cuenta</button>
      </div>
    </details>

    <p class="hint-txt" style="margin-top:14px;text-align:center">
      <a href="../privacidad" target="_blank" rel="noopener">Privacidad</a> ·
      <a href="../terminos" target="_blank" rel="noopener">Condiciones</a> ·
      <a href="../aviso-legal" target="_blank" rel="noopener">Aviso legal</a>
    </p>

    <p id="ajustesErr" class="error-txt" style="display:none"></p>`;
  document.getElementById('comidaModalBtns').innerHTML = '';
  document.getElementById('comidaModal').style.display = '';
};

/* ─────────────────────────────────────────────────────────────
   NOMBRE DE LA FAMILIA

   Salía «Familia Tamarit» porque lo escribí yo en la migración del
   30/09: había que meter los registros de Álex en alguna familia y
   nadie había elegido nombre todavía. Ahora se puede cambiar.
   ───────────────────────────────────────────────────────────── */
window.editarFamilia = function() {
  document.getElementById('comidaModalTitulo').textContent = '✏️ Nombre de la familia';
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label for="famNombre">Nombre</label>
      <input type="text" id="famNombre" maxlength="60" value="${esc(familia.nombre)}">
      <p class="hint-txt" style="margin:8px 0 0">
        Es sólo una etiqueta vuestra: no sale en las capturas ni la ve nadie de fuera.
      </p>
    </div>
    <p id="ajustesErr" class="error-txt" style="display:none"></p>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" onclick="guardarFamilia()">Guardar</button>
    <button class="btn" onclick="abrirAjustes()"
            style="background:var(--surface2);color:var(--text)">← Volver</button>`;
};

window.guardarFamilia = async function() {
  const err    = document.getElementById('ajustesErr');
  const nombre = document.getElementById('famNombre').value.trim();
  if (!nombre) { err.textContent = 'El nombre no puede quedar vacío.'; err.style.display = ''; return; }

  // .select() para detectar el caso de 0 filas afectadas: si RLS bloqueara el
  // UPDATE, Supabase no devuelve error, devuelve una lista vacía.
  const { data, error } = await sb.from('familias')
    .update({ nombre }).eq('id', familia.id).select();

  if (error || !data || !data.length) {
    err.textContent = error ? mensajeFamilia(error) : 'No se pudo guardar (sin permiso).';
    err.style.display = '';
    return;
  }

  familia.nombre = nombre;
  toast('✅ Nombre actualizado');
  abrirAjustes();
};

/* ─────────────────────────────────────────────────────────────
   EDITAR UN HIJO

   El sexo y la fecha de nacimiento no son cosméticos: de ellos salen
   la edad en días y la curva de la OMS con la que se calcula el
   percentil. Cambiarlos recalcula todo, por eso al guardar se
   repintan el resumen y las gráficas.
   ───────────────────────────────────────────────────────────── */
window.editarHijo = function(id) {
  const n = hijos.find(x => x.id === id);
  if (!n) return;

  const esUnico = hijos.length <= 1;

  document.getElementById('comidaModalTitulo').textContent = '✏️ ' + n.nombre;
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label for="edHijoNombre">Nombre</label>
      <input type="text" id="edHijoNombre" maxlength="40" value="${esc(n.nombre)}">
    </div>

    <div class="field">
      <label for="edHijoFecha">Fecha de nacimiento</label>
      <input type="date" id="edHijoFecha" value="${esc(n.fecha_nacimiento)}">
    </div>

    <div class="field">
      <label>Sexo</label>
      <div class="toggle-row" id="rowEdHijoSexo">
        <button type="button" class="toggle-opt${n.sexo !== 'nina' ? ' sel' : ''}" data-v="nino">Niño</button>
        <button type="button" class="toggle-opt${n.sexo === 'nina' ? ' sel' : ''}" data-v="nina">Niña</button>
      </div>
      <p class="hint-txt" style="margin:8px 0 0">
        La fecha y el sexo cambian el percentil: la OMS tiene una curva
        distinta para cada sexo, y la edad en días sale de la fecha.
      </p>
    </div>

    <p id="ajustesErr" class="error-txt" style="display:none"></p>

    <div class="field" style="margin-top:20px">
      <label>Zona peligrosa</label>
      <p class="hint-txt" style="margin:0 0 10px" id="avisoBorrado">Comprobando registros…</p>
      <button class="btn btn-secundario" id="btnBorrarHijo"
              style="color:var(--danger);border-color:var(--danger)"
              onclick="pedirBorradoHijo('${n.id}')" disabled>🗑️ Borrar a ${esc(n.nombre)}</button>
    </div>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" onclick="guardarHijo('${n.id}')">Guardar</button>
    <button class="btn" onclick="abrirAjustes()"
            style="background:var(--surface2);color:var(--text)">← Volver</button>`;

  // El recuento se pide aparte para no retrasar la apertura del formulario
  contarRegistrosDe(n.id).then(total => {
    const aviso = document.getElementById('avisoBorrado');
    const btn   = document.getElementById('btnBorrarHijo');
    if (!aviso || !btn) return;              // se cerró el modal mientras tanto

    if (esUnico) {
      aviso.innerHTML = 'Es el único hijo de la familia. Si lo borras, la app se '
        + 'queda sin nada que mostrar y no hay pantalla para volver a empezar. '
        + 'Para corregir un nombre o una fecha, edítalo aquí arriba.';
      return;
    }
    btn.disabled = false;
    aviso.innerHTML =
        total < 0 ? 'No se ha podido comprobar cuántos registros tiene. '
                  + 'Borrarlo se llevaría todo su historial.'
      : total > 0 ? `Tiene <strong>${total}</strong> ${plural(total, 'registro', 'registros', 'registro')}. `
                  + 'Borrarlo los borra todos, y eso no se puede deshacer.'
      : 'No tiene ningún registro todavía.';
  });
};

/* Cuántas filas cuelgan de este niño, en las tres tablas */
async function contarRegistrosDe(id) {
  let total = 0;
  for (const t of ['registros', 'alim_registros', 'alim_ajustes']) {
    const { count, error } = await sb.from(t)
      .select('*', { count: 'exact', head: true }).eq('nino_id', id);
    if (error) { console.error(error); return -1; }
    total += count || 0;
  }
  return total;
}

window.guardarHijo = async function(id) {
  const err    = document.getElementById('ajustesErr');
  const nombre = document.getElementById('edHijoNombre').value.trim();
  const fecha  = document.getElementById('edHijoFecha').value;
  const sexo   = valorSel('rowEdHijoSexo', 'nino');

  const fallo = !nombre ? 'Ponle nombre.'
              : !fecha  ? 'Falta la fecha de nacimiento.'
              : new Date(fecha) > new Date() ? 'La fecha no puede ser futura.' : null;
  if (fallo) { err.textContent = fallo; err.style.display = ''; return; }

  const { data, error } = await sb.from('ninos')
    .update({ nombre, fecha_nacimiento: fecha, sexo }).eq('id', id).select();

  if (error || !data || !data.length) {
    err.textContent = error ? mensajeFamilia(error) : 'No se pudo guardar (sin permiso).';
    err.style.display = '';
    return;
  }

  await cargarFamilia();
  pintarCabecera();
  renderResumen();
  renderTabla();
  if (tabActual === 'graficas') renderCharts();

  toast('✅ Datos actualizados');
  abrirAjustes();
};

/* ─────────────────────────────────────────────────────────────
   BORRAR UN HIJO

   Es la operación más destructiva de la app: se lleva por delante
   todo su historial. Por eso no basta un confirm():
     · si tiene registros, hay que teclear su nombre;
     · y el borrado va en orden, porque las claves ajenas NO son
       ON DELETE CASCADE. Eso conviene dejarlo así: sin ese orden
       explícito Postgres se niega, que es justo la red que impide
       que un toque accidental se lleve un historial entero.
   ───────────────────────────────────────────────────────────── */
window.pedirBorradoHijo = async function(id) {
  const n = hijos.find(x => x.id === id);
  if (!n || hijos.length <= 1) return;

  const total = await contarRegistrosDe(id);

  document.getElementById('comidaModalTitulo').textContent = '🗑️ Borrar a ' + n.nombre;
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="aviso aviso-stop" style="margin-bottom:14px">
      ${total < 0
        ? `No se ha podido comprobar cuántos registros tiene ${esc(n.nombre)}. Se borrará todo lo suyo. No se puede deshacer.`
        : total > 0
        ? `Se borrarán <strong>${total}</strong> ${plural(total, 'registro', 'registros', 'registro')} de ${esc(n.nombre)}. No se puede deshacer.`
        : `Se borrará a ${esc(n.nombre)}. Segun la base de datos no tiene ningún registro.`}
    </div>
    <div class="field">
      <label for="confBorrado">Escribe <strong>${esc(n.nombre)}</strong> para confirmar</label>
      <input type="text" id="confBorrado" autocomplete="off" placeholder="${esc(n.nombre)}">
    </div>
    <p id="ajustesErr" class="error-txt" style="display:none"></p>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn" onclick="borrarHijo('${n.id}')"
            style="background:var(--danger);color:#fff">Sí, borrar</button>
    <button class="btn" onclick="editarHijo('${n.id}')"
            style="background:var(--surface2);color:var(--text)">Cancelar</button>`;
};

window.borrarHijo = async function(id) {
  const n   = hijos.find(x => x.id === id);
  const err = document.getElementById('ajustesErr');
  if (!n) return;

  // Se pide el nombre SIEMPRE, tenga registros o no. El recuento se lee con
  // la sesion del usuario: si esta caducada, RLS devuelve cero filas y ningun
  // error, o sea que un historial entero parecia estar vacio. Confiar en ese
  // cero para saltarse la confirmacion era la peor forma posible de fallar.
  const campo = document.getElementById('confBorrado');
  if (!campo || campo.value.trim() !== n.nombre) {
    err.textContent = 'El nombre no coincide.';
    err.style.display = '';
    return;
  }

  // Orden obligatorio: primero lo que apunta al niño, el niño al final
  for (const t of ['alim_registros', 'alim_ajustes', 'registros']) {
    const { error } = await sb.from(t).delete().eq('nino_id', id);
    if (error) {
      err.textContent = 'No se pudo borrar de ' + t + ': ' + (error.message || '');
      err.style.display = '';
      return;
    }
  }

  const { error } = await sb.from('ninos').delete().eq('id', id);
  if (error) { err.textContent = mensajeFamilia(error); err.style.display = ''; return; }

  // Si el borrado era el hijo que se estaba viendo hay que soltarlo antes de
  // recargar: si no, cargarFamilia() lo buscaría por el id guardado y no existe.
  if (ninoActivo && ninoActivo.id === id) {
    localStorage.removeItem(CLAVE_ULTIMO_HIJO);
    limpiarEstado();
    ninoActivo = null;
  }

  await cargarFamilia();
  if (ninoActivo) localStorage.setItem(CLAVE_ULTIMO_HIJO, ninoActivo.id);

  pintarCabecera();
  await cargarDatos();
  configurarRealtime();
  if (moduloActivo('comida')) { await cargarComida(); configurarRealtimeComida(); }
  renderResumen();
  renderTabla();
  if (tabActual === 'graficas') renderCharts();

  toast('🗑️ ' + n.nombre + ' borrado');
  abrirAjustes();
};

window.guardarNuevoHijo = async function() {
  const err    = document.getElementById('ajustesErr');
  const nombre = document.getElementById('nuevoHijoNombre').value.trim();
  const fecha  = document.getElementById('nuevoHijoFecha').value;
  const sexo   = valorSel('rowNuevoHijoSexo', 'nino');

  const fallo = !nombre ? 'Ponle nombre.'
              : !fecha  ? 'Falta la fecha de nacimiento.'
              : new Date(fecha) > new Date() ? 'La fecha no puede ser futura.' : null;
  if (fallo) { err.textContent = fallo; err.style.display = ''; return; }

  const r = await anadirHijo(nombre, fecha, sexo);
  if (r.error) { err.textContent = r.error; err.style.display = ''; return; }

  toast('✅ Hijo añadido');
  cerrarComidaModal();
  pintarCabecera();
};

window.generarInvitacion = async function() {
  const r = await crearInvitacion();
  const el = document.getElementById('estadoInvitacion');
  if (r.error) {
    document.getElementById('ajustesErr').textContent = r.error;
    document.getElementById('ajustesErr').style.display = '';
    return;
  }
  el.innerHTML = `Código: <strong style="font-size:1.1rem;letter-spacing:2px">${esc(r.codigo)}</strong>
    <br><span class="hint-txt">Caduca en 7 días y sólo sirve una vez.</span>`;
};
