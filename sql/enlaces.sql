-- ═══════════════════════════════════════════════════════════════════════════
--  ENLACES DE SÓLO LECTURA
--
--  Para la abuela, la matrona, el pediatra: ven las gráficas y el panel de
--  24 h de UN hijo, sin cuenta y sin sesión.
--
--  ── POR QUÉ ESTO NO ES VOLVER A `lectura_publica` ──
--
--  La política que se borró al pasar a varias familias era
--
--      CREATE POLICY "lectura_publica" ON registros FOR SELECT USING (true);
--
--  es decir, la base entera abierta a todo internet. Esto es lo contrario:
--
--    · anon NO recibe ni un GRANT sobre ninguna tabla, y ninguna política
--      apunta a anon. Se expone UNA función y nada más.
--    · Esa función devuelve UN hijo, como mucho cuatro tipos de registro, y
--      de `datos` sólo las claves que pintan las gráficas: las NOTAS NO
--      SALEN NUNCA.
--    · Caduca y se revoca.
--
--  Y lo que NO sale, a propósito: el nombre de la familia —hay una promesa
--  escrita en app/familia.js, «es sólo una etiqueta vuestra: no sale en las
--  capturas ni la ve nadie de fuera»—, ningún identificador de usuario,
--  ningún correo, la etiqueta del enlace (que es una nota privada sobre una
--  tercera persona) y el propio token.
--
--  Si alguien añade aquí abajo un JOIN a `familias` para poner una cabecera
--  más bonita, está rompiendo esa promesa.
--
--  ── BASTA CON EJECUTAR ESTE FICHERO ──
--
--  No hay que tocar ninguna función que ya exista, y en particular NO hay
--  que tocar borrar_mi_cuenta(). La primera versión de este fichero sí lo
--  pedía; el ON DELETE CASCADE de abajo, que va razonado donde se declara,
--  lo hace innecesario. Editar a mano una función de 70 líneas en
--  producción era el paso más arriesgado de todo esto, y era evitable.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. LA TABLA ────────────────────────────────────────────────────────────
--
-- Sin ON DELETE CASCADE, como todo en este proyecto: un borrado mal hecho se
-- estrella en vez de llevarse algo por delante. El precio es acordarse de
-- `enlaces` en los dos sitios que dice la cabecera.
--
-- No hay contador de visitas, y es deliberado. Sería una escritura anónima
-- sin límite —cada carga de la página, una versión de fila nueva, WAL y
-- bloat, provocable gratis desde fuera por cualquiera que tenga el enlace—
-- y además mentiría: el previsualizador de enlaces de WhatsApp y el prefetch
-- del móvil contarían como visitas. `ultimo_acceso` responde a la única
-- pregunta real («¿lo sigue usando alguien?») y se escribe como mucho una
-- vez por hora.

CREATE TABLE IF NOT EXISTS public.enlaces (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE, que es la EXCEPCIÓN en este proyecto y va razonada.
  --
  -- La regla general es no ponerlo: «así un borrado mal hecho se estrella en
  -- vez de llevarse un historial por delante». Pero un enlace NO es historial,
  -- es un permiso de acceso — el mismo razonamiento que ya justifica la
  -- excepción de med_push («una suscripción no es un dato del bebé, es una
  -- dirección de entrega»).
  --
  -- Si se borra un hijo, sus enlaces TIENEN que morir con él: dejar vivo un
  -- enlace que apunta a un niño que ya no está sería el fallo, no la
  -- protección. Y a cambio, borrar_mi_cuenta() no hay que tocarla.
  nino_id        UUID        NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,

  -- 22 caracteres del mismo alfabeto sin ambigüedades que usan las
  -- invitaciones (sin I, O, 0 ni 1) = 110 bits. Ojo con la cuenta: la
  -- entropía es CARACTERES x 5 bits, no bytes x 8. Las invitaciones de 9
  -- caracteres tienen 45 bits, que está bien para un código que caduca en
  -- 7 días y se usa una sola vez, y no lo estaría para esto.
  --
  -- El CHECK no es cosmético: permite que ver_enlace() rechace la basura
  -- sin llegar a tocar la tabla.
  token          TEXT        NOT NULL UNIQUE
                             CHECK (token ~ '^[A-HJ-NP-Z2-9]{22}$'),

  -- «abuela», «matrona», «Dra. Ruiz». Sólo sirve para saber cuál revocar.
  -- Es una nota privada sobre una tercera persona: NUNCA se devuelve.
  etiqueta       TEXT        CHECK (etiqueta IS NULL OR char_length(etiqueta) <= 60),

  ver_peso       BOOLEAN     NOT NULL DEFAULT false,
  ver_panales    BOOLEAN     NOT NULL DEFAULT false,
  ver_extraccion BOOLEAN     NOT NULL DEFAULT false,
  ver_resumen    BOOLEAN     NOT NULL DEFAULT true,

  caduca_en      TIMESTAMPTZ,              -- NULL = no caduca
  revocado_en    TIMESTAMPTZ,              -- NULL = sigue vivo
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Sin REFERENCES a auth.users, igual que med_tomas.por. Si la llevara,
  -- irse de la familia obligaría a borrar antes los enlaces para poder
  -- borrar la cuenta, y eso es una clave ajena trabajando en contra.
  creado_por     UUID        NOT NULL DEFAULT auth.uid(),

  ultimo_acceso  TIMESTAMPTZ,

  -- Un enlace sin ninguna gráfica es un enlace roto: el panel de 24 h solo
  -- no tiene de dónde sacar los números.
  CONSTRAINT enlaces_algo_que_ver
    CHECK (ver_peso OR ver_panales OR ver_extraccion)
);

CREATE INDEX IF NOT EXISTS enlaces_nino_idx ON public.enlaces (nino_id);

COMMENT ON TABLE public.enlaces IS
  'Enlaces de sólo lectura de las gráficas de un hijo. El token es la credencial: quien lo tiene, entra. Se lee únicamente a través de ver_enlace().';


-- ── 2. RLS: la cadena de siempre, y sólo para los de casa ──────────────────
--
-- registro → nino_id → ninos.familia_id → es_miembro(). `enlaces` no lleva
-- familia_id por lo mismo que no lo llevan las demás tablas: el hijo ya dice
-- de quién es.
--
-- Ninguna política TO anon. Quien abre el enlace no pasa por aquí: pasa por
-- ver_enlace(), que es SECURITY DEFINER y se salta RLS por diseño.

ALTER TABLE public.enlaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enlaces_sel" ON public.enlaces;
DROP POLICY IF EXISTS "enlaces_ins" ON public.enlaces;
DROP POLICY IF EXISTS "enlaces_upd" ON public.enlaces;
DROP POLICY IF EXISTS "enlaces_del" ON public.enlaces;

CREATE POLICY "enlaces_sel" ON public.enlaces
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ninos n
                  WHERE n.id = enlaces.nino_id AND public.es_miembro(n.familia_id)));

CREATE POLICY "enlaces_ins" ON public.enlaces
  FOR INSERT TO authenticated
  WITH CHECK (creado_por = auth.uid()
    AND EXISTS (SELECT 1 FROM public.ninos n
                 WHERE n.id = enlaces.nino_id AND public.es_miembro(n.familia_id)));

-- El UPDATE existe para revocar y para cambiar la etiqueta, no para
-- reescribir el token: eso sería otro enlace, y entonces se crea otro.
CREATE POLICY "enlaces_upd" ON public.enlaces
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.ninos n
                       WHERE n.id = enlaces.nino_id AND public.es_miembro(n.familia_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ninos n
                       WHERE n.id = enlaces.nino_id AND public.es_miembro(n.familia_id)));

CREATE POLICY "enlaces_del" ON public.enlaces
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ninos n
                  WHERE n.id = enlaces.nino_id AND public.es_miembro(n.familia_id)));

-- Política y GRANT van juntos. Este proyecto ya ha tenido dos veces el mismo
-- fallo —una política sin su GRANT— y las dos veces falló EN SILENCIO:
-- Supabase no devuelve error, devuelve cero filas.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enlaces TO authenticated;

-- Y hay que QUITAR lo que no se ha pedido. Una tabla nueva nace con los
-- privilegios por defecto del esquema public, que incluyen a anon. Aquí
-- importa más que en ninguna otra tabla del proyecto: esto son credenciales.
REVOKE ALL ON public.enlaces FROM anon, PUBLIC;
REVOKE TRUNCATE, TRIGGER ON public.enlaces FROM authenticated;

-- Y NO se añade a la publicación supabase_realtime. No hace falta, y sería
-- meter una tabla de credenciales en un flujo de replicación.


-- ── 3. LA ÚNICA PUERTA ─────────────────────────────────────────────────────
--
-- Es la única lectura anónima de todo el proyecto. Dos cosas se apartan a
-- propósito del estilo del resto de funciones de este repositorio:
--
-- 1) SET search_path = ''   y no   SET search_path TO 'public'
--
--    Con 'public', PostgreSQL busca las tablas en pg_temp ANTES que en
--    public. Quien pueda crear una tabla temporal podría crear
--    pg_temp.enlaces y suplantar a la de verdad dentro de un cuerpo que
--    corre como el dueño de la función. En las demás funciones DEFINER del
--    proyecto no llega la sangre al río porque sólo las puede llamar
--    authenticated; ésta la puede llamar cualquiera, así que aquí sí.
--    La cadena vacía obliga a calificarlo todo (public.enlaces,
--    public.registros), que es exactamente lo que se quiere.
--
-- 2) Lista BLANCA de claves de `datos`, no lista negra.
--
--    `datos` es JSONB libre que escribe el cliente. Con una lista negra
--    —«quitar la nota»— la clave que alguien añada el año que viene viaja
--    sola hasta el móvil de la abuela, sin que nadie lo haya decidido.
--    Estas seis son exactamente las que leen graficas.js y renderResumen():
--
--        peso        gramos
--        extraccion  ml, pecho
--        pipi        cantidad, transparente
--        caca        cantidad, color
--
--    `transparente` hace falta de verdad: es lo que da color a los puntos
--    de la gráfica de pipís. Sin ella se pintan todos del color que no es,
--    y esta página la puede estar leyendo una matrona.
--
--    Las notas no están en la lista, y ése es el punto: son el texto libre
--    de los padres, y la aplicación las enseña al pasar el dedo por encima.

CREATE OR REPLACE FUNCTION public.ver_enlace(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  e       public.enlaces;
  n       public.ninos;
  v_tipos TEXT[] := ARRAY[]::TEXT[];
  v_regs  jsonb;
BEGIN
  -- El formato primero: así la basura no llega ni a tocar el índice.
  IF p_token IS NULL OR p_token !~ '^[A-HJ-NP-Z2-9]{22}$' THEN
    RETURN jsonb_build_object('error', 'no_valido');
  END IF;

  SELECT * INTO e FROM public.enlaces WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_valido');
  END IF;

  -- Se distingue «caducado» de «no existe» a propósito. El motivo habitual
  -- para no distinguirlos es que nadie pueda averiguar qué tokens existen;
  -- con 110 bits eso no es un ataque posible. En cambio, decirle «el enlace
  -- no es válido» a una abuela cuando la verdad es «caducó, pídeles otro»
  -- sí es un problema real, y encima recurrente.
  IF e.revocado_en IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'revocado');
  END IF;

  IF e.caduca_en IS NOT NULL AND e.caduca_en < now() THEN
    RETURN jsonb_build_object('error', 'caducado');
  END IF;

  SELECT * INTO n FROM public.ninos WHERE id = e.nino_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'no_valido');
  END IF;

  IF e.ver_peso       THEN v_tipos := v_tipos || ARRAY['peso'];         END IF;
  IF e.ver_panales    THEN v_tipos := v_tipos || ARRAY['pipi', 'caca']; END IF;
  IF e.ver_extraccion THEN v_tipos := v_tipos || ARRAY['extraccion'];   END IF;

  SELECT COALESCE(jsonb_agg(s.fila ORDER BY s.fh), '[]'::jsonb)
    INTO v_regs
    FROM (
      SELECT r.fecha_hora AS fh,
             jsonb_build_object(
               'fecha_hora', r.fecha_hora,
               'tipo',       r.tipo,
               'datos', CASE r.tipo
                 WHEN 'peso'       THEN jsonb_build_object(
                        'gramos',       r.datos->'gramos')
                 WHEN 'extraccion' THEN jsonb_build_object(
                        'ml',           r.datos->'ml',
                        'pecho',        r.datos->'pecho')
                 WHEN 'pipi'       THEN jsonb_build_object(
                        'cantidad',     r.datos->'cantidad',
                        'transparente', r.datos->'transparente')
                 WHEN 'caca'       THEN jsonb_build_object(
                        'cantidad',     r.datos->'cantidad',
                        'color',        r.datos->'color')
                 ELSE '{}'::jsonb
               END
             ) AS fila
        FROM public.registros r
       WHERE r.nino_id = e.nino_id
         AND r.tipo = ANY (v_tipos)
    ) s;

  -- Como mucho una escritura por hora y por enlace, pase lo que pase. Sin
  -- esta condición, cada carga de la página sería una fila nueva. Y sólo
  -- con el token bueno: a quien va probando tokens al azar no se le da
  -- trabajo que hacer.
  UPDATE public.enlaces
     SET ultimo_acceso = now()
   WHERE id = e.id
     AND (ultimo_acceso IS NULL OR ultimo_acceso < now() - interval '1 hour');

  RETURN jsonb_build_object(
    'nino', jsonb_build_object(
      'nombre',           n.nombre,
      'fecha_nacimiento', n.fecha_nacimiento,  -- sin esto los percentiles mienten
      'sexo',             n.sexo               -- y sin esto, también
    ),
    'ver', jsonb_build_object(
      'peso',       e.ver_peso,
      'panales',    e.ver_panales,
      'extraccion', e.ver_extraccion,
      'resumen',    e.ver_resumen
    ),
    'registros', v_regs
  );
END $function$;

-- Lo de siempre: cerrar todo y abrir sólo lo justo. Aquí anon SÍ entra, y es
-- el único sitio de todo el proyecto donde eso pasa.
REVOKE ALL ON FUNCTION public.ver_enlace(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ver_enlace(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.ver_enlace(TEXT) IS
  'Única vía de lectura anónima del proyecto. Devuelve nombre, nacimiento y sexo del hijo, más los registros que permita el enlace, con las notas fuera.';


-- ── 4. BORRADO DE CUENTA: NO HAY QUE HACER NADA ────────────────────────────
--
-- Queda escrito porque es lo primero que mira quien añade una tabla a este
-- proyecto, y la respuesta aquí es que no hace falta:
--
--   · nino_id va con ON DELETE CASCADE (razonado arriba), así que el
--     DELETE FROM ninos de borrar_mi_cuenta() se lleva los enlaces solo.
--   · creado_por es un UUID SIN clave ajena a auth.users, igual que
--     med_tomas.por. Si la llevara, el adulto que se va de una familia no
--     podría borrar su cuenta sin cargarse antes los enlaces del otro.
--
-- El efecto secundario, que es el correcto: irse de la familia NO revoca los
-- enlaces que hiciste; se quedan con la familia, como los datos. Borrar al
-- hijo sí los revoca, porque ya no hay nada que enseñar.
