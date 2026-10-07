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

// Cuántos adultos hay en la familia. Se sabe sin consultar nada: la
// política mie_ver deja ver los dos miembros, así que cargarFamilia()
// ya se los trae. Lo usa la lista de primeros pasos, que se repinta
// muchas veces y no puede permitirse un await.
let adultosFamilia = 1;

// Quién eres tú. Hace falta para distinguir «lo marcaste tú» de
// «lo marcó tu pareja»: familia_miembros guarda identificadores,
// no nombres, y auth.users no se puede leer desde el cliente.
let usuarioId  = null;

const CLAVE_ULTIMO_HIJO = 'ultimoHijo';

/* ¿La fecha de nacimiento puede estar en el futuro? Sí.

   Una pareja que espera un bebé quiere poder abrir la aplicación antes
   del parto y ver cómo es, y para eso hace falta meter al hijo con la
   fecha prevista. Lo único que hay que cazar es el año tecleado mal,
   así que el límite no es «hoy» sino «dentro de un año»: más que
   cualquier embarazo y menos que una errata de siglo.

   Mientras no nazca, la edad es negativa. Eso está contemplado donde
   importa: lmsEn() ya devuelve null con edad negativa (no se dibujan
   percentiles inventados) y el aviso de pipís no se enciende. */
const DIAS_FUTURO_MAX = 365;
const TXT_FECHA_LEJOS = t('aj.fechaLejos', 'Esa fecha está demasiado lejos. ¿El año es correcto?');

function fechaDisparatada(iso) {
  const tope = new Date();
  tope.setDate(tope.getDate() + DIAS_FUTURO_MAX);
  return new Date(iso + 'T12:00:00') > tope;
}

/* ─────────────────────────────────────────────────────────────
   CARGA
   ───────────────────────────────────────────────────────────── */
async function cargarFamilia() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { familia = null; hijos = []; ninoActivo = null; usuarioId = null; return null; }
  usuarioId = user.id;

  // Una familia por usuario. Se traen TODAS las filas en vez de la
  // primera porque la política mie_ver deja ver también a la pareja, y
  // así se sabe de paso si la familia tiene uno o dos adultos sin
  // gastar una consulta aparte.
  const { data: mis, error: e1 } = await sb
    .from('familia_miembros').select('familia_id, user_id');
  if (e1) { console.error(e1); return null; }
  if (!mis || !mis.length) { familia = null; hijos = []; ninoActivo = null; return null; }
  adultosFamilia = mis.length;

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
  if (moduloActivo('medicacion')) await cargarMedicacion();

  // limpiarEstado() cierra los canales porque van filtrados por nino_id.
  // Sin volver a suscribirse aquí, el tiempo real dejaba de funcionar en
  // cuanto se cambiaba de hijo una vez.
  configurarRealtime();
  if (moduloActivo('comida')) configurarRealtimeComida();
  if (moduloActivo('medicacion')) configurarRealtimeMed();

  if (tabActual === 'graficas') renderCharts();
}

function limpiarEstado() {
  registros = [];
  comidas   = [];
  ajustes   = { plan: { retrasos: {}, descartados: [] }, inicio: null,
                preparacion: {}, personalizados: [] };

  Object.values(charts).forEach(c => { if (c) c.destroy(); });
  charts = {};

  medPautas     = [];
  medTomas      = [];
  medPendientes = [];

  // Los módulos también. Sin esto, cerrar sesión y entrar con otra
  // cuenta en el mismo navegador heredaba la configuración del
  // anterior hasta que cargarModulos() la pisara.
  resetModulos();
  adultosFamilia = 1;

  // Los canales van filtrados por nino_id, así que hay que rehacerlos
  if (canalRT)       { sb.removeChannel(canalRT);       canalRT = null; }
  if (canalRTComida) { sb.removeChannel(canalRTComida); canalRTComida = null; }
  if (canalRTMed)    { sb.removeChannel(canalRTMed);    canalRTMed = null; }

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
    <select id="selectorHijo" class="hijo-select" aria-label="${esc(t('aria.hijo', 'Cambiar de hijo'))}">
      ${hijos.map(n => `<option value="${n.id}"${n.id === ninoActivo.id ? ' selected' : ''}>
        ${esc(n.nombre)}</option>`).join('')}
    </select>`;
  document.getElementById('selectorHijo')
          .addEventListener('change', e => cambiarHijo(e.target.value));
}

/* ─────────────────────────────────────────────────────────────
   ALTA DE FAMILIA Y DE HIJOS
   ───────────────────────────────────────────────────────────── */
/* Va por RPC, igual que unirseAFamilia(), y por un motivo parecido.

   Antes eran tres escrituras seguidas desde aquí, y la primera no podía
   funcionar: para LEER la familia recién creada hay que ser miembro, para
   ser miembro hace falta su id, y el id sólo llega leyendo la fila. El
   .select() del insert chocaba con la política de SELECT.

   Comprobado suplantando a un usuario real: el INSERT a secas pasaba, el
   INSERT con RETURNING no. Nadie lo había visto porque la única familia
   que existía la creé en SQL durante la migración, y el segundo adulto
   entró por código de invitación, que ya iba por RPC.

   De paso, las tres altas ocurren ahora en una sola transacción: se acabó
   la posibilidad de dejar una familia a medio crear si se corta la red. */
async function crearFamilia(nombreFamilia, hijo) {
  const { data, error } = await sb.rpc('crear_familia', {
    p_familia:    nombreFamilia,
    p_hijo:       hijo.nombre,
    p_nacimiento: hijo.fecha,
    p_sexo:       hijo.sexo
  });

  if (error) return { error: mensajeFamilia(error) };
  if (data && data.error) return { error: data.error };

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
  if (/mas de 2 adultos/i.test(m))            return t('aj.dosAdultos', 'Una familia sólo puede tener dos adultos.');
  if (/familia_miembros_user_unico/i.test(m)) return 'Esa cuenta ya pertenece a otra familia.';
  if (/row-level security/i.test(m))          return t('aj.sinPermiso', 'No tienes permiso. ¿Se ha cerrado la sesión?');
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

  /* El alta tiene dos pasos: quién es, y con qué se empieza.

     Se parte porque entrar de golpe a cinco pestañas es lo que abruma
     a quien llega nuevo. Eligiendo al principio, se entra a tres. */
  let altaPaso = 1;

  function pintarPasoAlta() {
    const p1 = document.getElementById('altaPaso1');
    const p2 = document.getElementById('altaPaso2');
    const inv = document.getElementById('altaInvitacion');
    const atras = document.getElementById('altaAtrasBtn');

    const dos = altaPaso === 2;
    if (p1) p1.style.display = dos ? 'none' : '';
    if (p2) p2.style.display = dos ? '' : 'none';
    // «¿Qué quieres llevar?» junto a «pega tu código» no se entiende
    if (inv) inv.style.display = dos ? 'none' : '';
    if (atras) atras.style.display = dos ? '' : 'none';

    document.getElementById('altaTitulo').textContent =
      dos ? t('alta.queLlevar', '¿Qué quieres llevar ahora?') : 'Vamos a empezar';
    document.getElementById('altaSub').textContent =
      dos ? 'Se cambia cuando quieras en ⚙️ Ajustes' : t('alta.sub', 'Sólo se pide una vez');
    btn.textContent = dos ? 'Crear' : 'Siguiente';
    window.scrollTo(0, 0);
  }

  /* Se valida aquí y no sólo al pulsar «Siguiente»: se puede volver
     atrás y dejar un campo vacío antes de crear. */
  function datosAlta() {
    const nombreF = document.getElementById('altaFamilia').value.trim();
    const nombreH = document.getElementById('altaNombre').value.trim();
    const fecha   = document.getElementById('altaFecha').value;
    const sexo    = valorSel('rowAltaSexo', 'nino');

    const fallo =
      !nombreF ? t('aj.faltaFamilia', 'Ponle nombre a la familia.') :
      !nombreH ? t('aj.faltaBebe', 'Ponle nombre al bebé.') :
      !fecha   ? t('aj.faltaFecha', 'Falta la fecha de nacimiento.') :
      fechaDisparatada(fecha) ? TXT_FECHA_LEJOS :
      null;

    return { nombreF, nombreH, fecha, sexo, fallo };
  }

  const atrasBtn = document.getElementById('altaAtrasBtn');
  if (atrasBtn) atrasBtn.addEventListener('click', () => {
    altaPaso = 1;
    document.getElementById('altaErr').style.display = 'none';
    pintarPasoAlta();
  });

  btn.addEventListener('click', async () => {
    const err = document.getElementById('altaErr');
    const d = datosAlta();

    if (d.fallo) {
      altaPaso = 1; pintarPasoAlta();
      err.textContent = d.fallo; err.style.display = '';
      return;
    }
    err.style.display = 'none';

    // Paso 1 → paso 2
    if (altaPaso === 1) {
      document.getElementById('altaModulos').innerHTML = htmlModulosAlta();
      altaPaso = 2;
      pintarPasoAlta();
      return;
    }

    const elegidos = modulosElegidosAlta();

    // Con las cinco apagadas se entraría a «Están todos los módulos
    // ocultos», es decir, a una aplicación vacía el primer día.
    if (!Object.keys(elegidos).some(k => elegidos[k])) {
      err.textContent = t('alta.eligeUna', 'Elige al menos una cosa. Lo demás se enciende luego en Ajustes.');
      err.style.display = '';
      return;
    }

    btn.disabled = true; btn.textContent = 'Creando…';
    const r = await crearFamilia(d.nombreF, { nombre: d.nombreH, fecha: d.fecha, sexo: d.sexo });
    btn.disabled = false; btn.textContent = 'Crear';

    if (r.error) { err.textContent = r.error; err.style.display = ''; return; }
    err.style.display = 'none';

    /* El orden importa: `modulos` en memoria ANTES de pintar, porque
       mostrarApp() llama a aplicarModulos(). Y nada de cargarModulos()
       después: si esa lectura fallara haría return dejándolo todo
       encendido sin avisar, que convertiría un fallo de red en «el alta
       no sirvió para nada» en silencio. */
    modulos = elegidos;
    const g = await guardarModulos();
    if (g && g.error) {
      // La familia ya existe: bloquear aquí sería peor que seguir. La
      // elección vale para esta sesión y se recupera desde Ajustes.
      toast(t('alta.noModulos', '⚠️ No se pudo guardar qué quieres llevar. Se ajusta en ⚙️ Ajustes.'), 6000);
    }

    encenderPrimerosPasos();
    mostrarBienvenida();
  });

  document.getElementById('unirBtn').addEventListener('click', async () => {
    const err = document.getElementById('unirErr');
    const cod = document.getElementById('altaCodigo').value.trim().toUpperCase();
    if (!cod) { err.textContent = t('alta.pegaCod', 'Pega el código que te han pasado.'); err.style.display = ''; return; }

    const r = await unirseAFamilia(cod);
    if (r.error) { err.textContent = r.error; err.style.display = ''; return; }
    err.style.display = 'none';
    await cargarFamilia();

    // Faltaba: sin esto, quien se une a una familia que tiene Comida o
    // Medicinas apagadas las veía encendidas hasta recargar la página.
    // Sólo entrar() llamaba a cargarModulos(), y por aquí no se pasa.
    await cargarModulos();

    encenderPrimerosPasos();
    mostrarBienvenida();
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
            <span class="tag tag-pronto">${n.sexo === 'nina' ? t('alta.nina', 'niña') : t('alta.nino', 'niño')}</span>
            <span class="ali-veces">${esc(new Date(n.fecha_nacimiento + 'T12:00:00')
              .toLocaleDateString(localeActivo()))}</span>
            <button class="btn-edit-sm" onclick="editarHijo('${n.id}')"
                    aria-label="Editar a ${esc(n.nombre)}">✏️</button>
          </div>`).join('')}
      </div>

      <details class="mas">
        <summary>➕ ${t('ajustes.anadirHijo', 'Añadir otro hijo')}</summary>
        <div class="field">
          <label for="nuevoHijoNombre">${t('aj.nombre', 'Nombre')}</label>
          <input type="text" id="nuevoHijoNombre" maxlength="40">
        </div>
        <div class="field">
          <label for="nuevoHijoFecha">${t('alta.nacimiento', 'Fecha de nacimiento')}</label>
          <input type="date" id="nuevoHijoFecha">
        </div>
        <div class="field">
          <label>${t('alta.sexo', 'Sexo')}</label>
          <div class="toggle-row" id="rowNuevoHijoSexo">
            <button type="button" class="toggle-opt sel" data-v="nino">${t('alta.nino', 'Niño')}</button>
            <button type="button" class="toggle-opt"     data-v="nina">${t('alta.nina', 'Niña')}</button>
          </div>
        </div>
        <div class="field" style="margin-bottom:0">
          <button class="btn btn-secundario" onclick="guardarNuevoHijo()">${t('aj.anadir', 'Añadir')}</button>
        </div>
      </details>

      <div class="field" style="margin-bottom:0">
        <label>${t('ajustes.segundoAdulto', 'Segundo adulto')}</label>
        <p class="ficha-txt" id="estadoInvitacion">
          ${t('aj.invita', 'Genera un código y pásaselo. Una familia admite dos adultos como máximo.')}
        </p>
        <button class="btn btn-secundario" style="margin-top:8px"
                onclick="generarInvitacion()">${t('aj.generarCodigo', 'Generar código de invitación')}</button>
      </div>
    </details>


    <details class="secc">
      <summary>🎛️ ${t('ajustes.app', 'La aplicación')}</summary>

      <div class="field">
        <label>${t('ajustes.idioma', 'Idioma')}</label>
        ${htmlSelectorIdioma()}
      </div>

      <div class="field">
        <label>${t('ajustes.primerosPasos', 'Primeros pasos')}</label>
        <p class="hint-txt" style="margin:0 0 10px">
          ${t('aj.pasosTxt', 'La lista corta de cosas por hacer al empezar.')}
        </p>
        <button class="btn btn-secundario" onclick="verPrimerosPasos()"
          >${t('ajustes.verPasos', 'Ver los primeros pasos otra vez')}</button>
      </div>

      <div class="field" style="margin-bottom:0">
        <label>${t('ajustes.modulos', 'Qué quieres llevar')}</label>
        <p class="hint-txt" style="margin:0 0 10px" lang="es">
          Lo que apagues desaparece de Registrar, Gráficas e Historial.
          <strong>No se borra nada</strong>: si lo vuelves a encender,
          todo lo guardado sigue ahí.
        </p>
        <p class="hint-txt" style="margin:0 0 10px" lang="en">
          Whatever you switch off disappears from Log, Charts and History.
          <strong>Nothing is deleted</strong>: switch it back on and
          everything you saved is still there.
        </p>
        ${htmlModulos()}
      </div>
    </details>


    <details class="secc">
      <summary>☕ ${t('ajustes.apoyar', 'Apoyar la app')}</summary>

      <div class="field" style="margin-bottom:0">
        <p class="hint-txt" style="margin:0 0 12px" lang="es">
          Tracking Álex es gratis y lo va a seguir siendo. No hay publicidad ni
          se venden datos, y no los va a haber. La mantiene una familia, y el
          servidor y el dominio los pagamos nosotros.
          <strong>Si te está sirviendo y te apetece echar una mano, se
          agradece.</strong> Y si no, no pasa nada: la app es exactamente la misma.
        </p>
        <p class="hint-txt" style="margin:0 0 12px" lang="en">
          Tracking Álex is free and it is going to stay that way. There are no
          ads and no data is sold, and there never will be. One family keeps it
          running, and we pay for the server and the domain ourselves.
          <strong>If it is useful to you and you feel like chipping in, it is
          appreciated.</strong> And if not, no problem at all: the app is exactly
          the same either way.
        </p>
        <a class="btn btn-secundario" href="${KOFI_URL}"
           target="_blank" rel="noopener noreferrer"
          >☕ ${t('ajustes.kofi', 'Invitar a un café')}</a>
      </div>
    </details>


    <details class="secc">
      <summary>🔐 ${t('ajustes.datos', 'Tus datos')}</summary>

      <div class="field">
        <p class="hint-txt" style="margin:0 0 10px">
          ${t('aj.exportTxt', 'Llévatelo todo cuando quieras, sin pedir permiso a nadie. '
            + 'El JSON es la copia completa; el CSV se abre en una hoja de cálculo.')}
        </p>
        <button class="btn btn-secundario" id="btnExportJSON"
                onclick="exportarJSON()">⬇️ ${t('aj.expJSON', 'Descargar todo (JSON)')}</button>
        <button class="btn btn-secundario" id="btnExportCSV" style="margin-top:8px"
                onclick="exportarCSV()">⬇️ ${t('aj.expCSV', 'Registros (CSV)')}</button>
        ${moduloActivo('medicacion') ? `
        <button class="btn btn-secundario" id="btnExportMed" style="margin-top:8px"
                onclick="exportarMedicacionCSV()">⬇️ ${t('aj.expMed', 'Medicinas (CSV)')}</button>` : ''}
      </div>

      <div class="field">
        <label>${t('ajustes.compartir', 'Compartir las gráficas')}</label>
        <p class="hint-txt" style="margin:0 0 10px" lang="es">
          Un enlace para que los abuelos, la matrona o el pediatra vean las
          gráficas de ${esc(nombreHijo())} sin tener cuenta. <strong>Sólo
          mirar:</strong> no pueden apuntar nada, ni ven el historial, ni la
          comida, ni las medicinas, ni nada tuyo.
        </p>
        <p class="hint-txt" style="margin:0 0 10px" lang="en">
          A link so grandparents, your midwife or your doctor can see
          ${esc(nombreHijo())}&rsquo;s charts without an account.
          <strong>Looking only:</strong> they cannot write anything down, and
          they do not see the history, the food, the medicines, or anything
          of yours.
        </p>
        <div id="listaEnlaces">
          <p class="hint-txt" style="margin:0">${t('aj.cargando', 'Cargando…')}</p>
        </div>
        <button class="btn btn-secundario" style="margin-top:8px"
                id="btnNuevoEnlace" onclick="abrirNuevoEnlace()"
          >🔗 ${t('ajustes.nuevoEnlace', 'Crear un enlace')}</button>
      </div>

      <div class="field" style="margin-bottom:0">
        <label>${t('ajustes.borrarCuenta', 'Borrar la cuenta')}</label>
        <p class="hint-txt" style="margin:0 0 10px">
          ${t('aj.borrarTxt', 'Borra tu cuenta y, si eres el único adulto de la familia, '
            + 'todo lo que hay dentro. No se puede deshacer y nosotros tampoco '
            + 'podremos recuperarlo.')}
        </p>
        <button class="btn btn-secundario"
                style="color:var(--danger);border-color:var(--danger)"
                onclick="abrirBorradoCuenta()">🗑️ ${t('aj.borrarBtn', 'Borrar mi cuenta')}</button>
      </div>
    </details>

    <p class="hint-txt" style="margin-top:14px;text-align:center">
      <a href="../privacidad" target="_blank" rel="noopener">${t('pie.privacidad', 'Privacidad')}</a> ·
      <a href="../terminos" target="_blank" rel="noopener">${t('pie.terminos', 'Condiciones')}</a> ·
      <a href="../aviso-legal" target="_blank" rel="noopener">${t('pie.legal', 'Aviso legal')}</a>
    </p>

    <p id="ajustesErr" class="error-txt" style="display:none"></p>`;
  document.getElementById('comidaModalBtns').innerHTML = '';
  abrirModal('abrirAjustes');

  // La lista de enlaces compartidos es una consulta, y abrirAjustes() no
  // es asíncrona: se pinta aparte, sobre el hueco que acaba de quedar.
  if (typeof pintarEnlaces === 'function') pintarEnlaces();
};

/* ─────────────────────────────────────────────────────────────
   NOMBRE DE LA FAMILIA

   Salía «Familia Tamarit» porque lo escribí yo en la migración del
   30/09: había que meter los registros de Álex en alguna familia y
   nadie había elegido nombre todavía. Ahora se puede cambiar.
   ───────────────────────────────────────────────────────────── */
window.editarFamilia = function() {
  document.getElementById('comidaModalTitulo').textContent = t('aj.nombreFamilia', '✏️ Nombre de la familia');
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label for="famNombre">${t('aj.nombre', 'Nombre')}</label>
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
  if (!nombre) { err.textContent = t('aj.nombreVacio', 'El nombre no puede quedar vacío.'); err.style.display = ''; return; }

  // .select() para detectar el caso de 0 filas afectadas: si RLS bloqueara el
  // UPDATE, Supabase no devuelve error, devuelve una lista vacía.
  const { data, error } = await sb.from('familias')
    .update({ nombre }).eq('id', familia.id).select();

  if (error || !data || !data.length) {
    err.textContent = error ? mensajeFamilia(error) : t('aj.noGuardadoPerm', 'No se pudo guardar (sin permiso).');
    err.style.display = '';
    return;
  }

  familia.nombre = nombre;
  toast(t('aj.okNombre', '✅ Nombre actualizado'));
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
      <label for="edHijoNombre">${t('aj.nombre', 'Nombre')}</label>
      <input type="text" id="edHijoNombre" maxlength="40" value="${esc(n.nombre)}">
    </div>

    <div class="field">
      <label for="edHijoFecha">${t('alta.nacimiento', 'Fecha de nacimiento')}</label>
      <input type="date" id="edHijoFecha" value="${esc(n.fecha_nacimiento)}">
    </div>

    <div class="field">
      <label>${t('alta.sexo', 'Sexo')}</label>
      <div class="toggle-row" id="rowEdHijoSexo">
        <button type="button" class="toggle-opt${n.sexo !== 'nina' ? ' sel' : ''}" data-v="nino">${t('alta.nino', 'Niño')}</button>
        <button type="button" class="toggle-opt${n.sexo === 'nina' ? ' sel' : ''}" data-v="nina">${t('alta.nina', 'Niña')}</button>
      </div>
      <p class="hint-txt" style="margin:8px 0 0">
        La fecha y el sexo cambian el percentil: la OMS tiene una curva
        distinta para cada sexo, y la edad en días sale de la fecha.
      </p>
    </div>

    <div class="field">
      <label for="edHijoTalla">${t('aj.talla', 'Talla de ropa (cm)')}</label>
      <select id="edHijoTalla" class="hijo-select">
        <option value=""${n.talla ? '' : ' selected'}>${t('aj.tallaSin', 'Sin decidir')}</option>
        ${htmlTallas(n.talla)}
      </select>
      <p class="hint-txt" style="margin:8px 0 0">${t('aj.talla.txt',
        'Sólo se usa para estimar lo que pesa la ropa al registrar un peso. '
        + 'También se puede cambiar desde ahí, y se guarda aquí.')}</p>
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
      aviso.innerHTML = esc(t('aj.unicoHijo',
        'Es el único hijo de la familia. Si lo borras, la app se queda sin nada '
        + 'que mostrar y no hay pantalla para volver a empezar. Para corregir un '
        + 'nombre o una fecha, edítalo aquí arriba.'));
      return;
    }
    btn.disabled = false;
    aviso.innerHTML =
        total < 0 ? esc(t('aj.noCuenta',
                      'No se ha podido comprobar cuántos registros tiene. '
                      + 'Borrarlo se llevaría todo su historial.'))
      : total > 0 ? t2('aj.tieneRegs', 'Tiene {n} {p}. Borrarlo los borra todos, '
                      + 'y eso no se puede deshacer.',
                      { n: '<strong>' + total + '</strong>',
                        p: plural(total, 'registro', 'registros', 'registro') })
      : esc(t('aj.sinRegistros', 'No tiene ningún registro todavía.'));
  });
};

/* Cuántas filas cuelgan de este niño, en las tres tablas */
async function contarRegistrosDe(id) {
  let total = 0;
  for (const t of ['registros', 'alim_registros', 'alim_ajustes',
                   'med_tomas', 'med_pautas']) {
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
  // Vacío = «sin decidir», que en la base es NULL y no 0: son cosas
  // distintas y la columna lo distingue a propósito.
  const talla  = parseInt(document.getElementById('edHijoTalla').value, 10) || null;

  const fallo = !nombre ? 'Ponle nombre.'
              : !fecha  ? t('aj.faltaFecha', 'Falta la fecha de nacimiento.')
              : fechaDisparatada(fecha) ? TXT_FECHA_LEJOS : null;
  if (fallo) { err.textContent = fallo; err.style.display = ''; return; }

  const { data, error } = await sb.from('ninos')
    .update({ nombre, fecha_nacimiento: fecha, sexo, talla }).eq('id', id).select();

  if (error || !data || !data.length) {
    err.textContent = error ? mensajeFamilia(error) : t('aj.noGuardadoPerm', 'No se pudo guardar (sin permiso).');
    err.style.display = '';
    return;
  }

  await cargarFamilia();
  pintarCabecera();
  renderResumen();
  renderTabla();
  if (tabActual === 'graficas') renderCharts();

  /* La talla puede haber cambiado, y el desplegable de Registrar se pinta
     una sola vez. Se vacía para que vuelva a nacer leyendo el niño nuevo:
     repintarlo «conservando lo de antes» traería justo la talla vieja que
     se acaba de corregir. Se pierden las prendas marcadas, y da igual —
     quien entra en Ajustes a cambiar la talla no está pesando al bebé. */
  const caja = document.getElementById('pesoRopa');
  if (caja && typeof pintarRopaPeso === 'function') {
    caja.innerHTML = '';
    pintarRopaPeso();
  }

  toast(t('aj.okDatos', '✅ Datos actualizados'));
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
        ? t2('aj.borrarHijoND', 'No se ha podido comprobar cuántos registros tiene '
            + '{h}. Se borrará todo lo suyo. No se puede deshacer.',
            { h: esc(n.nombre) })
        : total > 0
        ? t2('aj.borrarHijoN', 'Se borrarán {n} {p} de {h}. No se puede deshacer.',
            { n: '<strong>' + total + '</strong>',
              p: plural(total, 'registro', 'registros', 'registro'),
              h: esc(n.nombre) })
        : t2('aj.borrarHijo0', 'Se borrará a {h}. Según la base de datos no tiene '
            + 'ningún registro.', { h: esc(n.nombre) })}
    </div>
    <div class="field">
      <label for="confBorrado">${t2('dat.escribe', 'Escribe {p} para confirmar',
        { p: '<strong>' + esc(n.nombre) + '</strong>' })}</label>
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
    err.textContent = t('aj.noCoincide', 'El nombre no coincide.');
    err.style.display = '';
    return;
  }

  // Orden obligatorio: primero lo que apunta al niño, el niño al final.
  // Y dentro de medicación, las tomas antes que las pautas: la cadena
  // de claves ajenas es toma → pauta → niño.
  for (const t of ['enlaces', 'med_tomas', 'med_pautas',
                   'alim_registros', 'alim_ajustes', 'registros']) {
    const { error } = await sb.from(t).delete().eq('nino_id', id);
    if (error) {
      err.textContent = t('aj.noBorradoDe', 'No se pudo borrar de ') + t + ': ' + (error.message || '');
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
  if (moduloActivo('medicacion')) { await cargarMedicacion(); configurarRealtimeMed(); }
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
              : !fecha  ? t('aj.faltaFecha', 'Falta la fecha de nacimiento.')
              : fechaDisparatada(fecha) ? TXT_FECHA_LEJOS : null;
  if (fallo) { err.textContent = fallo; err.style.display = ''; return; }

  const r = await anadirHijo(nombre, fecha, sexo);
  if (r.error) { err.textContent = r.error; err.style.display = ''; return; }

  toast(t('aj.okHijo', '✅ Hijo añadido'));
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
