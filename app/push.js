/* ═════════════════════════════════════════════════════════════
   AVISOS EN EL MÓVIL

   El banner de medicación sólo existe con la aplicación abierta. Esto
   es lo que hace que suene el teléfono cuando está cerrada.

   Hay que decir de entrada lo que NO se puede:

     · En iPhone sólo funciona si la web está añadida a la pantalla de
       inicio. Desde Safari no hay avisos y no hay forma de que los
       haya: lo decide Apple, no esta aplicación.
     · Una notificación ya enviada no se puede retirar con garantías.
       Si tu pareja marca la toma, el aviso sigue en tu pantalla. Por
       eso el texto nunca dice «dásela», dice «compruébalo».
     · Con el ahorro de batería, el aviso puede llegar tarde.
     · Las suscripciones caducan solas —cambio de móvil, navegador
       limpiado, meses sin abrir—. Por eso se renuevan al arrancar.

   Nada de esto lo arregla el código. Lo que sí se puede es no mentir
   sobre ello, y que la pantalla lo diga antes de que alguien confíe su
   antibiótico a esto.

   La clave pública VAPID va aquí en claro porque es pública por
   diseño: es lo que usa el navegador para comprobar que el aviso lo
   manda quien dice. La privada vive en los secretos de Supabase.
   ═════════════════════════════════════════════════════════════ */

const VAPID_PUBLICA = 'BKH031KZ1b2QNfdnPqVqN9pyBQhKrmi4Aqvq-xwIiV_JUcQPZoQ_nq_Swnk9lCEVAnBIH5hjH5MN-cngNnpE4as';

let swReg = null;

/* El estado se guarda en memoria en vez de preguntarse al pintar.
   renderMedicacion() repinta cada minuto para mover el reloj del
   banner, y estadoPush() es asíncrona: encadenarlas convertiría un
   repintado de texto en una ronda de promesas cada sesenta segundos y
   la tarjeta parpadearía. El estado sólo cambia cuando alguien pulsa
   un botón, así que se refresca ahí y al arrancar. */
let pushEstado = 'sin-pedir';

function pushActivo() { return pushEstado === 'activo'; }

/* ── Qué soporta este móvil ─────────────────────────────────── */
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

async function estadoPush() {
  if (!pushSoportado()) {
    // En iPhone la carencia no es del móvil: es de no haberla instalado
    return (esIOS() && !instaladaEnPantallaInicio()) ? 'ios-sin-instalar' : 'no-soportado';
  }
  if (Notification.permission === 'denied')  return 'denegado';
  if (Notification.permission === 'default') return 'sin-pedir';

  const reg = swReg || await navigator.serviceWorker.getRegistration();
  if (!reg) return 'sin-pedir';
  const sus = await reg.pushManager.getSubscription();
  return sus ? 'activo' : 'sin-pedir';
}

/* ── El service worker ──────────────────────────────────────── */
async function registrarSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    return swReg;
  } catch (e) {
    console.error('No se pudo registrar el service worker:', e);
    return null;
  }
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

/* ── Encender ───────────────────────────────────────────────── */
window.activarPush = async function() {
  if (!pushSoportado()) { toast('⚠️ Este navegador no admite avisos.', 4000); return; }

  // El permiso SÓLO se puede pedir desde un gesto de la persona. Pedirlo
  // al cargar la página hace que el navegador lo ignore o lo deniegue
  // para siempre, y salir de un «denegado» es incomodísimo en todos.
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    toast(permiso === 'denied'
      ? t('push.bloqueado',
      '🔕 Has bloqueado los avisos. Se vuelven a permitir desde los ajustes del navegador.')
      : t('push.sinPermiso', '🔕 Sin permiso no puedo avisarte.'), 5000);
    await refrescarPush();
    return;
  }

  const reg = swReg || await registrarSW();
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
    toast(t('push.noSuscrito', '❌ El navegador no dejó suscribirse: ') + (e.message || ''), 5000);
    return;
  }

  const j = sus.toJSON();
  const { error } = await sb.from('med_push').upsert({
    endpoint: sus.endpoint,
    p256dh:   j.keys.p256dh,
    auth:     j.keys.auth,
    agente:   navigator.userAgent.slice(0, 200),
    fallos:   0
  }, { onConflict: 'endpoint' });

  if (error) { toast(t('push.noGuardado', '❌ No se pudo guardar: ') + (error.message || ''), 4500); return; }

  toast(t('push.on', '🔔 Listo: este móvil ya recibe los avisos'));
  await refrescarPush();
};

/* ── Apagar ─────────────────────────────────────────────────── */
window.desactivarPush = async function() {
  const reg = swReg || await navigator.serviceWorker.getRegistration();
  const sus = reg && await reg.pushManager.getSubscription();
  if (!sus) { await refrescarPush(); return; }

  // Primero la base y luego el navegador: al revés, si fallara el
  // borrado quedaría una fila apuntando a un buzón que ya no existe y
  // el servidor seguiría mandando avisos al vacío.
  await sb.from('med_push').delete().eq('endpoint', sus.endpoint);
  await sus.unsubscribe();

  toast(t('push.off', '🔕 Este móvil deja de recibir avisos'));
  await refrescarPush();
};

/* ── Renovar en silencio ────────────────────────────────────────
   Las suscripciones caducan solas. Si el permiso sigue dado y hay
   suscripción, se reescribe la fila: iOS las invalida al reinstalar y
   el usuario no se entera de nada hasta que un día no suena. */
async function renovarPush() {
  if (!pushSoportado() || Notification.permission !== 'granted') return;
  const reg = swReg || await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sus = await reg.pushManager.getSubscription();
  if (!sus) return;

  const j = sus.toJSON();
  await sb.from('med_push').upsert({
    endpoint: sus.endpoint,
    p256dh:   j.keys.p256dh,
    auth:     j.keys.auth,
    agente:   navigator.userAgent.slice(0, 200),
    fallos:   0
  }, { onConflict: 'endpoint' });
}

/* ── La tarjeta ─────────────────────────────────────────────── */
function cajaPush(icono, titulo, texto, boton) {
  return `
    <div class="card">
      <p class="card-title">${icono} ${esc(titulo)}</p>
      <p class="hint-txt" style="margin:0 0 ${boton ? '14px' : '0'}">${texto}</p>
      ${boton || ''}
    </div>`;
}

function htmlPush() {
  if (pushEstado === 'ios-sin-instalar') {
    return cajaPush('📲', t('push.ios.titulo', 'Para que suene el móvil'), t('push.ios.txt',
      'En iPhone los avisos sólo funcionan si añades Tracking Álex a la pantalla de inicio. ' +
      'Pulsa el botón de compartir de Safari y elige <strong>Añadir a pantalla de inicio</strong>. ' +
      'Luego ábrela desde ahí y vuelve aquí.'), '');
  }

  if (pushEstado === 'no-soportado') {
    return cajaPush('🔕', t('push.no.titulo', 'Sin avisos en este navegador'), t('push.no.txt',
      'Este navegador no admite notificaciones. El aviso seguirá saliendo al abrir la aplicación.'), '');
  }

  if (pushEstado === 'denegado') {
    return cajaPush('🔕', t('push.denegado.titulo', 'Avisos bloqueados'), t('push.denegado.txt',
      'Bloqueaste los avisos para esta web. Hay que volver a permitirlos desde los ajustes del ' +
      'navegador: no se puede hacer desde aquí.'), '');
  }

  if (pushEstado === 'activo') {
    return cajaPush('🔔', t('push.on.titulo', 'Este móvil recibe los avisos'),
      t('push.on.txt', 'Te avisará cuando toque una toma y nadie la haya marcado. ' +
        t('push.soloEste', 'Sólo este móvil: el de tu pareja se activa desde su propio teléfono.')),
      `<button class="btn btn-secundario" onclick="desactivarPush()"
        >${esc(t('push.off', 'Dejar de avisarme en este móvil'))}</button>`);
  }

  return cajaPush('🔔', t('push.off.titulo', 'Avisarme en el móvil'),
    t('push.off.txt', 'Ahora mismo el aviso sólo aparece cuando abres la aplicación. ' +
      t('push.conEsto', 'Con esto, el móvil suena aunque esté cerrada.')),
    `<button class="btn btn-primary" onclick="activarPush()"
      >${esc(t('push.on', 'Activar los avisos'))}</button>`);
}

/* ── Arranque ───────────────────────────────────────────────── */
async function refrescarPush() {
  pushEstado = await estadoPush();
  if (typeof renderMedicacion === 'function') renderMedicacion();
}

async function iniciarPush() {
  await registrarSW();
  await renovarPush();
  await refrescarPush();
}
