-- =====================================================================
--  LIBERAR ESPACIO EN LA BASE DE DATOS
--
--  Cuando se borran datos, PostgreSQL los elimina de verdad, pero el espacio que ocupaban queda
--  disponible DENTRO de la base para nuevos datos; el tamaño del archivo no baja por sí solo.
--  VACUUM FULL reescribe las tablas y devuelve ese espacio al disco.
--
--  Cómo usarlo (en Supabase > SQL Editor), después de usar "Eliminar datos antiguos":
--   1) Ejecuta la consulta de tamaños para ver cuánto ocupa cada tabla.
--   2) Ejecuta los VACUUM FULL. Si el editor da error por "transaction block",
--      ejecútalos UNO por UNO (selecciona solo esa línea y presiona Run).
--   Bloquea brevemente cada tabla mientras se compacta: hazlo cuando nadie esté usando la app.
-- =====================================================================

-- 1) Tamaño de cada tabla (incluye índices)
select relname as tabla,
       pg_size_pretty(pg_total_relation_size(relid)) as tamano
  from pg_catalog.pg_statio_user_tables
 where schemaname = 'public'
 order by pg_total_relation_size(relid) desc;

-- 2) Compactar (devuelve el espacio al disco)
vacuum full public.history;
vacuum full public.towel_movements;
vacuum full public.stays;
vacuum full public.profiles;

-- Opcional: Supabase guarda su propio registro de inicios de sesión en el esquema auth.
-- Si crece, puedes borrarlo hasta una fecha (ajusta la fecha) y compactarlo:
-- delete from auth.audit_log_entries where created_at < '2026-01-01';
-- vacuum full auth.audit_log_entries;
