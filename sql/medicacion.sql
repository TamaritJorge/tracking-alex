-- ═══════════════════════════════════════════════════════════════════════════
--  MÓDULO DE MEDICACIÓN
--
--  ✅ SEGURO     — sólo crea cosas nuevas. No toca ninguna tabla existente.
--  ✅ IDEMPOTENTE — se puede ejecutar dos veces sin romper nada.
--
--  Se pega en: Supabase → SQL Editor → New query.
--
--  Dos tablas nuevas y una función. Arquitectura separada a propósito: no se
--  mete nada en `registros`, que es la tabla del día a día y ya tiene dueño.
--
--  La única cosa existente que se modifica es borrar_mi_cuenta(), y es
--  obligatorio: las claves ajenas de este proyecto NO llevan ON DELETE CASCADE
--  (a propósito, para que un borrado mal hecho se estrelle en vez de llevarse
--  un historial por delante), así que sin añadir las dos tablas nuevas el
--  borrado de cuenta fallaría en cuanto alguien tuviera una pauta.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. LA PAUTA: lo que ha dicho el pediatra ───────────────────────────────
--
-- `horas` son cadenas 'HH:MM' en hora local, no instantes. Es la decisión de
-- diseño que sostiene todo lo demás: ver la nota del índice único más abajo.
--
-- `dosis` es texto libre A PROPÓSITO. La aplicación no calcula, no sugiere y
-- no valida dosis: repite lo que ha escrito el padre. Un campo numérico con
-- unidades invitaría a hacer aritmética con la medicación de un bebé.

CREATE TABLE IF NOT EXISTS public.med_pautas (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id    UUID        NOT NULL REFERENCES public.ninos(id),
  nombre     TEXT        NOT NULL,
  dosis      TEXT,
  horas      TEXT[]      NOT NULL,
  zona       TEXT        NOT NULL DEFAULT 'Europe/Madrid',
  desde      DATE        NOT NULL,
  hasta      DATE,
  nota       TEXT,
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Redundante con la PK, pero hace falta para la clave ajena compuesta de
  -- med_tomas, que es lo que impide que una toma cuelgue de otro niño.
  CONSTRAINT med_pautas_id_nino UNIQUE (id, nino_id)
);

-- Formato de las horas. Sin esto, '8:00' y '08:00' serían dos ranuras
-- distintas para el mismo momento y el índice único no las vería.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'med_pautas_horas_ok') THEN
    -- Sin subconsulta: Postgres no las admite en un CHECK. Se valida la
    -- lista entera de una vez con una expresión regular.
    ALTER TABLE public.med_pautas ADD CONSTRAINT med_pautas_horas_ok CHECK (
      array_length(horas, 1) BETWEEN 1 AND 12
      AND array_to_string(horas, ',') ~
          '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_med_pautas_nino ON public.med_pautas (nino_id);


-- ── 2. LA TOMA: lo que ha pasado de verdad ─────────────────────────────────
--
-- Dos ejes distintos y los dos hacen falta:
--   · (fecha_slot, hora_slot) = lo que TOCABA
--   · dada_en                 = lo que PASÓ
-- Acordarse a las 11:00 de la toma de las 09:00 y apuntarla a las 09:15
-- (se la diste) o a las 11:00 (se la das ahora) son cosas distintas.
--
-- `estado` NO tiene valor por defecto a propósito: el defecto de un campo
-- clínico no puede ser el optimista. Una fila escrita a medias no debe contar
-- como dosis administrada.

CREATE TABLE IF NOT EXISTS public.med_tomas (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pauta_id    UUID        NOT NULL,
  nino_id     UUID        NOT NULL,
  fecha_slot  DATE        NOT NULL,
  hora_slot   TEXT        NOT NULL,
  dada_en     TIMESTAMPTZ NOT NULL,
  estado      TEXT        NOT NULL,
  por         UUID        NOT NULL DEFAULT auth.uid(),
  nota        TEXT,
  creada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- La clave ajena va por el PAR (pauta, niño). Así es IMPOSIBLE que una toma
  -- cuelgue de un niño distinto al de su pauta: lo garantiza la integridad
  -- referencial, no la buena fe del cliente.
  CONSTRAINT med_tomas_pauta_nino
    FOREIGN KEY (pauta_id, nino_id) REFERENCES public.med_pautas (id, nino_id),

  CONSTRAINT med_tomas_estado_ok
    CHECK (estado IN ('dada', 'saltada', 'rechazada', 'anulada'))
);

-- ═══ EL CORAZÓN DE TODO ═══
--
-- Una ranura sólo se puede ocupar una vez. Si los dos padres pulsan a la vez
-- desde dos móviles, uno gana y el otro recibe un 23505: la doble fila no es
-- improbable, es IMPOSIBLE.
--
-- La clave es LÓGICA (día local + la cadena '16:00') y no un instante, y eso
-- es deliberado. Un timestamptz depende de la zona horaria del sistema
-- operativo de cada teléfono: con un padre en Canarias, de viaje, o con el
-- reloj mal puesto, "las 16:00" serían dos instantes distintos, entrarían dos
-- filas y el índice no saltaría. El día y la cadena son idénticos en los dos
-- móviles por construcción, y además resuelven solos los dos domingos del
-- cambio de hora.
--
-- Es PARCIAL: una toma anulada libera la ranura pero no se borra. Borrarla
-- sería justo la forma en que una dosis desaparece sin dejar rastro.
CREATE UNIQUE INDEX IF NOT EXISTS med_slot_unico
  ON public.med_tomas (pauta_id, fecha_slot, hora_slot)
  WHERE estado <> 'anulada';

CREATE INDEX IF NOT EXISTS idx_med_tomas_nino ON public.med_tomas (nino_id, fecha_slot);


-- ── 3. RLS ─────────────────────────────────────────────────────────────────
-- Mismo patrón que registros y alim_registros: la cadena niño → familia →
-- es_miembro(), con el mismo EXISTS en USING y en WITH CHECK.

ALTER TABLE public.med_pautas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.med_tomas  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "med_pautas_familia" ON public.med_pautas;
CREATE POLICY "med_pautas_familia" ON public.med_pautas
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.ninos n
                       WHERE n.id = med_pautas.nino_id AND public.es_miembro(n.familia_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ninos n
                       WHERE n.id = med_pautas.nino_id AND public.es_miembro(n.familia_id)));

-- med_tomas lleva cuatro políticas en vez de una FOR ALL como las demás
-- tablas, y hay un motivo: en el INSERT se exige además que `por` sea tu
-- propio auth.uid(). Si cualquiera pudiera escribir el identificador del
-- otro, "¿quién se la dio?" dejaría de ser una respuesta fiable justo en la
-- conversación donde más importa. En el UPDATE no se exige, porque cualquiera
-- de los dos padres tiene que poder anular una toma mal apuntada.

DROP POLICY IF EXISTS "med_tomas_familia" ON public.med_tomas;
DROP POLICY IF EXISTS "med_tomas_sel"     ON public.med_tomas;
DROP POLICY IF EXISTS "med_tomas_ins"     ON public.med_tomas;
DROP POLICY IF EXISTS "med_tomas_upd"     ON public.med_tomas;
DROP POLICY IF EXISTS "med_tomas_del"     ON public.med_tomas;

CREATE POLICY "med_tomas_sel" ON public.med_tomas
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.med_pautas p JOIN public.ninos n ON n.id = p.nino_id
                  WHERE p.id = med_tomas.pauta_id AND public.es_miembro(n.familia_id)));

CREATE POLICY "med_tomas_ins" ON public.med_tomas
  FOR INSERT TO authenticated
  WITH CHECK (por = auth.uid()
    AND EXISTS (SELECT 1 FROM public.med_pautas p JOIN public.ninos n ON n.id = p.nino_id
                 WHERE p.id = med_tomas.pauta_id AND public.es_miembro(n.familia_id)));

CREATE POLICY "med_tomas_upd" ON public.med_tomas
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.med_pautas p JOIN public.ninos n ON n.id = p.nino_id
                       WHERE p.id = med_tomas.pauta_id AND public.es_miembro(n.familia_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.med_pautas p JOIN public.ninos n ON n.id = p.nino_id
                       WHERE p.id = med_tomas.pauta_id AND public.es_miembro(n.familia_id)));

-- El DELETE existe para borrar un hijo o una cuenta, no para la vida diaria:
-- la interfaz anula, nunca borra.
CREATE POLICY "med_tomas_del" ON public.med_tomas
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.med_pautas p JOIN public.ninos n ON n.id = p.nino_id
                  WHERE p.id = med_tomas.pauta_id AND public.es_miembro(n.familia_id)));

-- Política y GRANT van juntos. Este proyecto ya ha tenido dos veces el mismo
-- fallo —una política FOR ALL sin su GRANT— y las dos veces falló EN SILENCIO:
-- Supabase no devuelve error, devuelve cero filas.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_pautas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.med_tomas  TO authenticated;

-- Y hay que QUITAR lo que no se ha pedido. Una tabla nueva nace con los
-- privilegios por defecto del esquema public, que incluyen a anon: sin estos
-- REVOKE, las tablas de medicación serían las únicas del proyecto que le dan
-- algo. Hoy RLS lo taparía igual —ninguna política es TO anon—, pero dejar un
-- GRANT que no hace falta es exactamente cómo se abren los agujeros el día
-- que alguien añade una política mal pensada.
REVOKE ALL ON public.med_pautas FROM anon;
REVOKE ALL ON public.med_tomas  FROM anon;

-- Lo mismo con TRUNCATE y TRIGGER, que tampoco tiene authenticated en
-- registros: vaciar la tabla entera no es cosa del cliente.
REVOKE TRUNCATE, TRIGGER ON public.med_pautas FROM authenticated;
REVOKE TRUNCATE, TRIGGER ON public.med_tomas  FROM authenticated;


-- ── 4. QUÉ TOCA AHORA ──────────────────────────────────────────────────────
--
-- ESTA FUNCIÓN ES LA ÚNICA DEFINICIÓN DE "QUÉ TOMA TOCA".
--
-- El cliente no vuelve a calcular ranuras por su cuenta: sólo decide de qué
-- color pinta lo que esta función le devuelve. Cuando lleguen las
-- notificaciones push, el cron llamará exactamente aquí. Si la lógica
-- estuviera escrita dos veces —una en JavaScript y otra en SQL— acabarían
-- desincronizándose, y una desincronización aquí es una dosis olvidada.
--
-- Ventana deslizante en vez de "hoy": si mirara el día de calendario, a las
-- 00:05 la toma de las 23:00 sin dar desaparecería de la pantalla. Es el
-- mismo razonamiento que ya está escrito en enVentana() para el resumen de
-- 24 h.
--
-- SECURITY INVOKER: las políticas de arriba filtran por sí solas, así que la
-- función no puede enseñar las pautas de otra familia.

CREATE OR REPLACE FUNCTION public.med_pendientes(p_nino UUID)
RETURNS TABLE (
  pauta_id   UUID,
  nombre     TEXT,
  dosis      TEXT,
  zona       TEXT,
  horas      TEXT[],
  fecha_slot DATE,
  hora_slot  TEXT,
  momento    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH dias AS (
    -- Ayer, hoy y mañana en la zona de la pauta: cubre de sobra la ventana
    SELECT p.*, d::date AS dia
      FROM med_pautas p,
           LATERAL generate_series(
             (timezone(p.zona, now()))::date - 1,
             (timezone(p.zona, now()))::date + 1,
             interval '1 day') AS d
     WHERE p.nino_id = p_nino
  ),
  slots AS (
    SELECT d.id, d.nombre, d.dosis, d.zona, d.horas, d.creada_en,
           d.dia AS fecha_slot,
           h     AS hora_slot,
           timezone(d.zona, (d.dia::text || ' ' || h)::timestamp) AS momento
      FROM dias d, LATERAL unnest(d.horas) AS h
     WHERE d.dia >= d.desde
       AND (d.hasta IS NULL OR d.dia <= d.hasta)
  )
  SELECT s.id, s.nombre, s.dosis, s.zona, s.horas, s.fecha_slot, s.hora_slot, s.momento
    FROM slots s
   WHERE s.momento >= now() - interval '12 hours'
     AND s.momento <= now() + interval '2 hours'
     -- Una pauta creada a media tarde no reclama las tomas de esta mañana
     AND s.momento >= s.creada_en
     AND NOT EXISTS (
           SELECT 1 FROM med_tomas t
            WHERE t.pauta_id   = s.id
              AND t.fecha_slot = s.fecha_slot
              AND t.hora_slot  = s.hora_slot
              AND t.estado <> 'anulada')
   ORDER BY s.momento, s.nombre;
$function$;

GRANT EXECUTE ON FUNCTION public.med_pendientes(UUID) TO authenticated;


-- ── 5. REALTIME ────────────────────────────────────────────────────────────
-- REPLICA IDENTITY FULL es imprescindible: sin ella el filtro nino_id=eq.…
-- no se aplica a los eventos UPDATE y DELETE, y anular una toma no llegaría
-- al móvil del otro padre, que se quedaría sin aviso de una dosis que hay
-- que dar.

ALTER TABLE public.med_pautas REPLICA IDENTITY FULL;
ALTER TABLE public.med_tomas  REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='med_pautas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.med_pautas;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='med_tomas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.med_tomas;
  END IF;
END $$;


COMMENT ON TABLE public.med_pautas IS
  'Tratamientos pautados por el pediatra: qué medicina, qué dosis y a qué horas.';
COMMENT ON TABLE public.med_tomas IS
  'Tomas realmente administradas (o saltadas). El índice único parcial sobre (pauta, día, hora) impide la doble dosis entre los dos padres.';
COMMENT ON FUNCTION public.med_pendientes(UUID) IS
  'Única definición de "qué toma toca ahora". La usan el cliente y, más adelante, el cron de notificaciones.';


-- ── 6. BORRADO DE CUENTA ───────────────────────────────────────────────────
--
-- Obligatorio, no opcional. Las claves ajenas de este proyecto no llevan
-- ON DELETE CASCADE, así que sin estos dos DELETE el borrado de cuenta
-- fallaría con un error de clave ajena en cuanto alguien tuviera una pauta.
--
-- Es la MISMA función que ya existía, con dos líneas añadidas y marcadas.
-- Orden: lo que apunta al niño primero, el niño al final.

CREATE OR REPLACE FUNCTION public.borrar_mi_cuenta()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user    uuid := auth.uid();
  v_familia uuid;
  v_otros   int;
  v_regs    int := 0;
  v_alim    int := 0;
  v_ninos   int := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('error', 'Sin sesion');
  END IF;

  SELECT familia_id INTO v_familia
    FROM familia_miembros WHERE user_id = v_user LIMIT 1;

  -- invitaciones.creada_por y usada_por apuntan a auth.users SIN cascade, asi
  -- que hay que soltarlas antes o el borrado del usuario falla. Ademas guardan
  -- su identificador, de modo que borrarlas es justo lo que pide la supresion.
  DELETE FROM invitaciones WHERE creada_por = v_user OR usada_por = v_user;

  -- Sin familia: no hay nada que repartir
  IF v_familia IS NULL THEN
    DELETE FROM auth.users WHERE id = v_user;
    RETURN jsonb_build_object('ok', true, 'familia_borrada', false);
  END IF;

  SELECT count(*) INTO v_otros
    FROM familia_miembros WHERE familia_id = v_familia AND user_id <> v_user;

  -- Queda alguien: se va la persona, se quedan los datos
  IF v_otros > 0 THEN
    DELETE FROM familia_miembros WHERE familia_id = v_familia AND user_id = v_user;
    DELETE FROM auth.users WHERE id = v_user;
    RETURN jsonb_build_object('ok', true, 'familia_borrada', false,
                              'quedan_adultos', v_otros);
  END IF;

  -- Ultimo adulto: se va todo. El orden importa porque registros, alim_registros
  -- y alim_ajustes apuntan a ninos SIN cascade (a proposito: asi un borrado mal
  -- hecho se estrella en vez de llevarse un historial por delante).
  SELECT count(*) INTO v_ninos FROM ninos WHERE familia_id = v_familia;
  SELECT count(*) INTO v_regs  FROM registros r
    WHERE r.nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);
  SELECT count(*) INTO v_alim  FROM alim_registros a
    WHERE a.nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);

  -- ← AÑADIDO: medicacion. Las tomas antes que las pautas, y las dos antes
  --   que los ninos, porque la cadena de claves ajenas es toma → pauta → nino.
  DELETE FROM med_tomas  WHERE nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);
  DELETE FROM med_pautas WHERE nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);

  DELETE FROM alim_registros WHERE nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);
  DELETE FROM alim_ajustes   WHERE nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);
  DELETE FROM registros      WHERE nino_id IN (SELECT id FROM ninos WHERE familia_id = v_familia);
  DELETE FROM ninos          WHERE familia_id = v_familia;
  DELETE FROM familia_ajustes WHERE familia_id = v_familia;
  DELETE FROM invitaciones    WHERE familia_id = v_familia;
  DELETE FROM familia_miembros WHERE familia_id = v_familia;
  DELETE FROM familias         WHERE id = v_familia;
  DELETE FROM auth.users       WHERE id = v_user;

  RETURN jsonb_build_object('ok', true, 'familia_borrada', true,
                            'ninos', v_ninos, 'registros', v_regs, 'alimentos', v_alim);
END $function$;
