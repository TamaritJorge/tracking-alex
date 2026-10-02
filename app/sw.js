/* ═════════════════════════════════════════════════════════════
   SERVICE WORKER

   Existe para UNA cosa: recibir los avisos de medicación cuando la
   aplicación está cerrada. No guarda nada en caché, y es a propósito.

   Una caché aquí serviría para funcionar sin red, pero esta aplicación
   no hace nada sin red —los datos están en Supabase— así que lo único
   que aportaría es la posibilidad de servir una versión vieja del
   JavaScript a quien ya tenga la página instalada. En este proyecto la
   caché del navegador ya ha hecho perder tiempo tres veces persiguiendo
   fallos que no existían; meter una segunda caché, encima persistente y
   difícil de borrar desde el móvil, sería buscárselo.

   Si algún día hace falta funcionar sin red, se añade aquí con cabeza y
   con un número de versión que se pueda subir a mano.

   skipWaiting + clients.claim: un service worker viejo puede quedarse
   semanas sirviendo a un móvil que no cierra la pestaña. Con estas dos
   líneas, la versión nueva manda en cuanto se despliega, que es lo que
   hace falta para poder arreglar esto si sale mal.
   ═════════════════════════════════════════════════════════════ */

const VERSION = 'ta-1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

/* Sin caché: se deja pasar. El manejador existe igualmente porque la
   instalación de una aplicación web lo pide. */
self.addEventListener('fetch', () => {});


/* ── EL AVISO ──────────────────────────────────────────────────
   Llega del servidor con la toma que toca. El texto NUNCA dice
   «dásela»: para cuando lees el aviso, tu pareja puede haberla dado
   ya, y una notificación enviada no se puede retirar de la pantalla
   de un móvil con garantías. Dice qué toca y manda a comprobarlo.
   ────────────────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }

  const titulo = d.titulo || 'Tracking Álex';
  const opciones = {
    body:  d.cuerpo || 'Toca una toma. Compruébalo en la aplicación.',
    icon:  '../marca/icono-192.png',
    badge: '../marca/icono-192.png',
    lang:  'es',
    // El tag hace que un aviso nuevo de la MISMA toma sustituya al
    // anterior en vez de apilarse. No borra el viejo de otra toma: eso
    // no se puede, y por eso el texto no da nada por hecho.
    tag:   d.tag || 'medicacion',
    renotify: false,
    requireInteraction: false,
    data: { url: d.url || './?tab=medicacion' }
  };

  e.waitUntil(self.registration.showNotification(titulo, opciones));
});

/* Al pulsarla: si la aplicación ya está abierta en alguna pestaña, se
   trae esa a primer plano en vez de abrir otra. Abrir una segunda copia
   de una aplicación que ya tienes abierta es desconcertante. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || './?tab=medicacion';

  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = new URL(destino, self.registration.scope).href;

    for (const c of abiertas) {
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
        if ('navigate' in c) { try { await c.navigate(url); } catch (err) {} }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
