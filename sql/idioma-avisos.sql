-- ═══════════════════════════════════════════════════════════════════════════
--  EL IDIOMA DE LOS AVISOS DE MEDICACIÓN
--
--  YA APLICADO en el proyecto. Queda aquí porque el esquema de este
--  proyecto vivía sólo en el panel de Supabase y eso es exactamente lo que
--  estamos dejando de hacer.
--
--  ── EL PROBLEMA ──
--  Traducir la aplicación no traduce los avisos del móvil. El texto de un
--  aviso lo compone la Edge Function, en el servidor: cuando llega al
--  teléfono ya está escrito, y el cliente sólo lo pinta. Así que hay que
--  saber el idioma ANTES de mandarlo.
--
--  ── POR DISPOSITIVO, NO POR USUARIO ──
--  med_push ya es una fila por móvil. Dos adultos de la misma familia
--  pueden tener el teléfono en idiomas distintos — o la misma persona el
--  móvil en inglés y la tablet en castellano. Cada suscripción recibe el
--  suyo, que es lo que la gente espera.
--
--  ── LO QUE YA EXISTÍA NO SE MUEVE ──
--  DEFAULT 'es' y NOT NULL: las suscripciones anteriores se quedan
--  exactamente como estaban. Nadie nota el cambio hasta que su móvil se
--  vuelve a suscribir o cambia de idioma en la aplicación.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. LA COLUMNA ──────────────────────────────────────────────────────────

ALTER TABLE public.med_push
  ADD COLUMN IF NOT EXISTS idioma TEXT NOT NULL DEFAULT 'es';

-- Los dos que entiende la aplicación. El CHECK no es decoración: sin él, un
-- idioma mal escrito desde el cliente haría que la función cayera al
-- castellano en silencio y nadie sabría por qué.
ALTER TABLE public.med_push
  DROP CONSTRAINT IF EXISTS med_push_idioma_ok;

ALTER TABLE public.med_push
  ADD CONSTRAINT med_push_idioma_ok CHECK (idioma IN ('es', 'en'));

COMMENT ON COLUMN public.med_push.idioma IS
  'Idioma en el que este dispositivo quiere los avisos. Lo pone app/push.js al suscribirse y al cambiar de idioma.';


-- ── 2. QUE LA CONSULTA LO DEVUELVA ─────────────────────────────────────────
--
-- Hay que soltar la función antes: cambia el tipo de retorno y PostgreSQL
-- no deja reemplazarla. Va en la misma transacción que el CREATE, así que no
-- existe un instante en que la función no esté — si el cron entrara justo en
-- medio, esperaría al commit.
--
-- Sigue siendo SECURITY DEFINER porque mira TODAS las familias, y por eso
-- mismo el EXECUTE es sólo para service_role. Es la función más peligrosa del
-- proyecto y la única que el cliente no toca nunca.

DROP FUNCTION IF EXISTS public.med_avisos_por_enviar();

CREATE FUNCTION public.med_avisos_por_enviar()
 RETURNS TABLE(user_id uuid, endpoint text, p256dh text, clave_auth text,
               pauta_id uuid, fecha_slot date, hora_slot text,
               medicamento text, dosis text, nino text, idioma text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ps.user_id, ps.endpoint, ps.p256dh, ps.auth,
         s.pauta_id, s.fecha_slot, s.hora_slot, s.nombre, s.dosis, n.nombre,
         ps.idioma
    FROM med_slots(NULL, interval '-20 minutes', interval '0 minutes') s
    JOIN ninos            n  ON n.id = s.nino_id
    JOIN familia_miembros m  ON m.familia_id = n.familia_id
    JOIN med_push         ps ON ps.user_id = m.user_id
   WHERE ps.fallos < 5
     AND NOT EXISTS (
           SELECT 1 FROM med_tomas t
            WHERE t.pauta_id   = s.pauta_id
              AND t.fecha_slot = s.fecha_slot
              AND t.hora_slot  = s.hora_slot
              AND t.estado <> 'anulada')
     AND NOT EXISTS (
           SELECT 1 FROM med_avisos a
            WHERE a.pauta_id   = s.pauta_id
              AND a.fecha_slot = s.fecha_slot
              AND a.hora_slot  = s.hora_slot
              AND a.user_id    = ps.user_id);
$function$;

-- El DROP se lleva los permisos por delante, así que hay que volver a
-- ponerlos. Si se olvidara, el cron dejaría de poder llamarla y los avisos
-- se pararían sin dar ningún error visible.
REVOKE ALL ON FUNCTION public.med_avisos_por_enviar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.med_avisos_por_enviar() TO service_role;


-- ── 3. LO QUE HAY QUE HACER ADEMÁS ─────────────────────────────────────────
--
--   · supabase/functions/enviar-recordatorios/index.ts  — redactar el texto
--     en el idioma que llega, y mandarlo también en la carga.
--   · app/push.js      — guardar idiomaActivo() al suscribirse y al renovar,
--     y actualizarIdiomaPush() cuando se cambia de idioma.
--   · app/idiomas.js   — llamar a actualizarIdiomaPush() desde cambiarIdioma().
--   · app/sw.js        — usar d.idioma en vez de 'es' clavado. Importa: `lang`
--     es lo que usa el lector de pantalla para elegir la voz.
