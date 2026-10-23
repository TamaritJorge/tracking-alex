/* ═════════════════════════════════════════════════════════════
   CARGA UJI — estado en vivo, mapa y estadísticas

   Herramienta aparte que vive en el mismo dominio que Tracking Álex y
   no comparte nada con ella: ni ficheros, ni tablas, ni service worker.

   ── DE DÓNDE SALEN LOS DATOS ──
   La UJI publica el estado en un endpoint sin autenticar y CON CORS
   abierto, así que el navegador lo llama directamente. Eso tiene una
   consecuencia que importa: el mapa funciona aunque Supabase esté
   caído, que es exactamente cuando estás en el aparcamiento preguntándote
   si bajas o das la vuelta.

   Supabase sólo hace falta para dos cosas que no puede hacer el móvil:
   guardar el historial (que exige sondear con la página cerrada) y mandar
   los avisos.
   ═════════════════════════════════════════════════════════════ */

const UJI_ESTADO =
  'https://e-ujier.uji.es/pls/www/!gri_www.euji24130?p_accion=GET_POINTS';

/* Cada 20 segundos con la página abierta. La oficial refresca cada 5;
   para decidir si bajas al coche, 20 sobra y es cuatro veces más liviano
   sobre un servidor que no es nuestro. */
const REFRESCO_MS = 20000;

const SUPABASE_URL = 'https://yzarrncayxkvkpyflbrk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IliCiFj7DM6UHxL4YxlnNw_57j6pW5z';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── LOS POSTES ───────────────────────────────────────────────
   Van aquí y no se piden a la base de datos, por lo mismo de arriba: el
   mapa tiene que poder dibujarse sin red propia. Son las coordenadas que
   devuelve la UJI, con todos sus decimales, y las mismas que siembra
   sql/carga.sql — si se cambian, se cambian en los dos sitios.

   Las letras vienen del mapa con el que se identificaron las zonas y NO
   se reordenan: las preferencias de aviso que la gente ya tenga guardadas
   apuntan a estas letras. */
const POSTES = [
  { id:'A1', zona:'A', lat:39.994111607, lon:-0.075141415 },
  { id:'A2', zona:'A', lat:39.994137293, lon:-0.075202435 },
  { id:'A3', zona:'A', lat:39.994165034, lon:-0.075264126 },
  { id:'B1', zona:'B', lat:39.993303902, lon:-0.071942729 },
  { id:'B2', zona:'B', lat:39.993330927, lon:-0.072004440 },
  { id:'C1', zona:'C', lat:39.992384104, lon:-0.069788769 },
  { id:'C2', zona:'C', lat:39.992410318, lon:-0.069850304 },
  { id:'C3', zona:'C', lat:39.992436259, lon:-0.069912231 },
  { id:'D1', zona:'D', lat:39.995979955, lon:-0.070493498 },
  { id:'D2', zona:'D', lat:39.996006728, lon:-0.070554624 },
  { id:'E1', zona:'E', lat:39.996069881, lon:-0.066323989 },
  { id:'E2', zona:'E', lat:39.996104659, lon:-0.066386897 },
  { id:'F1', zona:'F', lat:39.992192333, lon:-0.067264773 }
];

/* Cada poste tiene 2 conectores: la página de la UJI habla de 26 puntos
   para coches y aquí hay 13 postes.

   PERO SE CUENTA EN POSTES, no en puntos. El endpoint da un `disponible`
   por poste, y no sabemos si un poste «libre» tiene sus dos conectores
   libres o sólo uno. Multiplicar por dos sería inventarse la mitad de la
   cifra. «2 de 3 postes» es lo que el dato sostiene; el detalle de la
   zona explica que cada poste da para dos coches. */
const CONECTORES_POR_POSTE = 2;

/* Nombres de las zonas.

   Identificadas con el GIS público de la UJI, no a ojo. Se cruzaron las
   siluetas de los edificios (capa Espacios_simbologia, planta baja) con
   la posición de cada zona y con el recuento de puntos que publica la
   página de movilidad:

     C  cae dentro de MID = Facultat de Ciències de la Salut   3 postes = 6 pts ✓
     F  cae dentro de TD, y la página dice «ESTCE, parte
        trasera del edificio TD»                              1 poste  = 2 pts ✓
     D  cae dentro del edificio H (Humanes)                   2 postes = 4 pts ✓
     B  pegada a NB, y NA es «Investigación I»                 2 postes = 4 pts ✓
     A  el único que queda con 6 puntos: CIETD
     E  por eliminación: Consell Social i Escola de Doctorat

   Las cuatro primeras tienen prueba doble (posición y recuento); las dos
   últimas salen por descarte. Si alguna no cuadra sobre el terreno, se
   corrige aquí y en carga_zonas.nombre. */
const NOMBRES = {
  A: 'CIETD',
  B: 'Investigació II',
  C: 'Ciències de la Salut',
  D: 'Humanes i Socials',
  E: 'Consell Social',
  F: 'ESTCE'
};

/* Las siglas del mapa. En una burbuja de 34 px no cabe «Ciències de la
   Salut», y la letra suelta (A, B, C…) no dice nada: hay que mirar la
   lista para traducirla, que es justo el paso que el mapa debería
   ahorrar. Las siglas son las que se usan en el campus, así que se
   reconocen sin leyenda. El nombre completo sigue abajo, en la lista. */
const SIGLAS = {
  A: 'CIETD',
  B: 'I2',
  C: 'MD',
  D: 'FH',
  E: 'CS',
  F: 'ESTCE'
};

function nombreZona(z) { return NOMBRES[z] || ('Zona ' + z); }
function siglaZona(z)  { return SIGLAS[z]  || z; }

let estadoActual = null;     // { A:{libres,total}, … }
let temporizador = null;

/* ─────────────────────────────────────────────────────────────
   EL MAPA ESQUEMÁTICO

   Las posiciones se calculan desde las coordenadas reales, no se
   escriben a mano: así el mapa es correcto por construcción y, si algún
   día se añade un poste, se recoloca solo.

   Se proyecta plano (lon→x, lat→y) y no en Mercator a propósito: en 750
   metros la diferencia es de centímetros, y la fórmula cabe en dos
   líneas que cualquiera puede comprobar.
   ───────────────────────────────────────────────────────────── */
function centrosDeZona() {
  const z = {};
  POSTES.forEach(p => {
    (z[p.zona] = z[p.zona] || { lat:0, lon:0, n:0 });
    z[p.zona].lat += p.lat; z[p.zona].lon += p.lon; z[p.zona].n++;
  });
  Object.values(z).forEach(c => { c.lat /= c.n; c.lon /= c.n; });
  return z;
}

/* ── DÓNDE VA CADA ZONA EN EL PLANO ───────────────────────────
   Porcentajes sobre el plano oficial del campus (carga/campus.webp).

   Están puestos A MANO, y no hay forma de evitarlo: el plano de la UJI
   es un dibujo isométrico, no una proyección cartográfica, así que no
   existe ninguna fórmula que lleve de latitud y longitud a ese dibujo.
   Antes se calculaban sobre una ortofoto y sí salían solas; el plano
   bonito cuesta esto.

   Cada una se sitúa por el edificio que tiene al lado, que es como las
   busca una persona:

     A  CIETD                  el bloque naranja del extremo oeste
     B  Investigació II        junto al rótulo «Investigación II»
     C  Ciències de la Salut   los bloques amarillos MD/MI
     D  Humanes i Socials      los bloques azules HA/HC
     E  Consell Social         junto a la Escuela de Doctorado
     F  ESTCE                  detrás de los TD, como dice la UJI

   Si algún día la UJI cambia el plano, estos doce números se repasan a
   ojo y no se rompe nada más. */
const SITIOS = {
  A: { x:  6.5, y: 51.0 },
  B: { x: 27.5, y: 64.0 },
  C: { x: 43.5, y: 70.5 },
  D: { x: 34.0, y: 32.0 },
  E: { x: 66.5, y: 18.0 },
  F: { x: 71.5, y: 62.5 }
};

function posiciones() {
  const z = centrosDeZona();
  const out = {};
  Object.entries(z).forEach(([k, c]) => {
    const s = SITIOS[k];
    if (s) out[k] = { x: s.x, y: s.y, postes: c.n };
  });
  return out;
}

/* Verde si hay alguno libre, rojo si está todo ocupado. Y ya.
   Hubo un intento de tercer color, «queda poco», con un umbral del 25 %
   del total — y era un error: la zona F tiene UN poste, y ese poste
   libre es el 100 % de la zona, pero salía en ámbar como si fuera mala
   noticia. Con totales de 1, 2 y 3 postes ningún porcentaje significa
   nada. La pregunta real sólo tiene dos respuestas: ¿puedo bajar o no?
   El número al lado ya dice cuántos quedan. */
function clase(libres) {
  if (libres === null || libres === undefined) return 'nd';
  return libres > 0 ? 'hay' : 'nada';
}

function pintarMapa() {
  const cont = document.getElementById('mapa');
  if (!cont) return;
  const pos = posiciones();

  /* Capa aparte para los círculos: el esquema del campus es un SVG que
     vive en el HTML y repintar el contenedor entero se lo llevaría por
     delante en el primer refresco. */
  let capa = document.getElementById('zonasCapa');
  if (!capa) {
    capa = document.createElement('div');
    capa.id = 'zonasCapa';
    capa.style.cssText = 'position:absolute;inset:0';
    cont.appendChild(capa);
  }

  capa.innerHTML = Object.entries(pos).map(([z, p]) => {
    const e = estadoActual && estadoActual[z];
    const libres = e ? e.libres : null;
    const total  = e ? e.total  : p.postes * CONECTORES_POR_POSTE;
    return `<button type="button" class="zona ${clase(libres)}"
              style="left:${p.x}%;top:${p.y}%"
              aria-label="${esc(nombreZona(z))}: ${libres === null ? 'sin datos'
                 : libres + ' de ' + total + ' postes libres'}"
              onclick="detalleZona('${z}')">
              <b>${libres === null ? '·' : libres}</b><span>${esc(siglaZona(z))}</span>
            </button>`;
  }).join('');
}

function pintarLista() {
  const cont = document.getElementById('lista');
  if (!cont) return;
  const pos = posiciones();

  // Ordenadas por sitio libre: lo que buscas, arriba.
  const zs = Object.keys(pos).sort((a, b) => {
    const ea = estadoActual && estadoActual[a], eb = estadoActual && estadoActual[b];
    return (eb ? eb.libres : -1) - (ea ? ea.libres : -1) || a.localeCompare(b);
  });

  cont.innerHTML = zs.map(z => {
    const e = estadoActual && estadoActual[z];
    const total = e ? e.total : pos[z].postes;
    return `<button type="button" class="zfila" onclick="detalleZona('${z}')">
      <span class="zpunto ${clase(e && e.libres)}"></span>
      <span>${esc(nombreZona(z))}</span>
      <span class="zcuenta">${e ? e.libres + ' / ' + total : '—'}</span>
    </button>`;
  }).join('');
}

function pintarResumen() {
  const r = document.getElementById('resumen');
  if (!r || !estadoActual) return;
  const libres = Object.values(estadoActual).reduce((s, e) => s + e.libres, 0);
  const total  = Object.values(estadoActual).reduce((s, e) => s + e.total, 0);
  r.textContent = libres === 0
    ? `Ahora mismo no hay ningún poste libre de ${total}.`
    : `${libres} de ${total} ${total === 1 ? 'poste' : 'postes'} libres.`;
}

/* ─────────────────────────────────────────────────────────────
   CONSULTAR A LA UJI

   Empareja por cercanía igual que lo hace el servidor, y por el mismo
   motivo: el endpoint devuelve coordenadas y nada más. Si aparece una
   que no conocemos no se descarta en silencio — se cuenta aparte y se
   dice, porque significa que la UJI ha movido o añadido algo.
   ───────────────────────────────────────────────────────────── */
function posteMasCercano(lat, lon) {
  let mejor = null, mejorD = Infinity;
  POSTES.forEach(p => {
    const d = Math.hypot((p.lat - lat) * 111320, (p.lon - lon) * 85000);
    if (d < mejorD) { mejorD = d; mejor = p; }
  });
  return mejorD < 25 ? mejor : null;
}

async function consultarEstado() {
  const act = document.getElementById('actualizado');
  try {
    const r = await fetch(UJI_ESTADO, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const puntos = await r.json();
    if (!Array.isArray(puntos) || !puntos.length) throw new Error('respuesta vacía');

    const z = {};
    POSTES.forEach(p => {
      (z[p.zona] = z[p.zona] || { libres: 0, total: 0 });
      z[p.zona].total += 1;
    });

    let sueltos = 0;
    puntos.forEach(pt => {
      const p = posteMasCercano(Number(pt.y), Number(pt.x));
      if (!p) { sueltos++; return; }
      // disponible = 1 es LIBRE: la página oficial lo pinta verde
      if (Number(pt.disponible) === 1) z[p.zona].libres += 1;
    });

    estadoActual = z;
    pintarMapa(); pintarLista(); pintarResumen();

    const h = new Date().toLocaleTimeString('es-ES',
      { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    act.textContent = 'Actualizado a las ' + h
      + (sueltos ? ` · ${sueltos} punto${sueltos > 1 ? 's' : ''} en una posición que no reconozco` : '');

  } catch (e) {
    console.error('estado UJI:', e);
    // No se borra lo anterior: un dato de hace un minuto es mucho mejor
    // que una pantalla en blanco.
    act.textContent = estadoActual
      ? 'No he podido actualizar. Lo de arriba es de hace un momento.'
      : 'No he podido consultar el estado. ¿Hay cobertura?';
  }
}

window.detalleZona = function (z) {
  const e = estadoActual && estadoActual[z];
  const postes = POSTES.filter(p => p.zona === z);
  abrirModal(nombreZona(z), `
    <p class="ficha-txt">${e
      ? `<strong>${e.libres} de ${e.total}</strong> postes libres ahora mismo.`
      : 'Sin datos ahora mismo.'}</p>
    <p class="ficha-txt">Cada poste tiene ${CONECTORES_POR_POSTE} conectores, así que
       ${postes.length} ${postes.length === 1 ? 'poste da' : 'postes dan'} para
       ${postes.length * CONECTORES_POR_POSTE} coches si están todos libres.</p>
    <p class="hint-txt">${NOMBRES[z] ? '' :
       'Esta zona todavía no tiene nombre puesto: se identifica por su letra.'}</p>`,
    `<button class="btn" onclick="cerrarModal()"
       style="background:var(--surface2);color:var(--text)">Cerrar</button>`);
};

/* ─────────────────────────────────────────────────────────────
   ESTADÍSTICAS
   ───────────────────────────────────────────────────────────── */
let chart = null;

async function cargarEstadisticas() {
  const sub  = document.getElementById('statsSub');
  const nota = document.getElementById('statsNota');

  const { data, error } = await sb.rpc('carga_ocupacion', { p_dias: 60 });
  if (error) {
    sub.textContent = 'No he podido cargar el historial.';
    console.error('carga_ocupacion:', error);
    return;
  }

  // Horas observadas en total: es lo que dice si el historial da para algo
  const horas = (data || []).reduce((s, f) => s + (f.muestras || 0), 0);
  const dias  = horas / 24 / Math.max(1, POSTES.length);

  /* Con dos días no se puede decir nada y con dos semanas sí. Se dice,
     en vez de dibujar una gráfica que aparenta saber. Es lo mismo que
     hace la gráfica de peso cuando faltan pesadas. */
  if (dias < 7) {
    sub.textContent = 'Todavía no hay historial suficiente.';
    nota.textContent = `Llevo ${dias < 1 ? 'menos de un día' : Math.floor(dias) + ' días'}`
      + ' recogiendo datos. A partir de dos semanas esto empieza a poder'
      + ' responder a «¿a qué hora suele haber sitio?».';
    document.querySelector('.chart-wrap').style.display = 'none';
    return;
  }

  // Media por hora entre semana, que es cuando se usa el campus
  const porHora = new Array(24).fill(null).map(() => ({ s: 0, n: 0 }));
  (data || []).forEach(f => {
    if (f.dia_semana === 0 || f.dia_semana === 6) return;   // domingo y sábado
    porHora[f.hora].s += f.prob_libre * f.muestras;
    porHora[f.hora].n += f.muestras;
  });

  sub.textContent = 'Media de lunes a viernes, últimos 60 días.';
  nota.textContent = 'Probabilidad de encontrar al menos un punto libre.';
  document.querySelector('.chart-wrap').style.display = '';

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('chartOcupacion'), {
    type: 'bar',
    data: {
      labels: porHora.map((_, h) => String(h).padStart(2, '0')),
      datasets: [{
        data: porHora.map(x => x.n ? Math.round(x.s / x.n * 100) : null),
        backgroundColor: porHora.map(x => {
          const v = x.n ? x.s / x.n : 0;
          return v > .5 ? 'rgba(5,150,105,.75)'
               : v > .2 ? 'rgba(217,119,6,.75)'
               :          'rgba(220,38,38,.6)';
        })
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => c.parsed.y + ' % de probabilidad' } }
      },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + ' %' } },
        x: { title: { display: true, text: 'hora del día' } }
      }
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   AYUDAS MÍNIMAS

   esc, toast y el modal se reimplementan aquí en vez de cargar app.js:
   son veinte líneas, y traerse 60 KB de lógica del bebé para usar tres
   funciones sería justo lo que esta página quiere evitar.
   ───────────────────────────────────────────────────────────── */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let tToast = null;
function toast(msg, ms) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(tToast);
  tToast = setTimeout(() => el.classList.remove('visible'), ms || 3000);
}

function abrirModal(titulo, cuerpo, botones) {
  document.getElementById('modalTitulo').textContent = titulo;
  document.getElementById('modalCuerpo').innerHTML = cuerpo;
  document.getElementById('modalBtns').innerHTML = botones || '';
  document.getElementById('modal').style.display = '';
}
window.cerrarModal = function () {
  document.getElementById('modal').style.display = 'none';
};

/* ── ARRANQUE ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // El tema lo gestiona marca.css con data-theme; aquí sólo el botón
  const bt = document.getElementById('themeBtn1');
  if (bt) bt.addEventListener('click', () => {
    const d = document.documentElement;
    const oscuro = d.getAttribute('data-theme') !== 'light';
    d.setAttribute('data-theme', oscuro ? 'light' : 'dark');
    try { localStorage.setItem('carga.tema', oscuro ? 'light' : 'dark'); } catch (e) {}
  });
  try {
    const t = localStorage.getItem('carga.tema');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') cerrarModal();
  });

  pintarMapa(); pintarLista();
  consultarEstado();
  temporizador = setInterval(consultarEstado, REFRESCO_MS);

  /* Con la pestaña en segundo plano no se consulta: el móvil no está
     mirando y el servidor de la UJI no es nuestro. */
  document.addEventListener('visibilitychange', () => {
    clearInterval(temporizador);
    if (!document.hidden) {
      consultarEstado();
      temporizador = setInterval(consultarEstado, REFRESCO_MS);
    }
  });

  /* Al pulsar un aviso, el service worker trae esta ventana al frente y
     manda «refrescar». Sin esto, lo primero que verías al abrir desde la
     notificación sería el recuento de hace veinte segundos — justo el
     número que has venido a mirar. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.tipo === 'refrescar') consultarEstado();
    });
  }

  cargarEstadisticas();
  if (typeof iniciarAvisos === 'function') iniciarAvisos();
});
