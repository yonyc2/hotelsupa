-- Ejecuta esto UNA vez en el SQL Editor para activar (o actualizar) el botón "Eliminar datos antiguos".
-- Si ya habías corrido una versión anterior de este archivo, vuelve a correr este: la reemplaza.

-- ---------------------------------------------------------------------
-- 10. ELIMINAR DATOS ANTIGUOS (solo admin)
--     Hasta la fecha indicada (inclusive, hora de CDMX) borra:
--       - los huéspedes que YA hicieron check-out, con sus movimientos de toallas
--       - TODO el historial anterior a esa fecha
--       - los usuarios DESACTIVADOS creados hasta esa fecha (también de Authentication)
--     NUNCA toca huéspedes activos ni usuarios activos.
--     p_apply = false: solo cuenta lo que se borraría. p_apply = true: lo borra.
-- ---------------------------------------------------------------------
create or replace function public.purge_stays_until(p_until date, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut    timestamptz;
  v_ids    bigint[];
  v_uids   uuid[];
  v_names  text[];
  v_stays  integer := 0;
  v_moves  integer := 0;
  v_hist   integer := 0;
  v_users  integer := 0;
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

  select coalesce(array_agg(id), '{}'), coalesce(array_agg(username order by username), '{}')
    into v_uids, v_names
    from public.profiles
   where not active and created_at < v_cut and id <> auth.uid();

  v_stays := coalesce(array_length(v_ids, 1), 0);
  v_users := coalesce(array_length(v_uids, 1), 0);
  select count(*) into v_moves from public.towel_movements where stay_id = any (v_ids);
  select count(*) into v_hist  from public.history where created_at < v_cut or stay_id = any (v_ids);

  if p_apply and (v_stays + v_users + v_hist) > 0 then
    delete from public.history         where created_at < v_cut or stay_id = any (v_ids);
    delete from public.towel_movements where stay_id = any (v_ids);
    delete from public.stays           where id = any (v_ids) and status = 'salido';
    -- Al borrar el usuario de Authentication se borra también su perfil (on delete cascade)
    delete from auth.users             where id = any (v_uids);

    perform public.add_history(auth.uid(), 'ELIMINAR_DATOS_ANTIGUOS', null, null,
      jsonb_build_object('hasta', p_until, 'huespedes', v_stays, 'movimientos', v_moves,
                         'historial', v_hist, 'usuarios', v_users));
  end if;

  return jsonb_build_object(
    'applied',   (p_apply and (v_stays + v_users + v_hist) > 0),
    'stays',     v_stays,
    'movements', v_moves,
    'history',   v_hist,
    'users',     v_users,
    'usernames', to_jsonb(v_names));
end;
$$;

revoke all on function public.purge_stays_until(date, boolean) from public, anon;
grant execute on function public.purge_stays_until(date, boolean) to authenticated;
