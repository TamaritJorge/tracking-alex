-- ═══════════════════════════════════════════════════════════════════════════
--  LA TALLA DE ROPA DEL BEBÉ
--
--  ── POR QUÉ HACE FALTA ──
--  Al descontar la ropa del peso, la talla salía del último registro de peso
--  que la llevara. Parecía elegante —cero esquema, se comparte sola entre los
--  dos móviles— y tenía dos agujeros que se vieron al usarlo de verdad:
--
--    1) Al anotar las diecisiete pesadas anteriores (ropa-retroactiva.sql) se
--       les estampó `talla: 50` a todas, incluida la más reciente. A partir de
--       ahí el formulario proponía 50: un valor que nadie había elegido.
--
--    2) Si guardas un peso SIN marcar ninguna prenda, `datos` es sólo
--       `{ gramos }` y la talla no se guarda en ningún sitio. La siguiente vez
--       vuelve a la del registro anterior, o a la edad.
--
--  La raíz es que la talla no es una propiedad de una pesada: es del bebé.
--  Vive donde viven la fecha de nacimiento y el sexo.
--
--  ── POR QUÉ NULLABLE Y SIN DEFAULT ──
--  NULL significa «todavía no la ha dicho nadie», que es distinto de 50. Con
--  un DEFAULT, los hijos que ya existen quedarían declarando una talla que
--  nadie eligió — exactamente el fallo que esto viene a arreglar. Mientras sea
--  NULL, el formulario propone una a partir de la edad y avisa de que es una
--  conjetura.
--
--  ── EL CHECK ──
--  Las tallas europeas de bebé van en centímetros. 40 y 110 son los extremos
--  razonables (prematuro y tres años) con holgura. No es decoración: sin él,
--  un 5 o un 500 llegados de un cliente con un fallo harían que pesoRopa()
--  cayera a la talla más cercana en silencio y restara lo que no toca.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ninos
  ADD COLUMN IF NOT EXISTS talla SMALLINT;

ALTER TABLE public.ninos
  DROP CONSTRAINT IF EXISTS ninos_talla_ok;

ALTER TABLE public.ninos
  ADD CONSTRAINT ninos_talla_ok CHECK (talla IS NULL OR talla BETWEEN 40 AND 110);

COMMENT ON COLUMN public.ninos.talla IS
  'Talla de ropa actual en centímetros (europea). La usa app/ropa.js para '
  'estimar lo que pesa la ropa al registrar un peso. NULL = sin decidir.';

-- No hace falta tocar RLS: las políticas de `ninos` son por fila, no por
-- columna, y quien ya podía editar el nombre o la fecha de nacimiento puede
-- editar ésta. La cadena sigue siendo la de siempre:
--   ninos.familia_id -> es_miembro() -> familia_miembros.user_id = auth.uid()


-- ── LA TALLA QUE YA SE SABE ────────────────────────────────────────────────
-- Álex tiene una pesada del 07-10-2026 apuntada a mano con talla 56, que es
-- la única que eligió una persona (las demás las puso ropa-retroactiva.sql).
-- Se recoge para no empezar en NULL. Idempotente: sólo si todavía no hay
-- ninguna.

UPDATE public.ninos n
   SET talla = 56
 WHERE n.nombre = 'Álex'
   AND n.talla IS NULL;
