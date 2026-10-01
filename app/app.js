/* ═════════════════════════════════════════════════════════════
   Configuración, estado compartido, utilidades, tema, sesión,
   pestañas, carga de datos y resumen de 24 h.
   Se carga el primero: el resto de ficheros usa lo que define aquí.
   ═════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   CONFIGURACIÓN
   Solo la publishable key va aquí — la secret key NUNCA
   ───────────────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://yzarrncayxkvkpyflbrk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IliCiFj7DM6UHxL4YxlnNw_57j6pW5z';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─────────────────────────────────────────────────────────────
   COLORES DE CACA
   Definidos UNA sola vez y reutilizados en el formulario, el
   modal de edición, la tabla y la gráfica.
   ───────────────────────────────────────────────────────────── */
const COLORES_CACA = {
  mostaza:     { label: 'Amarillo mostaza', hex: '#d4a017' },
  amarillo:    { label: 'Amarillo claro',   hex: '#f2c94c' },
  verde:       { label: 'Verdoso',          hex: '#4d9c5a' },
  marron:      { label: 'Marrón',           hex: '#8a5a34' },
  naranja:     { label: 'Naranja',          hex: '#e07b39' },
  negro:       { label: 'Negro (meconio)',  hex: '#3b3b3b' },
  blanquecino: { label: 'Blanquecino ⚠️',    hex: '#e8e4d9' },
  rojizo:      { label: 'Rojizo / sangre ⚠️', hex: '#b03030' }
};

const COLOR_CACA_DEF = 'mostaza';
const COLOR_PIPI     = '#38bdf8';

function infoColor(clave) {
  return COLORES_CACA[clave] || { label: clave || '—', hex: '#8a5a34' };
}

/* ── Estado ────────────────────────────────────────────────── */
// El antiguo modo matrona (?modo=ver) se ha retirado: funcionaba porque
// TODA la base de datos era de lectura pública, que es justo lo que había
// que cerrar al pasar a varias familias. Para enseñar datos en la consulta
// están las capturas compartibles.
const modoVer = false;          // se conserva la constante para no romper llamadas
let registros  = [];
let charts     = {};            // { ext, peso, panal }
let filtroHist = 'todo';
let canalRT    = null;
let tabActual  = 'registrar';

/* ─────────────────────────────────────────────────────────────
   UTILIDADES
   ───────────────────────────────────────────────────────────── */

// Escapa texto antes de meterlo en innerHTML. Imprescindible desde
// que existen las notas libres: sin esto, una nota con <script> o
// con comillas rompería (o peor) la tabla del historial.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let toastTimer;
function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── Fechas ────────────────────────────────────────────────── */

// Momento actual en formato YYYY-MM-DDTHH:mm para datetime-local
function ahoraLocal() {
  const d = new Date();
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Pasa un ISO de la base de datos al formato de datetime-local
function toLocalDT(iso) {
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fmtFechaHora(iso) {
  // El idioma lo pone idiomas.js, no este fichero
  return fechaHora(iso);
}

// Lee un input datetime-local y devuelve el ISO, o null si no vale
function leerFechaISO(id) {
  const v = document.getElementById(id).value;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(+d) ? null : d.toISOString();
}

const VENTANA_MS = 24 * 60 * 60 * 1000;

// Ventana móvil: desde hace 24 h hasta ahora mismo.
// No es "hoy" de calendario, así que a las 2 de la mañana sigue
// contando lo de la tarde anterior, que es cuando más falta hace.
function enVentana(iso, desde) {
  return +new Date(iso) >= desde;
}


/* ─────────────────────────────────────────────────────────────
   TENDENCIA DE PESO

   Recta de mínimos cuadrados sobre las pesadas recientes.

   Sólo se usan los últimos DIAS_TENDENCIA días a propósito: los
   primeros días el bebé PIERDE peso y luego lo recupera,
   y meter esa bajada en el ajuste aplanaría la pendiente y daría
   una estimación falsamente mala.
   ───────────────────────────────────────────────────────────── */
const OBJETIVO_G_DIA  = 20;   // mínimo que indicó la pediatra
const DIAS_TENDENCIA  = 7;    // ventana de pesadas que entra en el ajuste
const DIAS_PROYECCION = 7;    // hasta dónde se prolonga la recta
const MIN_HORAS_SPAN  = 18;   // por debajo de esto la pendiente se dispara

function tendenciaPeso() {
  const pts = registros
    .filter(r => r.tipo === 'peso')
    .map(r => ({ t: +new Date(r.fecha_hora), g: Number(r.datos.gramos) }))
    .filter(p => !isNaN(p.t) && !isNaN(p.g))
    .sort((a, b) => a.t - b.t);

  if (pts.length < 2) return null;

  const ultimo = pts[pts.length - 1];
  let usados = pts.filter(p => p.t >= ultimo.t - DIAS_TENDENCIA * 864e5);
  if (usados.length < 2) usados = pts.slice(-2);   // pesadas muy espaciadas

  const span = usados[usados.length - 1].t - usados[0].t;
  if (span < MIN_HORAS_SPAN * 3600e3) return null;

  // Mínimos cuadrados con el tiempo en días desde la primera pesada usada
  const t0 = usados[0].t;
  const x  = usados.map(p => (p.t - t0) / 864e5);
  const n  = usados.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = usados.reduce((a, p) => a + p.g, 0) / n;

  let num = 0, den = 0;
  x.forEach((xi, i) => {
    num += (xi - mx) * (usados[i].g - my);
    den += (xi - mx) ** 2;
  });
  if (!den) return null;

  const gPorDia = num / den;
  return {
    gPorDia,
    inter: my - gPorDia * mx,          // gramos estimados en t0
    t0,
    n,
    dias: span / 864e5,
    ultimo
  };
}

// Gramos estimados por la recta en un instante dado
function pesoEstimado(tend, t) {
  return tend.inter + tend.gPorDia * (t - tend.t0) / 864e5;
}

/* ─────────────────────────────────────────────────────────────
   SELECTORES DE BOTONES (cantidad, color, dos opciones)

   Se generan por HTML y se gestionan con UN listener delegado:
   así funcionan igual en el formulario principal y dentro del
   modal de edición, que se crea sobre la marcha.
   ───────────────────────────────────────────────────────────── */

function htmlCantidad(valor = 0) {
  let h = '';
  for (let n = 0; n <= 10; n++) {
    const sel = n === valor;
    h += `<button type="button" class="qty-btn${sel ? ' sel' : ''}" `
       + `data-v="${n}" aria-pressed="${sel}">${n}</button>`;
  }
  return h;
}

/* Ocho muestras en una fila, y debajo el nombre de la elegida.
   Antes era una rejilla de ocho botones con su texto: 203 px de los ~600
   que tiene un movil, y por eso el boton de Guardar no se alcanzaba.
   El nombre en texto sigue ahi — elegir un color no puede depender solo
   de ver el color — pero ocupa una linea en vez de ocho. */
function htmlColores(valor = COLOR_CACA_DEF) {
  const botones = Object.entries(COLORES_CACA).map(([clave, c]) => {
    const sel = clave === valor;
    const ojo = /⚠/.test(c.label);          // los dos de aviso llevan ⚠️
    return `<button type="button" class="color-btn${sel ? ' sel' : ''}" `
         + `data-v="${clave}" aria-pressed="${sel}" aria-label="${esc(c.label)}" `
         + `title="${esc(c.label)}" style="--muestra:${c.hex}">`
         + (ojo ? '<span class="color-ojo" aria-hidden="true">⚠️</span>' : '')
         + `</button>`;
  }).join('');

  return botones + `<span class="color-nombre">${esc(infoColor(valor).label)}</span>`;
}

// Valor seleccionado dentro de una fila de botones
function valorSel(rowId, porDefecto = null) {
  const el = document.querySelector('#' + rowId + ' .sel');
  return el ? el.dataset.v : porDefecto;
}

function cantidadSel(rowId) {
  const v = valorSel(rowId);
  return v === null ? null : parseInt(v, 10);
}

// Un único listener para todos los selectores de la página,
// acotado siempre a la fila del propio botón: así el toggle de
// pipí no desmarca el de pecho (y viceversa).
document.addEventListener('click', e => {
  const btn = e.target.closest('.qty-btn, .color-btn, .toggle-opt, .chip');
  if (!btn) return;

  const fila = btn.closest('.qty-row, .color-row, .toggle-row, .chip-row');
  if (!fila) return;

  fila.querySelectorAll('button').forEach(b => {
    b.classList.remove('sel');
    b.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('sel');
  btn.setAttribute('aria-pressed', 'true');

  // Al elegir un color, su nombre se escribe debajo de la fila
  if (btn.classList.contains('color-btn')) {
    const nombre = fila.querySelector('.color-nombre');
    if (nombre) nombre.textContent = infoColor(btn.dataset.v).label;
  }

  // Los chips del historial además filtran. Acotado a #filtroRow a
  // propósito: si no, cualquier .chip de otra pestaña machacaría el
  // filtro del historial sin que se note.
  if (btn.classList.contains('chip') && btn.closest('#filtroRow')) {
    filtroHist = btn.dataset.f;
    renderTabla();
  }

  // Y los de la pestaña Registrar eligen qué formulario se ve
  if (btn.classList.contains('chip') && btn.closest('#selectorRegistro')) {
    mostrarFormulario(btn.dataset.reg);
  }
});

/* ─────────────────────────────────────────────────────────────
   TEMA CLARO / OSCURO
   ───────────────────────────────────────────────────────────── */
let tema = localStorage.getItem('tema') || 'auto';

function esDark() {
  return tema === 'dark' ||
    (tema === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}

function aplicarTema(t) {
  tema = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem('tema', t);
  const icono = esDark() ? '☀️' : '🌙';
  // Los tres botones: login, app y alta. Recorrido en vez de uno a uno,
  // para que añadir una pantalla nueva no deje su icono desincronizado.
  ['themeBtn1', 'themeBtn2', 'themeBtn3'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.textContent = icono;
  });
  // Antes se miraba charts.ext como prueba de "ya se ha dibujado alguna
  // vez". Con módulos ocultables esa gráfica puede no existir nunca, así
  // que el cambio de tema dejaba de repintar las demás.
  if (tabActual === 'graficas' && Object.keys(charts).length) renderCharts();
}

function toggleTema() { aplicarTema(esDark() ? 'light' : 'dark'); }

document.getElementById('themeBtn1').addEventListener('click', toggleTema);
document.getElementById('themeBtn2').addEventListener('click', toggleTema);
aplicarTema(tema);

/* ─────────────────────────────────────────────────────────────
   INICIALIZACIÓN
   ───────────────────────────────────────────────────────────── */
async function init() {
  // El idioma, antes que nada: si no, se ve un parpadeo en español
  aplicarIdioma();

  // Pintar los selectores generados antes de nada
  document.getElementById('rowCacaQty').innerHTML   = htmlCantidad(1);
  document.getElementById('rowPipiQty').innerHTML   = htmlCantidad(1);
  document.getElementById('rowCacaColor').innerHTML = htmlColores();

  // Antes la sesión sólo se miraba al arrancar: si caducaba, la app no se
  // enteraba y los guardados fallaban en silencio.
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') { limpiarEstado(); mostrarLogin(); }

    // PASSWORD_RECOVERY llega cuando se vuelve desde el enlace del correo.
    // Hay que atenderlo ANTES que SIGNED_IN: supabase-js deja una sesion
    // iniciada, asi que sin esto entrarias directo a la app sin llegar a
    // cambiar la contrasena, y el enlace del correo no serviria de nada.
    if (evento === 'PASSWORD_RECOVERY') { modoRecuperacion(true); return; }

    if (evento === 'SIGNED_IN')  entrar();
  });

  engancharAlta();

  // Cerrar el modal tocando fuera. Va aquí y no en iniciarComida() porque
  // ese mismo modal lo reutiliza Ajustes, que existe aunque la pestaña de
  // comida esté apagada.
  document.getElementById('comidaModal').addEventListener('click', e => {
    if (e.target.id === 'comidaModal') cerrarComidaModal();
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session) await entrar();
  else mostrarLogin();
}

/* Con sesión iniciada: o tienes familia y entras, o hay que crearla */
async function entrar() {
  await cargarFamilia();
  if (!hayFamilia() || !hayHijo()) { mostrarAlta(); return; }
  await cargarModulos();     // qué se enseña y qué no, antes de pintar nada
  mostrarApp();
}

function pantalla(cual) {
  ['loginScreen', 'altaScreen', 'appScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === cual) ? '' : 'none';
  });
}

function mostrarLogin() { pantalla('loginScreen'); }
function mostrarAlta()  { pantalla('altaScreen'); }

function mostrarApp() {
  pantalla('appScreen');
  pintarCabecera();
  avisarSuscripcion();

  // Antes que nada: esconder lo que la familia no use, para que no
  // se dibujen gráficas de módulos apagados ni parpadeen sus tarjetas.
  aplicarModulos();

  resetFechas();
  ponerBotonesCompartir();
  cargarDatos();
  configurarRealtime();
  if (moduloActivo('comida')) iniciarComida();   // sus propias tablas (comida.js)
  switchTab(tabActual);
}

/* Aviso de los días de prueba que quedan */
/* Mientras no haya pasarela de pago, no se enseña ninguna cuenta atrás.
   El contador llegaba a cero y no pasaba absolutamente nada —puedeEscribir()
   no se llama desde ningún sitio y la política RLS no mira el plan—, así que
   se contradecía a sí mismo y además contradecía las condiciones del
   servicio, que dicen que hoy es gratuito.

   Se pone a true el día que Stripe esté conectado Y el límite esté en la base
   de datos. En el cliente solo sería decorativo: cualquiera con su token puede
   escribir contra la API saltándose la interfaz. */
const COBRO_ACTIVO = false;

function avisarSuscripcion() {
  const el = document.getElementById('avisoPlan');
  if (!el) return;

  if (!COBRO_ACTIVO || !familia || familia.plan === 'activo') {
    el.style.display = 'none';
    return;
  }

  const dias = diasDePrueba();
  el.style.display = '';
  el.className = 'aviso ' + (dias > 3 ? 'aviso-suave' : dias > 0 ? 'aviso-ojo' : 'aviso-stop');
  el.textContent = dias > 0
    ? t2('plan.prueba', 'Prueba gratuita: quedan {n} {dias}.',
          { n: dias, dias: plural(dias, 'día', 'días', 'dia') })
    : 'La prueba ha terminado. Puedes consultar y exportar todo, pero no añadir registros nuevos.';
}

// Todos los formularios arrancan en "ahora"
function resetFechas() {
  ['extFecha', 'pesoFecha', 'cacaFecha', 'pipiFecha'].forEach(id => {
    document.getElementById(id).value = ahoraLocal();
  });
}

/* ─────────────────────────────────────────────────────────────
   AUTH — LOGIN / LOGOUT
   ───────────────────────────────────────────────────────────── */
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const btn   = document.getElementById('loginBtn');
  const errEl = document.getElementById('loginErr');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Entrando…';

  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });

  btn.disabled = false;
  btn.textContent = 'Entrar';

  // De entrar() se encarga onAuthStateChange, que salta con SIGNED_IN
  if (error) { errEl.textContent = traducirAuth(error); errEl.style.display = ''; }
});

// Pulsar Enter en el campo contraseña hace login
document.getElementById('loginPwd').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

/* ── Google ── */
document.getElementById('googleBtn').addEventListener('click', async () => {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) {
    const errEl = document.getElementById('loginErr');
    errEl.textContent = traducirAuth(error);
    errEl.style.display = '';
  }
});

/* ── Registrarse con correo ── */
document.getElementById('registroBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const errEl = document.getElementById('loginErr');

  if (!email || pwd.length < 8) {
    errEl.textContent = 'Pon un correo y una contraseña de al menos 8 caracteres.';
    errEl.style.display = '';
    return;
  }

  // emailRedirectTo explicito: sin el manda la Site URL del panel, que
  // apunta a la raiz, y el usuario confirmaba su cuenta para aterrizar en
  // la pagina de ventas en vez de dentro de la aplicacion.
  const { error } = await sb.auth.signUp({
    email, password: pwd,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });
  errEl.style.display = '';
  errEl.textContent = error
    ? traducirAuth(error)
    : 'Cuenta creada. Mira el correo para confirmarla y luego entra.';
});

function traducirAuth(error) {
  const m = (error && error.message) || '';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/already registered/i.test(m))        return 'Ese correo ya tiene cuenta. Entra en vez de registrarte.';
  if (/Email not confirmed/i.test(m))       return 'Confirma el correo antes de entrar.';
  if (/provider is not enabled/i.test(m))   return 'El acceso con Google aún no está configurado en Supabase.';
  if (/rate limit|too many/i.test(m))       return 'Demasiados intentos. Espera un minuto.';
  return m || 'No se ha podido completar.';
}

/* ─────────────────────────────────────────────────────
   RECUPERAR LA CONTRASEÑA

   No existía. Una aplicación con entrada por correo y contraseña y sin
   forma de recuperarla deja fuera para siempre a quien la olvide, que
   es exactamente lo que acaba pasando con una cuenta que se usa a las
   tres de la mañana.
   ──────────────────────────────────────────────────── */

/* Alterna entre el formulario de entrar y el de elegir contraseña nueva */
function modoRecuperacion(activo) {
  pantalla('loginScreen');
  const entrar = document.querySelector('#loginScreen .card');
  const nueva  = document.getElementById('cardNuevaPwd');
  if (entrar) entrar.style.display = activo ? 'none' : '';
  if (nueva)  nueva.style.display  = activo ? '' : 'none';
}

document.getElementById('olvideBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const errEl = document.getElementById('loginErr');
  errEl.style.display = '';

  if (!email) {
    errEl.textContent = t('recup.falta', 'Escribe tu correo arriba y vuelve a pulsar.');
    return;
  }

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  // A proposito NO se distingue entre "existe" y "no existe": decirlo
  // convertiria esta pantalla en una forma de averiguar quien tiene cuenta.
  errEl.textContent = error
    ? traducirAuth(error)
    : t('recup.enviado', 'Si esa dirección tiene cuenta, te llega un correo en un minuto.');
});

document.getElementById('guardarPwdBtn').addEventListener('click', async () => {
  const pwd   = document.getElementById('nuevaPwd').value;
  const errEl = document.getElementById('nuevaPwdErr');
  const btn   = document.getElementById('guardarPwdBtn');

  if (pwd.length < 8) {
    errEl.textContent = t('recup.corta', 'Al menos 8 caracteres.');
    errEl.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = t('recup.guardando', 'Guardando…');

  const { error } = await sb.auth.updateUser({ password: pwd });

  btn.disabled = false;
  btn.textContent = t('recup.guardar', 'Guardar contraseña');

  if (error) {
    errEl.textContent = traducirAuth(error);
    errEl.style.display = '';
    return;
  }

  document.getElementById('nuevaPwd').value = '';
  modoRecuperacion(false);
  toast(t('recup.lista', '✅ Contraseña cambiada'));
  entrar();
});

/* Al volver a la pantalla de entrar hay que deshacer el modo recuperacion:
   si no, quien cierre sesion vuelve y se encuentra el formulario equivocado. */
document.getElementById('logoutBtn').addEventListener('click', async () => {
  modoRecuperacion(false);
  await sb.auth.signOut();      // limpiarEstado() lo hace onAuthStateChange
});

// Envuelto en una funcion a proposito: abrirAjustes() vive en familia.js,
// que se carga DESPUES que este fichero. Pasarla por referencia aqui
// lanzaba "abrirAjustes is not defined" y abortaba el resto de app.js.
document.getElementById('ajustesBtn').addEventListener('click', () => abrirAjustes());

/* ─────────────────────────────────────────────────────────────
   TABS
   ───────────────────────────────────────────────────────────── */
function switchTab(tab) {
  tabActual = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const panel = document.getElementById('tab-' + tab);
  if (panel) panel.classList.add('active');

  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');

  // La ventana de 24 h se mueve sola, así que se recalcula cada vez
  // que se entra en una pestaña que muestra el resumen.
  if (tab === 'registrar' || tab === 'graficas') renderResumen();

  // Las gráficas solo se pueden dibujar con el panel visible
  if (tab === 'graficas') renderCharts();
  window.scrollTo(0, 0);
}

// Si la app se queda abierta horas (pasa de noche), el resumen
// se refresca solo para que no muestre una ventana caducada.
setInterval(() => {
  if (tabActual === 'registrar' || tabActual === 'graficas') renderResumen();
}, 5 * 60 * 1000);

// Al rotar el móvil, Chart.js no reajusta el ancho del canvas por su
// cuenta (se queda con el de antes y los puntos se amontonan a la
// izquierda), así que se redibujan a mano.
let tempResize;
addEventListener('resize', () => {
  clearTimeout(tempResize);
  tempResize = setTimeout(() => {
    if (tabActual === 'graficas') renderCharts();
  }, 250);
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ─────────────────────────────────────────────────────────────
   CARGAR DATOS
   ───────────────────────────────────────────────────────────── */
async function cargarDatos() {
  if (!ninoActivo) { registros = []; return; }

  const { data, error } = await sb
    .from('registros')
    .select('*')
    .eq('nino_id', ninoActivo.id)
    .order('fecha_hora', { ascending: true });

  if (error) {
    console.error('Error al cargar:', error);
    document.getElementById('histBody').innerHTML =
      `<tr><td colspan="4" class="empty-state">
         ❌ No se pudieron cargar los datos.<br>${esc(error.message || '')}
       </td></tr>`;
    return;
  }

  registros = data || [];
  renderResumen();
  renderTabla();
  if (tabActual === 'graficas') renderCharts();
}

/* ─────────────────────────────────────────────────────────────
   TIEMPO REAL — sincronización automática entre móviles
   ───────────────────────────────────────────────────────────── */
function configurarRealtime() {
  if (canalRT) return;          // no re-suscribir si ya hay canal
  if (!ninoActivo) return;
  // El filtro evita que los cambios de otro hijo recarguen esta vista
  canalRT = sb.channel('registros-' + ninoActivo.id)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'registros',
          filter: 'nino_id=eq.' + ninoActivo.id },
        () => cargarDatos())
    .subscribe();
}

/* ─────────────────────────────────────────────────────────────
   RESUMEN DE LAS ÚLTIMAS 24 H

   El mismo panel se pinta en la pestaña Registrar y en la de
   Gráficas: se busca por [data-resumen], así que basta con
   añadir el contenedor donde haga falta.
   ───────────────────────────────────────────────────────────── */
function renderResumen() {
  const conts = document.querySelectorAll('[data-resumen]');
  if (!conts.length) return;

  const desde = Date.now() - VENTANA_MS;

  document.querySelectorAll('[data-resumen-desde]').forEach(el => {
    el.textContent = t('resumen.desde', 'Desde las ') + fechaHora(desde, {
      hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short'
    });
  });

  const recientes = registros.filter(r => enVentana(r.fecha_hora, desde));

  const pipis = recientes.filter(r => r.tipo === 'pipi').length;
  const cacas = recientes.filter(r => r.tipo === 'caca').length;

  const ext   = recientes.filter(r => r.tipo === 'extraccion');
  const ml    = lado => ext.filter(r => r.datos.pecho === lado)
                           .reduce((s, r) => s + (Number(r.datos.ml) || 0), 0);
  const mlIzq = ml('izquierdo');
  const mlDer = ml('derecho');

  // El último peso suele ser de hace más de 24 h, así que aquí no
  // se filtra por ventana: se muestra el más reciente con su fecha.
  const pesos  = registros.filter(r => r.tipo === 'peso');
  const ultimo = pesos.length ? pesos[pesos.length - 1] : null;

  // Cuánto necesita ganar al día para no bajar de percentil.
  // Cambia mucho con la edad (~40 g/día a las 3 semanas, ~12 a los
  // 6 meses), así que se recalcula en cada pesada.
  const necesario = ultimo
    ? gananciaParaMantener(ultimo.fecha_hora, ultimo.datos.gramos)
    : null;

  // Ganancia diaria observada, con tres estados:
  //   ok    → mantiene percentil
  //   justo → pasa el suelo de 20 g/día de la pediatra, pero bajará de percentil
  //   bajo  → por debajo del suelo de la pediatra
  const tend = tendenciaPeso();
  let trend;
  if (!tend) {
    // Distinguir "aún no hay datos" de "las hay, pero demasiado juntas":
    // si no, con dos pesadas seguidas el aviso despista.
    trend = pesos.length >= 2
      ? `<div class="sum-trend nd">g/día: pesadas muy juntas</div>`
      : `<div class="sum-trend nd">g/día: faltan pesadas</div>`;
  } else {
    const g     = Math.round(tend.gPorDia);
    const signo = g > 0 ? '+' : '';

    let clase, porque;
    if (necesario !== null && g >= Math.round(necesario)) {
      clase  = 'ok';
      porque = 'Mantiene su percentil';
    } else if (g >= OBJETIVO_G_DIA) {
      clase  = 'justo';
      porque = 'Pasa los ' + OBJETIVO_G_DIA + ' g/día de la pediatra, '
             + 'pero por debajo de lo que haría falta para no bajar de percentil';
    } else {
      clase  = 'bajo';
      porque = 'Por debajo de los ' + OBJETIVO_G_DIA + ' g/día que marcó la pediatra';
    }

    trend = `<div class="sum-trend ${clase}" title="${porque}. Ajuste sobre ${tend.n} pesadas de los últimos ${tend.dias.toFixed(1)} días">`
          + `${signo}${g} g/día</div>`;
  }

  // Línea de referencia: lo que pide su percentil a día de hoy
  const needTxt = (tend && necesario !== null)
    ? `<div class="sum-need" title="Pendiente de la curva de la OMS en su punto actual. A esta edad sube hasta las 3 semanas y luego baja; sobre los 3 meses y medio se cruza con los ${OBJETIVO_G_DIA} g/día de la pediatra.">`
      + `necesita ${Math.round(necesario)} g/día</div>`
    : '';

  // Percentil OMS de la última pesada (peso para la edad, niños)
  let pctTxt = '';
  if (ultimo) {
    const p = percentilPeso(ultimo.fecha_hora, ultimo.datos.gramos);
    pctTxt = p
      ? `<div class="sum-pct" title="Peso para la edad, niños (OMS). ${Math.floor(p.dias)} días de edad, z = ${p.z.toFixed(2)}">`
        + `${textoPercentil(p.pct)} <span class="sum-pct-lbl">OMS</span></div>`
      : '<div class="sum-pct nd">percentil n/d</div>';
  }

  // Cada casilla depende de su módulo: si la familia no se saca leche,
  // no tiene sentido una casilla de mililitros siempre a cero. Se montan
  // en una lista para que la rejilla se recoloque sola en vez de dejar
  // huecos donde estaba la que falta.
  const casillas = [];

  if (moduloActivo('panales')) {
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${pipis}</div>
      <div class="sum-lbl">💧 Pipís</div>
    </div>`);
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${cacas}</div>
      <div class="sum-lbl">💩 Cacas</div>
    </div>`);
  }

  if (moduloActivo('peso')) {
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${ultimo ? ultimo.datos.gramos + ' g' : '—'}</div>
      ${trend}
      ${needTxt}
      ${pctTxt}
      <div class="sum-lbl">Último peso</div>
      <div class="sum-extra">${ultimo ? esc(fmtFechaHora(ultimo.fecha_hora)) : 'sin datos'}</div>
    </div>`);
  }

  if (moduloActivo('extraccion')) {
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${mlIzq + mlDer} ml</div>
      <div class="sum-lbl">🍼 Leche</div>
      <div class="sum-extra">Izq ${mlIzq} · Der ${mlDer}</div>
    </div>`);
  }

  const html = casillas.length
    ? casillas.join('')
    : '<p class="hint-txt" style="margin:0">Todo está oculto. Se enciende de nuevo en ⚙️ Ajustes.</p>';

  conts.forEach(c => {
    c.innerHTML = html;
    // La rejilla es de 4 columnas fijas: con menos casillas quedaba un
    // hueco a la derecha, así que se le dice cuántas hay de verdad.
    const n = Math.max(casillas.length, 1);
    c.style.setProperty('--sum-cols', n);
    c.style.setProperty('--sum-cols-estrecho', Math.min(n, 2));
  });
}

/* ─────────────────────────────────────────────────────────────
   ARRANCAR

   init() vive aquí pero necesita funciones de graficas.js y del
   resto de ficheros, que se cargan DESPUÉS que este. Por eso no
   se llama directamente: DOMContentLoaded salta cuando ya se han
   ejecutado todos los <script> del final del body.
   ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
