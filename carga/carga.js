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
   cifra. «2 de 3 postes» es lo que el dato sostiene. */
const CONECTORES_POR_POSTE = 2;

/* Límite de tiempo de carga en el campus. De aquí sale la hora a la que
   un poste ocupado DEBERÍA quedar libre.

   Es una norma, no una predicción, y la pantalla lo dice así: nada
   impide que un coche se quede más rato, y de hecho la ficha avisa
   cuando el límite ya ha pasado en vez de callárselo. Si la UJI cambia
   la norma, se cambia este número. */
const LIMITE_CARGA_H = 3;

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

    /* Los chips para armar el aviso muestran cuántos postes quedan en
       cada zona, así que también se repintan. Sólo con el aviso ya
       permitido: en los demás estados la tarjeta es texto fijo y
       repintarla cada veinte segundos no aporta nada. */
    if (typeof pintarAvisos === 'function' && typeof estadoAv !== 'undefined'
        && estadoAv === 'activo') pintarAvisos();

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

/* ─────────────────────────────────────────────────────────────
   LA FICHA DE UNA ZONA

   Lo que se quiere saber al pulsar un círculo es una sola cosa: ¿voy o
   no voy? Y si está lleno, ¿cuánto falta?

   La hora de cada poste NO sale del endpoint de la UJI, que sólo dice
   libre o no: sale de nuestro propio historial de cambios. Por eso esta
   ficha es asíncrona y por eso puede decir «desde antes de que empezara
   a mirar» — el historial arrancó el 23/10/2026 y antes de esa fecha no
   hay nada que contar.
   ───────────────────────────────────────────────────────────── */
function horaDe(ts) {
  if (!ts) return null;
  // Postgres puede devolver «2026-10-23 15:02:01+00»: con espacio en vez
  // de T, y con el huso en dos dígitos. Ninguna de las dos cosas es ISO
  // válido y Safari las rechaza devolviendo una fecha inválida — que es
  // justo el fallo que convertía una línea correcta en «sin datos».
  const s = String(ts).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function hhmm(d) {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function lineaPoste(f) {
  /* Sin haber visto la transición no se puede calcular el límite: lo
     único que sabemos es que ya estaba así cuando empezamos a mirar.
     Dar una hora inventada aquí sería peor que no dar ninguna. Va antes
     que todo lo demás porque esta rama no necesita la fecha. */
  if (!f.libre && !f.observada) {
    return `<li><span class="p-no">●</span> <strong>${esc(f.poste_id)}</strong>
      ocupado desde antes de que empezara a mirar</li>`;
  }

  const d = horaDe(f.desde);
  if (!d) return `<li>${esc(f.poste_id)} · sin datos</li>`;

  const hoy = d.toDateString() === new Date().toDateString();
  const cuando = hhmm(d) + (hoy ? '' : ' del ' + d.toLocaleDateString('es-ES',
    { day: 'numeric', month: 'short' }));

  if (f.libre) {
    return `<li><span class="p-ok">●</span> <strong>${esc(f.poste_id)}</strong>
      libre desde las ${esc(cuando)}</li>`;
  }

  const limite = new Date(d.getTime() + LIMITE_CARGA_H * 3600000);
  const pasado = limite < new Date();

  return `<li><span class="p-no">●</span> <strong>${esc(f.poste_id)}</strong>
    ocupado desde las ${esc(cuando)} ·
    ${pasado
      ? `<span class="p-tarde">pasado el límite de ${LIMITE_CARGA_H} h (${esc(hhmm(limite))})</span>`
      : `libre como máximo a las <strong>${esc(hhmm(limite))}</strong>`}</li>`;
}

window.detalleZona = async function (z) {
  const e = estadoActual && estadoActual[z];
  const lleno = e && e.libres === 0;

  const botones =
    (lleno ? `<button class="btn btn-primary" onclick="avisarmeDeZona('${z}')"
                >Avisarme cuando quede libre</button>` : '')
    + `<button class="btn" onclick="verEstadisticas('${z}')"
         style="background:var(--surface2);color:var(--text)">Ver estadísticas</button>
       <button class="btn" onclick="cerrarModal()"
         style="background:var(--surface2);color:var(--text)">Cerrar</button>`;

  const cabecera = `<p class="ficha-txt">${e
    ? `<strong>${e.libres} de ${e.total}</strong> postes libres ahora mismo.`
    : 'Sin datos ahora mismo.'}</p>`;

  abrirModal(nombreZona(z), cabecera + '<p class="hint-txt">Cargando el detalle…</p>', botones);

  const { data, error } = await sb.rpc('carga_zona_detalle', { p_zona: z });

  // La ficha puede haberse cerrado o haber abierto otra mientras tanto
  const titulo = document.getElementById('modalTitulo');
  if (!titulo || titulo.textContent !== nombreZona(z)) return;

  if (error) {
    console.error('carga_zona_detalle:', error);
    document.getElementById('modalCuerpo').innerHTML = cabecera +
      '<p class="hint-txt">No he podido cargar las horas. El recuento de arriba' +
      ' viene de la UJI y sigue siendo bueno.</p>';
    return;
  }

  const filas = (data || []).map(lineaPoste).join('');

  // La explicación del límite sólo tiene sentido si hay algo ocupado
  const hayOcupado = (data || []).some(f => !f.libre);

  document.getElementById('modalCuerpo').innerHTML = cabecera +
    `<ul class="postes">${filas || '<li>Sin historial todavía.</li>'}</ul>` +
    (hayOcupado ? `<p class="hint-txt">El límite de carga en el campus es de
      ${LIMITE_CARGA_H} h, así que esa es la hora a la que <em>debería</em> quedar
      libre. Es una norma, no una promesa: nada impide que un coche se quede
      más rato.</p>` : '');
};

/* ─────────────────────────────────────────────────────────────
   ESTADÍSTICAS
   ───────────────────────────────────────────────────────────── */
let chart      = null;
let statsDatos = null;     // lo que devolvió carga_ocupacion, en crudo
let statsZona  = null;     // null = todas las zonas juntas

/* El día: 'hoy', 'lv' (media de lunes a viernes) o un número 0..6.

   Arranca en 'hoy' porque la pregunta que trae a alguien a esta página
   es «¿y ahora?». La media de L-V se queda como opción, no como punto de
   partida: mezcla cinco días que no tienen por qué parecerse, y si el
   martes y el viernes son distintos, promediarlos los esconde a los dos. */
let statsDia = 'hoy';

const DIAS  = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const INIC  = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/* Se pide UNA vez y se filtra en el navegador. Son como mucho unas
   pocas miles de filas (6 zonas × 7 días × 24 horas = 1.008 como tope),
   así que cambiar de zona o de día no vuelve a tocar el servidor y es
   instantáneo. */
async function cargarEstadisticas() {
  const { data, error } = await sb.rpc('carga_ocupacion', { p_dias: 60 });
  if (error) {
    document.getElementById('statsSub').textContent = 'No he podido cargar el historial.';
    console.error('carga_ocupacion:', error);
    return;
  }
  statsDatos = data || [];
  pintarFiltrosStats();
  pintarEstadisticas();
}

/* Dos grupos separados y etiquetados, no una tira de botones seguidos:
   «MD» y «J» son las dos cosas cortas y en mayúscula, y sin separarlas
   parecen la misma clase de filtro cuando se combinan entre sí. */
function pintarFiltrosStats() {
  const c = document.getElementById('statsFiltros');
  if (!c) return;

  const zonas = [['', 'Todas']].concat(Object.keys(SIGLAS).map(z => [z, SIGLAS[z]]));
  const bz = zonas.map(([v, et]) => `
    <button type="button" class="f-btn ${(statsZona || '') === v ? 'on' : ''}"
            onclick="filtrarStats('${v}', null)">${esc(et)}</button>`).join('');

  // 'hoy' y 'lv' primero, y después los cinco días sueltos
  const dias = [['hoy', 'Hoy'], ['lv', 'L-V']]
    .concat([1, 2, 3, 4, 5].map(n => [String(n), INIC[n]]));

  const bd = dias.map(([v, et]) => `
    <button type="button" class="f-btn ${String(statsDia) === v ? 'on' : ''}"
            onclick="filtrarStats(null, '${v}')"
            title="${esc(v === 'hoy' ? DIAS[new Date().getDay()]
                       : v === 'lv' ? 'media de lunes a viernes'
                       : DIAS[Number(v)])}">${esc(et)}</button>`).join('');

  c.innerHTML = `
    <p class="f-tit">Zona</p>
    <div class="filtros">${bz}</div>
    <p class="f-tit">Día</p>
    <div class="filtros">${bd}</div>`;
}

window.filtrarStats = function (zona, dia) {
  if (zona !== null) statsZona = zona || null;
  // Los días sueltos llegan como texto desde el onclick: se vuelven número
  if (dia  !== null) statsDia  = /^\d$/.test(dia) ? Number(dia) : dia;
  pintarFiltrosStats();
  pintarEstadisticas();
};

/* Lleva a las gráficas con la zona ya elegida y mirando el día de hoy,
   que es la pregunta que uno se hace de pie junto al coche. */
window.verEstadisticas = function (z) {
  cerrarModal();
  statsZona = z;
  statsDia  = 'hoy';
  pintarFiltrosStats();
  pintarEstadisticas();
  const s = document.getElementById('estadisticas');
  if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function pintarEstadisticas() {
  const sub  = document.getElementById('statsSub');
  const nota = document.getElementById('statsNota');
  const caja = document.querySelector('.chart-wrap');
  if (!statsDatos) return;

  const dow = new Date().getDay();
  const dia = statsDia === 'hoy' ? dow : statsDia;   // 'lv' se queda como está

  const esDelDia = f => dia === 'lv'
    ? (f.dia_semana !== 0 && f.dia_semana !== 6)
    : f.dia_semana === dia;

  const filas = statsDatos.filter(f =>
    (!statsZona || f.zona_id === statsZona) && esDelDia(f));

  const porHora = new Array(24).fill(null).map(() => ({ s: 0, n: 0 }));
  filas.forEach(f => {
    porHora[f.hora].s += f.prob_libre * f.muestras;
    porHora[f.hora].n += f.muestras;
  });

  /* El umbral se mide sobre LO QUE SE VA A PINTAR, no sobre el total.
     Puede haber dos meses de historial general y cuatro horas de una
     zona concreta en sábado; dibujar eso como si fuera una tendencia
     sería exactamente la clase de gráfica que miente. */
  const horas   = filas.reduce((s, f) => s + (f.muestras || 0), 0);
  const postes  = statsZona ? POSTES.filter(p => p.zona === statsZona).length : POSTES.length;
  const dias    = horas / 24 / Math.max(1, postes);

  /* Un día suelto sólo aparece una vez por semana, así que dos ya dicen
     algo; la media de L-V junta cinco y se le puede pedir más. */
  const minimo  = dia === 'lv' ? 7 : 2;

  const donde  = statsZona ? nombreZona(statsZona) : 'todo el campus';
  /* «los lunes», no «los luness»: en castellano los días acabados en -s
     no cambian en plural, y sólo sábado y domingo llevan la -s. */
  const enPlural = d => /s$/.test(d) ? d : d + 's';
  const cuando = dia === 'lv' ? 'de lunes a viernes' : 'los ' + enPlural(DIAS[dia]);

  if (dias < minimo) {
    sub.textContent = `Todavía no hay historial suficiente de ${donde} ${cuando}.`;
    nota.textContent = `Llevo ${dias < 1 ? 'menos de un día' : Math.floor(dias) + ' días'}`
      + ' de datos para ese filtro. Esto empieza a poder responder a «¿a qué hora'
      + ' suele haber sitio?» cuando haya unas cuantas semanas.';
    caja.style.display = 'none';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  sub.textContent = `${donde[0].toUpperCase()}${donde.slice(1)}, ${cuando}, últimos 60 días.`;
  /* OJO CON ESTA FRASE. Antes decía «probabilidad de encontrar al menos
     un poste libre» y era FALSO: carga_ocupacion() suma segundos de
     poste, así que lo que sale es qué proporción del parque estuvo
     libre, no si quedaba alguno. En una zona de tres postes con uno
     siempre libre, lo primero da 33 % y lo segundo 100 %. Las dos cifras
     son útiles, pero no son la misma, y la que calculamos es ésta. */
  nota.textContent = 'Proporción media de postes libres en esa hora.';
  caja.style.display = '';

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
        tooltip: { callbacks: { label: c => c.parsed.y + ' % de los postes libres' } }
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
