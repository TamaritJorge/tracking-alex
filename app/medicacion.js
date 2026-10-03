/* ═════════════════════════════════════════════════════════════
   MEDICACIÓN

   Con dos padres turnándose, la pregunta no es «¿se la hemos
   dado?» sino «¿se la has dado TÚ?». Las dos formas de fallar
   —darla dos veces y no darla ninguna— salen del mismo sitio:
   la información vive en dos cabezas distintas.

   Esto es un tablón compartido, NO un despertador. Mientras no
   haya notificaciones, el aviso sólo existe con la app abierta,
   y la pantalla lo dice en voz alta en vez de dejar que se
   suponga lo contrario.

   Se apoya en:
     · familia.js  → ninoActivo
     · app.js      → sb, esc(), toast(), switchTab()
     · modulos.js  → moduloActivo()
     · idiomas.js  → t(), fechaHora(), localeActivo()

   Tiene sus propias tablas (med_pautas, med_tomas) y su propio
   canal de realtime: no toca nada de cargarDatos().

   ── LO QUE NO ESTÁ AQUÍ ──
   Qué toma toca NO se calcula en este fichero. Lo decide la
   función med_pendientes() de la base de datos, que es la única
   definición que hay. Cuando lleguen las notificaciones push, el
   cron llamará exactamente a esa misma función. Si la lógica
   estuviera escrita dos veces —una aquí y otra en SQL— acabarían
   desincronizándose, y una desincronización aquí es una dosis
   olvidada. Este fichero sólo decide de qué COLOR se pinta lo
   que el servidor le dice que está pendiente.
   ═════════════════════════════════════════════════════════════ */

/* Umbrales del aviso. Están aquí arriba para que cambiarlos sea
   una línea y no una cacería. */
const AMBAR_MIN    = 30;    // «toca ahora»: los primeros 30 min
const ROJO_MIN      = 150;  // 30 + 120 → dos horas de rojo
const GRIS_MIN     = 720;   // 12 h: deja de gritar, no deja de estar

/* Cuánto sigue una toma YA MARCADA en «Ahora mismo».

   Antes era el día natural —hoy y ayer— y fallaba por los dos lados: la
   toma de ayer a las 10:00 seguía ahí 38 horas después, y la de ayer a
   las 23:00 desaparecía de golpe al dar las doce, que es justo cuando
   podrías dudar de si se dio.

   12 h no es un número nuevo: es la misma ventana hacia atrás que usa
   med_pendientes() (interval '-12 hours'), así que lo hecho y lo
   pendiente se miran exactamente igual de lejos.

   Lo que de verdad evita la doble dosis no es esta lista, es
   avisarYaMarcada(): saltaría igual aunque aquí no se viera nada. Esto
   sólo sirve para responder de un vistazo a «¿se la han dado ya?», y
   para eso 12 horas sobran. El resto está en el historial de abajo. */
const AHORA_MIN    = 720;

const POSPONER_MIN = 30;
const POSPONER_MAX = 2;     // a la tercera ya no se pospone

const CLAVE_POSPUESTOS = 'med.pospuestos';

let medPautas     = [];
let medTomas      = [];
let medPendientes = [];     // lo que ha dicho med_pendientes()
let canalRTMed    = null;
let medReloj      = null;
let medFoco       = null;   // ranura a destacar al llegar desde el banner
let medForm       = null;   // estado del formulario de alta mientras está abierto

/* ─────────────────────────────────────────────────────────────
   FECHAS

   fechaLocalISO NO es toISOString().slice(0,10). Esa devuelve la
   fecha UTC, que en España entre las 00:00 y las 02:00 es la de
   ayer — justo la franja donde caen las tomas de madrugada.
   ───────────────────────────────────────────────────────────── */
function fechaLocalISO(d, zona) {
  const opc = zona ? { timeZone: zona } : {};
  return new Intl.DateTimeFormat('sv-SE', opc).format(d || new Date());
}

function hoyISO()  { return fechaLocalISO(new Date()); }
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fechaLocalISO(d);
}

/* «hace 1 h 20» / «en 25 min» */
function desdeHace(min) {
  const m = Math.abs(Math.round(min));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? h + ' h ' + r : h + ' h';
}

function claveSlot(p) {
  return p.pauta_id + '|' + p.fecha_slot + '|' + p.hora_slot;
}

/* ─────────────────────────────────────────────────────────────
   EL COLOR DEL AVISO
   ───────────────────────────────────────────────────────────── */
function estadoSlot(momentoISO) {
  const min = (Date.now() - new Date(momentoISO)) / 60000;
  if (min < 0)          return 'futuro';
  if (min < AMBAR_MIN)  return 'toca';
  if (min < ROJO_MIN)   return 'tarde';
  if (min < GRIS_MIN)   return 'pasada';
  return 'vieja';       // ya no tiene sentido darla: deja de avisarse
}

const CLASE_AVISO = {
  toca:   'aviso aviso-ojo',
  tarde:  'aviso aviso-stop',
  pasada: 'aviso aviso-suave'
};

/* ─────────────────────────────────────────────────────────────
   POSPONER

   Vive en localStorage, NO en la base de datos, y es a propósito.
   Posponer es un acto personal: «ahora no, lo tengo en brazos».
   Si se guardara en la base, callaría también el banner de tu
   pareja, que es exactamente lo contrario de lo que este módulo
   existe para evitar.

   El límite de dos existe porque sin notificaciones posponer no
   pospone: si pospones, cierras la app y no vuelves a abrirla,
   nadie te avisa jamás. A la tercera hay que decidir.
   ───────────────────────────────────────────────────────────── */
function leerPospuestos() {
  try { return JSON.parse(localStorage.getItem(CLAVE_POSPUESTOS) || '{}'); }
  catch (e) { return {}; }
}

function guardarPospuestos(o) {
  try { localStorage.setItem(CLAVE_POSPUESTOS, JSON.stringify(o)); } catch (e) {}
}

/* Las ranuras de anteayer ya no vuelven: si no se limpian, esto
   acumula un año de entradas muertas. */
function limpiarPospuestos() {
  const corte = diasAtras(2);
  const o = leerPospuestos();
  let tocado = false;
  Object.keys(o).forEach(k => {
    const fecha = k.split('|')[1];
    if (fecha && fecha < corte) { delete o[k]; tocado = true; }
  });
  if (tocado) guardarPospuestos(o);
}

function pospuesto(p) {
  const e = leerPospuestos()[claveSlot(p)];
  return !!(e && e.hasta > Date.now());
}

function vecesPospuesto(p) {
  const e = leerPospuestos()[claveSlot(p)];
  return e ? (e.veces || 0) : 0;
}

window.posponerSlot = function(clave) {
  const o = leerPospuestos();
  const e = o[clave] || { veces: 0 };
  e.veces = (e.veces || 0) + 1;
  e.hasta = Date.now() + POSPONER_MIN * 60000;
  o[clave] = e;
  guardarPospuestos(o);
  pintarBannerMed();
  // «Sigue sin darse» a proposito: el boton de al lado es el de marcarla,
  // y confundirlos es confundir «luego» con «ya esta hecho».
  toast(t2('med.pospuesto', '⏾ Sigue sin darse. Te lo recuerdo en {n} min.',
           { n: POSPONER_MIN }), 4000);
};

/* ─────────────────────────────────────────────────────────────
   CARGA
   ───────────────────────────────────────────────────────────── */
async function cargarMedicacion() {
  if (!ninoActivo) { medPautas = []; medTomas = []; medPendientes = []; return; }

  const [pa, to, pe] = await Promise.all([
    sb.from('med_pautas').select('*')
      .eq('nino_id', ninoActivo.id).order('creada_en', { ascending: false }),
    sb.from('med_tomas').select('*')
      .eq('nino_id', ninoActivo.id).gte('fecha_slot', diasAtras(30))
      .order('fecha_slot', { ascending: false }).order('hora_slot', { ascending: false }),
    sb.rpc('med_pendientes', { p_nino: ninoActivo.id })
  ]);

  const err = pa.error || to.error || pe.error;
  const cont = document.getElementById('medError');
  if (cont) {
    cont.style.display = err ? '' : 'none';
    if (err) cont.textContent = '⚠️ ' + (err.message || 'No se pudo cargar la medicación.');
  }
  if (err) console.error('medicación:', err);

  medPautas     = pa.data || [];
  medTomas      = to.data || [];
  medPendientes = pe.data || [];

  limpiarPospuestos();
  renderMedicacion();
  pintarBannerMed();
}

/* Sólo las pendientes: es lo único que cambia solo con el reloj y
   lo que hay que refrescar al volver a la app. */
async function refrescarPendientes() {
  if (!ninoActivo || !moduloActivo('medicacion')) return;
  const { data, error } = await sb.rpc('med_pendientes', { p_nino: ninoActivo.id });
  if (error) { console.error(error); return; }
  medPendientes = data || [];
  pintarBannerMed();
  if (tabActual === 'medicacion') renderMedicacion();
}

function configurarRealtimeMed() {
  if (canalRTMed) return;
  if (!ninoActivo) return;
  const f = 'nino_id=eq.' + ninoActivo.id;
  canalRTMed = sb.channel('medicacion-' + ninoActivo.id)
    .on('postgres_changes', { event:'*', schema:'public', table:'med_tomas',  filter:f }, () => cargarMedicacion())
    .on('postgres_changes', { event:'*', schema:'public', table:'med_pautas', filter:f }, () => cargarMedicacion())
    .subscribe();
}

/* El reloj del aviso. Un minuto, no cinco: la franja ámbar dura
   treinta y con cinco minutos de grano se notaría el salto.

   Se recalcula SIEMPRE desde Date.now(), nunca acumulando, porque
   iOS congela los temporizadores en segundo plano y al volver
   pueden haber pasado horas. Por eso también se refresca al
   volver a primer plano. */
function arrancarRelojMed() {
  if (medReloj) return;
  medReloj = setInterval(() => {
    if (!moduloActivo('medicacion')) return;
    pintarBannerMed();
    if (tabActual === 'medicacion') renderMedicacion();
  }, 60000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refrescarPendientes();
});

function iniciarMedicacion() {
  cargarMedicacion();
  configurarRealtimeMed();
  arrancarRelojMed();
  if (typeof iniciarPush === 'function') iniciarPush();
}

/* ─────────────────────────────────────────────────────────────
   EL BANNER
   ───────────────────────────────────────────────────────────── */
/* El orden es por GRAVEDAD, no por antigüedad.

   Ordenar por hora dejaba arriba la toma de las 08:00 —gris, hace
   siete horas, ya casi sin remedio— y escondía detrás la que toca
   ahora mismo. El banner enseña una sola, así que tiene que ser la
   que más urge: primero la que va tarde (roja), luego la que toca
   (ámbar) y al final la que ya se pasó (gris). Dentro de cada
   grupo, la más antigua. */
const URGENCIA = { tarde: 0, toca: 1, pasada: 2 };

function pendientesVivas() {
  return medPendientes
    .map(p => Object.assign({}, p, { est: estadoSlot(p.momento) }))
    .filter(p => CLASE_AVISO[p.est])          // toca, tarde o pasada
    .sort((a, b) => (URGENCIA[a.est] - URGENCIA[b.est])
                 || (new Date(a.momento) - new Date(b.momento)));
}

function pintarBannerMed() {
  const el = document.getElementById('avisoMed');
  if (!el) return;

  if (!moduloActivo('medicacion')) { el.style.display = 'none'; return; }

  const vivas = pendientesVivas().filter(p => !pospuesto(p));
  if (!vivas.length) { el.style.display = 'none'; return; }

  const p     = vivas[0];
  const clave = claveSlot(p);
  const min   = (Date.now() - new Date(p.momento)) / 60000;

  const cuando = p.est === 'toca'
    ? t('med.ahora', 'toca ahora')
    : t('med.hace', 'hace') + ' ' + desdeHace(min);

  // Si hay más de una pendiente se dice, pero el banner sigue
  // hablando de UNA sola: un aviso que enumera no se lee.
  const otras = vivas.length - 1;
  const cola  = otras > 0
    ? ` <span class="med-otras">+${otras} ${plural(otras, 'más', 'más', 'mas')}</span>` : '';

  const puedePosponer = vecesPospuesto(p) < POSPONER_MAX;

  el.className = CLASE_AVISO[p.est];
  el.style.display = '';
  el.innerHTML = `
    <div class="med-banner">
      <span class="med-banner-txt" onclick="irAMedicacion('${clave}')">
        💊 <strong>${esc(p.nombre)}</strong>${p.dosis ? ' · ' + esc(p.dosis) : ''}
        · ${esc(p.hora_slot)} ${esc(cuando)}${cola}
      </span>
      <span class="med-banner-btns">
        <button class="btn-mini btn-mini-pri" onclick="irAMedicacion('${clave}')"
                >${esc(t('med.verla', 'Ver'))}</button>
        ${puedePosponer ? `<button class="btn-mini" onclick="posponerSlot('${clave}')"
                >${esc(t2('med.posponer', 'Posponer {n} min', { n: POSPONER_MIN }))}</button>` : ''}
      </span>
    </div>`;
}

window.irAMedicacion = function(clave) {
  medFoco = clave;
  switchTab('medicacion');
  renderMedicacion();
};

/* ─────────────────────────────────────────────────────────────
   MARCAR UNA TOMA

   Tres cosas pasan antes de escribir, y las tres evitan una dosis
   de más:

     1. Se relee la ranura. El realtime se cae en el metro, y
        entonces un móvil enseña rojo para una toma ya dada.
        Avisar ANTES de que el medicamento salga del bote es mejor
        que explicarlo después.
     2. Barrera de proximidad: si la anterior está demasiado
        reciente, se enseña el dato y se pregunta.
     3. Y si aun así chocan dos móviles, el índice único de la
        base de datos corta — pero el mensaje NO es tranquilizador:
        si los dos han pulsado, probablemente los dos se la han
        dado.
   ───────────────────────────────────────────────────────────── */

/* Hueco más corto entre dos horas seguidas de la pauta, en minutos.
   Para ['08:00','16:00','00:00'] son 480. */
function intervaloPauta(horas) {
  if (!horas || horas.length < 2) return 24 * 60;
  const m = horas.map(h => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3), 10))
                 .sort((a, b) => a - b);
  let min = 24 * 60 - (m[m.length - 1] - m[0]);     // la vuelta por medianoche
  for (let i = 1; i < m.length; i++) min = Math.min(min, m[i] - m[i - 1]);
  return min;
}

function ultimaDada(pautaId) {
  return medTomas
    .filter(x => x.pauta_id === pautaId && x.estado === 'dada')
    .sort((a, b) => new Date(b.dada_en) - new Date(a.dada_en))[0] || null;
}

window.marcarToma = async function(clave, estado) {
  const [pautaId, fecha, hora] = clave.split('|');
  const pauta = medPautas.find(x => x.id === pautaId);
  if (!pauta) return;

  // 1. ¿Se nos ha adelantado alguien?
  const { data: ya, error: errLee } = await sb.from('med_tomas')
    .select('*').eq('pauta_id', pautaId).eq('fecha_slot', fecha)
    .eq('hora_slot', hora).neq('estado', 'anulada').maybeSingle();

  if (errLee) { toast('⚠️ ' + (errLee.message || 'No se pudo comprobar la toma'), 4500); return; }

  if (ya) {
    avisarYaMarcada(ya, pauta);
    await cargarMedicacion();
    return;
  }

  // 2. Barrera de proximidad (sólo al dar, no al saltar)
  if (estado === 'dada') {
    const ult = ultimaDada(pautaId);
    if (ult) {
      const minDesde = (Date.now() - new Date(ult.dada_en)) / 60000;
      const intervalo = intervaloPauta(pauta.horas);
      if (minDesde < intervalo / 2) {
        const ok = confirm('⚠️ ' + pauta.nombre + '\n\n'
          + t2('med.muySeguida',
              'La anterior fue hace {a}, y entre tomas deberían pasar {b}.',
              { a: desdeHace(minDesde), b: desdeHace(intervalo) })
          + '\n\n' + t('med.otraMas', '¿Seguro que toca otra?'));
        if (!ok) return;
      }
    }
  }

  if (estado === 'saltada') {
    const ok = confirm(
      pauta.nombre + ' · ' + hora + '\n\n' +
      t('med.noDadaAviso', 'Vas a dejar constancia de que esta toma NO se ha dado.') + '\n' +
      t('med.noDadaAviso2', 'El aviso desaparecerá también del móvil de tu pareja.')
      + '\n\n' + t('med.seguir', '¿Seguir?'));
    if (!ok) return;
  }

  // 3. Escribir
  const { error } = await sb.from('med_tomas').insert({
    pauta_id:   pautaId,
    nino_id:    ninoActivo.id,
    fecha_slot: fecha,
    hora_slot:  hora,
    dada_en:    new Date().toISOString(),
    estado:     estado
  });

  if (error) {
    if (error.code === '23505') {
      // Carrera perdida por milésimas. Esto NO es un final feliz.
      const { data: otra } = await sb.from('med_tomas')
        .select('*').eq('pauta_id', pautaId).eq('fecha_slot', fecha)
        .eq('hora_slot', hora).neq('estado', 'anulada').maybeSingle();
      if (otra) avisarYaMarcada(otra, pauta, true);
      await cargarMedicacion();
      return;
    }
    toast(t('med.noGuardado', '❌ No se pudo guardar: ')
          + (error.message || t('reg.errorRaro', 'error desconocido')), 4500);
    return;
  }

  toast(estado === 'dada'
    ? '✅ ' + pauta.nombre + ' · ' + hora
    : t2('med.anotadoNo', '📝 Anotado: no se dio la de las {h}', { h: hora }));
  await cargarMedicacion();
};

/* El mensaje cambia según lo reciente que sea. Si tu pareja la
   marcó hace un minuto y tú ibas a marcarla ahora, lo más probable
   es que los dos se la hayáis dado: eso hay que decirlo, no
   taparlo con un «ya estaba hecho». */
function avisarYaMarcada(toma, pauta, carrera) {
  const quien = quienMarco(toma);
  const minDesde = (Date.now() - new Date(toma.dada_en)) / 60000;

  if (toma.estado === 'dada' && (carrera || minDesde < 10)) {
    alert('⚠️ ' + pauta.nombre + '\n\n'
      + t2('med.laMarco', 'La marcó {q} hace {t}.',
           { q: quien, t: desdeHace(minDesde) })
      + '\n\n' + t('med.dobleDosis',
          'Si se la acabas de dar tú también, ha habido doble dosis: '
          + 'comprobadlo antes de volver a darla.'));
    return;
  }
  toast(toma.estado === 'dada'
    ? t2('med.yaMarcada', '👌 Ya la había marcado {q} ({f})',
         { q: quien, f: fechaHora(toma.dada_en) })
    : t('med.yaNoDada', '👌 Ya estaba anotada como no dada'));
}

/* «Tú» o «tu pareja», y no un nombre: familia_miembros guarda
   identificadores y rol, ningún nombre, y el cliente no puede
   leer auth.users — ni debe. Decir «tu pareja» es lo único
   honesto que se puede decir hoy. */
function quienMarco(toma) {
  return toma.por === usuarioId ? t('med.tu', 'tú') : t('med.pareja', 'tu pareja');
}

/* Anular en vez de borrar: borrar la fila liberaría la ranura sin
   dejar rastro, que es justo cómo una dosis desaparece en
   silencio. Anulada libera la ranura y se queda escrita. */
window.anularToma = async function(id) {
  const toma = medTomas.find(x => x.id === id);
  if (!toma) return;
  if (!confirm(t('med.deshacerQ', '¿Deshacer esta toma?\n\nQueda anotada como anulada y el aviso volverá a aparecer.'))) return;

  const { data, error } = await sb.from('med_tomas')
    .update({ estado: 'anulada' }).eq('id', id).select();

  if (error) { toast('❌ ' + (error.message || 'No se pudo deshacer'), 4500); return; }
  if (!data || !data.length) {
    toast(t('med.rlsTomas', '⚠️ No se modificó nada. Revisa la policy de UPDATE de med_tomas.'), 6000); return;
  }
  toast('↩️ Deshecha');
  await cargarMedicacion();
};

/* ─────────────────────────────────────────────────────────────
   LA PESTAÑA
   ───────────────────────────────────────────────────────────── */
function pautaActiva(p) {
  return !p.hasta || p.hasta >= hoyISO();
}

function nombreHoras(horas) {
  return horas.join(' · ');
}

/* Cuándo vale una pauta, dicho de forma que no parezca un duplicado.

   Cambiar las horas de un tratamiento en marcha cierra el viejo y abre uno
   nuevo (ver cambiarHorasPauta). Sin esta etiqueta, durante un día se veían
   dos «Vitamina D» idénticas y parecía un error de la aplicación. Con ella
   se ve lo que de verdad pasa: uno termina hoy y el otro empieza mañana. */
function vigencia(p) {
  const hoy = hoyISO(), man = diasAtras(-1);
  if (p.desde > hoy) {
    return p.desde === man ? t('med.empiezaManana', 'empieza mañana')
                           : t('med.empiezaEl', 'empieza el') + ' ' + fechaCorta(p.desde + 'T12:00');
  }
  if (!p.hasta) return t('med.sinfin', 'sin fecha de fin');
  if (p.hasta === hoy) return t('med.terminaHoy', 'termina hoy');
  if (p.hasta <  hoy)  return t('med.termino', 'terminó el') + ' ' + fechaCorta(p.hasta + 'T12:00');
  return t('med.hasta', 'hasta el') + ' ' + fechaCorta(p.hasta + 'T12:00');
}

/* Una pauta sin ninguna toma apuntada no tiene historia que romper: se
   puede cambiar entera en el sitio, sin duplicar nada. Es además el caso
   que de verdad ocurre —acabas de crearla y te has equivocado—. */
function tieneTomas(pautaId) {
  return medTomas.some(x => x.pauta_id === pautaId && x.estado !== 'anulada');
}

function renderMedicacion() {
  const panel = document.getElementById('tab-medicacion');
  if (!panel) return;

  const cont = document.getElementById('medCuerpo');
  if (!cont) return;

  if (!medPautas.length) {
    cont.innerHTML = `
      <div class="card">
        <p class="card-title">💊 ${esc(t('med.titulo', 'Medicinas'))}</p>
        <p class="card-sub">${esc(t('med.vacio.sub', 'Todavía no hay ningún tratamiento'))}</p>
        <p class="hint-txt" style="margin-bottom:16px">
          ${esc(t('med.vacio.txt', 'Apunta lo que os haya pautado el pediatra y a qué horas. Cuando uno de los dos marque una toma, el aviso desaparece del móvil del otro.'))}
        </p>
        <button class="btn btn-primary" onclick="abrirAltaPauta()"
          >${esc(t('med.anadir', 'Añadir medicamento'))}</button>
      </div>
      ${typeof htmlPush === 'function' ? htmlPush() : ''}
      ${piePrudencia()}`;
    return;
  }

  cont.innerHTML = htmlAhora() + htmlTratamientos()
                 + (typeof htmlPush === 'function' ? htmlPush() : '')
                 + htmlHistorialMed()
                 + piePrudencia();
  medFoco = null;
}

/* Lo de ahora: pendientes y ya marcadas, en orden de hora, todo
   junto. Las pendientes salen de med_pendientes(); las marcadas,
   de las tomas. Aquí no se calcula ninguna ranura. */
function htmlAhora() {
  const desde = Date.now() - AHORA_MIN * 60000;

  const filas = [];

  pendientesVivas().concat(
    medPendientes.map(p => Object.assign({}, p, { est: estadoSlot(p.momento) }))
                 .filter(p => p.est === 'futuro')
  ).forEach(p => {
    if (!filas.some(f => f.clave === claveSlot(p))) filas.push(filaPendiente(p));
  });

  // La ranura, no el momento en que se marcó: una toma de las 23:00 que
  // se apuntó a las 02:00 sigue siendo la de las 23:00, y es por su hora
  // prevista por la que se pregunta.
  medTomas.filter(x => x.estado !== 'anulada'
                    && new Date(x.fecha_slot + 'T' + x.hora_slot) >= desde)
          .forEach(x => filas.push(filaHecha(x)));

  if (!filas.length) {
    return `<div class="card">
      <p class="card-title">💊 ${esc(t('med.hoy', 'Ahora mismo'))}</p>
      <p class="hint-txt" style="margin:0">${esc(t('med.nada', 'No toca ninguna toma ahora mismo.'))}</p>
    </div>`;
  }

  // En la lista sí manda el reloj, y hacia abajo: un horario de
  // medicación se lee como se vive el día, de la mañana a la noche.
  filas.sort((a, b) => (a.orden > b.orden ? 1 : a.orden < b.orden ? -1 : 0));

  return `<div class="card card-no-pad">
    <p class="card-title" style="padding:18px 18px 0">💊 ${esc(t('med.hoy', 'Ahora mismo'))}</p>
    <div style="padding:10px 0 2px">${filas.map(f => f.html).join('')}</div>
  </div>`;
}

function etiquetaDia(fecha) {
  if (fecha === hoyISO())    return '';
  if (fecha === diasAtras(1)) return t('med.ayer', 'ayer') + ' · ';
  return fechaCorta(fecha + 'T12:00', { day: 'numeric', month: 'short' }) + ' · ';
}

function filaPendiente(p) {
  const clave = claveSlot(p);
  const min   = (Date.now() - new Date(p.momento)) / 60000;
  const foco  = medFoco === clave ? ' med-foco' : '';

  let sello, clase;
  if (p.est === 'futuro')      { sello = t('med.luego', 'más tarde'); clase = 'med-pt-futuro'; }
  else if (p.est === 'toca')   { sello = t('med.ahora', 'toca ahora'); clase = 'med-pt-toca'; }
  else if (p.est === 'tarde')  { sello = t('med.hace', 'hace') + ' ' + desdeHace(min); clase = 'med-pt-tarde'; }
  else                         { sello = t('med.hace', 'hace') + ' ' + desdeHace(min); clase = 'med-pt-pasada'; }

  const pos = pospuesto(p)
    ? `<span class="med-pos">${esc(t('med.pospuesta', 'pospuesta'))}</span>` : '';

  // med-pend sólo en las que piden acción: son las que llevan el botón
  // ancho y las únicas que necesitan partirse en dos líneas en un móvil
  // estrecho. Las ya resueltas llevan un ✕ pequeño y caben de sobra.
  return { clave, orden: p.fecha_slot + p.hora_slot, html: `
    <div class="med-fila med-pend${foco}">
      <div class="med-cuando ${clase}">${esc(etiquetaDia(p.fecha_slot))}${esc(p.hora_slot)}</div>
      <div class="med-info">
        <div class="med-nom">${esc(p.nombre)}${p.dosis ? ' <span class="med-dosis">' + esc(p.dosis) + '</span>' : ''}</div>
        <div class="med-sello ${clase}">${esc(sello)} ${pos}</div>
      </div>
      <div class="med-acciones">
        <button class="btn-mini btn-mini-pri" onclick="marcarToma('${clave}','dada')"
          >${esc(t('med.dada', 'Ya se la he dado'))}</button>
        <button class="btn-mini" onclick="marcarToma('${clave}','saltada')"
          title="${esc(t('med.saltar', 'Dejar constancia de que no se ha dado'))}">✕</button>
      </div>
    </div>` };
}

function filaHecha(x) {
  const pauta = medPautas.find(p => p.id === x.pauta_id);
  const quien = quienMarco(x);
  const desfase = Math.round(
    (new Date(x.dada_en) - new Date(x.fecha_slot + 'T' + x.hora_slot)) / 60000);

  const detalle = x.estado === 'dada'
    ? t('med.dadaA', 'dada a las') + ' ' +
      new Date(x.dada_en).toLocaleTimeString(localeActivo(), { hour: '2-digit', minute: '2-digit' }) +
      (Math.abs(desfase) >= 15 ? ' (' + (desfase > 0 ? '+' : '−') + desdeHace(desfase) + ')' : '') +
      ' · ' + quien
    : t('med.nodada', 'no se dio') + ' · ' + quien;

  return { clave: null, orden: x.fecha_slot + x.hora_slot, html: `
    <div class="med-fila med-hecha">
      <div class="med-cuando med-pt-ok">${esc(etiquetaDia(x.fecha_slot))}${esc(x.hora_slot)}</div>
      <div class="med-info">
        <div class="med-nom">${esc(pauta ? pauta.nombre : '—')}</div>
        <div class="med-sello">${x.estado === 'dada' ? '✅' : '🚫'} ${esc(detalle)}</div>
      </div>
      <div class="med-acciones">
        <button class="btn-mini" onclick="anularToma('${x.id}')"
          title="${esc(t('med.deshacer', 'Deshacer'))}">↩︎</button>
      </div>
    </div>` };
}

function htmlTratamientos() {
  const activas = medPautas.filter(pautaActiva);
  const viejas  = medPautas.filter(p => !pautaActiva(p));

  const fila = p => `
    <div class="med-trat">
      <div class="med-info">
        <div class="med-nom">${esc(p.nombre)}${p.dosis ? ' <span class="med-dosis">' + esc(p.dosis) + '</span>' : ''}</div>
        <div class="med-sello">⏰ ${esc(nombreHoras(p.horas))} · ${esc(vigencia(p))}</div>
        ${p.nota ? `<div class="med-nota">${esc(p.nota)}</div>` : ''}
      </div>
      <div class="med-acciones">
        <button class="btn-mini" onclick="abrirEditarPauta('${p.id}')">${esc(t('btn.editar', 'Editar'))}</button>
      </div>
    </div>`;

  return `<div class="card card-no-pad">
    <p class="card-title" style="padding:18px 18px 10px">${esc(t('med.tratamientos', 'Tratamientos'))}</p>
    ${activas.length ? activas.map(fila).join('')
      : `<p class="hint-txt" style="padding:0 18px 10px">${esc(t('med.sinactivos', 'Ninguno en marcha.'))}</p>`}
    <div style="padding:14px 18px 18px">
      <button class="btn btn-secundario" onclick="abrirAltaPauta()"
        >${esc(t('med.anadir', 'Añadir medicamento'))}</button>
    </div>
    ${viejas.length ? `
      <details class="mas" style="margin:0 18px 18px">
        <summary>${esc(t('med.terminados', 'Tratamientos terminados'))} (${viejas.length})</summary>
        <div style="padding:4px 0">${viejas.map(fila).join('')}</div>
      </details>` : ''}
  </div>`;
}

/* ─────────────────────────────────────────────────────────────
   HISTORIAL DE TOMAS

   Lo que «Ahora mismo» ya no tiene por qué cargar. Sale de las
   mismas medTomas que ya se traen al cargar —30 días— así que no
   hay ni una consulta nueva.

   Las anuladas SÍ salen, tachadas. Anular existe precisamente
   para dejar rastro: una toma que desaparece sin dejar nada es
   justo lo que este módulo intenta evitar.
   ───────────────────────────────────────────────────────────── */
function htmlHistorialMed() {
  const tomas = medTomas.slice().sort((a, b) =>
    (b.fecha_slot + b.hora_slot).localeCompare(a.fecha_slot + a.hora_slot));

  if (!tomas.length) return '';

  // Agrupadas por día, de hoy hacia atrás. Dentro del día, de la
  // última a la primera: lo reciente arriba, que es lo que se busca.
  const dias = [];
  tomas.forEach(x => {
    let d = dias.find(g => g.fecha === x.fecha_slot);
    if (!d) { d = { fecha: x.fecha_slot, filas: [] }; dias.push(d); }
    d.filas.push(x);
  });

  const fila = x => {
    const pauta = medPautas.find(p => p.id === x.pauta_id);
    const anulada = x.estado === 'anulada';

    const icono = anulada ? '🚫' : x.estado === 'dada' ? '✅' : '⊘';
    const detalle = anulada
      ? t('med.anulada', 'anulada')
      : x.estado === 'dada'
        ? t('med.dadaA', 'dada a las') + ' ' + new Date(x.dada_en)
            .toLocaleTimeString(localeActivo(), { hour: '2-digit', minute: '2-digit' })
          + ' · ' + quienMarco(x)
        : t('med.nodada', 'no se dio') + ' · ' + quienMarco(x);

    return `
      <div class="med-fila med-hecha">
        <div class="med-cuando ${anulada ? 'med-pt-pasada' : 'med-pt-ok'}">${esc(x.hora_slot)}</div>
        <div class="med-info">
          <div class="med-nom"${anulada ? ' style="text-decoration:line-through"' : ''}
            >${esc(pauta ? pauta.nombre : '—')}</div>
          <div class="med-sello">${icono} ${esc(detalle)}</div>
        </div>
      </div>`;
  };

  const dadas = tomas.filter(x => x.estado === 'dada').length;

  return `<div class="card card-no-pad">
    <details class="mas" style="margin:0;border:none;background:none">
      <summary style="padding:18px">${esc(t('med.historial', 'Historial de tomas'))}
        <span class="med-otras">· ${dadas} ${esc(plural(dadas, 'dada', 'dadas', 'dosis'))}
        ${esc(t('med.en30', 'en 30 días'))}</span></summary>
      <div style="padding:0 0 8px">
        ${dias.map(d => `
          <p class="hint-txt" style="margin:10px 18px 2px">${esc(nombreDia(d.fecha))}</p>
          ${d.filas.map(fila).join('')}`).join('')}
      </div>
    </details>
  </div>`;
}

/* «hoy», «ayer» o la fecha. etiquetaDia() hace casi lo mismo pero
   devuelve cadena vacía para hoy y lleva el separador pegado,
   porque allí va delante de la hora. Aquí es un encabezado. */
function nombreDia(fecha) {
  if (fecha === hoyISO())     return t('med.hoy.dia', 'Hoy');
  if (fecha === diasAtras(1)) return t('med.ayer.dia', 'Ayer');
  return fechaCorta(fecha + 'T12:00',
    { weekday: 'long', day: 'numeric', month: 'long' });
}

/* Esto no es un adorno legal: la app no avisa con el móvil
   apagado y hay que decirlo donde se toman las decisiones. */
function piePrudencia() {
  // El texto cambia con los avisos encendidos: decir «sólo avisa cuando
  // lo abres» cuando acabas de activar las notificaciones es falso, y
  // decir que ya no hace falta la alarma del móvil sería peor. Ni una
  // cosa ni la otra.
  const txt = (typeof pushActivo === 'function' && pushActivo())
    ? t('med.pie.push',
        'Tracking Álex no es un dispositivo médico. Los avisos del móvil pueden ' +
        'llegar tarde o no llegar: con el ahorro de batería se retrasan, y una ' +
        'suscripción puede caducar sin avisar. Para una toma que no se puede ' +
        'olvidar, pon también la alarma del teléfono. Sigue siempre la pauta de ' +
        'tu pediatra.')
    : t('med.pie',
        'Tracking Álex no es un dispositivo médico y sólo avisa cuando lo abres. ' +
        'Para una toma que no se puede olvidar, pon también la alarma del móvil. ' +
        'Sigue siempre la pauta de tu pediatra.');
  return `<p class="med-pie">${esc(txt)}</p>`;
}

/* ─────────────────────────────────────────────────────────────
   ALTA Y EDICIÓN DE PAUTAS
   ───────────────────────────────────────────────────────────── */
function normalizarHoras(lista) {
  const vistas = {};
  lista.forEach(h => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((h || '').trim());
    if (!m) return;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    // Se descarta, no se recorta. Recortar convertía «24:70» en las
    // 23:59 sin decir nada: una hora inventada que nadie había
    // pedido, y encima a la que de verdad se dan tomas de noche.
    if (hh > 23 || mm > 59) return;
    vistas[String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')] = true;
  });
  return Object.keys(vistas).sort();
}

window.abrirAltaPauta = function(desdePauta) {
  const base = desdePauta ? medPautas.find(p => p.id === desdePauta) : null;
  medForm = {
    id:      null,
    rehacer: base ? base.id : null,     // si viene de «cambiar horas»
    horas:   base ? base.horas.slice() : ['09:00']
  };

  document.getElementById('comidaModalTitulo').textContent = base
    ? t('med.cambiarHoras', 'Cambiar las horas') + ' · ' + base.nombre
    : t('med.anadir', 'Añadir medicamento');

  document.getElementById('comidaModalCuerpo').innerHTML = `
    ${base ? `<p class="aviso aviso-suave">${esc(t('med.rehacerAviso',
      'Las horas de una pauta no se tocan en marcha: lo apuntado dejaría de cuadrar. ' +
      t('med.cierraHoy', 'Se cierra ésta hoy y la nueva empieza mañana.')))}</p>` : ''}

    <div class="field">
      <label for="medNombre">${esc(t('med.f.nombre', 'Medicamento'))}</label>
      <input type="text" id="medNombre" maxlength="80" placeholder="Vitamina D"
             value="${base ? esc(base.nombre) : ''}">
    </div>

    <div class="field">
      <label for="medDosis">${esc(t('med.f.dosis', 'Dosis'))}</label>
      <input type="text" id="medDosis" maxlength="60" placeholder="2 gotas"
             value="${base && base.dosis ? esc(base.dosis) : ''}">
      <p class="hint-txt" style="margin:6px 0 0">${esc(t('med.f.dosisAyuda',
        'Tal cual te lo haya dicho el pediatra. La app no calcula dosis.'))}</p>
    </div>

    <div class="field">
      <label>${esc(t('med.f.horas', '¿A qué horas?'))}</label>

      <div id="medHoras" class="med-horas-lista"></div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input type="time" id="medHoraNueva" value="09:00" style="flex:1">
        <button type="button" class="btn-mini btn-mini-pri" onclick="medAnadirHora()"
          >${esc(t('med.f.anadirHora', 'Añadir'))}</button>
      </div>

      <p class="hint-txt" style="margin:0 0 7px">${esc(t('med.f.atajosAyuda',
        'O reparte las tomas a lo largo del día desde la primera hora:'))}</p>
      <div class="med-atajos">
        <button type="button" class="btn-mini" onclick="medAtajo(12)"
          >${esc(t('med.cada', 'cada'))} 12 h · 2</button>
        <button type="button" class="btn-mini" onclick="medAtajo(8)"
          >${esc(t('med.cada', 'cada'))} 8 h · 3</button>
        <button type="button" class="btn-mini" onclick="medAtajo(6)"
          >${esc(t('med.cada', 'cada'))} 6 h · 4</button>
      </div>
      <p class="hint-txt" style="margin:7px 0 0">${esc(t('med.f.horasAyuda',
        'Lo que vale es la lista de arriba: toca una hora para quitarla, o añade las que quieras a mano.'))}</p>
    </div>

    <div class="field">
      <label for="medDesde">${esc(t('med.f.desde', 'Empieza'))}</label>
      <input type="date" id="medDesde" value="${base ? diasAtras(-1) : hoyISO()}">
    </div>

    <div class="field">
      <label for="medDias">${esc(t('med.f.durante', 'Durante (días)'))}</label>
      <input type="number" id="medDias" min="1" max="3650" inputmode="numeric" placeholder="365">
      <p class="hint-txt" style="margin:6px 0 0">${esc(t('med.f.duranteAyuda',
        'Déjalo vacío si no tiene fecha de fin.'))}</p>
    </div>

    <div class="field" style="margin-bottom:0">
      <label for="medNota">${esc(t('med.f.nota', 'Nota (opcional)'))}</label>
      <input type="text" id="medNota" maxlength="200" placeholder="Con la comida"
             value="${base && base.nota ? esc(base.nota) : ''}">
    </div>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" onclick="guardarPauta()"
      >${esc(t('btn.guardar', 'Guardar'))}</button>`;

  abrirModal();
  pintarHorasForm();
};

function pintarHorasForm() {
  const cont = document.getElementById('medHoras');
  if (!cont || !medForm) return;
  cont.innerHTML = medForm.horas.length
    ? medForm.horas.map(h => `
        <button type="button" class="med-hora-chip" onclick="medQuitarHora('${h}')"
          title="${esc(t('med.f.quitar', 'Quitar esta hora'))}">${esc(h)} <span aria-hidden="true">✕</span></button>`).join('')
    : `<span class="hint-txt">${esc(t('med.f.sinHoras', 'Todavía no hay ninguna hora'))}</span>`;
}

window.medAnadirHora = function() {
  const v = document.getElementById('medHoraNueva').value;
  if (!v) return;
  medForm.horas = normalizarHoras(medForm.horas.concat([v]));
  pintarHorasForm();
};

window.medQuitarHora = function(h) {
  medForm.horas = medForm.horas.filter(x => x !== h);
  pintarHorasForm();
};

/* «Cada 8 h» no es otra forma de guardar la pauta: genera las
   horas concretas a partir de la primera. Así sólo existe una
   manera de decir cuándo toca, y es la lista de horas. */
window.medAtajo = function(cada) {
  const base = medForm.horas[0] || document.getElementById('medHoraNueva').value || '09:00';
  const h0 = parseInt(base.slice(0, 2), 10), m0 = base.slice(3);
  const horas = [];
  for (let i = 0; i < 24 / cada; i++) {
    horas.push(String((h0 + i * cada) % 24).padStart(2, '0') + ':' + m0);
  }
  medForm.horas = normalizarHoras(horas);
  pintarHorasForm();

  // Decir en voz alta lo que acaba de pasar. El atajo PISA la lista, y
  // que unos botones cambien en silencio lo que habías escrito a mano es
  // justo lo que hacía que esto no se entendiera.
  //
  // La hora que se nombra es la que PUSISTE, no la primera de la lista
  // ordenada: con «cada 8 h» desde las 09:00 la lista empieza en 01:00, y
  // decir «desde las 01:00» sonaba a que te había cambiado la hora.
  toast(t2('med.atajoHecho', '{n} tomas al día, desde las {h}',
           { n: 24 / cada, h: base }));
};

window.guardarPauta = async function() {
  const nombre = document.getElementById('medNombre').value.trim();
  const dosis  = document.getElementById('medDosis').value.trim();
  const nota   = document.getElementById('medNota').value.trim();
  const desde  = document.getElementById('medDesde').value;
  const dias   = parseInt(document.getElementById('medDias').value, 10);

  if (!nombre)              { toast(t('med.faltaNombre', '⚠️ Ponle nombre al medicamento.')); return; }
  if (!medForm.horas.length) { toast(t('med.faltaHora', '⚠️ Añade al menos una hora.')); return; }
  if (!desde)               { toast(t('med.faltaInicio', '⚠️ Falta la fecha de inicio.')); return; }

  let hasta = null;
  if (!isNaN(dias) && dias > 0) {
    const d = new Date(desde + 'T12:00');
    d.setDate(d.getDate() + dias - 1);
    hasta = fechaLocalISO(d);
  }

  const fila = {
    nino_id: ninoActivo.id,
    nombre, dosis: dosis || null, nota: nota || null,
    horas: medForm.horas,
    zona: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
    desde, hasta
  };

  // Si venimos de «cambiar horas», la vieja se cierra HOY y la
  // nueva empieza MAÑANA. Cerrarla ayer dejaría las tomas de hoy
  // apuntando a ranuras que ya no existen, y la pauta nueva
  // volvería a pedir dosis que ya se han dado.
  if (medForm.rehacer) {
    const { error: e1 } = await sb.from('med_pautas')
      .update({ hasta: hoyISO() }).eq('id', medForm.rehacer).select();
    if (e1) { toast('❌ ' + (e1.message || 'No se pudo cerrar la pauta anterior'), 4500); return; }
  }

  const { error } = await sb.from('med_pautas').insert(fila);
  if (error) { toast('❌ No se pudo guardar: ' + (error.message || ''), 4500); return; }

  cerrarComidaModal();
  medForm = null;
  toast('💊 ' + nombre + ' ' + t('med.guardada', 'añadido'));
  await cargarMedicacion();
};

/* ─────────────────────────────────────────────────────────────
   EDITAR UNA PAUTA

   Antes esto duplicaba el tratamiento, y con razón de ser pero sin
   avisar: el enlace de «cambiar las horas» cerraba la pauta vieja y
   creaba una nueva, y durante un día se veían dos «Vitamina D»
   idénticas. Parecía un error de la aplicación.

   Ahora hay dos caminos, y el que se usa depende de si la pauta tiene
   tomas apuntadas:

     · SIN tomas  → se edita entera en el sitio, horas incluidas. No hay
       historia que romper, así que no hay nada que duplicar. Es además
       el caso real: acabas de crearla y te has equivocado.

     · CON tomas  → cambiar las horas sí cierra la vieja y abre una
       nueva, porque las tomas ya apuntadas señalan ranuras que dejarían
       de existir y el aviso volvería a pedir dosis ya dadas. Pero se
       dice antes, y la lista enseña «termina hoy» / «empieza mañana»
       para que se vea el relevo en vez de un duplicado.
   ───────────────────────────────────────────────────────────── */
window.abrirEditarPauta = function(id) {
  const p = medPautas.find(x => x.id === id);
  if (!p) return;

  const conTomas = tieneTomas(p.id);
  medForm = { id: p.id, rehacer: null, horas: p.horas.slice() };

  document.getElementById('comidaModalTitulo').textContent = p.nombre;
  document.getElementById('comidaModalCuerpo').innerHTML = `
    <div class="field">
      <label for="medENombre">${esc(t('med.f.nombre', 'Medicamento'))}</label>
      <input type="text" id="medENombre" maxlength="80" value="${esc(p.nombre)}">
    </div>

    <div class="field">
      <label for="medEDosis">${esc(t('med.f.dosis', 'Dosis'))}</label>
      <input type="text" id="medEDosis" maxlength="60" value="${p.dosis ? esc(p.dosis) : ''}">
    </div>

    <div class="field">
      <label>${esc(t('med.f.horas', '¿A qué horas?'))}</label>
      ${conTomas ? `
        <p style="margin:0 0 6px;font-weight:600">⏰ ${esc(nombreHoras(p.horas))}</p>
        <p class="hint-txt" style="margin:0">${esc(t('med.horasBloqueadas',
          'Hay tomas apuntadas con estas horas, así que no se cambian aquí.'))}
          <a href="#" onclick="event.preventDefault();abrirAltaPauta('${p.id}')"
             >${esc(t('med.cambiarHoras', 'Cambiar las horas'))}</a>
        </p>`
      : `
        <div id="medHoras" class="med-horas-lista"></div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <input type="time" id="medHoraNueva" value="${esc(p.horas[0] || '09:00')}" style="flex:1">
          <button type="button" class="btn-mini btn-mini-pri" onclick="medAnadirHora()"
            >${esc(t('med.f.anadirHora', 'Añadir'))}</button>
        </div>
        <div class="med-atajos">
          <button type="button" class="btn-mini" onclick="medAtajo(12)">${esc(t('med.cada', 'cada'))} 12 h · 2</button>
          <button type="button" class="btn-mini" onclick="medAtajo(8)">${esc(t('med.cada', 'cada'))} 8 h · 3</button>
          <button type="button" class="btn-mini" onclick="medAtajo(6)">${esc(t('med.cada', 'cada'))} 6 h · 4</button>
        </div>`}
    </div>

    <div class="field">
      <label for="medEHasta">${esc(t('med.f.hasta', 'Hasta el día'))}</label>
      <input type="date" id="medEHasta" value="${p.hasta || ''}">
      <p class="hint-txt" style="margin:6px 0 0">${esc(t('med.f.hastaAyuda',
        'Vacío = sin fecha de fin.'))}</p>
    </div>

    <div class="field" style="margin-bottom:0">
      <label for="medENota">${esc(t('med.f.nota', 'Nota (opcional)'))}</label>
      <input type="text" id="medENota" maxlength="200" value="${p.nota ? esc(p.nota) : ''}">
    </div>`;

  document.getElementById('comidaModalBtns').innerHTML = `
    <button class="btn btn-primary" onclick="guardarEdicionPauta('${p.id}')"
      >${esc(t('btn.guardar', 'Guardar'))}</button>
    ${pautaActiva(p) ? `<button class="btn btn-secundario" onclick="terminarPauta('${p.id}')"
      >${esc(t('med.terminar', 'Terminar ya'))}</button>` : ''}
    <button class="btn btn-danger-sm" onclick="borrarPauta('${p.id}')"
      >${esc(t('med.borrar', 'Borrar'))}</button>`;

  abrirModal();
  if (!conTomas) pintarHorasForm();
};

window.guardarEdicionPauta = async function(id) {
  const p = medPautas.find(x => x.id === id);
  if (!p) return;

  const cambios = {
    nombre: document.getElementById('medENombre').value.trim(),
    dosis:  document.getElementById('medEDosis').value.trim() || null,
    nota:   document.getElementById('medENota').value.trim() || null,
    hasta:  document.getElementById('medEHasta').value || null
  };
  if (!cambios.nombre) { toast(t('med.nombreVacio', '⚠️ El nombre no puede quedar vacío.')); return; }

  // Las horas sólo viajan cuando se pueden tocar sin romper nada
  if (!tieneTomas(id)) {
    if (!medForm || !medForm.horas.length) { toast(t('med.faltaHora', '⚠️ Añade al menos una hora.')); return; }
    cambios.horas = medForm.horas;
  }

  // .select() a propósito: si RLS bloquea un UPDATE, Supabase no devuelve
  // error, devuelve cero filas. Ya ha pasado dos veces en este proyecto.
  const { data, error } = await sb.from('med_pautas').update(cambios).eq('id', id).select();
  if (error) { toast('❌ ' + (error.message || t('med.noGuardado2', 'No se pudo guardar')), 4500); return; }
  if (!data || !data.length) {
    toast(t('med.rlsPautas', '⚠️ No se modificó nada. Revisa la policy de UPDATE de med_pautas.'), 6000); return;
  }

  cerrarComidaModal();
  medForm = null;
  toast('✅ Guardado');
  await cargarMedicacion();
};

/* Terminar pone el final AYER, no hoy: «ya no se la demos» quiere decir
   que las tomas que quedaban hoy tampoco. Lo ya apuntado no se toca. */
window.terminarPauta = async function(id) {
  const p = medPautas.find(x => x.id === id);
  if (!p) return;
  if (!confirm(t2('med.terminarQ', '¿Terminar {m}?', { m: p.nombre })
    + '\n\n' + t('med.terminarTxt',
        'Dejará de avisar, incluidas las tomas que quedaban hoy.')
    + '\n' + t('med.terminarTxt2', 'Lo apuntado no se borra.'))) return;

  const { data, error } = await sb.from('med_pautas')
    .update({ hasta: diasAtras(1) }).eq('id', id).select();
  if (error) { toast('❌ ' + (error.message || t('med.noTerminado', 'No se pudo terminar')), 4500); return; }
  if (!data || !data.length) {
    toast(t('med.rlsPautas', '⚠️ No se modificó nada. Revisa la policy de UPDATE de med_pautas.'), 6000); return;
  }

  cerrarComidaModal();
  toast(t2('med.terminado', '🏁 {m} terminado', { m: p.nombre }));
  await cargarMedicacion();
};

/* Borrar de verdad, para cuando la pauta no debería existir nunca: la
   apuntaste mal, o te equivocaste de niño. «Terminar» la dejaría ahí para
   siempre en la lista de terminados, que es basura si nunca fue real.

   Las tomas se van con ella, y por eso se dice cuántas son antes: no es lo
   mismo tirar una pauta recién creada que una con veinte dosis apuntadas.
   El orden es obligatorio, las claves ajenas no llevan cascade. */
window.borrarPauta = async function(id) {
  const p = medPautas.find(x => x.id === id);
  if (!p) return;

  const n = medTomas.filter(x => x.pauta_id === id).length;
  const aviso = t2('med.borrarQ', '¿Borrar {m} del todo?', { m: p.nombre }) + '\n\n'
    + (n ? t2('med.borrarTomas', 'Se borrarán también sus {n} {p} apuntadas.',
             { n: n, p: plural(n, 'toma', 'tomas', 'tomas') })
         : t('med.sinTomas', 'No tiene ninguna toma apuntada.')) + '\n'
    + '\n' + t('med.borrarIrrev',
        'Esto no se puede deshacer. Si sólo quieres dejar de darla, usa «Terminar ya».');
  if (!confirm(aviso)) return;

  const { error: e1 } = await sb.from('med_tomas').delete().eq('pauta_id', id);
  if (e1) { toast('❌ ' + (e1.message || t('med.noBorradasTomas', 'No se pudieron borrar las tomas')), 4500); return; }

  const { error: e2 } = await sb.from('med_pautas').delete().eq('id', id);
  if (e2) { toast('❌ ' + (e2.message || 'No se pudo borrar'), 4500); return; }

  cerrarComidaModal();
  medForm = null;
  toast('🗑️ ' + p.nombre + ' borrado');
  await cargarMedicacion();
};
