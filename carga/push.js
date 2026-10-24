/* ═════════════════════════════════════════════════════════════
   AVISOS DE POSTE LIBRE

   Lo único de esta página que necesita cuenta. El mapa y las
   estadísticas funcionan sin registrarse; esto no puede, porque hay que
   guardar a qué móvil mandar el aviso.

   ── ES UN AVISO DE UN SOLO USO ──
   No se vigila nada de forma permanente. Se ARMA cuando hace falta —vas
   de camino y la zona está llena— suena UNA vez al liberarse un poste, y
   se desactiva solo. Lo que lo apaga es carga_aviso_enviado() en el
   servidor, no este fichero: si lo apagara el cliente, un aviso recibido
   con la página cerrada seguiría armado y volvería a sonar.

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
    .select('endpoint, zonas')
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
  /* Nace sin ninguna zona armada, y eso NO es un descuido: dar permiso
     para que suene el móvil es una cosa y pedir un aviso concreto es
     otra. Aquí sólo se guarda la dirección de entrega; el aviso se arma
     después, marcando una zona. */
  const { error } = await sb.from('carga_push').upsert({
    endpoint: sus.endpoint,
    p256dh:   j.keys.p256dh,
    auth:     j.keys.auth,
    agente:   navigator.userAgent.slice(0, 200),
    zonas:    [],
    fallos:   0
  }, { onConflict: 'endpoint' });

  if (error) { toast('❌ No se pudo guardar: ' + (error.message || ''), 4500); return; }

  toast('✅ Listo. Ahora marca la zona que te interese.', 4000);
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
   ARMAR EL AVISO

   Esto NO es una suscripción permanente. El aviso se ARMA cuando hace
   falta —vas de camino, la zona está llena— y se GASTA al dispararse:
   suena una vez y queda desactivado.

   Es un cambio con consecuencias en cadena, todas a favor:
     · No hace falta franja horaria. Si lo armas a las tres de la
       madrugada es porque lo quieres a las tres de la madrugada.
     · No hace falta enfriamiento. No hay segundo aviso del que
       protegerse.
     · `zonas` vacío significa NADA ARMADO, que es el estado de reposo.
       (En el modelo anterior el vacío quería decir «todas». Si alguna
       vez vuelve a leerse código viejo, ojo con eso.)

   Marcar una zona la arma en el acto, sin un botón de «guardar»
   aparte: esto se usa con una mano y a menudo dentro del coche.
   ───────────────────────────────────────────────────────────── */
window.alternarZona = async function (z) {
  if (!miAviso) return;
  const armadas = (miAviso.zonas || []).slice();
  const i = armadas.indexOf(z);
  if (i >= 0) armadas.splice(i, 1); else armadas.push(z);
  await guardarZonas(armadas);
};

window.cancelarAviso = function () { return guardarZonas([]); };

async function guardarZonas(zonas) {
  if (!miAviso) return;

  const { error } = await sb.from('carga_push')
    .update({ zonas })
    .eq('endpoint', miAviso.endpoint);
  if (error) { toast('❌ No se pudo guardar: ' + (error.message || ''), 4000); return; }

  miAviso.zonas = zonas;
  pintarAvisos();

  if (!zonas.length) { toast('Aviso cancelado'); return; }
  toast(zonas.length === 1
    ? '🔔 Te aviso cuando se libere algo en ' + nombreZona(zonas[0])
    : '🔔 Te aviso cuando se libere algo en ' + zonas.length + ' zonas');
}


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

  cuerpo += `<p class="ficha-txt"><strong>El aviso es de un solo uso.</strong> No te
    suscribes a nada: marcas una zona cuando vas de camino, suena una vez en
    cuanto se libere un poste, y queda desactivado. Para el día siguiente se
    vuelve a marcar.</p>`;

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
  const armadas = miAviso.zonas || [];
  const armada  = z => armadas.indexOf(z) >= 0;

  /* Cada chip lleva su estado actual. Sin él, armar un aviso es a
     ciegas: lo normal es querer marcar precisamente la zona que está
     llena, y si no se ve cuál es, hay que subir al mapa y volver. */
  const chips = Object.keys(SIGLAS).map(z => {
    const e = estadoActual && estadoActual[z];
    const estado = !e ? '<span class="chip-est">sin datos</span>'
      : e.libres === 0
        ? '<span class="chip-est llena">llena</span>'
        : `<span class="chip-est libre">${e.libres} ${e.libres === 1 ? 'libre' : 'libres'}</span>`;
    return `
      <button type="button" class="chip-zona ${armada(z) ? 'on' : ''}"
              onclick="alternarZona('${z}')"
              aria-pressed="${armada(z)}">
        <b>${esc(SIGLAS[z])}</b><span>${esc(nombreZona(z))}</span>${estado}
      </button>`;
  }).join('');

  if (!armadas.length) {
    return `
      <p class="hint-txt" style="margin:0 0 10px">
        Marca la zona que te interese y te avisaré <strong>una vez</strong>, en cuanto
        se libere un poste. Luego el aviso se desactiva solo.</p>
      <div class="zonas-chips">${chips}</div>`;
  }

  /* Armar una zona que ya tiene sitio no sirve de nada ahora mismo: el
     aviso salta en la TRANSICIÓN de ocupado a libre, así que esperaría a
     que se llenara y volviera a vaciarse. Se dice, pero no se impide:
     para cuando llegues puede estar llena, y es decisión tuya. */
  const conSitio = armadas.filter(z => estadoActual && estadoActual[z] && estadoActual[z].libres > 0);

  return `
    <p class="card-sub" style="margin:0 0 10px">
      🔔 Aviso armado para <strong>${esc(armadas.map(nombreZona).join(', '))}</strong>.
      Sonará una vez, cuando se libere un poste, y quedará desactivado.</p>
    <div class="zonas-chips">${chips}</div>
    ${conSitio.length ? `<p class="hint-txt" style="margin:10px 0 0">
      Ojo: en ${esc(conSitio.map(nombreZona).join(' y '))} ya hay sitio ahora mismo. El aviso
      salta cuando un poste pasa de ocupado a libre, así que esperaría a que se llenara antes.</p>` : ''}
    <button class="btn" onclick="cancelarAviso()"
      style="background:var(--surface2);color:var(--text);margin-top:14px">Cancelar el aviso</button>`;
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
      <p class="card-sub">Cuando vayas de camino y la zona esté llena, pide un aviso y te
         digo en cuanto se libere un poste. Suena una vez y se apaga solo.</p>
      <button class="btn btn-primary" onclick="activarAvisos()" style="margin-top:12px">Permitir avisos en este móvil</button>
      ${botonAyuda()}
      <p class="hint-txt" style="margin:12px 0 0">Sesión: ${esc(sesion.user.email)} ·
        <a href="#" onclick="salir();return false">salir</a></p>`;
    return;
  }

  /* Aquí abajo sólo van enlaces, no botones. «Cancelar el aviso» es lo
     único que se pulsa a menudo y ya es un botón dentro de htmlZonas();
     tres botones grises idénticos uno encima de otro harían que el que
     importa dejara de verse.

     «Cancelar el aviso» (desarmar) y «quitar este móvil» (borrar la
     suscripción) son cosas distintas a propósito: lo normal es cancelar
     un aviso y seguir pudiendo pedir otro mañana sin volver a pasar por
     el permiso del navegador. */
  c.innerHTML = `
    ${htmlZonas()}
    <p class="hint-txt" style="margin:16px 0 0">${esc(sesion.user.email)} ·
      <a href="#" onclick="ayudaAvisos();return false">cómo funciona</a> ·
      <a href="#" onclick="desactivarAvisos();return false">quitar este móvil</a> ·
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
