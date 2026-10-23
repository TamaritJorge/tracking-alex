/* ═════════════════════════════════════════════════════════════
   AVISOS DE POSTE LIBRE

   Lo único de esta página que necesita cuenta. El mapa y las
   estadísticas funcionan sin registrarse; esto no puede, porque hay que
   guardar a qué móvil mandar el aviso y de qué zonas.

   ── LO QUE NO SE PUEDE ──
     · En iPhone sólo funciona si la web está añadida a la pantalla de
       inicio. Lo decide Apple.
     · El permiso de notificaciones es POR ORIGEN, no por carpeta. Si
       alguien bloqueó los avisos en la app de Tracking Álex, aquí nacen
       bloqueados y no hay forma de pedirlo otra vez desde el código.
     · Con el ahorro de batería el aviso puede llegar tarde, y entre que
       se libera el poste y llegas tú puede haber otro coche. Por eso el
       texto del aviso no promete una plaza.
     · Las suscripciones caducan solas. Por eso se renuevan al arrancar.

   ── LA CLAVE ──
   La pública va aquí en claro porque es pública por diseño: es lo que
   usa el navegador para comprobar que el aviso lo manda quien dice. La
   privada vive en los secretos de Supabase, como VAPID_PRIVATE_KEY_CARGA.

   Es un par PROPIO, distinto del de la medicación. Compartirlo
   significaría que quien pudiera firmar un aviso de cargadores podría
   firmar uno de medicación; y además las suscripciones quedan atadas a
   la clave con la que se crearon, así que mezclarlas haría imposible
   rotar una sin romper la otra.
   ═════════════════════════════════════════════════════════════ */

const VAPID_PUBLICA = 'BF0oXFDFCF0xPyfMYnLL4JgJJIK9ro6GssbCkS-q1cWatn1hdomvzcdpZQVlsZX2fQNEdjzjFGVoizg5Ia650zU';

let swRegC   = null;
let sesion   = null;      // la de Supabase, o null
let miAviso  = null;      // la fila de carga_push de ESTE móvil, o null
let estadoAv = 'cargando';


/* ── Qué soporta este móvil ─────────────────────────────────
   Copiado tal cual de app/push.js: no tiene nada de específico de un
   bebé y duplicarlo es más barato que compartir un global entre dos
   páginas que por lo demás no se conocen. */
function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function instaladaEnPantallaInicio() {
  return window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
}

function pushSoportado() {
  return 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
}

/* La clave viaja en base64url y el navegador la quiere en bytes */
function claveABytes(base64) {
  const relleno = '='.repeat((4 - base64.length % 4) % 4);
  const limpio = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(limpio);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registrarSWCarga() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    // El ámbito acotado es lo que mantiene separados este registro y el
    // de /app/. Sin él, el de arriba se tragaría los dos.
    swRegC = await navigator.serviceWorker.register('sw.js', { scope: './' });
    return swRegC;
  } catch (e) {
    console.error('service worker de carga:', e);
    return null;
  }
}


/* ─────────────────────────────────────────────────────────────
   ESTADO
   ───────────────────────────────────────────────────────────── */
async function calcularEstado() {
  if (!sesion) return 'sin-sesion';
  if (!pushSoportado()) {
    return (esIOS() && !instaladaEnPantallaInicio()) ? 'ios-sin-instalar' : 'no-soportado';
  }
  if (Notification.permission === 'denied') return 'denegado';

  const reg = swRegC || await navigator.serviceWorker.getRegistration('./');
  if (!reg) return 'apagado';
  const sus = await reg.pushManager.getSubscription();
  if (!sus) return 'apagado';

  const { data, error } = await sb.from('carga_push')
    .select('endpoint, zonas, desde_hora, hasta_hora')
    .eq('endpoint', sus.endpoint)
    .maybeSingle();
  if (error) { console.error('carga_push:', error); return 'apagado'; }

  /* Suscripción en el navegador pero no en la base: pasa si se borró la
     fila desde otro sitio, o si falló el guardado. Para la persona está
     apagado, porque de hecho no va a llegarle nada. */
  if (!data) return 'apagado';

  miAviso = data;
  return 'activo';
}


/* ─────────────────────────────────────────────────────────────
   ENCENDER Y APAGAR
   ───────────────────────────────────────────────────────────── */
window.activarAvisos = async function () {
  if (!sesion)        { entrar(); return; }
  if (!pushSoportado()) { toast('⚠️ Este navegador no admite avisos.', 4000); return; }

  // El permiso SÓLO se puede pedir desde un gesto de la persona: pedirlo
  // al cargar hace que el navegador lo ignore o lo deniegue para siempre.
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    toast(permiso === 'denied'
      ? '🔕 Has bloqueado los avisos. Se vuelven a permitir desde los ajustes del navegador.'
      : '🔕 Sin permiso no puedo avisarte.', 5000);
    await refrescarAvisos();
    return;
  }

  const reg = swRegC || await registrarSWCarga();
  if (!reg) { toast('❌ No se pudo preparar el aviso.', 4000); return; }
  await navigator.serviceWorker.ready;

  let sus;
  try {
    sus = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveABytes(VAPID_PUBLICA)
    });
  } catch (e) {
    console.error(e);
    toast('❌ El navegador no dejó suscribirse: ' + (e.message || ''), 5000);
    return;
  }

  const j = sus.toJSON();
  /* zonas vacío = TODAS, también las que la UJI añada mañana. Es el
     estado inicial a propósito: quien acaba de activarlo no ha elegido
     nada todavía, y lo que quiere es enterarse. */
  const { error } = await sb.from('carga_push').upsert({
    endpoint: sus.endpoint,
    p256dh:   j.keys.p256dh,
    auth:     j.keys.auth,
    agente:   navigator.userAgent.slice(0, 200),
    zonas:    [],
    fallos:   0
  }, { onConflict: 'endpoint' });

  if (error) { toast('❌ No se pudo guardar: ' + (error.message || ''), 4500); return; }

  toast('🔔 Listo: este móvil ya recibe los avisos');
  await refrescarAvisos();
};

window.desactivarAvisos = async function () {
  const reg = swRegC || await navigator.serviceWorker.getRegistration('./');
  const sus = reg && await reg.pushManager.getSubscription();
  if (!sus) { await refrescarAvisos(); return; }

  // Primero la base y luego el navegador: al revés, si fallara el borrado
  // quedaría una fila apuntando a un buzón que ya no existe.
  await sb.from('carga_push').delete().eq('endpoint', sus.endpoint);
  await sus.unsubscribe();
  miAviso = null;

  toast('🔕 Este móvil deja de recibir avisos');
  await refrescarAvisos();
};

/* Renovar en silencio: iOS invalida las suscripciones al reinstalar y
   nadie se entera hasta que un día no suena. */
async function renovarAvisos() {
  if (!sesion || !pushSoportado() || Notification.permission !== 'granted') return;
  const reg = swRegC || await navigator.serviceWorker.getRegistration('./');
  if (!reg) return;
  const sus = await reg.pushManager.getSubscription();
  if (!sus) return;

  const j = sus.toJSON();
  await sb.from('carga_push').upsert({
    endpoint: sus.endpoint,
    p256dh:   j.keys.p256dh,
    auth:     j.keys.auth,
    agente:   navigator.userAgent.slice(0, 200),
    fallos:   0
  }, { onConflict: 'endpoint', ignoreDuplicates: false });
}


/* ─────────────────────────────────────────────────────────────
   QUÉ ZONAS VIGILA

   Selección múltiple: ninguna, una, varias o todas. El botón «Todas»
   existe porque es el caso más frecuente y marcar seis a mano es
   absurdo — y porque «todas» marcando las seis NO es lo mismo que
   «todas» con la lista vacía: la primera deja fuera cualquier zona que
   la UJI añada en el futuro, y la segunda no.
   ───────────────────────────────────────────────────────────── */
window.alternarZona = async function (z) {
  if (!miAviso) return;
  const actuales = (miAviso.zonas && miAviso.zonas.length)
    ? miAviso.zonas.slice()
    : Object.keys(SIGLAS);           // vacío significaba todas: se materializa

  const i = actuales.indexOf(z);
  if (i >= 0) actuales.splice(i, 1); else actuales.push(z);

  // Si acaban marcadas todas, se guarda el vacío, que es lo que de
  // verdad quiere decir «todas».
  const guardar = actuales.length === Object.keys(SIGLAS).length ? [] : actuales;
  await guardarZonas(guardar);
};

window.todasLasZonas = function () { return guardarZonas([]); };
window.ningunaZona   = function () { return guardarZonas(null); };

async function guardarZonas(zonas) {
  if (!miAviso) return;

  // «Ninguna» no es una lista vacía (eso es «todas»): es apagar.
  if (zonas === null) { await desactivarAvisos(); return; }

  const { error } = await sb.from('carga_push')
    .update({ zonas })
    .eq('endpoint', miAviso.endpoint);
  if (error) { toast('❌ No se pudo guardar: ' + (error.message || ''), 4000); return; }

  miAviso.zonas = zonas;
  pintarAvisos();
  toast(zonas.length ? '✅ Guardado' : '✅ Te avisaré de todas las zonas');
}

window.guardarFranja = async function () {
  if (!miAviso) return;
  const d = Number(document.getElementById('avDesde').value);
  const h = Number(document.getElementById('avHasta').value);
  if (!(h > d)) { toast('⚠️ La hora de fin tiene que ser posterior a la de inicio.', 4000); return; }

  const { error } = await sb.from('carga_push')
    .update({ desde_hora: d, hasta_hora: h })
    .eq('endpoint', miAviso.endpoint);
  if (error) { toast('❌ No se pudo guardar: ' + (error.message || ''), 4000); return; }

  miAviso.desde_hora = d; miAviso.hasta_hora = h;
  toast('✅ Sólo te avisaré entre las ' + d + ':00 y las ' + h + ':00');
};


/* ─────────────────────────────────────────────────────────────
   LA SESIÓN

   Enlace mágico por correo y nada más: sin contraseña no hay
   contraseña que perder, y esta herramienta no justifica montar un
   registro con sus recuperaciones.
   ───────────────────────────────────────────────────────────── */
window.entrar = function () {
  abrirModal('Entrar para recibir avisos', `
    <p class="ficha-txt">Te mando un enlace al correo. No hay contraseña.</p>
    <p class="ficha-txt">Sólo se usa para saber a qué móvil mandar el aviso.
       El mapa y las estadísticas no necesitan cuenta.</p>
    <input id="avCorreo" type="email" inputmode="email"
           autocomplete="email" placeholder="tu@correo.es" style="width:100%">`,
    `<button class="btn btn-primary" onclick="mandarEnlace()">Mandarme el enlace</button>
     <button class="btn" onclick="cerrarModal()"
       style="background:var(--surface2);color:var(--text)">Cancelar</button>`);
  setTimeout(() => { const c = document.getElementById('avCorreo'); if (c) c.focus(); }, 50);
};

window.mandarEnlace = async function () {
  const correo = (document.getElementById('avCorreo').value || '').trim();
  if (!correo || correo.indexOf('@') < 0) { toast('⚠️ Hace falta un correo.', 3500); return; }

  const { error } = await sb.auth.signInWithOtp({
    email: correo,
    // Vuelve AQUÍ, no a la app del bebé. Esta URL tiene que estar en las
    // de redirección permitidas del panel de Supabase o el enlace lleva
    // al sitio equivocado sin decir por qué.
    options: { emailRedirectTo: window.location.origin + '/carga/' }
  });
  if (error) { toast('❌ ' + error.message, 5000); return; }

  cerrarModal();
  toast('📧 Mírate el correo: el enlace caduca en una hora.', 6000);
};

window.salir = async function () {
  await sb.auth.signOut();
  sesion = null; miAviso = null;
  await refrescarAvisos();
};


/* ─────────────────────────────────────────────────────────────
   LA AYUDA

   Dice lo que toca EN ESTE MÓVIL en vez de pedirle a todo el mundo que
   instale algo que la mitad no necesita: en Android y en el escritorio
   los avisos funcionan en el navegador normal.
   ───────────────────────────────────────────────────────────── */
window.ayudaAvisos = function () {
  const ios       = esIOS();
  const instalada = instaladaEnPantallaInicio();

  let cuerpo = '';

  if (ios && !instalada) {
    cuerpo += `<p class="ficha-txt"><strong>En iPhone hace falta instalarla.</strong>
      Safari no deja mandar avisos a una web normal: hay que añadirla a la
      pantalla de inicio. Pulsa el botón de compartir
      (el cuadrado con la flecha) y elige <strong>Añadir a pantalla de
      inicio</strong>. Luego abre Carga UJI desde ese icono y vuelve aquí.</p>`;
  } else if (ios) {
    cuerpo += `<p class="ficha-txt">Ya la tienes en la pantalla de inicio, que es lo
      que hace falta en iPhone. Puedes activar los avisos.</p>`;
  } else {
    cuerpo += `<p class="ficha-txt"><strong>Aquí no hace falta instalar nada.</strong>
      En Android y en el ordenador los avisos funcionan en el navegador
      normal. Instalarla sólo te da un icono que abre directo.</p>`;
  }

  cuerpo += `<p class="ficha-txt"><strong>Es una aplicación aparte de Tracking Álex.</strong>
    Si instalas las dos quedan dos iconos independientes, cada uno abre en
    lo suyo y cada uno manda sus propios avisos.</p>`;

  if (Notification.permission === 'denied') {
    cuerpo += `<p class="ficha-txt">⚠️ <strong>Los avisos están bloqueados para este sitio.</strong>
      El permiso lo guarda el navegador por dominio, así que si lo bloqueaste
      alguna vez en trackingalex.app, esto lo hereda. Hay que volver a
      permitirlo desde los ajustes del navegador: no se puede desde aquí.</p>`;
  }

  cuerpo += `<p class="hint-txt">El aviso puede llegar con retraso si el móvil está
    ahorrando batería, y entre que se libera el poste y llegas tú puede haber
    otro coche. Te digo lo que ha pasado, no te guardo el sitio.</p>`;

  abrirModal('Cómo funcionan los avisos', cuerpo,
    `<button class="btn" onclick="cerrarModal()"
       style="background:var(--surface2);color:var(--text)">Entendido</button>`);
};


/* ─────────────────────────────────────────────────────────────
   LA TARJETA
   ───────────────────────────────────────────────────────────── */
function botonAyuda() {
  return `<button class="btn" onclick="ayudaAvisos()"
    style="background:var(--surface2);color:var(--text)">¿Cómo funciona?</button>`;
}

function htmlZonas() {
  const todas = !miAviso.zonas || !miAviso.zonas.length;
  const sel = z => todas || miAviso.zonas.indexOf(z) >= 0;

  const chips = Object.keys(SIGLAS).map(z => `
    <button type="button" class="chip-zona ${sel(z) ? 'on' : ''}"
            onclick="alternarZona('${z}')"
            aria-pressed="${sel(z)}">
      <b>${esc(SIGLAS[z])}</b><span>${esc(nombreZona(z))}</span>
    </button>`).join('');

  const d = miAviso.desde_hora, h = miAviso.hasta_hora;
  const horas = n => Array.from({ length: 25 }, (_, i) => i)
    .map(i => `<option value="${i}" ${i === n ? 'selected' : ''}>${i}:00</option>`).join('');

  return `
    <p class="hint-txt" style="margin:0 0 8px">
      ${todas ? 'Te aviso de <strong>todas</strong> las zonas, incluidas las que se añadan.'
              : 'Te aviso sólo de las marcadas.'}
    </p>
    <div class="zonas-chips">${chips}</div>
    ${todas ? '' : `<button class="btn" onclick="todasLasZonas()"
        style="background:var(--surface2);color:var(--text);margin-top:10px">Todas</button>`}

    <p class="card-sub" style="margin:18px 0 6px">Sólo entre estas horas</p>
    <div class="franja">
      <select id="avDesde" onchange="guardarFranja()">${horas(d)}</select>
      <span>y</span>
      <select id="avHasta" onchange="guardarFranja()">${horas(h)}</select>
    </div>
    <p class="hint-txt" style="margin:8px 0 0">
      Hora de Madrid. Nadie quiere saber a las 3:40 que hay un cargador libre.</p>`;
}

function pintarAvisos() {
  const c = document.getElementById('avisos');
  if (!c) return;

  if (estadoAv === 'cargando') { c.innerHTML = '<p class="card-sub">Un momento…</p>'; return; }

  if (estadoAv === 'sin-sesion') {
    c.innerHTML = `
      <p class="card-sub">El mapa no necesita cuenta. Los avisos sí: hay que saber
         a qué móvil mandarlos.</p>
      <button class="btn btn-primary" onclick="entrar()" style="margin-top:12px">Entrar con mi correo</button>
      ${botonAyuda()}`;
    return;
  }

  if (estadoAv === 'ios-sin-instalar') {
    c.innerHTML = `
      <p class="card-sub">En iPhone los avisos sólo funcionan si añades Carga UJI a la
         pantalla de inicio. Es cosa de Apple, no de esta página.</p>
      ${botonAyuda()}`;
    return;
  }

  if (estadoAv === 'no-soportado') {
    c.innerHTML = `<p class="card-sub">Este navegador no admite avisos. El mapa
      sigue funcionando igual.</p>${botonAyuda()}`;
    return;
  }

  if (estadoAv === 'denegado') {
    c.innerHTML = `
      <p class="card-sub">Los avisos están bloqueados para este sitio. Hay que volver a
         permitirlos desde los ajustes del navegador: no se puede desde aquí.</p>
      ${botonAyuda()}`;
    return;
  }

  if (estadoAv === 'apagado') {
    c.innerHTML = `
      <p class="card-sub">Te aviso en cuanto un poste pase de ocupado a libre.</p>
      <button class="btn btn-primary" onclick="activarAvisos()" style="margin-top:12px">Avisarme en este móvil</button>
      ${botonAyuda()}
      <p class="hint-txt" style="margin:12px 0 0">Sesión: ${esc(sesion.user.email)} ·
        <a href="#" onclick="salir();return false">salir</a></p>`;
    return;
  }

  c.innerHTML = `
    <p class="card-sub">🔔 Este móvil recibe los avisos.</p>
    ${htmlZonas()}
    <button class="btn" onclick="desactivarAvisos()"
      style="background:var(--surface2);color:var(--text);margin-top:16px">Dejar de avisarme</button>
    ${botonAyuda()}
    <p class="hint-txt" style="margin:12px 0 0">Sesión: ${esc(sesion.user.email)} ·
      <a href="#" onclick="salir();return false">salir</a></p>`;
}

async function refrescarAvisos() {
  estadoAv = await calcularEstado();
  pintarAvisos();
}


/* ── ARRANQUE ─────────────────────────────────────────────── */
async function iniciarAvisos() {
  pintarAvisos();

  const { data } = await sb.auth.getSession();
  sesion = data ? data.session : null;

  // El enlace mágico vuelve con la sesión en el fragmento de la URL;
  // supabase-js la canjea solo, pero el evento llega después.
  sb.auth.onAuthStateChange((_e, s) => {
    sesion = s;
    miAviso = null;
    refrescarAvisos();
  });

  if (sesion) await registrarSWCarga();
  await renovarAvisos();
  await refrescarAvisos();
}
