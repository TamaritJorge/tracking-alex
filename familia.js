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

  document.getElementById('comidaModalTitulo').textContent = '⚙️ Ajustes';

  const dias = diasDePrueba();
  const plan = familia.plan === 'activo'
    ? '<span style="color:var(--ok)">Activo</span>'
    : dias > 0 ? `Prueba · quedan ${dias} ${dias === 1 ? 'día' : 'días'}`
               : '<span style="color:var(--danger)">Prueba terminada</span>';

  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label>Familia</label>
      <p class="ficha-txt">${esc(familia.nombre)} · ${plan}</p>
    </div>

    <div class="field">
      <label>Hijos</label>
      ${hijos.map(n => `
        <div class="ali-fila" style="cursor:default">
          <span class="ali-nom">${esc(n.nombre)}</span>
          <span class="tag tag-pronto">${n.sexo === 'nina' ? 'niña' : 'niño'}</span>
          <span class="ali-veces">${esc(new Date(n.fecha_nacimiento + 'T12:00:00')
            .toLocaleDateString('es-ES'))}</span>
        </div>`).join('')}
    </div>

    <div class="field">
      <label>Qué quieres llevar</label>
      <p class="hint-txt" style="margin:0 0 10px">
        Lo que apagues desaparece de Registrar, Gráficas e Historial.
        <strong>No se borra nada</strong>: si lo vuelves a encender,
        todo lo guardado sigue ahí.
      </p>
      ${htmlModulos()}
    </div>

    <details style="margin-bottom:16px">
      <summary style="cursor:pointer;font-size:.9rem;color:var(--primary)">➕ Añadir otro hijo</summary>
      <div style="margin-top:12px">
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
        <button class="btn btn-secundario" onclick="guardarNuevoHijo()">Añadir</button>
      </div>
    </details>

    <div class="field">
      <label>Segundo adulto</label>
      ${hijos.length === 0 ? '' : ''}
      <p class="ficha-txt" id="estadoInvitacion">
        ${'Genera un código y pásaselo. Una familia admite dos adultos como máximo.'}
      </p>
      <button class="btn btn-secundario" style="margin-top:8px"
              onclick="generarInvitacion()">Generar código de invitación</button>
    </div>

    <p id="ajustesErr" class="error-txt" style="display:none"></p>`;

  document.getElementById('comidaModalBtns').innerHTML = '';
  document.getElementById('comidaModal').style.display = '';
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
