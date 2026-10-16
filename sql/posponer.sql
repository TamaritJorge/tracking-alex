-- ═══════════════════════════════════════════════════════════════════════════
--  QUE POSPONER POSPONGA DE VERDAD
--
--  ── EL FALLO ──
--  Al pulsar «Posponer 30 min» la aplicación contesta, literalmente, «Te lo
--  recuerdo en 30 min». Y no lo hacía. El aviso no volvía nunca.
--
--  El motivo son dos cosas que se suman:
--
--    1. Posponer sólo escribía en el localStorage del móvil. Repinta el
--       banner de dentro de la app, y nada más: no hay nadie en el servidor
--       que sepa que has pospuesto algo.
--
--    2. med_avisos_por_enviar() manda UN aviso por (pauta, ranura, usuario) y
--       nunca más, porque existe la fila en med_avisos. Y además sólo mira
--       ranuras de los últimos 20 minutos, así que una pospuesta media hora
--       ya se le ha escapado por los dos lados.
--
--  Prometer un recordatorio y no darlo es peor que no ofrecer el botón: la
--  gente cuenta con él y cierra la aplicación tranquila.
--
--  ── LA FORMA DE ARREGLARLO ──
--  Una columna `recordar_en` en med_avisos. Posponer la rellena; la consulta
--  del cron devuelve también las filas cuyo recordar_en ya ha pasado; y al
--  reenviar se pone a NULL, que es lo que evita que se repita en bucle cada
--  vez que el cron despierta.
--
--  ── SIGUE SIENDO PERSONAL ──
--  med_avisos es por user_id, así que posponer sigue siendo un acto de UNA
--  persona: no calla el aviso de tu pareja, que es exactamente lo que este
--  módulo existe para evitar. El localStorage se queda para el banner de
--  dentro de la app, que es de este móvil y de nadie más.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. LA COLUMNA ──────────────────────────────────────────────────────────

ALTER TABLE public.med_avisos
  ADD COLUMN IF NOT EXISTS recordar_en TIMESTAMPTZ;

COMMENT ON COLUMN public.med_avisos.recordar_en IS
  'Cuándo hay que volver a avisar de esta ranura. Lo pone med_posponer(); '
  'med_aviso_enviado() lo devuelve a NULL al reenviar. NULL = no hay nada pendiente.';

-- Para que la rama nueva de la consulta no recorra la tabla entera cada
-- minuto. Parcial: las filas con recordar_en son siempre un puñado.
CREATE INDEX IF NOT EXISTS med_avisos_recordar_idx
  ON public.med_avisos (recordar_en)
  WHERE recordar_en IS NOT NULL;


-- ── 2. POSPONER ────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque med_avisos no la toca el cliente: es la tabla con
-- la que el cron decide a quién avisar, y abrirla a escritura directa sería
-- dejar que cualquiera silencie o dispare avisos ajenos. Aquí sólo se puede
-- hacer una cosa, sobre la propia fila y sobre una pauta de la propia familia.
--
-- search_path = '' y todo cualificado: con 'public', PostgreSQL mira antes en
-- pg_temp, y una tabla temporal con el nombre adecuado se ejecutaría con los
-- permisos del dueño de la función.

CREATE OR REPLACE FUNCTION public.med_posponer(
  p_pauta   UUID,
  p_fecha   DATE,
  p_hora    TEXT,
  p_minutos INT DEFAULT 30
) RETURNS TIMESTAMPTZ
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
DECLARE
  v_user    UUID := auth.uid();
  v_minutos INT  := LEAST(GREATEST(COALESCE(p_minutos, 30), 5), 180);
  v_cuando  TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'hace falta estar identificado';
  END IF;

  -- Que la pauta sea de un hijo de su familia. Sin esto, con un id prestado
  -- se podrían programar avisos sobre la medicación de otra casa.
  IF NOT EXISTS (
    SELECT 1
      FROM public.med_pautas p
      JOIN public.ninos n ON n.id = p.nino_id
     WHERE p.id = p_pauta
       AND public.es_miembro(n.familia_id)
  ) THEN
    RAISE EXCEPTION 'sin permiso sobre esa pauta';
  END IF;

  v_cuando := now() + make_interval(mins => v_minutos);

  /* Puede no haber fila todavía: se pospone desde el banner de la app sin
     que haya llegado ningún push (móvil sin avisos, o todavía no es la
     hora). Insertar la fila igualmente es lo correcto — lo que se está
     pidiendo es «avísame a esta hora», no «repite aquel aviso». */
  INSERT INTO public.med_avisos (pauta_id, fecha_slot, hora_slot, user_id, recordar_en)
  VALUES (p_pauta, p_fecha, p_hora, v_user, v_cuando)
  ON CONFLICT (pauta_id, fecha_slot, hora_slot, user_id)
  DO UPDATE SET recordar_en = EXCLUDED.recordar_en;

  RETURN v_cuando;
END $function$;

REVOKE ALL ON FUNCTION public.med_posponer(UUID, DATE, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.med_posponer(UUID, DATE, TEXT, INT) TO authenticated;


-- ── 3. AL ENVIAR, BORRAR EL APLAZAMIENTO ───────────────────────────────────
--
-- Era ON CONFLICT DO NOTHING. Con la columna nueva eso es un bucle: la fila
-- se quedaría con un recordar_en ya pasado y el cron la reenviaría cada
-- minuto para siempre. Ahora el reenvío la deja a NULL.

CREATE OR REPLACE FUNCTION public.med_aviso_enviado(
  p_pauta UUID, p_fecha DATE, p_hora TEXT, p_user UUID, p_endpoint TEXT, p_ok BOOLEAN
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $function$
BEGIN
  IF p_ok THEN
    INSERT INTO public.med_avisos (pauta_id, fecha_slot, hora_slot, user_id)
    VALUES (p_pauta, p_fecha, p_hora, p_user)
    ON CONFLICT (pauta_id, fecha_slot, hora_slot, user_id)
    DO UPDATE SET recordar_en = NULL, enviado_en = now();

    UPDATE public.med_push SET ultimo_ok = now(), fallos = 0 WHERE endpoint = p_endpoint;
  ELSE
    -- Un movil que ya no acepta avisos (desinstalado, navegador limpiado,
    -- iOS que invalida la suscripcion sola). A la quinta se deja de
    -- intentar; med_avisos_por_enviar() ya filtra por fallos < 5.
    UPDATE public.med_push SET fallos = fallos + 1 WHERE endpoint = p_endpoint;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.med_aviso_enviado(UUID, DATE, TEXT, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.med_aviso_enviado(UUID, DATE, TEXT, UUID, TEXT, BOOLEAN)
  TO service_role;


-- ── 4. LA CONSULTA DEL CRON ────────────────────────────────────────────────
--
-- Dos ramas, y no una ventana más ancha. Ensanchar med_slots() habría hecho
-- que cualquier toma olvidada de hace horas volviera a sonar sola, que es
-- otro fallo distinto y peor.
--
--   A) lo de siempre: ranuras de los últimos 20 minutos sin aviso ninguno.
--   B) las pospuestas cuyo momento ya ha llegado. Ésta no necesita
--      med_slots(): la fila de med_avisos ya dice de qué ranura se trata.
--
-- No se solapan: la A exige que NO exista fila y la B exige que exista.
--
-- El corte de 6 horas en la B es para que un cron caído media noche no
-- despierte a nadie a las seis de la mañana con avisos de ayer.
--
-- Sigue siendo SECURITY DEFINER porque mira TODAS las familias, y por eso
-- mismo el EXECUTE es sólo para service_role.

DROP FUNCTION IF EXISTS public.med_avisos_por_enviar();

CREATE FUNCTION public.med_avisos_por_enviar()
 RETURNS TABLE(user_id uuid, endpoint text, p256dh text, clave_auth text,
               pauta_id uuid, fecha_slot date, hora_slot text,
               medicamento text, dosis text, nino text, idioma text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  -- A) la primera vez
  SELECT ps.user_id, ps.endpoint, ps.p256dh, ps.auth,
         s.pauta_id, s.fecha_slot, s.hora_slot, s.nombre, s.dosis, n.nombre,
         ps.idioma
    FROM public.med_slots(NULL, interval '-20 minutes', interval '0 minutes') s
    JOIN public.ninos            n  ON n.id = s.nino_id
    JOIN public.familia_miembros m  ON m.familia_id = n.familia_id
    JOIN public.med_push         ps ON ps.user_id = m.user_id
   WHERE ps.fallos < 5
     AND NOT EXISTS (
           SELECT 1 FROM public.med_tomas t
            WHERE t.pauta_id   = s.pauta_id
              AND t.fecha_slot = s.fecha_slot
              AND t.hora_slot  = s.hora_slot
              AND t.estado <> 'anulada')
     AND NOT EXISTS (
           SELECT 1 FROM public.med_avisos a
            WHERE a.pauta_id   = s.pauta_id
              AND a.fecha_slot = s.fecha_slot
              AND a.hora_slot  = s.hora_slot
              AND a.user_id    = ps.user_id)

  UNION ALL

  -- B) las pospuestas a las que ya les toca
  SELECT ps.user_id, ps.endpoint, ps.p256dh, ps.auth,
         a.pauta_id, a.fecha_slot, a.hora_slot, p.nombre, p.dosis, n.nombre,
         ps.idioma
    FROM public.med_avisos a
    JOIN public.med_pautas p  ON p.id = a.pauta_id
    JOIN public.ninos      n  ON n.id = p.nino_id
    JOIN public.med_push   ps ON ps.user_id = a.user_id
   WHERE a.recordar_en IS NOT NULL
     AND a.recordar_en <= now()
     AND a.recordar_en >  now() - interval '6 hours'
     AND ps.fallos < 5
     AND NOT EXISTS (
           SELECT 1 FROM public.med_tomas t
            WHERE t.pauta_id   = a.pauta_id
              AND t.fecha_slot = a.fecha_slot
              AND t.hora_slot  = a.hora_slot
              AND t.estado <> 'anulada');
$function$;

-- El DROP se lleva los permisos por delante. Si se olvidara, el cron dejaría
-- de poder llamarla y los avisos se pararían sin dar ningún error visible.
REVOKE ALL ON FUNCTION public.med_avisos_por_enviar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.med_avisos_por_enviar() TO service_role;
