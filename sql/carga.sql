-- ═══════════════════════════════════════════════════════════════════════════
--  CARGA UJI — disponibilidad de los puntos de recarga del campus
--
--  ✅ SEGURO       no toca ninguna tabla de Tracking Álex salvo una función
--  ✅ IDEMPOTENTE  se puede volver a ejecutar entero
--
--  Es una herramienta aparte que vive en el mismo proyecto de Supabase. No
--  comparte ni una tabla con la aplicación del bebé, y hay un motivo muy
--  concreto para que así sea; está escrito abajo, en carga_push.
--
--  ── DE DÓNDE SALEN LOS DATOS ──
--  La UJI publica el estado en vivo en un endpoint sin autenticar:
--
--    https://e-ujier.uji.es/pls/www/!gri_www.euji24130?p_accion=GET_POINTS
--    → [{"y":39.994165,"x":-0.075264,"disponible":0}, …]   13 objetos
--      disponible: 1 = LIBRE   (la página oficial lo pinta verde)
--
--  Devuelve SÓLO coordenadas: no hay identificadores. Por eso carga_postes
--  se siembra con las trece posiciones conocidas y cada sondeo empareja por
--  cercanía. Una coordenada que no encaje NO se descarta en silencio: se
--  guarda en carga_desconocidos. Si la UJI añade un poste, hay que enterarse.
--
--  ── LOS 13 SON POSTES, NO ENCHUFES ──
--  La página habla de 26 puntos para coches. Agrupando las coordenadas salen
--  6 zonas de 3·2·3·2·2·1 postes, que a 2 conectores por poste dan 26. Lo que
--  no se sabe es si `disponible` mira el poste o uno de sus dos conectores;
--  se asume el poste y así se nombra en la interfaz.
--
--  ── PASOS MANUALES FUERA DE ESTE FICHERO ──
--    1. Secreto VAPID de esta aplicación (es un par PROPIO, no el del bebé):
--         supabase secrets set VAPID_PRIVATE_KEY_CARGA=...
--    2. El trabajo de cron, al final de este fichero (comentado).
--    3. Poner nombre a las seis zonas: ver `carga_zonas` más abajo.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. ZONAS ───────────────────────────────────────────────────────────────
--
-- Las letras A..F vienen del mapa que se usó para identificarlas y NO se
-- reordenan nunca: si mañana se ordenaran por longitud o por nombre, las
-- preferencias de aviso que ya tiene guardada la gente (carga_push.zonas)
-- pasarían a apuntar a otro sitio sin que nadie se entere.
--
-- `nombre` nació NULL a propósito, porque el recuento de puntos no distingue
-- las dos zonas de seis ni las tres de cuatro y ponerlas a ojo habría sido
-- inventar. Ya están identificadas sobre el plano oficial del campus, así que
-- se siembran abajo.
--
-- El nombre vive AQUÍ y no sólo en carga/carga.js porque el título del aviso
-- lo escribe el servidor: sin esto la notificación diría «Zona C» y habría
-- que traducirla de cabeza. Si alguno resulta estar mal, se corrige en los
-- dos sitios a la vez.

CREATE TABLE IF NOT EXISTS public.carga_zonas (
  id     TEXT PRIMARY KEY CHECK (id ~ '^[A-Z]$'),
  nombre TEXT,
  orden  SMALLINT NOT NULL DEFAULT 0
);

COMMENT ON TABLE  public.carga_zonas IS
  'Las seis agrupaciones de postes del campus. Las letras son estables: carga_push.zonas las referencia.';
COMMENT ON COLUMN public.carga_zonas.nombre IS
  'Nombre real de la zona. NULL mientras no se haya identificado sobre el mapa.';

INSERT INTO public.carga_zonas (id, orden) VALUES
  ('A', 1), ('B', 2), ('C', 3), ('D', 4), ('E', 5), ('F', 6)
ON CONFLICT (id) DO NOTHING;

UPDATE public.carga_zonas SET nombre = v.nombre
  FROM (VALUES
    ('A', 'CIETD'),
    ('B', 'Investigació II'),
    ('C', 'Ciències de la Salut'),
    ('D', 'Humanes i Socials'),
    ('E', 'Consell Social'),
    ('F', 'ESTCE')
  ) AS v(id, nombre)
 WHERE public.carga_zonas.id = v.id;


-- ── 2. POSTES ──────────────────────────────────────────────────────────────
--
-- Las coordenadas son las que devuelve el endpoint, con todos sus decimales.
-- No se redondean: son la CLAVE con la que se empareja cada sondeo, y
-- redondear acercaría postes que están a 5 m unos de otros.
--
-- Sin ON DELETE CASCADE hacia carga_estado, que es la regla de la casa: un
-- borrado mal hecho tiene que estrellarse en vez de llevarse el historial.

CREATE TABLE IF NOT EXISTS public.carga_postes (
  id          TEXT PRIMARY KEY,
  zona_id     TEXT NOT NULL REFERENCES public.carga_zonas(id),
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  conectores  SMALLINT NOT NULL DEFAULT 2 CHECK (conectores > 0),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.carga_postes IS
  'Los 13 postes del campus. lat/lon son la clave de emparejamiento con el endpoint de la UJI.';

INSERT INTO public.carga_postes (id, zona_id, lat, lon) VALUES
  ('A1', 'A', 39.994111607, -0.075141415),
  ('A2', 'A', 39.994137293, -0.075202435),
  ('A3', 'A', 39.994165034, -0.075264126),
  ('B1', 'B', 39.993303902, -0.071942729),
  ('B2', 'B', 39.993330927, -0.072004440),
  ('C1', 'C', 39.992384104, -0.069788769),
  ('C2', 'C', 39.992410318, -0.069850304),
  ('C3', 'C', 39.992436259, -0.069912231),
  ('D1', 'D', 39.995979955, -0.070493498),
  ('D2', 'D', 39.996006728, -0.070554624),
  ('E1', 'E', 39.996069881, -0.066323989),
  ('E2', 'E', 39.996104659, -0.066386897),
  ('F1', 'F', 39.992192333, -0.067264773)
ON CONFLICT (id) DO NOTHING;


-- ── 3. HISTORIAL ───────────────────────────────────────────────────────────
--
-- Se guardan CAMBIOS, no muestras, y la diferencia es grande: una fila por
-- sondeo serían 13 × 400 = 5.200 filas al día y 1,9 millones al año; sólo las
-- transiciones son unas 500 al día.
--
-- Y es MÁS información, no menos: de una lista de cambios se reconstruye el
-- estado en cualquier instante, cosa que una lista de muestras sólo hace a
-- saltos de cinco minutos.
--
-- `latido` distingue «llevaba ocho horas ocupado» de «el cron estuvo caído»:
-- una fila diaria por poste aunque no haya cambiado nada.

CREATE TABLE IF NOT EXISTS public.carga_estado (
  poste_id  TEXT NOT NULL REFERENCES public.carga_postes(id),
  momento   TIMESTAMPTZ NOT NULL DEFAULT now(),
  libre     BOOLEAN NOT NULL,
  latido    BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (poste_id, momento)
);

CREATE INDEX IF NOT EXISTS carga_estado_momento_idx
  ON public.carga_estado (momento DESC);

COMMENT ON COLUMN public.carga_estado.latido IS
  'true = no hubo cambio, es la fila diaria que prueba que el sondeo seguía vivo.';


-- Coordenadas que el endpoint devolvió y no encajan con ningún poste conocido.
-- Existe para enterarse, no para funcionar.
CREATE TABLE IF NOT EXISTS public.carga_desconocidos (
  lat        DOUBLE PRECISION NOT NULL,
  lon        DOUBLE PRECISION NOT NULL,
  veces      INTEGER NOT NULL DEFAULT 1,
  primera_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lat, lon)
);


-- ── 4. SUSCRIPCIONES AL AVISO ──────────────────────────────────────────────
--
-- ── POR QUÉ UNA TABLA PROPIA Y NO med_push ──
-- med_push no distingue de qué aplicación viene cada suscripción, y
-- med_avisos_por_enviar() manda a TODAS las filas del usuario. Si esto
-- guardara aquí su suscripción, alguien que además fuera miembro de la
-- familia empezaría a recibir los avisos de medicación de Álex en el service
-- worker de los cargadores — que ni siquiera sabe pintarlos. Tabla aparte, y
-- NO una columna `tipo` en la de medicación.
--
-- ── zonas: EL VACÍO SIGNIFICA TODAS ──
-- No es un atajo. Si la UJI pone cargadores nuevos, quien dijo «todas» los
-- quiere también y quien eligió tres concretas no. Guardar la lista completa
-- en vez de {} haría que una zona nueva no avisara a nadie, y nadie
-- entendería por qué.

CREATE TABLE IF NOT EXISTS public.carga_push (
  endpoint    TEXT PRIMARY KEY,
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  agente      TEXT,
  zonas       TEXT[] NOT NULL DEFAULT '{}',
  desde_hora  SMALLINT NOT NULL DEFAULT 7  CHECK (desde_hora BETWEEN 0 AND 23),
  hasta_hora  SMALLINT NOT NULL DEFAULT 21 CHECK (hasta_hora BETWEEN 1 AND 24),
  fallos      INTEGER NOT NULL DEFAULT 0,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_ok   TIMESTAMPTZ,
  CONSTRAINT carga_push_franja CHECK (hasta_hora > desde_hora)
);

CREATE INDEX IF NOT EXISTS carga_push_user_idx ON public.carga_push (user_id);

COMMENT ON COLUMN public.carga_push.zonas IS
  'Zonas que vigila. Vacío = todas, incluidas las que se añadan en el futuro.';

-- ON DELETE CASCADE aquí sí, y es la excepción razonada: una suscripción no
-- es historial, es una dirección de entrega. Si el usuario se va, mandar
-- avisos a su móvil sería exactamente lo contrario de lo que pidió.


-- Enfriamiento. Por usuario Y ZONA: así dos zonas distintas pueden avisar
-- seguidas, pero una sola que parpadee no manda cinco avisos.
CREATE TABLE IF NOT EXISTS public.carga_avisos (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  zona_id    TEXT NOT NULL REFERENCES public.carga_zonas(id),
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, zona_id)
);


-- ── 5. PERMISOS ────────────────────────────────────────────────────────────
--
-- Política y GRANT van SIEMPRE juntos. Este proyecto ya ha tenido dos veces
-- el mismo fallo —una política sin su GRANT— y las dos veces falló EN
-- SILENCIO: Supabase no da error, devuelve cero filas.

-- Zonas y postes: públicos. Es la cartografía, no hay nada que esconder.
ALTER TABLE public.carga_zonas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carga_postes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carga_zonas_sel"  ON public.carga_zonas;
DROP POLICY IF EXISTS "carga_postes_sel" ON public.carga_postes;

CREATE POLICY "carga_zonas_sel"  ON public.carga_zonas  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "carga_postes_sel" ON public.carga_postes FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.carga_zonas  TO anon, authenticated;
GRANT SELECT ON public.carga_postes TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.carga_zonas  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.carga_postes FROM anon, authenticated;

-- Historial: público también. Es la ocupación de un aparcamiento público de
-- una universidad pública; no hay nada personal en ello.
ALTER TABLE public.carga_estado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "carga_estado_sel" ON public.carga_estado;
CREATE POLICY "carga_estado_sel" ON public.carga_estado
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.carga_estado TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.carga_estado FROM anon, authenticated;

-- Suscripciones: cada uno las suyas y nada más.
ALTER TABLE public.carga_push ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "carga_push_mias" ON public.carga_push;
CREATE POLICY "carga_push_mias" ON public.carga_push
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carga_push TO authenticated;
REVOKE ALL ON public.carga_push FROM anon, PUBLIC;
REVOKE TRUNCATE, TRIGGER ON public.carga_push FROM authenticated;

-- Las dos del servidor: RLS encendida y SIN políticas ni GRANT. Sólo
-- service_role, que se salta RLS.
ALTER TABLE public.carga_avisos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carga_desconocidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.carga_avisos       FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.carga_desconocidos FROM anon, authenticated, PUBLIC;


-- ── 6. REGISTRAR UN SONDEO ─────────────────────────────────────────────────
--
-- Recibe el JSON tal cual lo devuelve la UJI y hace todo el trabajo dentro de
-- la base: emparejar, detectar cambios y escribir sólo lo que cambió. Así la
-- Edge Function no tiene más lógica que «pedir y pasar», y lo que decide qué
-- es un cambio vive en un solo sitio.
--
-- SECURITY DEFINER con search_path = '' y todo cualificado: es la costumbre
-- actual de la casa. Sólo la llama service_role.
--
-- Devuelve las ZONAS en las que algún poste pasó a libre, que es justo lo que
-- necesita el envío de avisos.

CREATE OR REPLACE FUNCTION public.carga_registrar(p_puntos JSONB)
 RETURNS JSONB
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  v_pt          JSONB;
  v_lat         DOUBLE PRECISION;
  v_lon         DOUBLE PRECISION;
  v_libre       BOOLEAN;
  v_poste       TEXT;
  v_zona        TEXT;
  v_anterior    BOOLEAN;
  v_cambios     INT := 0;
  v_desconocidos INT := 0;
  v_liberadas   TEXT[] := '{}';
BEGIN
  IF jsonb_typeof(p_puntos) <> 'array' OR jsonb_array_length(p_puntos) = 0 THEN
    -- Un formato que no reconocemos NO se interpreta a medias: se devuelve
    -- un error y no se escribe nada. Mejor un hueco en el historial que un
    -- historial que miente.
    RETURN jsonb_build_object('error', 'respuesta vacia o no es un array');
  END IF;

  FOR v_pt IN SELECT * FROM jsonb_array_elements(p_puntos) LOOP
    v_lat   := (v_pt->>'y')::DOUBLE PRECISION;
    v_lon   := (v_pt->>'x')::DOUBLE PRECISION;
    v_libre := COALESCE((v_pt->>'disponible')::INT, 0) = 1;

    IF v_lat IS NULL OR v_lon IS NULL THEN CONTINUE; END IF;

    -- Emparejar con el poste más cercano por debajo de 25 m. La distancia se
    -- calcula a mano con grados → metros porque a esta latitud y en 25 m la
    -- aproximación plana sobra, y así no hace falta PostGIS.
    SELECT p.id, p.zona_id INTO v_poste, v_zona
      FROM public.carga_postes p
     WHERE p.activo
       AND sqrt( power((p.lat - v_lat) * 111320, 2)
               + power((p.lon - v_lon) *  85000, 2) ) < 25
     ORDER BY sqrt( power((p.lat - v_lat) * 111320, 2)
                  + power((p.lon - v_lon) *  85000, 2) )
     LIMIT 1;

    IF v_poste IS NULL THEN
      INSERT INTO public.carga_desconocidos (lat, lon)
      VALUES (v_lat, v_lon)
      ON CONFLICT (lat, lon) DO UPDATE
        SET veces = public.carga_desconocidos.veces + 1, ultima_en = now();
      v_desconocidos := v_desconocidos + 1;
      CONTINUE;
    END IF;

    -- Último estado conocido de ese poste
    SELECT e.libre INTO v_anterior
      FROM public.carga_estado e
     WHERE e.poste_id = v_poste
     ORDER BY e.momento DESC
     LIMIT 1;

    IF v_anterior IS NULL OR v_anterior <> v_libre THEN
      INSERT INTO public.carga_estado (poste_id, libre) VALUES (v_poste, v_libre)
      ON CONFLICT DO NOTHING;
      v_cambios := v_cambios + 1;

      -- Sólo la transición a libre interesa para avisar. «Sigue habiendo
      -- sitio» no es noticia.
      IF v_libre AND v_anterior IS NOT NULL AND NOT (v_zona = ANY (v_liberadas)) THEN
        v_liberadas := array_append(v_liberadas, v_zona);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'cambios', v_cambios,
    'desconocidos', v_desconocidos, 'liberadas', to_jsonb(v_liberadas));
END $function$;

REVOKE ALL ON FUNCTION public.carga_registrar(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carga_registrar(JSONB) TO service_role;


-- Latido diario: deja constancia de que el sondeo seguía vivo aunque no
-- cambiara nada. Sin esto no hay forma de distinguir ocho horas ocupado de
-- ocho horas de cron caído.
CREATE OR REPLACE FUNCTION public.carga_latido()
 RETURNS INT
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE v_n INT := 0;
BEGIN
  INSERT INTO public.carga_estado (poste_id, libre, latido)
  SELECT p.id, COALESCE(
           (SELECT e.libre FROM public.carga_estado e
             WHERE e.poste_id = p.id ORDER BY e.momento DESC LIMIT 1), false), true
    FROM public.carga_postes p
   WHERE p.activo
     AND NOT EXISTS (SELECT 1 FROM public.carga_estado e
                      WHERE e.poste_id = p.id AND e.momento > now() - interval '20 hours');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.carga_latido() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carga_latido() TO service_role;


-- ── 7. A QUIÉN HAY QUE AVISAR ──────────────────────────────────────────────
--
-- Tres guardas, y las tres existen porque un aviso que molesta se desactiva y
-- entonces no sirve para nada:
--   · la zona está entre las que vigila (o las vigila todas),
--   · estamos dentro de su franja horaria, en hora de Madrid,
--   · y no se le ha avisado de ESA zona en los últimos 20 minutos.

CREATE OR REPLACE FUNCTION public.carga_avisos_por_enviar(p_zonas TEXT[])
 RETURNS TABLE(endpoint TEXT, p256dh TEXT, clave_auth TEXT,
               user_id UUID, zona_id TEXT, zona_nombre TEXT,
               libres INT, total INT)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = ''
AS $function$
  WITH estado AS (
    SELECT DISTINCT ON (p.id) p.id, p.zona_id, e.libre
      FROM public.carga_postes p
      JOIN public.carga_estado e ON e.poste_id = p.id
     WHERE p.activo
     ORDER BY p.id, e.momento DESC
  ),
  por_zona AS (
    SELECT zona_id,
           count(*) FILTER (WHERE libre)::INT AS libres,
           count(*)::INT                      AS total
      FROM estado GROUP BY zona_id
  )
  SELECT s.endpoint, s.p256dh, s.auth, s.user_id,
         z.id, COALESCE(z.nombre, 'Zona ' || z.id),
         pz.libres, pz.total
    FROM public.carga_push s
    CROSS JOIN LATERAL unnest(p_zonas) AS z_id
    JOIN public.carga_zonas z  ON z.id = z_id
    JOIN por_zona          pz  ON pz.zona_id = z.id
   WHERE s.fallos < 5
     AND (cardinality(s.zonas) = 0 OR z.id = ANY (s.zonas))
     AND EXTRACT(HOUR FROM (now() AT TIME ZONE 'Europe/Madrid'))
           BETWEEN s.desde_hora AND s.hasta_hora - 1
     AND NOT EXISTS (
           SELECT 1 FROM public.carga_avisos a
            WHERE a.user_id = s.user_id
              AND a.zona_id = z.id
              AND a.enviado_en > now() - interval '20 minutes');
$function$;

REVOKE ALL ON FUNCTION public.carga_avisos_por_enviar(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carga_avisos_por_enviar(TEXT[]) TO service_role;


CREATE OR REPLACE FUNCTION public.carga_aviso_enviado(
  p_user UUID, p_zona TEXT, p_endpoint TEXT, p_ok BOOLEAN)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  IF p_ok THEN
    INSERT INTO public.carga_avisos (user_id, zona_id) VALUES (p_user, p_zona)
    ON CONFLICT (user_id, zona_id) DO UPDATE SET enviado_en = now();
    UPDATE public.carga_push SET ultimo_ok = now(), fallos = 0 WHERE endpoint = p_endpoint;
  ELSE
    -- Un móvil que ya no acepta avisos. A la quinta se deja de intentar.
    UPDATE public.carga_push SET fallos = fallos + 1 WHERE endpoint = p_endpoint;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.carga_aviso_enviado(UUID, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carga_aviso_enviado(UUID, TEXT, TEXT, BOOLEAN)
  TO service_role;


-- ── 8. ESTADÍSTICAS ────────────────────────────────────────────────────────
--
-- De la lista de cambios se saca, con lead(), cuánto duró cada estado. De ahí
-- sale la única pregunta que importa: «¿a qué hora suele haber sitio?».
--
-- Se reparte la duración de cada tramo entre las horas que abarca, en hora de
-- Madrid. Un tramo de 40 minutos a caballo entre las 9 y las 10 cuenta en las
-- dos, en su proporción — si se asignara entero a la hora de inicio, las
-- ocupaciones largas falsearían la mañana entera.
--
-- STABLE y no materializada: con ~500 filas al día, un año son 180.000 y esto
-- se resuelve en milisegundos. El día que no, se materializa.

CREATE OR REPLACE FUNCTION public.carga_ocupacion(p_dias INT DEFAULT 60)
 RETURNS TABLE(zona_id TEXT, dia_semana SMALLINT, hora SMALLINT,
               prob_libre REAL, muestras REAL)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = ''
AS $function$
  WITH tramos AS (
    SELECT e.poste_id, p.zona_id, e.libre,
           e.momento AS desde,
           LEAST(COALESCE(lead(e.momento) OVER (PARTITION BY e.poste_id
                                                ORDER BY e.momento), now()),
                 now()) AS hasta
      FROM public.carga_estado e
      JOIN public.carga_postes p ON p.id = e.poste_id
     WHERE e.momento > now() - make_interval(days => GREATEST(p_dias, 1))
  ),
  horas AS (
    SELECT t.zona_id, t.libre,
           generate_series(
             date_trunc('hour', t.desde AT TIME ZONE 'Europe/Madrid'),
             date_trunc('hour', t.hasta AT TIME ZONE 'Europe/Madrid'),
             interval '1 hour') AS h,
           t.desde AT TIME ZONE 'Europe/Madrid' AS d,
           t.hasta AT TIME ZONE 'Europe/Madrid' AS f
      FROM tramos t
     WHERE t.hasta > t.desde
  ),
  solapes AS (
    SELECT zona_id, libre,
           EXTRACT(DOW  FROM h)::SMALLINT AS dia_semana,
           EXTRACT(HOUR FROM h)::SMALLINT AS hora,
           EXTRACT(EPOCH FROM (LEAST(f, h + interval '1 hour') - GREATEST(d, h))) AS seg
      FROM horas
  )
  SELECT zona_id, dia_semana, hora,
         (sum(seg) FILTER (WHERE libre) / NULLIF(sum(seg), 0))::REAL AS prob_libre,
         (sum(seg) / 3600.0)::REAL                                   AS muestras
    FROM solapes
   WHERE seg > 0
   GROUP BY zona_id, dia_semana, hora
   ORDER BY zona_id, dia_semana, hora;
$function$;

REVOKE ALL ON FUNCTION public.carga_ocupacion(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carga_ocupacion(INT) TO anon, authenticated;


-- ── 9. BORRAR LA CUENTA ────────────────────────────────────────────────────
--
-- Regla de la casa: cada tabla nueva contesta a esta pregunta.
--
-- carga_push y carga_avisos apuntan a auth.users con ON DELETE CASCADE, así
-- que el `DELETE FROM auth.users` que ya hace borrar_mi_cuenta() se las lleva
-- solas, por los tres caminos que tiene la función. No hay que tocarla.
--
-- Se comprueba así, con una cuenta de usar y tirar:
--   select count(*) from carga_push where user_id = '<uuid>';   -- 1
--   select borrar_mi_cuenta();
--   select count(*) from carga_push where user_id = '<uuid>';   -- 0


-- ── 10. EL TRABAJO DE CRON ─────────────────────────────────────────────────
--
-- UN SOLO trabajo cada 2 minutos; la decisión de si toca sondear vive dentro
-- de la Edge Function (horario laboral siempre, fuera sólo cada 15 min). Una
-- regla en un sitio es más fácil de cambiar que tres expresiones de cron que
-- se solapan.
--
-- Reutiliza el secreto del Vault que ya existe para los avisos de medicación.
--
--   select cron.schedule('carga-sondeo', '*/2 * * * *', $cron$
--     select net.http_post(
--       url := 'https://yzarrncayxkvkpyflbrk.supabase.co/functions/v1/sondear-carga',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || (select decrypted_secret
--                                          from vault.decrypted_secrets
--                                         where name = 'service_role_key')),
--       body := '{}'::jsonb
--     );
--   $cron$);
--
-- Para pararlo:   select cron.unschedule('carga-sondeo');
-- Para mirarlo:   select * from cron.job_run_details order by start_time desc limit 10;
