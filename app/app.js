/* ═════════════════════════════════════════════════════════════
   Configuración, estado compartido, utilidades, tema, sesión,
   pestañas, carga de datos y resumen de 24 h.
   Se carga el primero: el resto de ficheros usa lo que define aquí.
   ═════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   CONFIGURACIÓN
   Solo la publishable key va aquí — la secret key NUNCA
   ───────────────────────────────────────────────────────────── */
/* Donaciones. La aplicación es gratuita y no hay muro de pago: esto es un
   enlace y nada más. Donar NO desbloquea nada ni cambia nada, y así tiene
   que seguir — en el momento en que diera algo a cambio dejaría de ser un
   donativo y pasaría a ser una venta, con todo lo que eso arrastra. */
const KOFI_URL = 'https://ko-fi.com/trackingalex';

const SUPABASE_URL = 'https://yzarrncayxkvkpyflbrk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IliCiFj7DM6UHxL4YxlnNw_57j6pW5z';

/* Se mira la URL ANTES de crear el cliente, y esto no es manía.

   supabase-js detecta solo el token de recuperación que viene en la
   dirección, inicia sesión con él y LIMPIA la URL. Todo eso pasa nada más
   cargar, mucho antes de que init() se suscriba a onAuthStateChange en
   DOMContentLoaded. Resultado: el evento PASSWORD_RECOVERY se dispara
   cuando todavía no hay nadie escuchando, y acto seguido getSession()
   encuentra una sesión válida y te mete en la aplicación.

   Era exactamente eso lo que fallaba: el enlace del correo te dejaba
   dentro sin haber cambiado nada. Mirando la URL aquí, da igual si
   llegamos tarde al evento. */
let recuperandoPwd = /type=recovery/.test(location.hash + location.search);

/* Y el caso contrario: el enlace que ya no vale.

   Cuando el enlace del correo ha caducado o ya se usó, Supabase devuelve
   #error=access_denied&error_code=otp_expired  y ahí NO viene type=recovery.
   Sin leerlo, el usuario aterriza en la pantalla de entrar sin ninguna
   explicación — o, si ya tenía sesión abierta, directamente dentro de la
   aplicación preguntandose qué ha pasado con su contraseña. */
const errorEnlace = (() => {
  const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const code = h.get('error_code') || h.get('error');
  return code || null;
})();

/* Se limpia la dirección para que al recargar no reaparezca el aviso de
   algo que ya se contó. */
if (errorEnlace) {
  history.replaceState(null, '', location.pathname + location.search);
}

const { createClient } = supabase;

/* En el visor de un enlace compartido (/ver/) el cliente se crea distinto,
   y las tres opciones importan:

     detectSessionInUrl  por defecto hurga en location.hash buscando un
                         access_token y REESCRIBE la dirección. Ahí es
                         donde viaja el token del enlace.
     persistSession      no hay sesión que guardar, y guardar algo en el
                         móvil de la abuela sería de mala educación.
     autoRefreshToken    no hay nada que refrescar.

   Y hay un motivo menos obvio: si un padre abre su propio enlace estando
   dentro, sin esto lo recorrería como `authenticated` y el camino real
   —el de anon, que es el que usa todo el mundo— no se probaría nunca. */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY,
  window.MODO_ENLACE
    ? { auth: { persistSession: false, detectSessionInUrl: false,
                autoRefreshToken: false } }
    : undefined);

/* ─────────────────────────────────────────────────────────────
   COLORES DE CACA
   Definidos UNA sola vez y reutilizados en el formulario, el
   modal de edición, la tabla y la gráfica.
   ───────────────────────────────────────────────────────────── */
const COLORES_CACA = {
  mostaza:     { label: 'Amarillo mostaza', hex: '#d4a017' },
  amarillo:    { label: 'Amarillo claro',   hex: '#f2c94c' },
  verde:       { label: 'Verdoso',          hex: '#4d9c5a' },
  marron:      { label: 'Marrón',          hex: '#8a5a34' },
  naranja:     { label: 'Naranja',          hex: '#e07b39' },
  negro:       { label: 'Negro (meconio)',  hex: '#3b3b3b' },
  blanquecino: { label: 'Blanquecino ⚠️',    hex: '#e8e4d9' },
  rojizo:      { label: 'Rojizo / sangre ⚠️', hex: '#b03030' }
};

const COLOR_CACA_DEF = 'mostaza';
const COLOR_PIPI     = '#38bdf8';

/* El label se traduce AQUÍ y no en COLORES_CACA: ese objeto se construye
   al cargar el fichero, antes de que se sepa el idioma, y además hay que
   poder cambiar de idioma sin recargar. El español del objeto es el valor
   por defecto, como en todo el proyecto. */
function infoColor(clave) {
  const c = COLORES_CACA[clave];
  if (!c) return { label: clave || '—', hex: '#8a5a34' };
  return { label: t('color.' + clave, c.label), hex: c.hex };
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
   LA PESTAÑA QUE PIDE LA NOTIFICACIÓN

   El aviso de medicación se manda con url './?tab=medicacion' desde
   la Edge Function, y el service worker abre esa dirección. Pero
   nadie leía el parámetro: la aplicación se abría SIEMPRE en
   Registrar, así que pulsar la notificación parecía no llevar a
   ninguna parte.

   Se lee UNA vez al cargar y se guarda, porque mostrarApp() se
   ejecuta después de ir a buscar la familia y la dirección puede
   haberse limpiado ya para entonces.
   ───────────────────────────────────────────────────────────── */
const TABS_VALIDAS = ['registrar', 'graficas', 'medicacion', 'comida'];

let tabPedida = (() => {
  const p = new URLSearchParams(location.search).get('tab');
  return TABS_VALIDAS.indexOf(p) >= 0 ? p : null;
})();

/* Ir a una pestaña que ha pedido alguien de fuera (la notificación).

   Se comprueba que el botón esté a la vista: aplicarModulos() ya ha
   escondido los de los módulos apagados, así que preguntarle al botón es
   más fiable que repetir aquí qué módulo corresponde a cada pestaña — y
   no hay dos sitios que se puedan contradecir el día que se añada una.
   Mandar a Medicinas a una familia que lo tiene apagado sería dejarla
   mirando una pestaña en blanco. */
function irATab(tab) {
  if (TABS_VALIDAS.indexOf(tab) < 0) return false;
  const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!btn || btn.offsetParent === null) return false;
  tabActual = tab;
  return true;
}

/* El service worker manda esto cuando pulsas la notificación y la
   aplicación YA estaba abierta. Antes recargaba la página entera; así
   sólo cambia de pestaña.

   El mensaje viene del propio service worker de este origen, no de la
   red, pero se comprueba igual que la pestaña sea una de las cuatro:
   irATab() no acepta otra cosa. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', ev => {
    const d = ev.data || {};
    if (d.tipo !== 'ir-a-tab') return;
    // Si todavía no se ha montado la app, se guarda para mostrarApp()
    const pantallaApp = document.getElementById('appScreen');
    if (!pantallaApp || pantallaApp.style.display === 'none') {
      tabPedida = TABS_VALIDAS.indexOf(d.tab) >= 0 ? d.tab : null;
      return;
    }
    if (irATab(d.tab)) switchTab(d.tab);
  });
}

// Si cargarDatos() ha terminado alguna vez. mostrarApp() lo llama SIN
// await, así que hay un instante con registros = [] en el que pintar la
// lista de primeros pasos haría que un paso ya hecho saliera sin tachar
// y se tachara solo dos décimas después.
let registrosCargados = false;

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

/* Engancha un manejador sólo si el nodo existe.

   Los de abajo (login, Google, registro, olvidé la contraseña, salir,
   ajustes) se enganchan al CARGAR el fichero, no dentro de init(). La
   página del visor de enlaces compartidos (/ver/) reutiliza app.js y no
   tiene ninguno de esos nodos: sin esta comprobación, el primero lanzaba
   una excepción a mitad de la carga y dejaba sin definir TODO lo que
   app.js declara más abajo —switchTab(), renderResumen(), cargarDatos()—,
   mientras los <script> siguientes se ejecutaban igual contra un ámbito a
   medio construir. */
function enganchar(id, evento, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evento, fn);
}

/* Abre el modal compartido dejando dicho QUIÉN lo pintó.

   Lo usa cambiarIdioma() para repintarlo traducido sin adivinar. Antes lo
   adivinaba olfateando si el título empezaba por '⚙', y eso ataba el
   idioma del texto a la lógica: traducir ese título rompía el repintado
   en silencio.

   Las pantallas que necesitan argumentos —la ficha de un alimento, editar
   un hijo— llaman sin nombre: se quedan en el idioma en que se abrieron,
   que es mucho mejor que repintar encima una pantalla distinta. Por eso
   el atributo se BORRA cuando no se pasa nombre; si se quedara el
   anterior, abrir una ficha y cambiar de idioma te dejaría Ajustes. */
function abrirModal(repintar) {
  const m = document.getElementById('comidaModal');
  if (!m) return;
  if (repintar) m.dataset.repintar = repintar;
  else delete m.dataset.repintar;
  m.style.display = '';
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


/* ═════════════════════════════════════════════════════════════
   LA TENDENCIA DE PESO

   Antes esto era una recta de mínimos cuadrados sobre los últimos
   siete días. Las dos cosas estaban mal, y se notó en cuanto hubo
   datos de verdad.

   ── LA VENTANA ERA DEMASIADO CORTA ──
   Con cuatro pesadas en seis días y una báscula que varía ±25 g, el
   margen del 95 % sobre la pendiente era de ±8 g/día. El panel decía
   «22 g/día» cuando lo honesto era «entre 13 y 29», y el bebé estaba
   ganando 33. No es que la cifra cambiara: es que nunca tuvo precisión
   para distinguir las dos cosas, y se enseñaba sin margen, como un dato.

   Alargar la ventana lo arregla casi todo: a 14 días el margen baja a
   ±4,5 y a 21 días a ±3.

   ── Y UNA RECTA NO ERA EL MODELO ──
   Un bebé no crece en línea recta. Prolongando la recta ajustada hoy,
   Álex pesaría 6,7 kg a los cuatro meses; la curva de la OMS dice 5,4.
   Y la pendiente que hace falta para no bajar de percentil pasa de 39
   g/día al mes a 12 a los seis meses, así que un único número lineal no
   puede significar lo mismo en los dos sitios.

   ── EL MODELO ──
   «Este bebé crece a lo largo de una curva de la OMS cuyo percentil se
   desliza despacio»:

       z(t) = z0 + k·t      →      peso(t) = pesoDeZ(lmsEn(t), z(t))

   Dos parámetros, los mismos que una recta, pero en el sistema
   correcto. El ajuste se hace SOBRE z y no sobre gramos: así una pesada
   de la semana 1 y otra de la semana 20 pesan lo mismo en el ajuste, que
   en gramos no ocurriría.

   De ese único ajuste salen las tres cosas que se enseñan —lo que gana,
   lo que necesitaría, y hacia dónde va su percentil— en vez de las tres
   piezas sueltas de antes, que se calculaban sobre ventanas distintas y
   podían contradecirse.
   ═════════════════════════════════════════════════════════════ */

/* Los 20 g/día que indicó la pediatra valen para el PRIMER MES y nada
   más. Un bebé de seis meses gana la mitad de eso y está perfectamente:
   mantenerlo como suelo para siempre convertiría un dato normal en una
   alarma permanente. Ya no decide nada —para eso está la curva de la
   OMS, que sabe la edad y el percentil—; se queda como referencia en el
   texto del primer mes. */
const OBJETIVO_G_DIA   = 20;
const DIAS_PRIMER_MES  = 30;

/* Hasta cuándo se enseña la nota de los primeros días. Seis semanas y
   no cuatro: con treinta días justos desaparece el día que el bebé
   cumple un mes, que es exactamente cuando uno mira atrás y se pregunta
   si aquella bajada del principio fue normal. Además explica por qué el
   ajuste de la tendencia empieza donde empieza. */
const DIAS_RECIEN_NACIDO = 42;

const DIAS_VENTANA    = 56;   // cuánto historial entra como mucho en el ajuste
const DIAS_PROYECCION = 7;    // hasta dónde se prolonga la curva
const MIN_PESADAS     = 3;    // por debajo de esto no se da ningún número
const MIN_DIAS_SPAN   = 10;   // ni por debajo de este recorrido

/* El umbral que se mira de verdad para hablar de crecimiento que
   flojea: 0,67 z es el ancho de una banda de percentiles de la cartilla
   (P3-P15-P50-P85-P97), y cruzar una entera de forma sostenida es lo que
   hace que un pediatra mire con atención. Es una referencia conocida y
   no un número que me haya inventado, y por eso es el que dispara el
   aviso. */
const Z_CAIDA_AVISO = 0.67;

/* ── Pesadas que entran en el ajuste ───────────────────────────
   Dos filtros, los dos explícitos:

   1. Fuera la pérdida fisiológica. Los primeros días el bebé PIERDE
      peso —hasta un 10 % es normal— y lo recupera antes del día 14. Eso
      es otro fenómeno, y meterlo en el mismo ajuste que el crecimiento
      posterior deja un residuo de 87 g. Se descarta todo hasta la última
      pesada que esté por debajo del peso de nacimiento.

      Antes esto lo hacía de refilón la ventana de siete días. Ahora es
      una línea que se puede leer y discutir.

   2. Ventana máxima de DIAS_VENTANA días, para que a los seis meses el
      ajuste no siga arrastrando el primer mes, cuando se ganaba el
      triple. */
function pesadasParaAjuste() {
  const pts = registros
    .filter(r => r.tipo === 'peso')
    .map(r => ({ t: +new Date(r.fecha_hora), g: Number(r.datos.gramos) }))
    .filter(p => !isNaN(p.t) && !isNaN(p.g))
    .sort((a, b) => a.t - b.t);

  if (!pts.length) return [];

  // El peso de nacimiento es la primera pesada; si la primera es de días
  // después, no hay bajada que quitar y el índice se queda en -1.
  const nacimiento = pts[0].g;
  let ultimaBaja = -1;
  pts.forEach((p, i) => { if (p.g < nacimiento) ultimaBaja = i; });

  const tFin = pts[pts.length - 1].t;
  return pts.slice(ultimaBaja + 1)
            .filter(p => p.t >= tFin - DIAS_VENTANA * 864e5);
}

function ajustePeso() {
  const usados = pesadasParaAjuste();
  if (usados.length < MIN_PESADAS) return null;

  const d0 = edadEnDias(usados[0].t);
  const d1 = edadEnDias(usados[usados.length - 1].t);
  if (!(d1 - d0 >= MIN_DIAS_SPAN)) return null;

  // A z cada punto. Si la edad se sale de las tablas, fuera.
  const zs = [];
  for (const p of usados) {
    const dias = edadEnDias(p.t);
    const lms  = lmsEn(dias);
    if (lms && p.g > 0) zs.push({ d: dias, z: zDePeso(lms, p.g / 1000) });
  }
  if (zs.length < MIN_PESADAS) return null;

  // Mínimos cuadrados de z contra la edad en días
  const n = zs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of zs) { sx += p.d; sy += p.z; sxy += p.d * p.z; sxx += p.d * p.d; }
  const den = n * sxx - sx * sx;
  if (!den) return null;

  const k  = (n * sxy - sx * sy) / den;      // z por día
  const z0 = (sy - k * sx) / n;

  /* El margen. Es la mitad del arreglo: sin él volvemos a enseñar una
     cifra que no sabe lo imprecisa que es. Con n-2 grados de libertad
     porque el modelo tiene dos parámetros.

     Y con un SUELO, que es lo que evita el peor fallo posible aquí: con
     tres pesadas casi alineadas el residuo tiende a cero, el margen con
     él, y entonces la deriva más insignificante pasa el test y la
     aplicación anuncia que el bebé baja de percentil. Tres puntos se
     alinean por casualidad constantemente.

     El suelo no es un número mágico: sabemos que la báscula varía unos
     25 g y que la ropa se estima con ese mismo orden de error, así que
     el residuo no PUEDE ser menor que eso por mucho que los puntos se
     alineen. Se pasa a unidades z dividiendo por M·S, que es lo que
     mide un z cerca de la mediana — y así el suelo se ajusta solo con
     la edad, porque un bebé de seis meses tiene otra escala. */
  let ss = 0;
  zs.forEach(p => ss += Math.pow(p.z - (z0 + k * p.d), 2));

  const lmsFin   = lmsEn(d1);
  const sigmaMin = lmsFin ? 0.025 / (lmsFin.M * lmsFin.S) : 0.05;
  const sigma    = Math.max(n > 2 ? Math.sqrt(ss / (n - 2)) : Infinity, sigmaMin);
  const seK      = sigma * Math.sqrt(n / den);

  const curva = dias => {
    const lms = lmsEn(dias);
    return lms ? pesoDeZ(lms, z0 + k * dias) * 1000 : null;
  };

  // Lo que gana AHORA: la pendiente de la curva ajustada en la última
  // pesada. Y lo que necesitaría: la misma pendiente con k = 0, o sea,
  // la de la línea de percentil que pasa por ahí.
  const zFin = z0 + k * d1;
  const a = curva(d1 - 0.5), b = curva(d1 + 0.5);
  const gPorDia = (a !== null && b !== null) ? b - a : null;
  if (gPorDia === null) return null;

  // Residuo en gramos, para poder comprobar que el ajuste es sano
  let ssg = 0;
  usados.forEach(p => {
    const e = curva(edadEnDias(p.t));
    if (e !== null) ssg += Math.pow(p.g - e, 2);
  });

  return {
    z0, k, seK, n,
    d0, d1,                                   // edad en días, para el modelo
    t0: usados[0].t, t1: usados[usados.length - 1].t,   // instantes, para la gráfica
    dias:  d1 - d0,
    curva,
    gPorDia,
    necesario: pendienteEn(d1, zFin),
    zFin,
    pctFin: normalCDF(zFin) * 100,
    pctIni: normalCDF(z0 + k * d0) * 100,
    residuo: Math.sqrt(ssg / usados.length),
    // ¿Es la deriva distinguible del ruido? Si no lo es, no se cuenta.
    derivaReal: isFinite(seK) && Math.abs(k) > 1.96 * seK,
    ultimo: usados[usados.length - 1]
  };
}

/* ── Los primeros días ─────────────────────────────────────────
   La bajada fisiológica y cuándo recuperó el peso de nacimiento. Son
   los dos datos que de verdad preocupan la primera semana, y hasta
   ahora la aplicación no decía ninguno. Sale casi gratis: para excluir
   esos días del ajuste hay que encontrarlos igualmente. */
function perdidaInicial() {
  const pts = registros
    .filter(r => r.tipo === 'peso')
    .map(r => ({ t: +new Date(r.fecha_hora), g: Number(r.datos.gramos) }))
    .filter(p => !isNaN(p.t) && !isNaN(p.g))
    .sort((a, b) => a.t - b.t);

  if (pts.length < 2) return null;

  // Sólo vale si la primera pesada es del día de nacimiento o el siguiente:
  // si la familia empezó a apuntar en la semana 3, el "peso de nacimiento"
  // sería inventado y el porcentaje, mentira.
  const d0 = edadEnDias(pts[0].t);
  if (!(d0 >= 0 && d0 < 2)) return null;

  const nacimiento = pts[0].g;
  let minimo = pts[0], recupero = null;

  for (const p of pts) {
    if (p.g < minimo.g) minimo = p;
    if (recupero === null && p !== pts[0] && p.g >= nacimiento) recupero = p;
  }

  if (minimo === pts[0]) return null;      // no llegó a bajar

  return {
    nacimiento,
    minimo:   minimo.g,
    perdidos: nacimiento - minimo.g,
    pct:      (nacimiento - minimo.g) / nacimiento * 100,
    diaMin:   edadEnDias(minimo.t),
    diaRecup: recupero ? edadEnDias(recupero.t) : null
  };
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
    const etiq = infoColor(clave).label;    // traducida
    const ojo  = /⚠/.test(etiq);            // los dos de aviso llevan ⚠️
    return `<button type="button" class="color-btn${sel ? ' sel' : ''}" `
         + `data-v="${clave}" aria-pressed="${sel}" aria-label="${esc(etiq)}" `
         + `title="${esc(etiq)}" style="--muestra:${c.hex}">`
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
  /* La ropa va primero y sale por su cuenta: es el único selector de
     selección MÚLTIPLE de la aplicación —se lleva un body y un pantalón
     y un pañal a la vez— y lo de abajo vacía la fila entera antes de
     marcar. Si cayera ahí, marcar el pantalón desmarcaría el body. */
  const prenda = e.target.closest('.ropa-opt');
  if (prenda) {
    const puesta = prenda.classList.toggle('sel');
    prenda.setAttribute('aria-pressed', String(puesta));
    if (typeof refrescarEcoPeso === 'function' && prenda.closest('#rowPesoRopa')) refrescarEcoPeso();
    if (typeof refrescarEcoEdit === 'function' && prenda.closest('#rowEditRopa')) refrescarEcoEdit();
    return;
  }

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

enganchar('themeBtn1', 'click', toggleTema);
enganchar('themeBtn2', 'click', toggleTema);
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
    // Se deja por si llega a tiempo, pero ya no dependemos de él
    if (evento === 'PASSWORD_RECOVERY') { recuperandoPwd = true; modoRecuperacion(true); return; }

    if (evento === 'SIGNED_IN') {
      if (recuperandoPwd) modoRecuperacion(true);
      else entrar();
    }
  });

  engancharAlta();

  // Cerrar el modal tocando fuera. Va aquí y no en iniciarComida() porque
  // ese mismo modal lo reutiliza Ajustes, que existe aunque la pestaña de
  // comida esté apagada.
  document.getElementById('comidaModal').addEventListener('click', e => {
    if (e.target.id === 'comidaModal') cerrarComidaModal();
  });

  const { data: { session } } = await sb.auth.getSession();

  // Venir del enlace de recuperación deja sesión iniciada. Entrar aquí sin
  // más sería saltarse el único paso que el usuario había pedido dar.
  if (session && recuperandoPwd) modoRecuperacion(true);
  else if (session) await entrar();
  else mostrarLogin();

  // Después de elegir pantalla: si veníamos de un enlace roto, explicarlo
  if (errorEnlace) avisarEnlaceRoto(session);
}

/* Con sesión iniciada: o tienes familia y entras, o hay que crearla */
async function entrar() {
  await cargarFamilia();
  if (!hayFamilia() || !hayHijo()) { mostrarAlta(); return; }
  await cargarModulos();     // qué se enseña y qué no, antes de pintar nada
  mostrarApp();
}

function pantalla(cual) {
  ['loginScreen', 'altaScreen', 'bienvenidaScreen', 'appScreen'].forEach(id => {
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
  if (moduloActivo('medicacion')) iniciarMedicacion();   // idem (medicacion.js)

  // El service worker va aqui y no dentro del modulo de medicinas: es lo
  // que hace la aplicacion instalable en la pantalla de inicio, y eso no
  // puede depender de que una familia use las medicinas o no.
  if (typeof registrarSW === 'function') registrarSW();

  /* Si se ha llegado pulsando la notificación, ahí es donde hay que
     aterrizar. Se comprueba que el módulo esté encendido: mandar a
     Medicinas a una familia que lo tiene apagado sería dejarla en una
     pestaña en blanco.

     Se consume y se olvida —y se limpia la dirección—, para que
     recargar más tarde no te siga llevando a Medicinas. */
  if (tabPedida) {
    const tab = tabPedida;
    tabPedida = null;
    history.replaceState(null, '', location.pathname + location.hash);

    // aplicarModulos() ya ha escondido las pestañas apagadas, así que
    // preguntarle al botón es más fiable que repetir aquí qué módulo
    // corresponde a cada pestaña — y no hay dos sitios que se puedan
    // contradecir el día que se añada una.
    irATab(tab);
  }

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
    : t('plan.terminada', 'La prueba ha terminado. Puedes consultar y exportar todo, '
      + 'pero no añadir registros nuevos.');
}

/* ─────────────────────────────────────────────────────
   EL MOMENTO QUE SE VA A GUARDAR

   Estos campos se rellenaban una sola vez, al entrar. Si la pestaña
   llevaba horas abierta —que es lo normal con el móvil en la mesilla—
   el pañal de las tres de la mañana se apuntaba a la hora de la cena,
   sin que nada lo dijera.

   Dos arreglos, y hacen falta los dos:

     1. Se enseña el momento sin tener que abrir nada.
     2. Se pone al día solo, mientras nadie lo haya tocado a mano. Si lo
        tocas, manda lo tuyo: para eso está el campo.
   ──────────────────────────────────────────────────── */
const CAMPOS_FECHA = ['extFecha', 'pesoFecha', 'cacaFecha', 'pipiFecha'];

/* ─────────────────────────────────────────────────────
   POCOS PIPÍS

   Los pañales mojados son el termómetro casero de si un bebé está
   tomando bastante. La regla de siempre: uno por día de vida durante
   los primeros días —uno el primer día, dos el segundo— y de cinco
   para arriba a partir del quinto.

   Tres cosas que este aviso NO hace, y las tres a propósito:

     · No se enciende si no has apuntado NADA en 24 h. Cero pipís
       apuntados casi siempre significa que no has abierto la aplicación,
       no que el bebé no haya hecho. Avisar ahí sería gritarle a todo el
       que se salta un día, y a la tercera vez nadie lee el aviso.
     · No sale en rojo. No es una urgencia: es un «mira esto».
     · No diagnostica. Dice el número, dice el esperado y manda al
       pediatra, que es quien decide.
   ──────────────────────────────────────────────────── */
const PIPIS_META   = 5;        // a partir del quinto día
const EDAD_MAX_AVISO_PIPIS = 365;   // pasado el año la regla ya no aplica

/* Qué día de vida es hoy, contado como lo cuenta un pediatra: el día del
   parto es el día 1.

   Se calcula con fechas de calendario a medianoche y NO con edadEnDias(),
   que ancla el nacimiento a las 12:00 para que el huso horario no mueva
   los percentiles. Media jornada no importa en una curva de peso, pero
   aquí sí: con ese anclaje, un bebé nacido hoy tenía edad negativa hasta
   mediodía y el aviso se apagaba solo durante toda la mañana —justo las
   horas en que mirarías si ha mojado el pañal—.

   Math.round() y no floor(): entre las dos medianoches puede haber 23 o
   25 horas el domingo del cambio de hora, y un día de vida no se pierde
   porque el reloj se mueva. */
function diaDeVida() {
  if (!ninoActivo || !ninoActivo.fecha_nacimiento) return null;
  const nac = new Date(ninoActivo.fecha_nacimiento + 'T00:00:00');
  if (isNaN(+nac)) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((hoy - nac) / 864e5) + 1;
}

function pipisEsperados(dia) {
  return Math.min(Math.max(dia, 1), PIPIS_META);
}

function avisarPocosPipis(pipis, hayDatos) {
  const el = document.getElementById('avisoPipi');
  if (!el) return;
  el.style.display = 'none';

  if (!moduloActivo('panales') || !ninoActivo) return;
  if (!hayDatos) return;                    // no estás apuntando, no opino

  const dia = diaDeVida();
  if (dia === null || dia < 1) return;         // todavía no ha nacido
  if (dia > EDAD_MAX_AVISO_PIPIS) return;

  const meta = pipisEsperados(dia);
  if (pipis >= meta) return;

  el.className = 'aviso aviso-ojo';
  el.style.display = '';
  el.innerHTML = `⚠️ <strong>${t2('pipi.pocos', 'Pocos pipís: {n} en 24 h.',
      { n: pipis })}</strong>
    ${t2('pipi.esperados', 'A sus días se esperan al menos {m}.', { m: meta })}
    ${t('pipi.quehacer', 'Si no se te ha olvidado apuntar alguno, coméntalo con el pediatra.')}
    <div class="aviso-fuente">${t('pipi.fuente',
      'Regla de los pañales mojados: uno por día de vida hasta el quinto, y cinco o más a partir de ahí.')}</div>`;
}

// Todos los formularios arrancan en "ahora"
function resetFechas() {
  CAMPOS_FECHA.forEach(reiniciarFecha);
}

/* Devuelve un campo a "ahora" y lo marca como no tocado */
function reiniciarFecha(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = ahoraLocal();
  delete el.dataset.tocada;
  pintarFechas();
}

/* Pone al día los que nadie haya tocado. Se llama al volver a la
   pestaña, al cambiar de formulario y cada cinco minutos. */
function refrescarFechas() {
  CAMPOS_FECHA.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.tocada) el.value = ahoraLocal();
  });
  pintarFechas();
}

/* "Hoy, 14:32" — más legible de un vistazo que 01/10/2026 14:32, que es
   lo que pinta el propio input y hay que pararse a leer. */
function etiquetaMomento(d) {
  const hora = d.toLocaleTimeString(localeActivo(), { hour: '2-digit', minute: '2-digit' });
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();
  const hoy = new Date();
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);

  if (mismoDia(d, hoy))  return t('fecha.hoy',  'Hoy')  + ', ' + hora;
  if (mismoDia(d, ayer)) return t('fecha.ayer', 'Ayer') + ', ' + hora;
  return fechaCorta(d.toISOString(), { day: 'numeric', month: 'short' }) + ', ' + hora;
}

function pintarFechas() {
  CAMPOS_FECHA.forEach(id => {
    const el  = document.getElementById(id);
    const eco = document.getElementById(id + 'Eco');
    if (!el || !eco) return;

    const d = new Date(el.value);
    if (isNaN(+d)) { eco.textContent = '—'; eco.classList.remove('viejo'); return; }

    eco.textContent = etiquetaMomento(d);
    // Dos minutos de margen: el reloj avanza mientras rellenas el formulario
    eco.classList.toggle('viejo', Math.abs(Date.now() - d) > 2 * 60 * 1000);
  });
}

/* Tocar el campo manda sobre la puesta al día automática */
CAMPOS_FECHA.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => { el.dataset.tocada = '1'; pintarFechas(); });
});

// Al volver a la app desde otra aplicación, que no se guarde la hora
// en que se dejó aparcada
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refrescarFechas();
});

/* ─────────────────────────────────────────────────────────────
   AUTH — LOGIN / LOGOUT
   ───────────────────────────────────────────────────────────── */
enganchar('loginBtn', 'click', async () => {
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
enganchar('loginPwd', 'keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

/* ── Google ── */
enganchar('googleBtn', 'click', async () => {
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
enganchar('registroBtn', 'click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  const errEl = document.getElementById('loginErr');

  if (!email || pwd.length < 8) {
    errEl.textContent = t('auth.corto', 'Pon un correo y una contraseña de al menos 8 caracteres.');
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
    : t('auth.creada', 'Cuenta creada. Mira el correo para confirmarla y luego entra.');
});

function traducirAuth(error) {
  const m = (error && error.message) || '';
  if (/Invalid login credentials/i.test(m)) return t('auth.malas', 'Correo o contraseña incorrectos.');
  if (/already registered/i.test(m))        return t('auth.yaExiste', 'Ese correo ya tiene cuenta. Entra en vez de registrarte.');
  if (/Email not confirmed/i.test(m))       return t('auth.sinConfirmar', 'Confirma el correo antes de entrar.');
  if (/provider is not enabled/i.test(m))   return t('auth.sinGoogle', 'El acceso con Google aún no está configurado en Supabase.');
  if (/rate limit|too many/i.test(m))       return t('auth.muchos', 'Demasiados intentos. Espera un minuto.');
  return m || t('auth.generico', 'No se ha podido completar.');
}

/* ─────────────────────────────────────────────────────
   RECUPERAR LA CONTRASEÑA

   No existía. Una aplicación con entrada por correo y contraseña y sin
   forma de recuperarla deja fuera para siempre a quien la olvide, que
   es exactamente lo que acaba pasando con una cuenta que se usa a las
   tres de la mañana.
   ──────────────────────────────────────────────────── */

/* Explica por qué el enlace del correo no ha hecho nada.

   Si ya había sesión no se le echa de la aplicación: ya está dentro y
   sacarlo sería más molesto que útil. Basta con contárselo. */
function avisarEnlaceRoto(hayCesion) {
  const caducado = /expired/i.test(errorEnlace);
  const texto = caducado
    ? t('enlace.caducado', 'Ese enlace ya no vale: había caducado o ya se había usado. Pide uno nuevo.')
    : t('enlace.invalido', 'Ese enlace no es válido. Pide uno nuevo.');

  if (hayCesion) { toast(texto, 6000); return; }

  const el = document.getElementById('avisoEnlace');
  if (!el) return;
  el.textContent = texto;
  el.style.display = '';
}

/* Alterna entre el formulario de entrar y el de elegir contraseña nueva */
function modoRecuperacion(activo) {
  pantalla('loginScreen');
  const entrar = document.querySelector('#loginScreen .card');
  const nueva  = document.getElementById('cardNuevaPwd');
  if (entrar) entrar.style.display = activo ? 'none' : '';
  if (nueva)  nueva.style.display  = activo ? '' : 'none';
}

enganchar('olvideBtn', 'click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const errEl = document.getElementById('loginErr');
  errEl.style.display = '';

  if (!email) {
    errEl.textContent = t('recup.falta', 'Escribe tu correo arriba y vuelve a pulsar.');
    return;
  }

  const aviso = document.getElementById('avisoEnlace');
  if (aviso) aviso.style.display = 'none';   // ya no viene a cuento

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  // A proposito NO se distingue entre "existe" y "no existe": decirlo
  // convertiria esta pantalla en una forma de averiguar quien tiene cuenta.
  errEl.textContent = error
    ? traducirAuth(error)
    : t('recup.enviado', 'Si esa dirección tiene cuenta, te llega un correo en un minuto.');
});

enganchar('guardarPwdBtn', 'click', async () => {
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
  recuperandoPwd = false;
  modoRecuperacion(false);
  toast(t('recup.lista', '✅ Contraseña cambiada'));
  entrar();
});

/* Al volver a la pantalla de entrar hay que deshacer el modo recuperacion:
   si no, quien cierre sesion vuelve y se encuentra el formulario equivocado. */
enganchar('logoutBtn', 'click', async () => {
  modoRecuperacion(false);
  await sb.auth.signOut();      // limpiarEstado() lo hace onAuthStateChange

  // Y a la puerta, no al cerrojo. Quien sale no suele querer volver a
  // entrar ahora mismo: dejarle mirando el formulario de entrar es
  // devolverle a donde acaba de irse. Con el .html puesto para que siga
  // funcionando abriendo el fichero a mano, sin servidor.
  window.location.href = '../index.html';
});

// Envuelto en una funcion a proposito: abrirAjustes() vive en familia.js,
// que se carga DESPUES que este fichero. Pasarla por referencia aqui
// lanzaba "abrirAjustes is not defined" y abortaba el resto de app.js.
enganchar('ajustesBtn', 'click', () => abrirAjustes());

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
  if (tab === 'registrar') refrescarFechas();

  // Las gráficas solo se pueden dibujar con el panel visible
  if (tab === 'graficas') renderCharts();
  window.scrollTo(0, 0);
}

// Si la app se queda abierta horas (pasa de noche), el resumen
// se refresca solo para que no muestre una ventana caducada.
setInterval(() => {
  if (tabActual === 'registrar' || tabActual === 'graficas') renderResumen();
  if (tabActual === 'registrar') refrescarFechas();
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
  registrosCargados = true;
  // La talla por defecto sale del último peso que la lleve, así que el
  // bloque de ropa no se puede pintar hasta aquí
  if (typeof pintarRopaPeso === 'function') pintarRopaPeso();
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

   Se busca por [data-resumen] y se pinta en TODOS los que
   encuentre, así que para ponerlo en un sitio nuevo basta con
   añadir el contenedor. Hoy hay dos, y no están en el mismo
   documento:

     · app/index.html, en la pestaña de Gráficas
     · ver/index.html, la página de los enlaces compartidos

   (Durante un tiempo hubo también uno en la pestaña Registrar.
   Se quitó, y este comentario siguió diciendo que estaba.)

   Dos avisos para quien añada el tercero:

     · Las casillas de alimentación NO son de las últimas 24 h,
       son un acumulado. Lo dice cada una en su pie.
     · Esto corre también sin sesión, en el visor. Todo lo que
       se llame desde aquí tiene que tolerar que comida.js,
       bienvenida.js y familia.js no existan — de ahí los
       typeof de más abajo, que no son paranoia.
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

  /* Ganancia diaria observada. Tres estados, y el tercero sólo existe
     durante el primer mes:

       ok    → mantiene su percentil
       justo → por debajo de eso, o sea que irá bajando de percentil
       bajo  → además, primer mes y por debajo de 20 g/día

     Pasado el primer mes no hay «bajo»: no existe un suelo universal de
     gramos al día, y pintar de rojo a un bebé de cinco meses que gana 15
     g/día sería asustar sin motivo. */
  const tend = ajustePeso();
  const dia  = diaDeVida();
  const primerMes = dia !== null && dia <= DIAS_PRIMER_MES;
  let trend;
  if (!tend) {
    /* Sin ajuste NO se enseña ningún número, y eso es deliberado. Antes,
       con dos pesadas de días seguidos, salía una cifra con ±8 g/día de
       margen presentada como un dato. Un número así es peor que no tener
       número: nadie desconfía de lo que ya parece una respuesta. */
    trend = pesos.length >= 2
      ? `<div class="sum-trend nd">${esc(t('sum.juntas', 'g/día: pesadas muy juntas'))}</div>`
      : `<div class="sum-trend nd">${esc(t('sum.faltan', 'g/día: faltan pesadas'))}</div>`;
  } else {
    const g     = Math.round(tend.gPorDia);
    const signo = g > 0 ? '+' : '';

    let clase, porque;
    if (tend.necesario !== null && g >= Math.round(tend.necesario)) {
      clase  = 'ok';
      porque = t('sum.mantiene', 'Mantiene su percentil');
    } else if (primerMes && g < OBJETIVO_G_DIA) {
      clase  = 'bajo';
      porque = t2('sum.primerMes',
        'En el primer mes se suelen esperar al menos {o} g/día',
        { o: OBJETIVO_G_DIA });
    } else {
      clase  = 'justo';
      porque = t('sum.pordebajo',
        'Por debajo de lo que haría falta para seguir por el mismo percentil. '
        + 'Bajar de percentil no es, por sí solo, un problema');
    }

    const ajuste = t2('sum.ajuste',
      'Curva de la OMS ajustada a {n} pesadas de {d} días. Residuo: {r} g',
      { n: tend.n, d: numero(tend.dias, 0), r: numero(tend.residuo, 0) });
    trend = `<div class="sum-trend ${clase}" title="${esc(porque)}. ${esc(ajuste)}">`
          + `${signo}${g} ${esc(t('u.gdia', 'g/día'))}</div>`;
  }

  // Percentil OMS de la última pesada (peso para la edad)
  const pct = ultimo ? percentilPeso(ultimo.fecha_hora, ultimo.datos.gramos) : null;

  /* Hacia dónde va el percentil.

     Es la pregunta que de verdad importa y que la aplicación no
     contestaba: un bebé sano se queda más o menos en su línea, y lo que
     un pediatra mira no es la velocidad en gramos —que depende de la
     edad y es ruidosa— sino si está cruzando líneas.

     SÓLO se dice si la deriva es distinguible del ruido (derivaReal).
     Si no lo es, no se dice nada. Inventar una tendencia a partir de
     tres pesadas es exactamente cómo se fabrica una preocupación a las
     tres de la mañana. */
  let derivaTxt = '';
  if (tend && tend.derivaReal) {
    const zSem = tend.k * 7;
    const sube = zSem > 0;
    // 0,67 z es el ancho de una banda de la cartilla; a este ritmo,
    // cuántas semanas tardaría en cruzarla entera.
    const semanas = Math.abs(Z_CAIDA_AVISO / zSem);
    derivaTxt = `<div class="sum-pct ${sube ? '' : 'nd'}" title="${esc(t2('sum.derivaTit',
        'Ajustado sobre {n} pesadas: {z} z por semana. A este ritmo tardaría unas '
        + '{s} semanas en cruzar una banda entera de percentiles, que es lo que se '
        + 'suele mirar. Moverse de percentil no es, por sí solo, un problema.',
        { n: tend.n, z: numero(zSem, 2), s: numero(semanas, 0) }))}">`
      + `${esc(sube ? t('sum.subiendo', '↗ subiendo de percentil')
                    : t('sum.bajando',  '↘ bajando de percentil'))}</div>`;
  }

  let pctTxt = '';
  if (ultimo) {
    pctTxt = pct
      ? `<div class="sum-pct" title="${esc(t2('sum.pctTit',
            'Peso para la edad (OMS). {d} días de edad, z = {z}',
            { d: Math.floor(pct.dias), z: numero(pct.z, 2) }))}">`
        + `${textoPercentil(pct.pct)} <span class="sum-pct-lbl">${esc(t('sum.oms', 'OMS'))}</span></div>`
      : `<div class="sum-pct nd">${esc(t('sum.pctNd', 'percentil n/d'))}</div>`;
  }

  /* Línea de referencia.

     Antes decía «necesita 32 g/día», que suena a que algo malo pasa si no
     llega. No es eso: es la pendiente que hace falta para seguir por el
     MISMO percentil, y bajar de percentil no es enfermar. Ahora se dice
     lo que de verdad significa, con el percentil delante. */
  const needTit = t('sum.needTit',
    'Pendiente de la curva de la OMS en su punto actual: lo que tendría que '
    + 'ganar para seguir por la misma línea. Cambia con la edad —sube hasta las '
    + '3 semanas y luego baja— y bajar de percentil no es, por sí solo, un problema.');

  /* Sin la guarda `tend &&` que tenía antes: esta línea sólo necesita
     `necesario`, que sale de la última pesada y no del ajuste. Con la
     guarda desaparecía justo cuando faltaban pesadas, que es cuando más
     falta hace saber a qué ritmo debería ir. */
  const needTxt = (necesario !== null)
    ? `<div class="sum-need" title="${esc(needTit)}">`
      + `${esc(pct
          ? t2('sum.need',   '{g} g/día para mantener {p}',
               { g: Math.round(necesario), p: textoPercentil(pct.pct) })
          : t2('sum.needSin', '{g} g/día para mantener su percentil',
               { g: Math.round(necesario) }))}</div>`
    : '';

  // Cada casilla depende de su módulo: si la familia no se saca leche,
  // no tiene sentido una casilla de mililitros siempre a cero. Se montan
  // en una lista para que la rejilla se recoloque sola en vez de dejar
  // huecos donde estaba la que falta.
  const casillas = [];

  if (moduloActivo('panales')) {
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${pipis}</div>
      <div class="sum-lbl">💧 ${esc(t('sum.pipis', 'Pipís'))}</div>
    </div>`);
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${cacas}</div>
      <div class="sum-lbl">💩 ${esc(t('sum.cacas', 'Cacas'))}</div>
    </div>`);
  }

  if (moduloActivo('peso')) {
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${ultimo ? ultimo.datos.gramos + ' g' : '—'}</div>
      ${trend}
      ${needTxt}
      ${pctTxt}
      ${derivaTxt}
      <div class="sum-lbl">${esc(t('sum.ultimoPeso', 'Último peso'))}</div>
      <div class="sum-extra">${ultimo ? esc(fmtFechaHora(ultimo.fecha_hora))
                                      : esc(t('sum.sinDatos', 'sin datos'))}</div>
    </div>`);
  }

  if (moduloActivo('extraccion')) {
    casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${mlIzq + mlDer} ml</div>
      <div class="sum-lbl">🍼 ${esc(t('sum.leche', 'Leche'))}</div>
      <div class="sum-extra">${esc(t('sum.izq', 'Izq'))} ${mlIzq} · ${esc(t('sum.der', 'Der'))} ${mlDer}</div>
    </div>`);
  }

  /* Alimentación complementaria.

     Las cuentas las hace comida.js, que es donde viven el catálogo y los
     registros; aquí sólo se pinta. Con typeof porque este mismo
     renderResumen() corre en la página de los enlaces compartidos
     (/ver/), donde comida.js no se carga a propósito.

     A diferencia del resto de casillas, ésta NO es de las últimas 24 h:
     es un acumulado. Por eso lleva su propio pie —«en total»— en vez de
     dejar que se lea bajo el título de arriba, que dice 24 h. */
  if (moduloActivo('comida') && typeof resumenComida === 'function') {
    const c = resumenComida();
    if (c) {
      casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${c.probados}</div>
      <div class="sum-lbl">🥑 ${esc(t('sum.alimentos', 'Alimentos'))}</div>
      <div class="sum-extra">${esc(t2('sum.deTotal', 'de {n} · en total', { n: c.total }))}</div>
    </div>`);

      // Una reacción es lo más importante que puede haber aquí, así que
      // se dice en la casilla y no escondido dentro de la pestaña.
      casillas.push(`
    <div class="sum-item">
      <div class="sum-val">${c.alergIntro}/${c.alergTotal}</div>
      <div class="sum-lbl">⚠️ ${esc(t('sum.alergenos', 'Alérgenos'))}</div>
      ${c.conReaccion
        ? `<div class="sum-trend bajo">${esc(t2('sum.conReaccion', '{n} con reacción', { n: c.conReaccion }))}</div>`
        : `<div class="sum-extra">${esc(t('sum.sinReaccion', 'sin reacciones'))}</div>`}
    </div>`);
    }
  }

  // El recuento ya está hecho aquí arriba, así que el aviso se decide
  // en el mismo sitio y con los mismos números que la casilla.
  avisarPocosPipis(pipis, recientes.length > 0);

  const html = casillas.length
    ? casillas.join('')
    : `<p class="hint-txt" style="margin:0">${esc(t('sum.todoOculto',
        'Todo está oculto. Se enciende de nuevo en ⚙️ Ajustes.'))}</p>`;

  // La lista de primeros pasos se cuelga de aquí: son ocho los sitios
  // que llaman a renderResumen() —cargar datos, cambiar de pestaña, el
  // temporizador de cinco minutos, cambiar de idioma, encender un
  // módulo…— y engancharse a mano a los ocho es olvidarse de uno.
  if (typeof renderPrimerosPasos === 'function') renderPrimerosPasos();

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
document.addEventListener('DOMContentLoaded', () => {
  /* El visor de un enlace compartido (/ver/) arranca por su cuenta, en
     ver.js. init() no vale allí: da por hechos nodos que no existen
     (#rowCacaQty, #rowPipiQty, #rowCacaColor, #comidaModal) y se
     suscribe a los cambios de sesión, que en una página sin cuenta no
     van a llegar nunca. */
  if (window.MODO_ENLACE) return;
  init();
});
