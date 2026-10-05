-- ═══════════════════════════════════════════════════════════════════════════
--  ANOTAR LA ROPA DE LAS PESADAS QUE YA EXISTÍAN
--
--  Se ejecuta UNA VEZ, y sólo DESPUÉS de que esté desplegado el código que
--  entiende `bruto` y `ropa`. Antes de eso, el modal de edición reemplaza
--  `datos` entero y borraría la anotación en cuanto alguien corrigiera la
--  hora de un peso.
--
--  ── POR QUÉ ──
--  A partir de ahora `datos->>'gramos'` significa «peso SIN ropa». Las
--  diecisiete pesadas anteriores se apuntaron tal cual salían de la báscula.
--  Si no se anotan, la primera pesada nueva baja un escalón artificial y la
--  tendencia se tuerce justo en el cambio — en la pantalla más clínica que
--  tiene la aplicación.
--
--  ── DE DÓNDE SALE EL DATO ──
--  No se estima nada: Jorge sabe lo que llevaba puesto.
--
--    · Los tres primeros días de vida (11, 12 y 13 de septiembre), el 17 y
--      el 23 fueron en el pediatra y DESNUDO. Esas cinco no se tocan: su
--      `gramos` ya es el peso limpio, que es justo lo que la columna
--      significa a partir de ahora.
--    · Las otras doce, con pañal talla 1 y body de manga corta talla 0.
--      En la tabla de app/ropa.js, fila de la talla 50: 22 + 28 = 50 g.
--
--  Álex nació el 11-09-2026, así que a lo largo de todas estas pesadas tenía
--  entre 0 y 24 días. La talla 50 y el pañal T1 son los que le correspondían
--  en todas ellas; no hay ningún cambio de talla escondido en medio.
--
--  ── LAS GUARDAS ──
--  1) Se excluyen por `id`, nunca por fecha. `fecha_hora` es timestamptz y
--     en octubre hay cambio de hora: una comparación de fechas es la forma
--     más fácil de llevarse por delante la pesada equivocada.
--  2) `NOT (datos ? 'ropa')` lo hace IDEMPOTENTE. Ejecutarlo dos veces no
--     resta otros 50 g: la segunda vez afecta a 0 filas.
--  3) Antes de ejecutarlo se guardó el estado anterior en
--     copias/pesos-antes-de-la-ropa-2026-10-05.json, fuera del repositorio.
--     En el plan Free de Supabase no hay copias de seguridad; ésa es la red.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ENSAYO ─────────────────────────────────────────────────────────────────
-- Mismo WHERE, como SELECT. Hay que leerlo entero antes de seguir:
--   · 12 filas (17 menos las 5 del pediatra),
--   · ninguna del 11, 12, 13, 17 ni 23 de septiembre,
--   · ningún «despues» por debajo de 500.

SELECT (r.fecha_hora AT TIME ZONE 'Europe/Madrid')::date AS dia,
       (r.datos->>'gramos')::int                         AS antes,
       (r.datos->>'gramos')::int - 50                    AS despues
  FROM public.registros r
  JOIN public.ninos n ON n.id = r.nino_id
 WHERE n.nombre = 'Álex'
   AND r.tipo = 'peso'
   AND NOT (r.datos ? 'ropa')
   AND r.id <> ALL (ARRAY['ab4387e5-492f-42d3-a3ba-cf3d0bae9595',   -- 11-sep, día 0
                          '68b78a1d-ff39-4519-a807-1df603d23b65',   -- 12-sep, día 1
                          'e28765d0-fa3c-47c9-9048-7435f44bf3f8',   -- 13-sep, día 2
                          'fbdf8ed8-03df-4943-a158-eafda0ddc772',   -- 17-sep
                          'b5527711-2b19-4221-98cf-dc816b0faa2d']::uuid[])
 ORDER BY r.fecha_hora;


-- ── EL CAMBIO ──────────────────────────────────────────────────────────────
-- Idéntico WHERE. `v` es la versión de la tabla de app/ropa.js con la que se
-- calcularon estos 50 g, para que dentro de dos años se sepa de dónde salen.

UPDATE public.registros r
   SET datos = jsonb_build_object(
         'gramos', (r.datos->>'gramos')::int - 50,
         'bruto',  (r.datos->>'gramos')::int,
         'ropa',   jsonb_build_object(
                     'talla', 50,
                     'g',     50,
                     'v',     1,
                     'prendas', jsonb_build_array('bodyMC', 'panal')))
  FROM public.ninos n
 WHERE n.id = r.nino_id
   AND n.nombre = 'Álex'
   AND r.tipo = 'peso'
   AND NOT (r.datos ? 'ropa')
   AND r.id <> ALL (ARRAY['ab4387e5-492f-42d3-a3ba-cf3d0bae9595',
                          '68b78a1d-ff39-4519-a807-1df603d23b65',
                          'e28765d0-fa3c-47c9-9048-7435f44bf3f8',
                          'fbdf8ed8-03df-4943-a158-eafda0ddc772',
                          'b5527711-2b19-4221-98cf-dc816b0faa2d']::uuid[]);


-- ── COMPROBAR ──────────────────────────────────────────────────────────────
-- Tiene que salir: 17 pesadas en total, 12 anotadas, 5 sin ropa.

SELECT count(*)                              AS total,
       count(*) FILTER (WHERE datos ? 'ropa') AS anotadas,
       count(*) FILTER (WHERE NOT (datos ? 'ropa')) AS desnudas
  FROM public.registros r
  JOIN public.ninos n ON n.id = r.nino_id
 WHERE n.nombre = 'Álex' AND r.tipo = 'peso';
