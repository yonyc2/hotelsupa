-- Ejecuta esto UNA vez en el SQL Editor para activar el "Reporte de toallas" (si ya tenías el script instalado).

-- ---------------------------------------------------------------------
-- 11. REPORTE DE TOALLAS POR DÍA (todos los roles)
--     Por cada día (hora de CDMX) del rango: toallas entregadas (incluye las iniciales que se
--     asignan al registrar al huésped) y toallas recibidas (devoluciones).
-- ---------------------------------------------------------------------
create or replace function public.towel_report(p_from date, p_to date)
returns table (report_day date, delivered bigint, returned bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_role(array['toallero', 'recepcion', 'admin']);

  if p_from is null or p_to is null then
    raise exception 'Las fechas son requeridas';
  end if;
  if p_to < p_from then
    raise exception 'La fecha final no puede ser anterior a la inicial';
  end if;
  if p_to - p_from > 366 then
    raise exception 'El rango máximo es de un año';
  end if;

  return query
  select (p_from + g.n) as report_day,
         coalesce(sum(m.quantity) filter (where m.movement_type in ('entrega', 'inicial')), 0)::bigint as delivered,
         coalesce(-sum(m.quantity) filter (where m.movement_type = 'devolucion'), 0)::bigint as returned
    from generate_series(0, p_to - p_from) as g(n)
    left join public.towel_movements m
           on (m.created_at at time zone 'America/Mexico_City')::date = p_from + g.n
   group by g.n
   order by g.n desc;
end;
$$;

revoke all on function public.towel_report(date, date) from public, anon;
grant execute on function public.towel_report(date, date) to authenticated;
