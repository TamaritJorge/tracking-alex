/* ═════════════════════════════════════════════════════════════
   PESTAÑA COMIDA — alimentación complementaria

   Se apoya en:
     · alimentos.js  → catálogo, restricciones, alérgenos
     · oms.js        → edadEnDias() y FECHA_NACIMIENTO
     · app.js        → sb, esc(), toast(), fechas

   Tiene su propia carga y su propio canal de realtime contra las
   tablas alim_registros y alim_ajustes, así que no toca nada de
   cargarDatos() ni de configurarRealtime().
   ═════════════════════════════════════════════════════════════ */

let comidas   = [];
let ajustes   = { plan: { retrasos: {}, descartados: [] }, inicio: null,
                  preparacion: {}, personalizados: [] };
let canalRTComida = null;
let catAbierta    = null;   // categoría desplegada en el catálogo
let fichaAbierta  = null;   // alimento abierto en el modal

const MS_DIA = 864e5;

/* ─────────────────────────────────────────────────────────────
   CARGA Y REALTIME
   ───────────────────────────────────────────────────────────── */
async function cargarComida() {
  const [regs, ajs] = await Promise.all([
    sb.from('alim_registros').select('*').order('fecha_hora', { ascending: true }),
    sb.from('alim_ajustes').select('*')
  ]);

  if (regs.error || ajs.error) {
    console.error('Error al cargar comida:', regs.error || ajs.error);
    const c = document.getElementById('comidaError');
    if (c) {
      c.style.display = '';
      c.textContent = '❌ No se pudieron cargar los alimentos: '
                    + ((regs.error || ajs.error).message || '')
                    + ' — ¿has ejecutado migracion-alimentos.sql?';
    }
    // Se pinta igualmente con lo que hay: el catálogo y las fichas no
    // dependen de la base de datos, y poder consultarlos sigue siendo útil.
    comidas = [];
    renderComida();
    return;
  }

  const err = document.getElementById('comidaError');
  if (err) err.style.display = 'none';

  comidas = regs.data || [];

  // Valores por defecto si aún no hay fila de ajustes
  ajustes = { plan: { retrasos: {}, descartados: [] }, inicio: null,
              preparacion: {}, personalizados: [] };
  (ajs.data || []).forEach(f => {
    if (f.clave === 'plan')           ajustes.plan           = Object.assign(ajustes.plan, f.valor || {});
    if (f.clave === 'inicio')         ajustes.inicio         = (f.valor || {}).fecha || null;
    if (f.clave === 'preparacion')    ajustes.preparacion    = f.valor || {};
    if (f.clave === 'personalizados') ajustes.personalizados = (f.valor || {}).lista || [];
  });
  if (!ajustes.plan.retrasos)    ajustes.plan.retrasos = {};
  if (!ajustes.plan.descartados) ajustes.plan.descartados = [];
  if (!ajustes.personalizados)   ajustes.personalizados = [];

  renderComida();
}

function configurarRealtimeComida() {
  if (canalRTComida) return;
  canalRTComida = sb.channel('tracking-alex-comida')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alim_registros' },
        () => cargarComida())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alim_ajustes' },
        () => cargarComida())
    .subscribe();
}

/* Traduce el error de Supabase a algo accionable.
   El caso típico: falta por ejecutar migracion-alimentos-2.sql y
   el mensaje crudo ("column revisado does not exist") no dice qué
   hacer. */
function mensajeError(error) {
  const m = (error && error.message) || '';
  if (/revisado/i.test(m)) {
    return 'falta la columna "revisado" — ejecuta migracion-alimentos-2.sql en Supabase';
  }
  if (/row-level security/i.test(m)) {
    return 'no tienes sesión iniciada (o caducó). Vuelve a entrar.';
  }
  return m || 'error desconocido';
}

// Guarda una clave de ajustes (upsert sobre la PK `clave`)
async function guardarAjuste(clave, valor) {
  const { error } = await sb.from('alim_ajustes')
    .upsert({ clave, valor, actualizado_en: new Date().toISOString() }, { onConflict: 'clave' });
  if (error) {
    console.error(error);
    toast('❌ No se pudo guardar: ' + mensajeError(error), 5000);
    return false;
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
   EDAD Y ESTADO GENERAL
   ───────────────────────────────────────────────────────────── */
function mesesAlex(cuando) {
  return edadEnDias(cuando || new Date()) / 30.4375;
}

function diasPara6Meses() {
  return Math.ceil(6 * 30.4375 - edadEnDias(new Date()));
}

function yaEmpezado() { return !!ajustes.inicio; }

const SENALES = [
  { id: 'sentado',   txt: 'Se mantiene sentado con poco apoyo' },
  { id: 'cabeza',    txt: 'Sostiene bien la cabeza' },
  { id: 'extrusion', txt: 'Ya no empuja la comida fuera con la lengua' },
  { id: 'interes',   txt: 'Muestra interés: mira, coge, se lleva cosas a la boca' }
];

function senalesListas() {
  return SENALES.every(s => ajustes.preparacion[s.id]);
}

/* ─────────────────────────────────────────────────────────────
   CATÁLOGO COMBINADO

   Los 115 del catálogo más los que hayáis añadido vosotros, que
   viven en alim_ajustes bajo la clave 'personalizados'. Se guardan
   ahí y no en una tabla propia porque esa tabla ya es clave/valor
   JSONB: así no hace falta ninguna migración.

   Los vuestros llevan `mio: true` y no traen guía de cómo darlos
   ni de atragantamiento: eso sólo lo tienen los revisados.
   ───────────────────────────────────────────────────────────── */
function catalogo() {
  return ALIMENTOS.concat((ajustes.personalizados || []).map(p => ({
    id: p.id,
    nombre: p.nombre,
    cat: CATEGORIAS[p.cat] ? p.cat : 'otros',
    hierro: null,
    alergeno: ALERGENOS[p.alergeno] ? p.alergeno : null,
    desdeMeses: 6,
    restriccion: null,
    blw: '', cuchara: '', atragantamiento: null, nota: '',
    orden: 900,
    mio: true
  })));
}

function buscarAlimento(id) {
  return catalogo().find(a => a.id === id) || null;
}

// Identificador estable a partir del nombre, con prefijo para no
// chocar nunca con los del catálogo
function idPersonalizado(nombre) {
  const base = 'mio-' + nombre.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quita tildes
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = base, n = 2;
  while (catalogo().some(a => a.id === id)) id = base + '-' + (n++);
  return id;
}

/* ─────────────────────────────────────────────────────────────
   ESTADO DE CADA ALIMENTO
   ───────────────────────────────────────────────────────────── */
// Ordenados de más antiguo a más reciente: varias funciones dan por
// hecho que rs[0] es la primera toma y rs[n-1] la última, y no conviene
// que eso dependa del orden en que los devuelva la consulta.
function registrosDe(id) {
  return comidas.filter(c => c.alimento_id === id)
                .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora));
}

function estadoAlimento(id) {
  const rs = registrosDe(id);
  if (!rs.length) return { veces: 0, estado: 'nuevo' };

  const conReaccion = rs.filter(r => r.reaccion);
  const primera = +new Date(rs[0].fecha_hora);
  const ultima  = +new Date(rs[rs.length - 1].fecha_hora);

  return {
    veces: rs.length,
    primera, ultima,
    reaccion: conReaccion.length ? conReaccion[conReaccion.length - 1].reaccion : null,
    estado: conReaccion.length ? 'reaccion'
          : (Date.now() - primera >= DIAS_VENTANA_ALERGENO * MS_DIA ? 'tolerado' : 'probado')
  };
}

/* ─────────────────────────────────────────────────────────────
   ALÉRGENOS Y LA REGLA DE LOS 3 DÍAS

   La espera de 3 días NO sirve para detectar reacciones
   inmediatas (esas salen en minutos o en las primeras 2 horas).
   Sirve para las tardías: digestivas, eczema, etc. Por eso se
   aplica sólo a los alérgenos y no a todo alimento nuevo.
   ───────────────────────────────────────────────────────────── */
function estadoAlergenos() {
  const out = {};
  for (const clave of Object.keys(ALERGENOS)) {
    const ids = catalogo().filter(a => a.alergeno === clave).map(a => a.id);
    const rs  = comidas
      .filter(c => ids.includes(c.alimento_id))
      .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora));

    const conReaccion = rs.find(r => r.reaccion);
    out[clave] = {
      nombre: ALERGENOS[clave].nombre,
      introducido: rs.length > 0,
      primera: rs.length ? +new Date(rs[0].fecha_hora) : null,
      ultima:  rs.length ? +new Date(rs[rs.length - 1].fecha_hora) : null,
      veces: rs.length,
      conReaccion: !!conReaccion,
      reaccion: conReaccion ? conReaccion.reaccion : null
    };
  }
  return out;
}

// Alérgeno cuya ventana de 3 días sigue abierta (si hay alguno)
function ventanaAlergeno() {
  const ahora = Date.now();
  let activa = null;
  for (const [clave, e] of Object.entries(estadoAlergenos())) {
    if (!e.introducido || e.conReaccion) continue;
    const fin = e.primera + DIAS_VENTANA_ALERGENO * MS_DIA;
    if (fin > ahora && (!activa || fin > activa.fin)) {
      activa = { clave, nombre: e.nombre, fin, primera: e.primera };
    }
  }
  return activa;
}

// Alérgenos ya tolerados que llevan mucho sin ofrecerse.
// LEAP: el efecto protector depende de mantenerlos en la dieta.
function alergenosADesempolvar() {
  const ahora = Date.now();
  return Object.entries(estadoAlergenos())
    .filter(([, e]) => e.introducido && !e.conReaccion
                    && ahora - e.primera >= DIAS_VENTANA_ALERGENO * MS_DIA
                    && ahora - e.ultima  >= DIAS_MANTENIMIENTO * MS_DIA)
    .map(([clave, e]) => ({ clave, nombre: e.nombre, dias: Math.floor((ahora - e.ultima) / MS_DIA) }));
}

/* ─────────────────────────────────────────────────────────────
   LA COLA

   Orden efectivo = orden del catálogo + los retrasos que se
   hayan ido acumulando al pulsar "Posponer". Se guarda sólo el
   contador de retrasos, no la lista entera: así el plan sigue
   funcionando aunque el catálogo cambie.
   ───────────────────────────────────────────────────────────── */
function ordenEfectivo(a) {
  return (a.orden || 999) + (ajustes.plan.retrasos[a.id] || 0) * 1000;
}

/* Edad de referencia para la cola.

   Si ya habéis decidido empezar, los alimentos de "6 meses" tienen
   que aparecer aunque falten días para cumplirlos: vosotros decidís
   cuándo está listo, no el calendario. Sin esto, pulsar "Ya hemos
   empezado" a los 5 meses y medio dejaba la cola vacía. */
function edadReferencia() {
  const meses = mesesAlex();
  return yaEmpezado() ? Math.max(meses, 6) : meses + 0.5;
}

function cola() {
  const ref = edadReferencia();
  return catalogo()
    .filter(a => estadoAlimento(a.id).veces === 0)
    .filter(a => !ajustes.plan.descartados.includes(a.id))
    .filter(a => edadMinimaMeses(a) <= ref)
    .sort((x, y) => ordenEfectivo(x) - ordenEfectivo(y));
}

async function posponer(id) {
  ajustes.plan.retrasos[id] = (ajustes.plan.retrasos[id] || 0) + 1;
  if (await guardarAjuste('plan', ajustes.plan)) { toast('⏭️ Pospuesto'); renderComida(); }
}

async function adelantar(id) {
  ajustes.plan.retrasos[id] = Math.max(0, (ajustes.plan.retrasos[id] || 0) - 1);
  if (await guardarAjuste('plan', ajustes.plan)) { toast('⏮️ Adelantado'); renderComida(); }
}

async function saltar(id) {
  if (!ajustes.plan.descartados.includes(id)) ajustes.plan.descartados.push(id);
  if (await guardarAjuste('plan', ajustes.plan)) { toast('🚫 Fuera de la cola'); renderComida(); }
}

async function recuperar(id) {
  ajustes.plan.descartados = ajustes.plan.descartados.filter(x => x !== id);
  if (await guardarAjuste('plan', ajustes.plan)) { toast('↩️ De vuelta'); renderComida(); }
}

/* Los dos avisos de edad, que NO se miden igual:

   · El de seguridad (miel, mercurio…) va contra la edad REAL. Da
     igual que hayáis decidido empezar antes: a los 11 meses la miel
     sigue siendo un riesgo de botulismo.
   · El de madurez va contra la edad de referencia, que respeta el
     "ya hemos empezado". Si no, la cola ofrecía ternera y al abrirla
     avisaba de que es para los 6 meses: se contradecían. */
function avisosEdad(a) {
  const r = restriccionDe(a);
  return {
    duro:  (r && r.edadMeses > mesesAlex()) ? r : null,
    suave: (!r || r.edadMeses <= mesesAlex()) && (a.desdeMeses || 0) > edadReferencia()
           ? a.desdeMeses : null
  };
}

/* ─────────────────────────────────────────────────────────────
   VARIEDAD
   ───────────────────────────────────────────────────────────── */
function variedad7dias() {
  const desde = Date.now() - 7 * MS_DIA;
  return new Set(comidas.filter(c => +new Date(c.fecha_hora) >= desde)
                        .map(c => c.alimento_id)).size;
}

/* ─────────────────────────────────────────────────────────────
   PINTAR
   ───────────────────────────────────────────────────────────── */
function renderComida() {
  const panel = document.getElementById('tab-comida');
  if (!panel) return;
  renderEstado();
  renderVentana();
  renderCola();
  renderCatalogo();
  renderDiario();
}

/* ── Tarjeta de estado y arranque ── */
function renderEstado() {
  const cont = document.getElementById('comidaEstado');
  if (!cont) return;

  if (!yaEmpezado()) {
    const faltan = diasPara6Meses();
    const listo  = senalesListas();
    cont.innerHTML = `
      <p class="card-title">🥑 Aún no habéis empezado</p>
      <p class="card-sub">
        ${faltan > 0
          ? `Faltan ${faltan} ${faltan === 1 ? 'día' : 'días'} para los 6 meses`
          : `Ya ha cumplido los 6 meses`}
      </p>

      <p class="hint-txt" style="margin-top:0">
        Los 6 meses son la referencia, no una fecha exacta. Lo que manda es que
        Álex esté listo:
      </p>

      <div class="check-list">
        ${SENALES.map(s => `
          <button type="button" class="check-item${ajustes.preparacion[s.id] ? ' sel' : ''}"
                  onclick="marcarSenal('${s.id}')" aria-pressed="${!!ajustes.preparacion[s.id]}">
            <span class="check-box">${ajustes.preparacion[s.id] ? '✓' : ''}</span>
            <span>${esc(s.txt)}</span>
          </button>`).join('')}
      </div>

      ${listo ? `<p class="aviso aviso-ok" style="margin-top:12px">
                   ✅ Con las cuatro señales, parece listo para empezar.
                 </p>` : ''}

      <button class="btn btn-primary" style="margin-top:14px" onclick="empezarComplementaria()">
        Ya hemos empezado
      </button>
      <p class="hint-txt" style="margin:8px 0 0">
        Púlsalo cuando le ofrezcáis comida por primera vez, falten los días que falten.
      </p>`;
    return;
  }

  // Math.max por si la fecha guardada fuera futura: mejor "Día 1" que "Día -165"
  const dias    = Math.max(1, Math.floor((Date.now() - +new Date(ajustes.inicio)) / MS_DIA) + 1);
  const cat      = catalogo();
  const probados = cat.filter(a => estadoAlimento(a.id).veces > 0).length;
  const al       = estadoAlergenos();
  const alIntro  = Object.values(al).filter(e => e.introducido).length;
  const alTotal  = Object.keys(ALERGENOS).length;

  cont.innerHTML = `
    <p class="card-title">🥑 Alimentación complementaria</p>
    <p class="card-sub">Día ${dias} · empezasteis el ${esc(new Date(ajustes.inicio)
        .toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }))}</p>
    <div class="sum-grid">
      <div class="sum-item">
        <div class="sum-val">${probados}</div>
        <div class="sum-lbl">Alimentos probados</div>
        <div class="sum-extra">de ${cat.length}</div>
      </div>
      <div class="sum-item">
        <div class="sum-val">${alIntro}/${alTotal}</div>
        <div class="sum-lbl">Alérgenos</div>
        <div class="sum-extra">introducidos</div>
      </div>
      <div class="sum-item">
        <div class="sum-val">${variedad7dias()}</div>
        <div class="sum-lbl">Variedad</div>
        <div class="sum-extra">distintos, 7 días</div>
      </div>
      <div class="sum-item">
        <div class="sum-val">${comidas.length}</div>
        <div class="sum-lbl">Registros</div>
        <div class="sum-extra">en total</div>
      </div>
    </div>`;
}

window.marcarSenal = async function(id) {
  ajustes.preparacion[id] = !ajustes.preparacion[id];
  if (await guardarAjuste('preparacion', ajustes.preparacion)) renderEstado();
};

window.empezarComplementaria = async function() {
  const hoy = new Date().toISOString().slice(0, 10);
  if (await guardarAjuste('inicio', { fecha: hoy })) {
    ajustes.inicio = hoy;
    toast('🥑 ¡A comer!');
    renderComida();
  }
};

/* ── Ventana de alérgeno y mantenimiento ── */
function renderVentana() {
  const cont = document.getElementById('comidaVentana');
  if (!cont) return;

  const v = ventanaAlergeno();
  const mant = alergenosADesempolvar();
  let html = '';

  if (v) {
    const restan = v.fin - Date.now();
    const d = Math.floor(restan / MS_DIA);
    const h = Math.floor((restan % MS_DIA) / 36e5);
    html += `
      <div class="aviso aviso-espera">
        <strong>⏳ Ventana de ${esc(v.nombre)} abierta</strong><br>
        Quedan ${d} d ${h} h — hasta el
        ${esc(new Date(v.fin).toLocaleString('es-ES',
          { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}.
        Mejor no introducir otro alérgeno nuevo hasta entonces, para saber a quién
        culpar si algo sienta mal.
      </div>`;
  }

  // Tomas pendientes de marcar cómo sentaron
  const pend = pendientesDeRevisar();
  if (pend.length) {
    html += `
      <div class="aviso aviso-ojo" style="margin-top:${html ? '10px' : '0'}">
        <strong>📝 ${pend.length} ${pend.length === 1 ? 'toma sin revisar' : 'tomas sin revisar'}</strong><br>
        Marca cómo le sentaron. Las reacciones tardías pueden tardar horas.
        <div class="cola-btns" style="margin-top:10px">
          ${pend.slice(0, 4).map(c => `
            <button class="btn-mini btn-mini-pri" onclick="editarComida('${c.id}')">
              ${esc(c.nombre)}
            </button>`).join('')}
          ${pend.length > 4 ? `<span class="cola-aviso">y ${pend.length - 4} más en el diario</span>` : ''}
        </div>
      </div>`;
  }

  if (mant.length) {
    html += `
      <div class="aviso aviso-suave" style="margin-top:${html ? '10px' : '0'}">
        <strong>🔁 Conviene repetirlos</strong><br>
        ${mant.map(m => `${esc(m.nombre)} (hace ${m.dias} días)`).join(' · ')}.
        Una vez tolerado, el efecto protector depende de seguir dándolo con
        regularidad, no de haberlo probado una vez.
      </div>`;
  }

  cont.innerHTML = html;
  cont.style.display = html ? '' : 'none';
}

/* ── Cola: qué toca ahora ── */
function renderCola() {
  const cont = document.getElementById('comidaCola');
  if (!cont) return;

  const c = cola();
  const v = ventanaAlergeno();
  const estAl = estadoAlergenos();

  if (!c.length) {
    cont.innerHTML = `<p class="card-title">👉 Siguiente</p>
      <p class="empty-state">${yaEmpezado()
        ? 'No queda nada pendiente para su edad. Mira el catálogo para repetir algo o recuperar lo que saltaste.'
        : 'Aquí aparecerá qué ofrecerle cuando empecéis. Pulsa «Ya hemos empezado» arriba.'}</p>`;
    return;
  }

  cont.innerHTML = `
    <p class="card-title">👉 Siguiente</p>
    <p class="card-sub">Orden sugerido priorizando el hierro. No es una pauta
      oficial: la AEP dice que el orden no importa, así que muévelo a tu gusto.</p>
    ${c.slice(0, 3).map(a => {
      const bloqueado = v && a.alergeno && a.alergeno !== v.clave;
      return `
      <div class="cola-item${bloqueado ? ' cola-espera' : ''}">
        <div class="cola-nom">
          ${CATEGORIAS[a.cat].emoji} ${esc(a.nombre)}
          ${a.hierro === 'alto' ? '<span class="tag tag-hierro">hierro</span>' : ''}
          ${etiquetaAlergeno(a, estAl)}
        </div>
        ${bloqueado
          ? `<div class="cola-aviso">Espera a que cierre la ventana de ${esc(v.nombre)}</div>`
          : ''}
        <div class="cola-btns">
          <button class="btn-mini btn-mini-pri" onclick="abrirRegistro('${a.id}')">Registrar</button>
          <button class="btn-mini" onclick="verFicha('${a.id}')">Cómo darlo</button>
          <button class="btn-mini" onclick="posponer('${a.id}')">Posponer</button>
          <button class="btn-mini" onclick="saltar('${a.id}')">Saltar</button>
        </div>
      </div>`;
    }).join('')}`;
}

/* ── Catálogo por categorías ── */
function renderCatalogo() {
  const cont = document.getElementById('comidaCatalogo');
  if (!cont) return;

  // `todos` y no `cat`: dentro del bucle `cat` ya es la categoría
  const todos = catalogo();
  const mios  = todos.filter(a => a.mio).length;
  const estAl = estadoAlergenos();   // se calcula una vez, no por fila

  cont.innerHTML = `
    <p class="card-title">📚 Catálogo</p>
    <p class="card-sub">${todos.length} alimentos${mios ? ` (${mios} vuestros)` : ''}.
      Toca uno para ver cómo ofrecerlo.</p>
    ${Object.entries(CATEGORIAS).map(([clave, cat]) => {
      const items = todos.filter(a => a.cat === clave)
                         .sort((x, y) => ordenEfectivo(x) - ordenEfectivo(y));
      if (!items.length) return '';
      const hechos = items.filter(a => estadoAlimento(a.id).veces > 0).length;
      const abierta = catAbierta === clave;
      return `
        <button type="button" class="cat-cab" onclick="toggleCat('${clave}')"
                aria-expanded="${abierta}">
          <span>${cat.emoji} ${esc(cat.nombre)}</span>
          <span class="cat-cuenta">${hechos}/${items.length} ${abierta ? '▾' : '▸'}</span>
        </button>
        ${abierta ? `<div class="cat-lista">${items.map(a => filaAlimento(a, estAl)).join('')}</div>` : ''}`;
    }).join('')}
    ${modoVer ? '' : `
      <button class="btn" style="margin-top:14px;background:var(--surface2);color:var(--text)"
              onclick="nuevoAlimento()">➕ Añadir un alimento vuestro</button>`}`;
}

/* Etiqueta de alérgeno, que sólo sale cuando dice algo útil.

   Antes ponía "alérgeno" en los 56 alimentos que lo llevan, sin
   decir cuál y siguiera introducido o no. Con 20 pescados seguidos
   la etiqueta dejaba de significar nada. Ahora:

     · sin introducir → nombre del alérgeno: registrarlo abrirá la
                        ventana de 3 días. Es lo accionable.
     · con reacción   → en rojo, que eso sí hay que verlo siempre.
     · ya tolerado    → nada: no es una primera exposición.          */
function etiquetaAlergeno(a, estAl) {
  if (!a.alergeno) return '';
  const e = (estAl || estadoAlergenos())[a.alergeno];
  if (!e) return '';
  const nombre = esc(ALERGENOS[a.alergeno].nombre);

  if (e.conReaccion) return `<span class="tag tag-stop">⚠ ${nombre}</span>`;
  if (!e.introducido) return `<span class="tag tag-alergeno">${nombre}</span>`;
  return '';
}

function filaAlimento(a, estAl) {
  const e  = estadoAlimento(a.id);
  const av = avisosEdad(a);

  const marca = e.estado === 'reaccion' ? '<span class="pt pt-mal">⚠</span>'
              : e.estado === 'tolerado' ? '<span class="pt pt-ok">✓</span>'
              : e.veces                 ? '<span class="pt pt-med">•</span>'
              : '<span class="pt"></span>';

  // La etiqueta de edad sólo cuando aporta algo. Usa los mismos
  // criterios que el modal para no contradecirse con la cola.
  const etiquetaEdad =
      av.duro  ? `<span class="tag tag-stop">${esc(av.duro.etiqueta)}</span>`
    : av.suave ? `<span class="tag tag-pronto">${av.suave} m</span>`
    : '';

  return `
    <button type="button" class="ali-fila" onclick="verFicha('${a.id}')">
      ${marca}
      <span class="ali-nom">${esc(a.nombre)}</span>
      ${a.hierro === 'alto' ? '<span class="tag tag-hierro">Fe</span>' : ''}
      ${etiquetaAlergeno(a, estAl)}
      ${a.mio ? '<span class="tag tag-mio">vuestro</span>' : ''}
      ${etiquetaEdad}
      ${e.veces ? `<span class="ali-veces">×${e.veces}</span>` : ''}
    </button>`;
}

window.toggleCat = function(clave) {
  catAbierta = (catAbierta === clave) ? null : clave;
  renderCatalogo();
};

/* ── Diario ── */
function renderDiario() {
  const cont = document.getElementById('comidaDiario');
  if (!cont) return;

  const ultimos = [...comidas]
    .sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora))
    .slice(0, 30);
  if (!ultimos.length) {
    cont.innerHTML = `<p class="card-title">📖 Diario</p>
      <p class="empty-state">Todavía no hay nada registrado.</p>`;
    return;
  }

  cont.innerHTML = `
    <p class="card-title">📖 Diario</p>
    <p class="card-sub">Últimos ${ultimos.length} registros</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Alimento</th><th>Cómo fue</th>
          ${modoVer ? '' : '<th>Acc.</th>'}</tr></thead>
        <tbody>
          ${ultimos.map(c => {
            const ac = { encanta:'😋 Le encanta', come:'🙂 Come', prueba:'😐 Lo prueba',
                         rechaza:'🙅 Lo rechaza' }[c.aceptacion] || '—';

            // Tres estados: pendiente de revisar, todo bien, o con reacción
            const estado = c.reaccion
              ? `<span class="nota-txt" style="color:var(--danger)">⚠ ${esc(c.reaccion.sintoma || 'reacción')}`
                + `${c.reaccion.nota ? ' — ' + esc(c.reaccion.nota) : ''}</span>`
              : c.revisado
                ? '<span class="nota-txt" style="color:var(--ok)">✓ Le sentó bien</span>'
                : '<span class="nota-txt" style="color:var(--target)">⏳ Sin revisar</span>';

            const nota = c.nota ? `<span class="nota-txt">📝 ${esc(c.nota)}</span>` : '';
            return `<tr>
              <td style="white-space:nowrap">${esc(fmtFechaHora(c.fecha_hora))}</td>
              <td>${esc(c.nombre)}</td>
              <td>${ac}${estado}${nota}</td>
              ${modoVer ? '' : `<td style="white-space:nowrap">
                <button class="btn-edit-sm" onclick="editarComida('${c.id}')"
                        aria-label="Editar">${c.revisado ? '✏️' : '📝'}</button>
                <button class="btn-danger-sm" onclick="borrarComida('${c.id}')"
                        style="margin-left:4px" aria-label="Borrar">🗑️</button></td>`}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <button class="btn" style="margin-top:14px;background:var(--surface2);color:var(--text)"
            onclick="copiarResumen()">📋 Copiar resumen para la pediatra</button>`;
}

window.borrarComida = async function(id) {
  if (!confirm('¿Borrar este registro?')) return;
  const { error } = await sb.from('alim_registros').delete().eq('id', id);
  if (error) { console.error(error); toast('❌ No se pudo borrar: ' + mensajeError(error), 4000); }
  else { toast('🗑️ Borrado'); await cargarComida(); }
};

/* ─────────────────────────────────────────────────────────────
   FICHA DEL ALIMENTO
   ───────────────────────────────────────────────────────────── */
window.verFicha = function(id) {
  const a = buscarAlimento(id);
  if (!a) return;
  fichaAbierta = id;

  const e = estadoAlimento(id);
  const av = avisosEdad(a);

  document.getElementById('comidaModalTitulo').textContent =
    CATEGORIAS[a.cat].emoji + ' ' + a.nombre;

  let html = '';

  if (av.duro) {
    html += `<div class="aviso aviso-stop">
      <strong>⛔ ${esc(av.duro.etiqueta)}</strong><br>${esc(av.duro.motivo)}
      <div class="aviso-fuente">Fuente: ${esc(av.duro.fuente)}</div></div>`;
  } else if (av.suave) {
    html += `<div class="aviso aviso-suave">
      Se suele ofrecer a partir de los ${av.suave} meses. No es una prohibición,
      sólo lo habitual.</div>`;
  }

  if (a.atragantamiento) {
    html += `<div class="aviso aviso-ojo"><strong>Atragantamiento</strong><br>
      ${esc(a.atragantamiento)}</div>`;
  }

  if (a.blw && a.blw !== '—') {
    html += `<div class="field"><label>En trozos (BLW)</label>
      <p class="ficha-txt">${esc(a.blw)}</p></div>`;
  }
  if (a.cuchara && a.cuchara !== '—') {
    html += `<div class="field"><label>Con cuchara</label>
      <p class="ficha-txt">${esc(a.cuchara)}</p></div>`;
  }
  if (a.nota) {
    html += `<div class="field"><label>A tener en cuenta</label>
      <p class="ficha-txt">${esc(a.nota)}</p></div>`;
  }

  if (a.alergeno) {
    html += `<div class="field"><label>Alérgeno</label>
      <p class="ficha-txt">${esc(ALERGENOS[a.alergeno].nombre)}. Tras introducirlo
      se abre una ventana de ${DIAS_VENTANA_ALERGENO} días antes de probar otro
      alérgeno nuevo.</p></div>`;
  }

  if (e.veces) {
    html += `<div class="field"><label>Historial</label>
      <p class="ficha-txt">Ofrecido ${e.veces} ${e.veces === 1 ? 'vez' : 'veces'}.
      Última vez: ${esc(fmtFechaHora(new Date(e.ultima).toISOString()))}.
      ${e.estado === 'tolerado' ? ' Tolerado.' : ''}
      ${e.estado === 'reaccion' ? ' <strong style="color:var(--danger)">Hubo una reacción.</strong>' : ''}
      </p></div>`;
  }

  if (ajustes.plan.descartados.includes(id)) {
    html += `<p class="hint-txt">Está fuera de la cola.
      <button class="btn-mini" onclick="recuperar('${id}');cerrarComidaModal()">Recuperar</button></p>`;
  }

  if (a.mio) {
    html += `<div class="aviso aviso-suave">Este alimento lo añadisteis vosotros, así
      que no trae guía de cómo ofrecerlo ni aviso de atragantamiento.</div>`;
  }

  document.getElementById('comidaModalCuerpo').innerHTML = html;
  document.getElementById('comidaModalBtns').innerHTML = modoVer ? '' : `
    <button class="btn btn-primary" onclick="abrirRegistro('${id}')">Registrar que lo ha probado</button>
    ${a.mio ? `<button class="btn" style="background:var(--surface2);color:var(--text)"
                 onclick="nuevoAlimento('${id}')">Editar o borrar este alimento</button>` : ''}`;
  document.getElementById('comidaModal').style.display = '';
};

/* ─────────────────────────────────────────────────────────────
   REGISTRAR UNA TOMA
   ───────────────────────────────────────────────────────────── */
window.abrirRegistro = function(id) {
  const a = buscarAlimento(id);
  if (!a) return;
  fichaAbierta = id;

  const av = avisosEdad(a);
  const v  = ventanaAlergeno();

  document.getElementById('comidaModalTitulo').textContent = 'Registrar ' + a.nombre;

  let aviso = '';
  if (av.duro) {
    aviso = `<div class="aviso aviso-stop">
      <strong>⛔ ${esc(av.duro.etiqueta)}</strong><br>${esc(av.duro.motivo)}
      <div class="aviso-fuente">Fuente: ${esc(av.duro.fuente)}</div>
      <label class="check-inline" style="margin-top:10px">
        <input type="checkbox" id="confirmaRiesgo"> Lo registro igualmente
      </label></div>`;
  } else if (av.suave) {
    aviso = `<div class="aviso aviso-suave">Se suele ofrecer a partir de los
      ${av.suave} meses. Puedes registrarlo igual.</div>`;
  }

  if (v && a.alergeno && a.alergeno !== v.clave) {
    aviso += `<div class="aviso aviso-espera">Hay una ventana de ${esc(v.nombre)}
      abierta. Si introduces otro alérgeno ahora, no sabrás cuál ha sido si algo
      sienta mal.</div>`;
  }

  document.getElementById('comidaModalCuerpo').innerHTML = `
    ${aviso}
    <div class="field">
      <label>¿Cómo se lo habéis dado?</label>
      <div class="toggle-row" id="rowForma">
        <button type="button" class="toggle-opt sel" data-v="blw">En trozos</button>
        <button type="button" class="toggle-opt" data-v="cuchara">Cuchara</button>
        <button type="button" class="toggle-opt" data-v="ambas">Las dos</button>
      </div>
    </div>
    <div class="field">
      <label>¿Qué tal ha ido?</label>
      <div class="toggle-row" id="rowAcept" style="flex-wrap:wrap">
        <button type="button" class="toggle-opt sel" data-v="encanta">😋</button>
        <button type="button" class="toggle-opt" data-v="come">🙂</button>
        <button type="button" class="toggle-opt" data-v="prueba">😐</button>
        <button type="button" class="toggle-opt" data-v="rechaza">🙅</button>
      </div>
      <p class="hint-txt" style="margin:6px 0 0">Le encanta · come · lo prueba · lo rechaza</p>
    </div>
    <div class="field">
      <label for="comidaFecha">Fecha y hora</label>
      <input type="datetime-local" id="comidaFecha" value="${ahoraLocal()}">
    </div>
    <div class="field">
      <label for="comidaNota">Nota (opcional)</label>
      <input type="text" id="comidaNota" maxlength="200" placeholder="Cómo lo preparasteis…">
    </div>
    <p class="hint-txt" style="margin-bottom:0">
      Cómo le sienta se apunta después, no ahora: las reacciones tardías tardan
      horas en salir. Quedará en el diario esperando a que lo marques.
    </p>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" id="btnGuardarComida">Guardar</button>`;
  document.getElementById('btnGuardarComida')
          .addEventListener('click', () => guardarComida(id));

  document.getElementById('comidaModal').style.display = '';
};

async function guardarComida(id) {
  const a = buscarAlimento(id);

  // Si hay restricción de seguridad vigente hace falta confirmarlo
  const chk = document.getElementById('confirmaRiesgo');
  if (avisosEdad(a).duro && chk && !chk.checked) {
    toast('⚠️ Marca la casilla para registrarlo de todos modos.', 4000);
    return;
  }

  const fecha = leerFechaISO('comidaFecha');
  if (!fecha) { toast('⚠️ La fecha no es válida.'); return; }

  const nota = document.getElementById('comidaNota').value.trim();

  // `revisado: false` a propósito: cómo le ha sentado se marca luego,
  // desde el diario, cuando ya ha dado tiempo a que se vea.
  const fila = {
    alimento_id: id,
    nombre: a.nombre,
    fecha_hora: fecha,
    forma: valorSel('rowForma', 'blw'),
    aceptacion: valorSel('rowAcept', 'come'),
    reaccion: null,
    revisado: false,
    nota: nota || null
  };

  const btn = document.getElementById('btnGuardarComida');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const { error } = await sb.from('alim_registros').insert(fila);

  btn.disabled = false;
  btn.textContent = 'Guardar';

  if (error) {
    console.error(error);
    toast('❌ No se pudo guardar: ' + mensajeError(error), 5000);
    return;
  }

  toast('✅ Registrado · marca luego qué tal le sentó');
  cerrarComidaModal();
  await cargarComida();
}

/* ─────────────────────────────────────────────────────────────
   ALIMENTOS VUESTROS

   Formulario corto a propósito: nombre, categoría y alérgeno. El
   alérgeno es el único campo que de verdad importa, porque es lo
   que dispara la ventana de 3 días; lo demás es organización.
   ───────────────────────────────────────────────────────────── */
window.nuevoAlimento = function(idEditar) {
  const p = idEditar ? (ajustes.personalizados || []).find(x => x.id === idEditar) : null;
  const catSel = p ? p.cat : 'otros';
  const aleSel = p ? (p.alergeno || '') : '';

  document.getElementById('comidaModalTitulo').textContent =
    p ? 'Editar ' + p.nombre : '➕ Añadir alimento';

  const btnCat = Object.entries(CATEGORIAS).map(([k, c]) =>
    `<button type="button" class="color-btn${k === catSel ? ' sel' : ''}" data-v="${k}">
       <span>${c.emoji}</span><span>${esc(c.nombre)}</span></button>`).join('');

  const btnAle = ['<button type="button" class="color-btn' + (aleSel === '' ? ' sel' : '') + '" data-v="">'
                  + '<span>—</span><span>Ninguno</span></button>']
    .concat(Object.entries(ALERGENOS).map(([k, a]) =>
      `<button type="button" class="color-btn${k === aleSel ? ' sel' : ''}" data-v="${k}">
         <span>⚠</span><span>${esc(a.nombre)}</span></button>`)).join('');

  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label for="nuevoNombre">Nombre</label>
      <input type="text" id="nuevoNombre" maxlength="60" value="${p ? esc(p.nombre) : ''}"
             placeholder="Cuscús de la abuela, gazpacho…">
    </div>

    <div class="field">
      <label>Categoría</label>
      <div class="color-row" id="rowNuevaCat">${btnCat}</div>
    </div>

    <div class="field">
      <label>¿Es alérgeno?</label>
      <div class="color-row" id="rowNuevoAle">${btnAle}</div>
    </div>

    <div class="aviso aviso-suave">
      Los alimentos que añadís vosotros no llevan guía de cómo cortarlos ni aviso
      de atragantamiento: eso sólo lo tienen los 115 revisados. Si alguno os
      parece que la merece, decídmelo y lo subo al catálogo con su ficha.
    </div>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" id="btnGuardarAlimento">${p ? 'Guardar cambios' : 'Añadir'}</button>
    ${p ? `<button class="btn" style="background:var(--surface2);color:var(--danger)"
             onclick="borrarPersonalizado('${p.id}')">Borrar este alimento</button>` : ''}`;

  document.getElementById('btnGuardarAlimento')
          .addEventListener('click', () => guardarPersonalizado(idEditar));

  document.getElementById('comidaModal').style.display = '';
};

async function guardarPersonalizado(idEditar) {
  const nombre = document.getElementById('nuevoNombre').value.trim();
  if (!nombre) { toast('⚠️ Ponle un nombre.'); return; }

  const cat = valorSel('rowNuevaCat', 'otros');
  const ale = valorSel('rowNuevoAle', '') || null;

  // Avisar si ya existe algo que se llama igual, pero sin bloquear
  const choca = catalogo().find(a =>
    a.id !== idEditar && a.nombre.toLowerCase() === nombre.toLowerCase());
  if (choca && !confirm(`Ya existe "${choca.nombre}". ¿Lo añades igualmente?`)) return;

  const lista = (ajustes.personalizados || []).slice();
  if (idEditar) {
    const i = lista.findIndex(x => x.id === idEditar);
    if (i < 0) return;
    lista[i] = Object.assign({}, lista[i], { nombre, cat, alergeno: ale });
  } else {
    lista.push({ id: idPersonalizado(nombre), nombre, cat, alergeno: ale,
                 creado: new Date().toISOString() });
  }

  const btn = document.getElementById('btnGuardarAlimento');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const ok = await guardarAjuste('personalizados', { lista });

  btn.disabled = false;
  btn.textContent = idEditar ? 'Guardar cambios' : 'Añadir';
  if (!ok) return;

  ajustes.personalizados = lista;
  toast(idEditar ? '✅ Alimento actualizado' : '✅ Alimento añadido');
  cerrarComidaModal();
  await cargarComida();
}

window.borrarPersonalizado = async function(id) {
  const n = registrosDe(id).length;
  const msg = n
    ? `Tiene ${n} ${n === 1 ? 'toma registrada' : 'tomas registradas'}. Si lo borras, `
      + 'esas tomas se quedan en el diario pero ya no contarán en el catálogo. ¿Seguir?'
    : '¿Borrar este alimento?';
  if (!confirm(msg)) return;

  const lista = (ajustes.personalizados || []).filter(x => x.id !== id);
  if (!await guardarAjuste('personalizados', { lista })) return;

  ajustes.personalizados = lista;
  toast('🗑️ Alimento borrado');
  cerrarComidaModal();
  await cargarComida();
};

/* ─────────────────────────────────────────────────────────────
   REVISAR / EDITAR UNA TOMA YA REGISTRADA

   Aquí es donde se apunta cómo le sentó. Se hace a posteriori
   porque las reacciones tardías (digestivas, eczema) aparecen
   horas después de la toma, no en el momento.
   ───────────────────────────────────────────────────────────── */
function comidaPorId(id) { return comidas.find(c => c.id === id) || null; }

window.editarComida = function(id) {
  const c = comidaPorId(id);
  if (!c) return;

  const tieneReaccion = !!c.reaccion;
  const sint = tieneReaccion ? (c.reaccion.sintoma || 'otra') : 'piel';

  document.getElementById('comidaModalTitulo').textContent = 'Qué tal fue: ' + c.nombre;

  const opt = (fila, v, txt, sel) =>
    `<button type="button" class="toggle-opt${sel ? ' sel' : ''}" data-v="${v}">${txt}</button>`;

  document.getElementById('comidaModalCuerpo').innerHTML = `
    <p class="hint-txt" style="margin-top:0">
      ${esc(fmtFechaHora(c.fecha_hora))}
    </p>

    <div class="field">
      <label>¿Le sentó bien?</label>
      <div class="toggle-row" id="rowReaccion">
        ${opt('rowReaccion', 'no', 'Todo bien', !tieneReaccion)}
        ${opt('rowReaccion', 'si', 'Hubo reacción', tieneReaccion)}
      </div>
    </div>

    <div id="detalleReaccion" style="display:${tieneReaccion ? '' : 'none'}">
      <div class="field">
        <label>¿Qué le pasó?</label>
        <div class="toggle-row" id="rowSintoma" style="flex-wrap:wrap">
          ${opt('rowSintoma', 'piel', 'Piel', sint === 'piel')}
          ${opt('rowSintoma', 'digestiva', 'Digestiva', sint === 'digestiva')}
          ${opt('rowSintoma', 'respiratoria', 'Respiratoria', sint === 'respiratoria')}
          ${opt('rowSintoma', 'otra', 'Otra', sint === 'otra')}
        </div>
      </div>
      <div class="field">
        <label for="reaccionNota">Descríbelo</label>
        <input type="text" id="reaccionNota" maxlength="200"
               value="${tieneReaccion ? esc(c.reaccion.nota || '') : ''}"
               placeholder="Ronchas alrededor de la boca, vómito…">
      </div>
      <div class="aviso aviso-stop">
        Si le cuesta respirar, se le hincha la cara o la lengua, o lo ves decaído:
        <strong>112</strong>. Esto es un registro, no un sustituto de la pediatra.
      </div>
    </div>

    <div class="field">
      <label>¿Qué tal comió?</label>
      <div class="toggle-row" id="rowAcept" style="flex-wrap:wrap">
        ${opt('rowAcept', 'encanta', '😋', c.aceptacion === 'encanta')}
        ${opt('rowAcept', 'come', '🙂', c.aceptacion === 'come')}
        ${opt('rowAcept', 'prueba', '😐', c.aceptacion === 'prueba')}
        ${opt('rowAcept', 'rechaza', '🙅', c.aceptacion === 'rechaza')}
      </div>
      <p class="hint-txt" style="margin:6px 0 0">Le encanta · come · lo prueba · lo rechaza</p>
    </div>

    <div class="field">
      <label>¿Cómo se lo disteis?</label>
      <div class="toggle-row" id="rowForma">
        ${opt('rowForma', 'blw', 'En trozos', c.forma === 'blw')}
        ${opt('rowForma', 'cuchara', 'Cuchara', c.forma === 'cuchara')}
        ${opt('rowForma', 'ambas', 'Las dos', c.forma === 'ambas')}
      </div>
    </div>

    <div class="field">
      <label for="comidaFecha">Fecha y hora</label>
      <input type="datetime-local" id="comidaFecha" value="${toLocalDT(c.fecha_hora)}">
    </div>

    <div class="field">
      <label for="comidaNota">Nota (opcional)</label>
      <input type="text" id="comidaNota" maxlength="200" value="${esc(c.nota || '')}">
    </div>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" id="btnGuardarRevision">Guardar</button>`;
  document.getElementById('btnGuardarRevision')
          .addEventListener('click', () => guardarRevision(id));

  // El detalle sólo si hay reacción
  document.getElementById('rowReaccion').addEventListener('click', e => {
    if (!e.target.closest('.toggle-opt')) return;
    setTimeout(() => {
      document.getElementById('detalleReaccion').style.display =
        valorSel('rowReaccion') === 'si' ? '' : 'none';
    }, 0);
  });

  document.getElementById('comidaModal').style.display = '';
};

async function guardarRevision(id) {
  const fecha = leerFechaISO('comidaFecha');
  if (!fecha) { toast('⚠️ La fecha no es válida.'); return; }

  const hay = valorSel('rowReaccion') === 'si';
  const nota = document.getElementById('comidaNota').value.trim();

  const cambios = {
    fecha_hora: fecha,
    forma: valorSel('rowForma', 'blw'),
    aceptacion: valorSel('rowAcept', 'come'),
    reaccion: hay ? {
      sintoma: valorSel('rowSintoma', 'otra'),
      nota: document.getElementById('reaccionNota').value.trim()
    } : null,
    revisado: true,
    nota: nota || null
  };

  const btn = document.getElementById('btnGuardarRevision');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  // .select() para detectar que RLS no haya bloqueado el UPDATE en silencio
  const { data, error } = await sb.from('alim_registros')
    .update(cambios).eq('id', id).select();

  btn.disabled = false;
  btn.textContent = 'Guardar';

  if (error) {
    console.error(error);
    toast('❌ No se pudo guardar: ' + mensajeError(error), 5000);
    return;
  }
  if (!data || !data.length) {
    toast('⚠️ No se modificó nada. ¿Has iniciado sesión?', 5000);
    return;
  }

  toast(hay ? '⚠️ Anotada la reacción' : '✅ Todo bien, anotado');
  cerrarComidaModal();
  await cargarComida();
}

/* Tomas registradas a las que todavía no se ha mirado cómo sentaron */
function pendientesDeRevisar() {
  return comidas.filter(c => !c.revisado)
                .sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora));
}

window.cerrarComidaModal = function() {
  document.getElementById('comidaModal').style.display = 'none';
  fichaAbierta = null;
};

/* ─────────────────────────────────────────────────────────────
   RESUMEN PARA LA PEDIATRA
   ───────────────────────────────────────────────────────────── */
window.copiarResumen = async function() {
  const probados = catalogo()
    .map(a => ({ a, e: estadoAlimento(a.id) }))
    .filter(x => x.e.veces > 0)
    .sort((x, y) => x.e.primera - y.e.primera);

  const f = t => new Date(t).toLocaleDateString('es-ES');
  let txt = 'ALIMENTACIÓN COMPLEMENTARIA — Álex\n';
  txt += 'Inicio: ' + (ajustes.inicio ? f(new Date(ajustes.inicio)) : '—') + '\n';
  txt += 'Edad actual: ' + mesesAlex().toFixed(1) + ' meses\n\n';

  txt += 'ALIMENTOS INTRODUCIDOS (' + probados.length + ')\n';
  probados.forEach(x => {
    txt += '· ' + x.a.nombre + ' — desde ' + f(x.e.primera)
         + ', ' + x.e.veces + (x.e.veces === 1 ? ' vez' : ' veces')
         + (x.e.estado === 'reaccion' ? ' — REACCIÓN' : '') + '\n';
  });

  const conR = probados.filter(x => x.e.reaccion);
  if (conR.length) {
    txt += '\nREACCIONES\n';
    conR.forEach(x => {
      txt += '· ' + x.a.nombre + ': ' + (x.e.reaccion.sintoma || '')
           + (x.e.reaccion.nota ? ' — ' + x.e.reaccion.nota : '') + '\n';
    });
  }

  txt += '\nALÉRGENOS\n';
  Object.values(estadoAlergenos()).forEach(e => {
    txt += '· ' + e.nombre + ': '
         + (!e.introducido ? 'sin introducir'
            : e.conReaccion ? 'con reacción'
            : 'tolerado desde ' + f(e.primera)) + '\n';
  });

  try {
    await navigator.clipboard.writeText(txt);
    toast('📋 Copiado al portapapeles');
  } catch {
    // En file:// o sin permiso el portapapeles falla: se muestra para copiar a mano
    document.getElementById('comidaModalTitulo').textContent = 'Resumen para la pediatra';
    document.getElementById('comidaModalCuerpo').innerHTML =
      `<textarea rows="16" readonly style="font-size:.8rem">${esc(txt)}</textarea>`;
    document.getElementById('comidaModalBtns').innerHTML = '';
    document.getElementById('comidaModal').style.display = '';
  }
};

/* ─────────────────────────────────────────────────────────────
   ARRANQUE
   ───────────────────────────────────────────────────────────── */
function iniciarComida() {
  if (modoVer) return;          // la pestaña no existe en el enlace público
  cargarComida();
  configurarRealtimeComida();

  document.getElementById('comidaModal').addEventListener('click', e => {
    if (e.target.id === 'comidaModal') cerrarComidaModal();
  });
}
