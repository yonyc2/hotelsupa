-- =====================================================================
--  MIGRACIÓN: editar nombre, habitación y código del huésped desde Recepción
--  Ejecútalo UNA vez en Supabase > SQL Editor (si ya tenías el script instalado).
--  Reemplaza la función update_stay por una versión con más campos editables.
--  Orden: corre esto ANTES de publicar la app nueva. La app vieja sigue funcionando con la
--  función nueva, pero la app nueva envía campos que la función vieja no conoce.
-- =====================================================================

begin;

-- Firma anterior (si se deja, hay dos funciones con el mismo nombre y falla la llamada)
drop function if exists public.update_stay(bigint, integer, text, text);

-- Actualizar huésped (recepción, admin). Los parámetros en null no se modifican.
-- Se puede editar nombre, habitación, código de tarjeta, límite de toallas y comentario.
create or replace function public.update_stay(
  p_id             bigint,
  p_towel_limit    integer default null,
  p_comment        text default null,
  p_guest_name     text default null,
  p_room_number    text default null,
  p_guest_barcode  text default null
)
returns public.stays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_old  jsonb;
  v_code text;
  s      public.stays;
begin
  perform public.require_role(array['recepcion', 'admin']);

  if p_towel_limit is null and p_comment is null and p_guest_name is null
     and p_room_number is null and p_guest_barcode is null then
    raise exception 'No hay datos para actualizar';
  end if;

  select * into s from public.stays where id = p_id for update;
  if not found then
    raise exception 'Huésped no encontrado';
  end if;

  v_old := jsonb_build_object('guest_name', s.guest_name, 'room_number', s.room_number,
                              'guest_barcode', s.guest_barcode, 'towel_limit', s.towel_limit,
                              'comment', s.comment);

  if p_towel_limit is not null then
    if p_towel_limit < 0 then raise exception 'Límite de toallas debe ser un entero mayor o igual a 0'; end if;
    if p_towel_limit > 100000 then raise exception 'Límite de toallas es demasiado grande'; end if;
    if s.status = 'activo' and p_towel_limit < s.current_towels then
      raise exception 'El nuevo límite no puede ser menor a las toallas que ya tiene el huésped';
    end if;
    s.towel_limit := p_towel_limit;
  end if;

  if p_comment is not null then
    s.comment := public.clean_text(p_comment, 'El comentario', 500);
  end if;

  if p_guest_name is not null then
    s.guest_name := public.clean_text(p_guest_name, 'El nombre del huésped', 100, true);
  end if;

  if p_room_number is not null then
    s.room_number := public.clean_text(p_room_number, 'El número de habitación', 20, true);
    if s.status = 'activo' and exists (
         select 1 from public.stays
          where room_number = s.room_number and status = 'activo' and id <> s.id) then
      raise exception 'La habitación % ya tiene un huésped activo', s.room_number;
    end if;
  end if;

  if p_guest_barcode is not null then
    v_code := btrim(p_guest_barcode);
    if v_code = '' then
      raise exception 'El código de tarjeta es requerido';
    end if;
    if v_code !~ '^[0-9]{4,20}$' then
      raise exception 'El código de tarjeta debe ser numérico y tener entre 4 y 20 dígitos';
    end if;
    if s.status = 'activo' and exists (
         select 1 from public.stays
          where guest_barcode = v_code and status = 'activo' and id <> s.id) then
      raise exception 'Ese código de tarjeta ya está en uso por un huésped activo';
    end if;
    s.guest_barcode := v_code;
  end if;

  update public.stays
     set towel_limit   = s.towel_limit,
         comment       = s.comment,
         guest_name    = s.guest_name,
         room_number   = s.room_number,
         guest_barcode = s.guest_barcode,
         updated_by    = v_uid
   where id = s.id
  returning * into s;

  perform public.add_history(v_uid, 'ACTUALIZAR_HUESPED', s.id, v_old,
    jsonb_build_object('guest_name', s.guest_name, 'room_number', s.room_number,
                       'guest_barcode', s.guest_barcode, 'towel_limit', s.towel_limit,
                       'comment', s.comment));
  return s;

exception
  when unique_violation then
    raise exception 'Esa habitación o ese código de tarjeta ya está en uso por un huésped activo';
end;
$$;


revoke all on function public.update_stay(bigint, integer, text, text, text, text) from public, anon;
grant execute on function public.update_stay(bigint, integer, text, text, text, text) to authenticated;

commit;
