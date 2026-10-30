-- Ejecuta esto SOLO si ya corriste el script anterior (supabase-schema.sql) y te falta esta función.

-- ---------------------------------------------------------------------
-- 9. DETECCIÓN DE CAMBIOS ENTRE DISPOSITIVOS
--    Devuelve un número que aumenta con cada cambio (toda acción queda en el historial).
--    La app lo consulta cada pocos segundos y solo recarga datos cuando cambia.
-- ---------------------------------------------------------------------
create or replace function public.data_version()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role(array['toallero', 'recepcion', 'admin']);
  return (select coalesce(max(id), 0) from public.history);
end;
$$;

revoke all on function public.data_version() from public, anon;
grant execute on function public.data_version() to authenticated;

