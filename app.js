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
  verde:       { label: 'Verde',            hex: '#4d9c5a' },
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
const params  = new URLSearchParams(location.search);
const modoVer = params.get('modo') === 'ver';   // URL de la matrona
let registros  = [];
let charts     = {};            // { ext, peso, panal }
let filtroHist = 'todo';
let canalRT    = null;
let tabActual  = modoVer ? 'graficas' : 'registrar';

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
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
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
   primeros días el bebé PIERDE peso (Álex bajó de 3050 a 2840),
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

function htmlColores(valor = COLOR_CACA_DEF) {
  return Object.entries(COLORES_CACA).map(([clave, c]) => {
    const sel = clave === valor;
    return `<button type="button" class="color-btn${sel ? ' sel' : ''}" `
         + `data-v="${clave}" aria-pressed="${sel}" title="${esc(c.label)}">`
         + `<span class="color-swatch" style="background:${c.hex}"></span>`
         + `<span>${esc(c.label)}</span></button>`;
  }).join('');
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

  // Los chips del historial además filtran
  if (btn.classList.contains('chip')) {
    filtroHist = btn.dataset.f;
    renderTabla();
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
  document.getElementById('themeBtn1').textContent = icono;
  document.getElementById('themeBtn2').textContent = icono;
  if (tabActual === 'graficas' && charts.ext) renderCharts();
}

function toggleTema() { aplicarTema(esDark() ? 'light' : 'dark'); }

document.getElementById('themeBtn1').addEventListener('click', toggleTema);
document.getElementById('themeBtn2').addEventListener('click', toggleTema);
aplicarTema(tema);

/* ─────────────────────────────────────────────────────────────
   INICIALIZACIÓN
   ───────────────────────────────────────────────────────────── */
async function init() {
  // Pintar los selectores generados antes de nada
  document.getElementById('rowCacaQty').innerHTML   = htmlCantidad(1);
  document.getElementById('rowPipiQty').innerHTML   = htmlCantidad(1);
  document.getElementById('rowCacaColor').innerHTML = htmlColores();

  if (modoVer) { mostrarApp(true); return; }

  const { data: { session } } = await sb.auth.getSession();
  if (session) mostrarApp(false);
  else mostrarLogin();
}

function mostrarLogin() {
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('appScreen').style.display   = 'none';
}

function mostrarApp(soloLectura) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display   = '';

  if (soloLectura) {
    document.getElementById('logoutBtn').style.display = 'none';
    // Ocultar la pestaña "Registrar" en modo solo lectura
    document.querySelector('[data-tab="registrar"]').style.display = 'none';
  }

  resetFechas();
  cargarDatos();
  configurarRealtime();
  switchTab(tabActual);
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

  if (error) errEl.style.display = '';
  else       mostrarApp(false);
});

// Pulsar Enter en el campo contraseña hace login
document.getElementById('loginPwd').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  mostrarLogin();
});

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
  const { data, error } = await sb
    .from('registros')
    .select('*')
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
  canalRT = sb.channel('tracking-alex')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'registros' },
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
    el.textContent = 'Desde las ' + new Date(desde).toLocaleString('es-ES', {
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

  // Ganancia diaria frente al mínimo de 20 g/día que marcó la pediatra
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
    const clase = g >= OBJETIVO_G_DIA ? 'ok' : 'bajo';
    const signo = g > 0 ? '+' : '';
    trend = `<div class="sum-trend ${clase}" title="Ajuste sobre ${tend.n} pesadas de los últimos ${tend.dias.toFixed(1)} días">`
          + `${signo}${g} g/día</div>`;
  }

  // Percentil OMS de la última pesada (peso para la edad, niños)
  let pctTxt = '';
  if (ultimo) {
    const p = percentilPeso(ultimo.fecha_hora, ultimo.datos.gramos);
    pctTxt = p
      ? `<div class="sum-pct" title="Peso para la edad, niños (OMS). ${Math.floor(p.dias)} días de edad, z = ${p.z.toFixed(2)}">`
        + `${textoPercentil(p.pct)} <span class="sum-pct-lbl">OMS</span></div>`
      : '<div class="sum-pct nd">percentil n/d</div>';
  }

  const html = `
    <div class="sum-item">
      <div class="sum-val">${pipis}</div>
      <div class="sum-lbl">💧 Pipís</div>
    </div>
    <div class="sum-item">
      <div class="sum-val">${cacas}</div>
      <div class="sum-lbl">💩 Cacas</div>
    </div>
    <div class="sum-item">
      <div class="sum-val">${ultimo ? ultimo.datos.gramos + ' g' : '—'}</div>
      ${trend}
      ${pctTxt}
      <div class="sum-lbl">Último peso</div>
      <div class="sum-extra">${ultimo ? esc(fmtFechaHora(ultimo.fecha_hora)) : 'sin datos'}</div>
    </div>
    <div class="sum-item">
      <div class="sum-val">${mlIzq + mlDer} ml</div>
      <div class="sum-lbl">🍼 Leche</div>
      <div class="sum-extra">Izq ${mlIzq} · Der ${mlDer}</div>
    </div>`;

  conts.forEach(c => { c.innerHTML = html; });
}

/* ─────────────────────────────────────────────────────────────
   ARRANCAR

   init() vive aquí pero necesita funciones de graficas.js y del
   resto de ficheros, que se cargan DESPUÉS que este. Por eso no
   se llama directamente: DOMContentLoaded salta cuando ya se han
   ejecutado todos los <script> del final del body.
   ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
