/* ═══════════════════════════════════════════════════════════════
   SONDEAR LOS CARGADORES DE LA UJI

   La llama pg_cron. Pregunta a la UJI que postes hay libres, se lo pasa
   a la base de datos, y si algun poste ha pasado de ocupado a libre
   manda los avisos de esa zona.

   ── EL AVISO ES DE UN SOLO USO ──
   Nadie esta suscrito de forma permanente. Se ARMA desde la pagina cuando
   hace falta —vas de camino y la zona esta llena— y se GASTA al
   dispararse. Aqui eso no cambia nada del sondeo: lo unico que lo
   implementa es carga_aviso_enviado(), que vacia las zonas armadas.

   QUIEN DECIDE QUE ES UN CAMBIO NO ES ESTA FUNCION. Eso lo hace
   carga_registrar(), dentro de la base. Aqui solo se pide y se pasa. Si
   la logica estuviera repartida entre los dos sitios acabarian
   discrepando, y una discrepancia aqui es un historial que miente.

   ── UN SOLO CRON, LA DECISION AQUI ──
   pg_cron la llama cada 2 minutos siempre. Es esta funcion la que mira
   el reloj: en horario laboral actua siempre, fuera solo si el minuto es
   multiplo de 15, y SIEMPRE si alguien tiene un aviso armado. Una regla
   en un sitio, en vez de tres expresiones de cron que se solapan y que
   hay que leer a la vez para saber cuando corre de verdad.

   ── LA CARGA SOBRE LA UJI ──
   Son unas 400 peticiones al dia. La pagina oficial refresca cada 5
   segundos: una sola persona con esa pestana abierta hace 17.000. Esto
   es 1/40 de un usuario. Aun asi la funcion se identifica con un
   User-Agent propio para que, si molestara, sepan a quien escribir.

       npx supabase functions deploy sondear-carga

   ── EL PAR VAPID ES PROPIO ──
   VAPID_PRIVATE_KEY_CARGA, no el de la medicacion. Las suscripciones
   quedan atadas a la clave con la que se crearon, asi que compartirlo
   haria imposible rotar una sin romper la otra.
   ═══════════════════════════════════════════════════════════════ */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const UJI_ESTADO =
  'https://e-ujier.uji.es/pls/www/!gri_www.euji24130?p_accion=GET_POINTS';

/* La publica va aqui en claro, igual que en carga/push.js, y es a
   proposito: es publica por diseno y ya viaja en el JavaScript que
   descarga cualquiera. Guardarla ademas como secreto solo crearia dos
   copias de lo mismo, y el dia que no coincidieran los avisos fallarian
   SIN NINGUNA PISTA: el navegador rechaza en silencio una firma que no
   casa con la clave con la que se suscribio.

   Si hay que cambiarla, se cambian LAS DOS a la vez: esta y la de
   carga/push.js. */
const VAPID_PUB  = 'BF0oXFDFCF0xPyfMYnLL4JgJJIK9ro6GssbCkS-q1cWatn1hdomvzcdpZQVlsZX2fQNEdjzjFGVoizg5Ia650zU';
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY_CARGA') ?? '';
const VAPID_SUB  = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:info@trackingalex.app';

const AGENTE = 'TrackingAlex-CargaUJI/1.0 (+https://trackingalex.app/carga/)';


/* ── ¿TOCA SONDEAR AHORA? ────────────────────────────────────
   En hora de Madrid, no en UTC: el cambio de hora movería la franja
   laboral media hora dos veces al ano y nadie se acordaria de por que. */
function toca(ahora: Date): boolean {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hour12: false
  }).formatToParts(ahora);
  const g = (t: string) => f.find(p => p.type === t)?.value ?? '';

  const hora   = Number(g('hour'));
  const minuto = Number(g('minute'));
  const finde  = g('weekday') === 'Sat' || g('weekday') === 'Sun';

  const laboral = !finde && hora >= 7 && hora < 21;
  return laboral || minuto % 15 === 0;
}

/* El latido diario: una vez al dia, hacia las 4 de la madrugada, se deja
   constancia de que el sondeo seguia vivo aunque no cambiara nada. Sin
   esto no hay forma de distinguir «ocupado ocho horas» de «el cron
   estuvo caido ocho horas». */
function tocaLatido(ahora: Date): boolean {
  const hora = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false
  }).format(ahora));
  return hora === 4;
}


Deno.serve(async () => {
  const inicio = Date.now();
  const ahora  = new Date();

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  /* Fuera de turno se sondea cada 15 minutos en vez de cada 2... salvo que
     alguien tenga un aviso ARMADO. Quien arma uno un sabado se enteraria
     hasta 15 minutos tarde de que se ha liberado un poste, y para entonces
     ya hay otro coche: el aviso seria inutil justo cuando mas falta hace.

     La consulta extra solo ocurre en la rama de saltar, y lo normal es que
     no haya nadie esperando, asi que esto no cambia el volumen de
     peticiones a la UJI en la practica. */
  if (!toca(ahora)) {
    const { data: armados, error: eArm } = await sb.rpc('carga_hay_armados');
    if (eArm) console.error('carga_hay_armados:', eArm);
    if (!armados) {
      return new Response(JSON.stringify({ ok: true, saltado: 'fuera de turno' }),
        { headers: { 'Content-Type': 'application/json' } });
    }
  }

  /* ── 1. PREGUNTAR A LA UJI ──
     El endpoint no esta documentado y puede cambiar o desaparecer sin
     avisar. Si la respuesta no es lo que esperamos NO se interpreta a
     medias: se corta aqui. Mejor un hueco en el historial que un
     historial corrupto. */
  let puntos: unknown;
  try {
    const r = await fetch(UJI_ESTADO, {
      headers: { 'User-Agent': AGENTE, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    puntos = await r.json();
  } catch (e) {
    console.error('endpoint UJI:', e);
    return new Response(JSON.stringify({ error: 'no se pudo consultar a la UJI: ' + String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  if (!Array.isArray(puntos) || puntos.length === 0) {
    console.error('respuesta inesperada de la UJI:', JSON.stringify(puntos).slice(0, 300));
    return new Response(JSON.stringify({ error: 'respuesta vacia o con otro formato' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  /* ── 2. REGISTRAR ──
     Devuelve las zonas en las que algun poste ha pasado a libre. */
  const { data: reg, error: eReg } = await sb.rpc('carga_registrar', { p_puntos: puntos });
  if (eReg) {
    console.error('carga_registrar:', eReg);
    return new Response(JSON.stringify({ error: eReg.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  if (reg?.error) {
    console.error('carga_registrar rechazo la respuesta:', reg.error);
    return new Response(JSON.stringify({ error: reg.error }),
      { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  if (reg?.desconocidos > 0) {
    // No se descarta en silencio: si la UJI anade o mueve un poste, hay
    // que enterarse, y el sitio donde se mira son estos registros.
    console.warn('coordenadas desconocidas en este sondeo:', reg.desconocidos);
  }

  if (tocaLatido(ahora)) {
    const { data: lat, error: eLat } = await sb.rpc('carga_latido');
    if (eLat) console.error('carga_latido:', eLat);
    else if (lat) console.log('latido: ' + lat + ' filas');
  }

  const liberadas: string[] = Array.isArray(reg?.liberadas) ? reg.liberadas : [];
  if (liberadas.length === 0) {
    return new Response(JSON.stringify({
      ok: true, cambios: reg?.cambios ?? 0, avisos: 0, ms: Date.now() - inicio
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  /* ── 3. AVISAR ──
     Sin clave privada no se puede firmar. Se dice y se sale, pero el
     registro de arriba ya esta guardado: el historial no depende de que
     los avisos funcionen. */
  if (!VAPID_PRIV) {
    console.error('Falta VAPID_PRIVATE_KEY_CARGA en los secretos de la funcion.');
    return new Response(JSON.stringify({
      ok: true, cambios: reg?.cambios ?? 0, liberadas,
      avisos: 'sin clave VAPID', ms: Date.now() - inicio
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  webpush.setVapidDetails(VAPID_SUB, VAPID_PUB, VAPID_PRIV);

  const { data: avisos, error: eAv } =
    await sb.rpc('carga_avisos_por_enviar', { p_zonas: liberadas });
  if (eAv) {
    console.error('carga_avisos_por_enviar:', eAv);
    return new Response(JSON.stringify({ error: eAv.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let enviados = 0, caidos = 0;

  for (const a of avisos ?? []) {
    /* El texto dice QUE ha pasado y DONDE, nunca «tienes sitio». Entre
       que el poste se libera y que llegas puede haber otro coche, y un
       aviso que promete una plaza y falla se desactiva a la segunda. */
    const carga = JSON.stringify({
      titulo: `⚡ ${a.zona_nombre}`,
      cuerpo: (a.libres === 1
        ? `Se ha liberado un poste. Queda 1 de ${a.total}.`
        : `Se ha liberado un poste. Quedan ${a.libres} de ${a.total}.`)
        // Se dice que el aviso se ha gastado. Si no, la primera reaccion
        // al volver otro dia es esperar uno que no va a llegar.
        + ' El aviso queda desactivado.',
      url: './',
      tag: 'carga-' + a.zona_id
    });

    let ok = false;
    try {
      await webpush.sendNotification({
        endpoint: a.endpoint,
        keys: { p256dh: a.p256dh, auth: a.clave_auth }
      }, carga, { TTL: 900 });   // 15 min: pasado ese rato el dato ya no vale
      ok = true;
      enviados++;
    } catch (e) {
      /* 404 y 410 son el movil diciendo «esta direccion ya no existe».
         Se apunta el fallo y a la quinta se deja de intentar. */
      const codigo = (e as { statusCode?: number }).statusCode;
      console.error('push fallido', codigo, String(a.endpoint).slice(0, 60));
      caidos++;
    }

    /* Desarma el aviso, que es lo que lo hace de un solo uso. Se hace en
       la base y no aqui: si fallara a mitad del bucle, el aviso quedaria
       armado y volveria a sonar dentro de dos minutos. */
    const { error: e2 } = await sb.rpc('carga_aviso_enviado', {
      p_endpoint: a.endpoint, p_ok: ok
    });
    if (e2) console.error('carga_aviso_enviado:', e2);
  }

  return new Response(JSON.stringify({
    ok: true, cambios: reg?.cambios ?? 0, desconocidos: reg?.desconocidos ?? 0,
    liberadas, candidatos: avisos?.length ?? 0, enviados, caidos,
    ms: Date.now() - inicio
  }), { headers: { 'Content-Type': 'application/json' } });
});
