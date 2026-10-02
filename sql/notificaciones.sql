-- ═══════════════════════════════════════════════════════════════════════════
--  NOTIFICACIONES DE MEDICACIÓN (PWA + Web Push)
--
--  ✅ SEGURO     — sólo crea cosas nuevas.
--  ✅ IDEMPOTENTE — se puede ejecutar dos veces.
--
--  Lo que hace falta ADEMÁS de este fichero, y que no se puede hacer desde
--  aquí porque son secretos:
--
--    1. Supabase → Edge Functions → Secrets:
--         VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
--       (están en vapid-NO-SUBIR.txt, fuera del repositorio)
--
--    2. Guardar la clave service_role en el Vault, que es lo que usa el cron
--       para llamar a la función:
--         select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
--    3. Programar el cron (al final de este fichero).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. UNA suscripción por móvil ───────────────────────────────────────────
--
-- ON DELETE CASCADE, en contra de la costumbre de este proyecto, y a
-- propósito: una suscripción no es un dato del bebé, es una dirección de
-- entrega. Guardarla después de borrar la cuenta sólo serviría para mandar
-- avisos a una cuenta que ya no existe. Además borrar_mi_cuenta() borra de
-- auth.users directamente, así que sin cascade el borrado se rompería.

CREATE TABLE IF NOT EXISTS public.med_push (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL DEFAULT auth.uid()
                         REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  agente     TEXT,
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_ok  TIMESTAMPTZ,
  fallos     INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_med_push_user ON public.med_push (user_id);

ALTER TABLE public.med_push ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "med_push_mias" ON public.med_push;
CREATE POLICY "med_push_mias" ON public.med_push
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_push TO authenticated;
REVOKE ALL ON public.med_push FROM anon;
REVOKE TRUNCATE, TRIGGER ON public.med_push FROM authenticated;


-- ── 2. Lo ya avisado ───────────────────────────────────────────────────────
-- El cron se despierta cada pocos minutos; sin esto, la misma toma avisaría
-- en cada vuelta hasta que alguien la marcara.

CREATE TABLE IF NOT EXISTS public.med_avisos (
  pauta_id   UUID        NOT NULL REFERENCES public.med_pautas(id) ON DELETE CASCADE,
  fecha_slot DATE        NOT NULL,
  hora_slot  TEXT        NOT NULL,
  user_id    UUID        NOT NULL,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pauta_id, fecha_slot, hora_slot, user_id)
);

ALTER TABLE public.med_avisos ENABLE ROW LEVEL SECURITY;
-- Sin políticas y sin GRANT: esta tabla es sólo del servidor.
REVOKE ALL ON public.med_avisos FROM anon, authenticated;


-- ── 3. UNA sola definición de «qué ranuras hay» ────────────────────────────
--
-- La usan el cliente (med_pendientes) y el cron (med_avisos_por_enviar). Si
-- cada uno calculara las suyas acabarían desincronizándose, y una
-- desincronización aquí es una dosis olvidada.
--
-- SECURITY INVOKER: llamada desde el cliente la filtran las políticas de
-- med_pautas; llamada desde una función SECURITY DEFINER, manda el dueño y
-- las ve todas, que es lo que necesita el cron.

CREATE OR REPLACE FUNCTION public.med_slots(
  p_nino UUID, p_desde INTERVAL, p_hasta INTERVAL
)
RETURNS TABLE (
  nino_id UUID, pauta_id UUID, nombre TEXT, dosis TEXT, zona TEXT,
  horas TEXT[], fecha_slot DATE, hora_slot TEXT, momento TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  WITH dias AS (
    SELECT p.*, d::date AS dia
      FROM med_pautas p,
           LATERAL generate_series(
             (timezone(p.zona, now()))::date - 1,
             (timezone(p.zona, now()))::date + 1,
             interval '1 day') AS d
     WHERE p_nino IS NULL OR p.nino_id = p_nino
  ),
  slots AS (
    SELECT d.nino_id, d.id, d.nombre, d.dosis, d.zona, d.horas, d.creada_en,
           d.dia AS fecha_slot, h AS hora_slot,
           timezone(d.zona, (d.dia::text || ' ' || h)::timestamp) AS momento
      FROM dias d, LATERAL unnest(d.horas) AS h
     WHERE d.dia >= d.desde AND (d.hasta IS NULL OR d.dia <= d.hasta)
  )
  SELECT s.nino_id, s.id, s.nombre, s.dosis, s.zona, s.horas,
         s.fecha_slot, s.hora_slot, s.momento
    FROM slots s
   WHERE s.momento >= now() + p_desde
     AND s.momento <= now() + p_hasta
     AND s.momento >= s.creada_en
   ORDER BY s.momento, s.nombre;
$function$;

GRANT EXECUTE ON FUNCTION public.med_slots(UUID, INTERVAL, INTERVAL) TO authenticated;


CREATE OR REPLACE FUNCTION public.med_pendientes(p_nino UUID)
RETURNS TABLE (
  pauta_id UUID, nombre TEXT, dosis TEXT, zona TEXT,
  horas TEXT[], fecha_slot DATE, hora_slot TEXT, momento TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
  SELECT s.pauta_id, s.nombre, s.dosis, s.zona, s.horas,
         s.fecha_slot, s.hora_slot, s.momento
    FROM med_slots(p_nino, interval '-12 hours', interval '2 hours') s
   WHERE NOT EXISTS (
           SELECT 1 FROM med_tomas t
            WHERE t.pauta_id = s.pauta_id AND t.fecha_slot = s.fecha_slot
              AND t.hora_slot = s.hora_slot AND t.estado <> 'anulada')
   ORDER BY s.momento, s.nombre;
$function$;

GRANT EXECUTE ON FUNCTION public.med_pendientes(UUID) TO authenticated;


-- ── 4. Lo que el cron tiene que mandar ─────────────────────────────────────
--
-- SECURITY DEFINER porque mira TODAS las familias. Por eso mismo el EXECUTE
-- se le da sólo a service_role: si lo tuviera authenticated, cualquiera con
-- una sesión podría leer las medicinas y los móviles de todas las familias de
-- un tirón. Es la función más peligrosa del proyecto y la única que el
-- cliente no toca nunca.

CREATE OR REPLACE FUNCTION public.med_avisos_por_enviar()
RETURNS TABLE (
  user_id UUID, endpoint TEXT, p256dh TEXT, clave_auth TEXT,
  pauta_id UUID, fecha_slot DATE, hora_slot TEXT,
  medicamento TEXT, dosis TEXT, nino TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT ps.user_id, ps.endpoint, ps.p256dh, ps.auth,
         s.pauta_id, s.fecha_slot, s.hora_slot, s.nombre, s.dosis, n.nombre
    FROM med_slots(NULL, interval '-20 minutes', interval '0 minutes') s
    JOIN ninos            n  ON n.id = s.nino_id
    JOIN familia_miembros m  ON m.familia_id = n.familia_id
    JOIN med_push         ps ON ps.user_id = m.user_id
   WHERE ps.fallos < 5
     AND NOT EXISTS (
           SELECT 1 FROM med_tomas t
            WHERE t.pauta_id = s.pauta_id AND t.fecha_slot = s.fecha_slot
              AND t.hora_slot = s.hora_slot AND t.estado <> 'anulada')
     AND NOT EXISTS (
           SELECT 1 FROM med_avisos a
            WHERE a.pauta_id = s.pauta_id AND a.fecha_slot = s.fecha_slot
              AND a.hora_slot = s.hora_slot AND a.user_id = ps.user_id);
$function$;

REVOKE ALL ON FUNCTION public.med_avisos_por_enviar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.med_avisos_por_enviar() TO service_role;


CREATE OR REPLACE FUNCTION public.med_aviso_enviado(
  p_pauta UUID, p_fecha DATE, p_hora TEXT, p_user UUID, p_endpoint TEXT, p_ok BOOLEAN
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_ok THEN
    INSERT INTO med_avisos (pauta_id, fecha_slot, hora_slot, user_id)
    VALUES (p_pauta, p_fecha, p_hora, p_user)
    ON CONFLICT DO NOTHING;
    UPDATE med_push SET ultimo_ok = now(), fallos = 0 WHERE endpoint = p_endpoint;
  ELSE
    -- Un móvil que ya no acepta avisos: desinstalado, navegador limpiado, o
    -- iOS que invalida la suscripción por su cuenta. A la quinta se deja de
    -- intentar; med_avisos_por_enviar() ya filtra por fallos < 5.
    UPDATE med_push SET fallos = fallos + 1 WHERE endpoint = p_endpoint;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.med_aviso_enviado(UUID, DATE, TEXT, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.med_aviso_enviado(UUID, DATE, TEXT, UUID, TEXT, BOOLEAN)
  TO service_role;


-- ── 5. El reloj ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Cada 5 minutos. Más a menudo no sirve de nada: la ventana de
-- med_avisos_por_enviar() es de 20 minutos para que una vuelta perdida no
-- se coma un aviso, y una notificación de medicación con cinco minutos de
-- retraso sigue siendo útil.
--
-- Requiere el paso 2 de la cabecera (el secreto en el Vault).
--
--   select cron.schedule('med-avisos', '*/5 * * * *', $cron$
--     select net.http_post(
--       url := 'https://yzarrncayxkvkpyflbrk.supabase.co/functions/v1/enviar-recordatorios',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || (select decrypted_secret
--                                          from vault.decrypted_secrets
--                                         where name = 'service_role_key')),
--       body := '{}'::jsonb
--     );
--   $cron$);
--
-- Para pararlo:   select cron.unschedule('med-avisos');
-- Para mirarlo:   select * from cron.job_run_details order by start_time desc limit 10;
