/* ═════════════════════════════════════════════════════════════
   SERVICE WORKER DE CARGA UJI

   Existe para UNA cosa: recibir el aviso de que se ha liberado un poste
   cuando la aplicación está cerrada. No guarda nada en caché, por el
   mismo motivo que el de la app del bebé: una caché persistente y
   difícil de borrar desde el móvil sólo sirve aquí para servir
   JavaScript viejo, y este proyecto ya ha perdido tiempo tres veces
   persiguiendo fallos que eran la caché.

   ── POR QUÉ ES UN FICHERO APARTE Y NO app/sw.js ──
   El ámbito de un service worker es la carpeta desde la que se registra.
   /app/ y /carga/ no se solapan, así que son DOS registros
   independientes: cada uno recibe sólo sus avisos y abre sólo su
   aplicación. Si los dos compartieran uno, un aviso de medicación podría
   acabar abriendo los cargadores.

   Lo que SÍ comparten es el permiso de notificaciones, que el navegador
   guarda por ORIGEN y no por ámbito. Si alguien bloqueó los avisos en
   trackingalex.app, aquí nacen bloqueados. Eso no se puede arreglar
   desde el código; push.js lo dice en pantalla.
   ═════════════════════════════════════════════════════════════ */

const VERSION = 'carga-1';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

/* Sin caché: se deja pasar. El manejador existe igualmente porque la
   instalación de una aplicación web lo pide. */
self.addEventListener('fetch', () => {});


/* ── EL AVISO ──────────────────────────────────────────────────
   El texto no promete una plaza. Entre que el poste se libera y que tú
   llegas al aparcamiento pueden pasar diez minutos y otro coche, y un
   aviso que diga «tienes sitio» para luego no haberlo se desactiva a la
   segunda vez. Dice qué se ha liberado y dónde, y la decisión es tuya.
   ────────────────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }

  const titulo = d.titulo || '⚡ Carga UJI';
  const opciones = {
    body:  d.cuerpo || 'Se ha liberado un poste en el campus.',
    icon:  'icono-192.png',
    badge: 'icono-192.png',
    lang:  'es',

    /* El tag es la ZONA: un aviso nuevo de la misma zona sustituye al
       anterior en vez de apilarse, pero dos zonas distintas conviven en
       la pantalla. Es la misma política que el enfriamiento de la base
       de datos, que también va por usuario y zona. */
    tag:   d.tag || 'carga',
    renotify: false,
    requireInteraction: false,
    data: { url: d.url || './' }
  };

  e.waitUntil(self.registration.showNotification(titulo, opciones));
});

/* Al pulsarla: si ya hay una ventana abierta, se trae a primer plano en
   vez de abrir otra copia. Y se le manda un mensaje para que refresque
   el estado en vez de recargar la página entera: el aviso es de hace
   unos segundos, pero lo que la ventana tiene pintado puede ser de hace
   veinte, y lo primero que hará la persona es mirar el número. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || './';

  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = new URL(destino, self.registration.scope).href;

    for (const c of abiertas) {
      if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
        try { c.postMessage({ tipo: 'refrescar' }); } catch (err) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
