-- Ejecuta esto UNA vez en el SQL Editor si ya tenías el script instalado y quieres el botón
-- "Eliminar datos antiguos" de la administración.

-- ---------------------------------------------------------------------
-- 10. ELIMINAR DATOS ANTIGUOS (solo admin)
--     Borra los huéspedes que YA hicieron check-out hasta la fecha indicada (inclusive, hora de CDMX),
--     junto con sus movimientos de toallas y su historial. NUNCA toca huéspedes activos ni usuarios.
--     p_apply = false: solo cuenta lo que se borraría. p_apply = true: lo borra.
-- ---------------------------------------------------------------------
create or replace function public.purge_stays_until(p_until date, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut      timestamptz;
  v_ids      bigint[];
  v_stays    integer := 0;
  v_moves    integer := 0;
  v_hist     integer := 0;
begin
  perform public.require_role(array['admin']);

  if p_until is null then
    raise exception 'La fecha es requerida';
  end if;
  if p_until > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La fecha no puede ser futura';
  end if;

  -- Inicio del día siguiente (hora de CDMX): incluye todo el día elegido
  v_cut := ((p_until + 1)::timestamp) at time zone 'America/Mexico_City';

  select coalesce(array_agg(id), '{}') into v_ids
    from public.stays
   where status = 'salido' and exit_date is not null and exit_date < v_cut;

  v_stays := coalesce(array_length(v_ids, 1), 0);
  select count(*) into v_moves from public.towel_movements where stay_id = any (v_ids);
  select count(*) into v_hist  from public.history         where stay_id = any (v_ids);

  if p_apply and v_stays > 0 then
    delete from public.history         where stay_id = any (v_ids);
    delete from public.towel_movements where stay_id = any (v_ids);
    delete from public.stays           where id = any (v_ids) and status = 'salido';

    perform public.add_history(auth.uid(), 'ELIMINAR_DATOS_ANTIGUOS', null, null,
      jsonb_build_object('hasta', p_until, 'huespedes', v_stays, 'movimientos', v_moves, 'historial', v_hist));
  end if;

  return jsonb_build_object('applied', (p_apply and v_stays > 0), 'stays', v_stays, 'movements', v_moves, 'history', v_hist);
end;
$$;

revoke all on function public.purge_stays_until(date, boolean) from public, anon;
grant execute on function public.purge_stays_until(date, boolean) to authenticated;

