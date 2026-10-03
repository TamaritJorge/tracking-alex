/* ═══════════════════════════════════════════════════════════════
   ENVIAR LOS AVISOS DE MEDICACION

   La llama pg_cron cada pocos minutos. Pregunta a la base de datos que
   tomas acaban de tocar y no ha marcado nadie, y manda un aviso al movil
   de cada adulto de esa familia.

   QUIEN DECIDE QUE TOCA NO ES ESTA FUNCION. Eso lo dice
   med_avisos_por_enviar(), que por dentro usa la misma med_slots() que el
   cliente. Si la logica estuviera aqui tambien, acabarian discrepando, y
   una discrepancia aqui es una dosis olvidada.

   ── ESTE FICHERO ES LA COPIA BUENA ──
   Durante un tiempo la unica copia de esta funcion fue la desplegada en
   el panel de Supabase: no estaba en el repositorio, asi que un borrado o
   un despliegue equivocado la habria perdido. Ahora vive aqui. Si se
   edita en el panel, hay que traerse el cambio.

       npx supabase functions deploy enviar-recordatorios

   ── EL IDIOMA ──
   El texto se compone AQUI, en el servidor, asi que la traduccion del
   cliente no sirve de nada: cuando el aviso llega, el movil solo pinta lo
   que le mandamos. Por eso med_push guarda el idioma de cada dispositivo
   y med_avisos_por_enviar() lo devuelve.

   Va por DISPOSITIVO y no por usuario a proposito: med_push ya es una
   fila por movil, y dos personas de la misma familia pueden tener el
   telefono en idiomas distintos. Cada una recibe el suyo.
   ═══════════════════════════════════════════════════════════════ */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

/* La clave PUBLICA va aqui en claro, no en los secretos, y es a proposito:
   es publica por diseno y ya viaja en app/push.js, que es JavaScript que
   descarga cualquiera. Guardarla ademas como secreto solo crearia dos
   copias de lo mismo, y el dia que no coincidieran los avisos fallarian
   sin ninguna pista: el navegador rechaza en silencio una firma que no
   casa con la clave con la que se suscribio.

   Si alguna vez hay que cambiarlas, se cambian LAS DOS a la vez: esta y la
   de app/push.js. */
const VAPID_PUB  = 'BKH031KZ1b2QNfdnPqVqN9pyBQhKrmi4Aqvq-xwIiV_JUcQPZoQ_nq_Swnk9lCEVAnBIH5hjH5MN-cngNnpE4as';
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUB  = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:info@trackingalex.app';

/* ── LOS TEXTOS ───────────────────────────────────────────────
   Un objeto y no un fichero de traduccion: son dos frases, y meter
   aqui la maquinaria de idiomas.js significaria mantener dos
   catalogos. Si algun dia esto crece, entonces si.

   El texto NO dice "dasela".

   Para cuando lo lees, tu pareja puede haberla dado ya, y una
   notificacion enviada no se puede retirar de la pantalla de un movil
   con garantias: el tag la sustituye si llega otra igual, pero no la
   borra. Asi que el aviso manda a comprobar, nunca a administrar. Eso
   vale en los dos idiomas.
   ───────────────────────────────────────────────────────────── */
const TEXTOS: Record<string, (n: string, h: string) => string> = {
  es: (nino, hora) =>
    `${nino}: toca la de las ${hora}. Compruebalo en la aplicacion antes de darla.`,
  en: (nino, hora) =>
    `${nino}: the ${hora} one is due. Check in the app before giving it.`
};

function cuerpoAviso(idioma: string, nino: string, hora: string): string {
  const f = TEXTOS[idioma] ?? TEXTOS.es;
  return f(nino, hora);
}

Deno.serve(async (req) => {
  const inicio = Date.now();

  if (!VAPID_PRIV) {
    return new Response(JSON.stringify({
      error: 'Falta VAPID_PRIVATE_KEY en los secretos de la funcion.'
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  webpush.setVapidDetails(VAPID_SUB, VAPID_PUB, VAPID_PRIV);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: avisos, error } = await sb.rpc('med_avisos_por_enviar');
  if (error) {
    console.error('med_avisos_por_enviar:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  let enviados = 0, caidos = 0;

  for (const a of avisos ?? []) {
    /* idioma puede venir nulo en una suscripcion anterior a la columna:
       ?? 'es' deja esas en castellano, que es como estaban. */
    const idioma = (a.idioma ?? 'es') as string;

    const carga = JSON.stringify({
      titulo: `💊 ${a.medicamento}${a.dosis ? ' · ' + a.dosis : ''}`,
      cuerpo: cuerpoAviso(idioma, a.nino, a.hora_slot),
      /* El idioma viaja tambien en la carga: el service worker lo pone en
         la notificacion (lang), que es lo que usan el lector de pantalla y
         la direccion del texto. Antes estaba clavado a 'es'. */
      idioma,
      url: './?tab=medicacion',
      tag: `${a.pauta_id}|${a.fecha_slot}|${a.hora_slot}`
    });

    let ok = false;
    try {
      await webpush.sendNotification({
        endpoint: a.endpoint,
        keys: { p256dh: a.p256dh, auth: a.clave_auth }
      }, carga, { TTL: 3600 });
      ok = true;
      enviados++;
    } catch (e) {
      /* 404 y 410 son el movil diciendo "esta direccion ya no existe":
         desinstalada, navegador limpiado, o iOS que invalida la suscripcion
         por su cuenta. Se apunta el fallo y a la quinta se deja de
         intentar, o se acumulan envios al vacio para siempre. */
      const codigo = (e as { statusCode?: number }).statusCode;
      console.error('push fallido', codigo, String(a.endpoint).slice(0, 60));
      caidos++;
    }

    const { error: e2 } = await sb.rpc('med_aviso_enviado', {
      p_pauta: a.pauta_id,
      p_fecha: a.fecha_slot,
      p_hora:  a.hora_slot,
      p_user:  a.user_id,
      p_endpoint: a.endpoint,
      p_ok: ok
    });
    if (e2) console.error('med_aviso_enviado:', e2);
  }

  return new Response(JSON.stringify({
    ok: true, candidatos: avisos?.length ?? 0, enviados, caidos,
    ms: Date.now() - inicio
  }), { headers: { 'Content-Type': 'application/json' } });
});
