-- =====================================================================
--  CONTROL DE TOALLAS - Base de datos para Supabase (PostgreSQL)
--
--  Cómo usarlo:
--   1. En Supabase abre "SQL Editor" > "New query".
--   2. Pega TODO este archivo y presiona "Run".
--   3. Lee las instrucciones del final (crear el primer administrador).
--
--  Qué crea:
--   - Tablas: profiles, stays, towel_movements, history
--   - Reglas de negocio como funciones (límites de toallas, check-out, códigos únicos...)
--   - Seguridad por filas (RLS): el navegador NO puede escribir directo en las tablas;
--     solo puede llamar a las funciones de abajo, que validan rol y reglas.
--   - Vistas con fechas en hora de CDMX y actualización en vivo (Realtime).
--
--  Está pensado para un proyecto nuevo. Se puede volver a ejecutar sin errores.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Perfil de cada usuario de la aplicación (1 a 1 con auth.users de Supabase)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null check (username ~ '^[a-zA-Z0-9._-]{3,32}$'),
  full_name   text not null check (char_length(full_name) between 1 and 100),
  role        text not null default 'toallero' check (role in ('admin', 'recepcion', 'toallero')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_username_uq on public.profiles (lower(username));

-- Estancias de huéspedes
create table if not exists public.stays (
  id              bigint generated always as identity primary key,
  guest_barcode   text not null check (guest_barcode ~ '^[0-9]{4,20}$'),
  guest_name      text not null check (char_length(guest_name) between 1 and 100),
  room_number     text not null check (char_length(room_number) between 1 and 20),
  status          text not null default 'activo' check (status in ('activo', 'salido')),
  entry_date      timestamptz not null default now(),
  exit_date       timestamptz,
  towel_limit     integer not null check (towel_limit between 0 and 100000),
  initial_towels  integer not null default 0 check (initial_towels >= 0),
  current_towels  integer not null default 0 check (current_towels >= 0),
  comment         text not null default '' check (char_length(comment) <= 500),
  created_by      uuid references public.profiles (id) on delete set null,
  updated_by      uuid references public.profiles (id) on delete set null,
  constraint stays_initial_le_limit check (initial_towels <= towel_limit),
  constraint stays_current_le_limit check (current_towels <= towel_limit)
);

-- Una habitación y un código de tarjeta solo pueden estar activos con un huésped a la vez
create unique index if not exists stays_room_activa_uq    on public.stays (room_number)   where status = 'activo';
create unique index if not exists stays_barcode_activa_uq on public.stays (guest_barcode) where status = 'activo';
create index if not exists stays_barcode_idx on public.stays (guest_barcode);
create index if not exists stays_status_idx  on public.stays (status, id desc);

-- Movimientos de toallas
create table if not exists public.towel_movements (
  id             bigint generated always as identity primary key,
  stay_id        bigint not null references public.stays (id),
  user_id        uuid references public.profiles (id) on delete set null,
  movement_type  text not null check (movement_type in ('inicial', 'entrega', 'devolucion')),
  quantity       integer not null,
  balance_after  integer not null check (balance_after >= 0),
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists movements_stay_idx on public.towel_movements (stay_id, id desc);

-- Historial de acciones
create table if not exists public.history (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null,
  action      text not null,
  stay_id     bigint references public.stays (id) on delete set null,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists history_created_idx on public.history (id desc);
create index if not exists history_stay_idx    on public.history (stay_id);


-- ---------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES
-- ---------------------------------------------------------------------

-- Fecha/hora en horario de Ciudad de México, como texto "2026-10-30 14:05:09"
create or replace function public.fmt_cdmx(p_ts timestamptz)
returns text
language sql
stable
as $$
  select to_char(p_ts at time zone 'America/Mexico_City', 'YYYY-MM-DD HH24:MI:SS')
$$;

-- Rol del usuario que hace la petición (null si no hay sesión o está inactivo)
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- Exige sesión y que el rol esté entre los permitidos. Devuelve el rol.
create or replace function public.require_role(p_roles text[])
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  v_role := public.app_role();
  if v_role is null then
    raise exception 'No autenticado';
  end if;

  if not (v_role = any (p_roles)) then
    raise exception 'Sin permiso para esta acción';
  end if;

  return v_role;
end;
$$;

-- Limpia un texto (quita caracteres de control, recorta espacios) y valida longitud
create or replace function public.clean_text(p_text text, p_field text, p_max integer, p_required boolean default false)
returns text
language plpgsql
immutable
as $$
declare
  s text := btrim(regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0b-\x1f\x7f]', '', 'g'));
begin
  if p_required and s = '' then
    raise exception '% es requerido', p_field;
  end if;
  if char_length(s) > p_max then
    raise exception '% no puede exceder % caracteres', p_field, p_max;
  end if;
  return s;
end;
$$;

-- Escribe en el historial (solo la usan las demás funciones)
create or replace function public.add_history(p_user uuid, p_action text, p_stay bigint, p_old jsonb, p_new jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.history (user_id, action, stay_id, old_values, new_values)
  values (p_user, p_action, p_stay, p_old, p_new)
$$;


-- ---------------------------------------------------------------------
-- 3. ALTA AUTOMÁTICA DE PERFIL AL CREAR UN USUARIO EN SUPABASE AUTH
--    - El PRIMER usuario que se crea queda como administrador activo.
--    - Los demás quedan como "toallero" INACTIVO hasta que un admin los active
--      (así, aunque alguien se registre, no puede usar nada).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first    boolean;
  v_username text;
  v_full     text;
begin
  select not exists (select 1 from public.profiles) into v_first;

  v_username := regexp_replace(
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1))),
    '[^a-z0-9._-]', '', 'g');

  v_full := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');

  insert into public.profiles (id, username, full_name, role, active)
  values (new.id, v_username, coalesce(v_full, v_username), case when v_first then 'admin' else 'toallero' end, v_first);

  perform public.add_history(null, 'CREAR_USUARIO', null, null,
    jsonb_build_object('userId', new.id, 'username', v_username,
                       'role', case when v_first then 'admin' else 'toallero' end, 'active', v_first));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 4. FUNCIONES DE NEGOCIO (lo que antes hacía server.js)
-- ---------------------------------------------------------------------

-- Alta de huésped (recepción, admin)
create or replace function public.create_stay(
  p_guest_name     text,
  p_room_number    text,
  p_guest_barcode  text,
  p_towel_limit    integer default null,
  p_initial_towels integer default 0,
  p_comment        text default ''
)
returns public.stays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_name    text;
  v_room    text;
  v_code    text := btrim(coalesce(p_guest_barcode, ''));
  v_comment text;
  v_initial integer := coalesce(p_initial_towels, 0);
  s         public.stays;
begin
  perform public.require_role(array['recepcion', 'admin']);

  v_name    := public.clean_text(p_guest_name, 'El nombre del huésped', 100, true);
  v_room    := public.clean_text(p_room_number, 'El número de habitación', 20, true);
  v_comment := public.clean_text(p_comment, 'El comentario', 500);

  if p_towel_limit is null then
    raise exception 'Límite de toallas es requerido';
  end if;
  if p_towel_limit < 0 then raise exception 'Límite de toallas debe ser un entero mayor o igual a 0'; end if;
  if p_towel_limit > 100000 then raise exception 'Límite de toallas es demasiado grande'; end if;
  if v_initial < 0 then raise exception 'Toallas iniciales debe ser un entero mayor o igual a 0'; end if;
  if v_initial > 100000 then raise exception 'Toallas iniciales es demasiado grande'; end if;

  if v_initial > p_towel_limit then
    raise exception 'Las toallas iniciales no pueden exceder el límite configurado';
  end if;

  if exists (select 1 from public.stays where room_number = v_room and status = 'activo') then
    raise exception 'La habitación % ya tiene un huésped activo', v_room;
  end if;

  if v_code = '' then
    raise exception 'El código de tarjeta es requerido';
  end if;
  if v_code !~ '^[0-9]{4,20}$' then
    raise exception 'El código de tarjeta debe ser numérico y tener entre 4 y 20 dígitos';
  end if;
  if exists (select 1 from public.stays where guest_barcode = v_code and status = 'activo') then
    raise exception 'Ese código de tarjeta ya está en uso por un huésped activo';
  end if;

  insert into public.stays (guest_barcode, guest_name, room_number, towel_limit,
                            initial_towels, current_towels, comment, created_by, updated_by)
  values (v_code, v_name, v_room, p_towel_limit, v_initial, v_initial, v_comment, v_uid, v_uid)
  returning * into s;

  if v_initial > 0 then
    insert into public.towel_movements (stay_id, user_id, movement_type, quantity, balance_after, reason)
    values (s.id, v_uid, 'inicial', v_initial, v_initial, 'Asignación inicial');
  end if;

  perform public.add_history(v_uid, 'ALTA_HUESPED', s.id, null,
    jsonb_build_object('guest_name', s.guest_name, 'room_number', s.room_number, 'guest_barcode', s.guest_barcode,
                       'towel_limit', s.towel_limit,
                       'initial_towels', s.initial_towels, 'current_towels', s.current_towels));
  return s;

exception
  when unique_violation then
    raise exception 'Esa habitación o ese código de tarjeta ya está en uso por un huésped activo';
end;
$$;

-- Actualizar huésped (recepción, admin). Los parámetros en null no se modifican.
create or replace function public.update_stay(
  p_id           bigint,
  p_towel_limit  integer default null,
  p_comment      text default null,
  p_guest_name   text default null
)
returns public.stays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb;
  s     public.stays;
begin
  perform public.require_role(array['recepcion', 'admin']);

  if p_towel_limit is null and p_comment is null and p_guest_name is null then
    raise exception 'No hay datos para actualizar';
  end if;

  select * into s from public.stays where id = p_id for update;
  if not found then
    raise exception 'Huésped no encontrado';
  end if;

  v_old := jsonb_build_object('guest_name', s.guest_name, 'towel_limit', s.towel_limit, 'comment', s.comment);

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

  update public.stays
     set towel_limit = s.towel_limit,
         comment     = s.comment,
         guest_name  = s.guest_name,
         updated_by  = v_uid
   where id = s.id
  returning * into s;

  perform public.add_history(v_uid, 'ACTUALIZAR_HUESPED', s.id, v_old,
    jsonb_build_object('guest_name', s.guest_name, 'towel_limit', s.towel_limit, 'comment', s.comment));
  return s;
end;
$$;

-- Entregar o devolver toallas (toallero, recepción, admin)
create or replace function public.move_towels(
  p_stay_id  bigint,
  p_action   text,
  p_qty      integer,
  p_reason   text default null
)
returns public.stays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_delta  integer;
  v_bal    integer;
  v_old    integer;
  v_reason text;
  s        public.stays;
begin
  perform public.require_role(array['toallero', 'recepcion', 'admin']);

  if p_action is null or p_action not in ('entrega', 'devolucion') then
    raise exception 'Acción inválida';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'La cantidad debe ser un entero mayor a 0';
  end if;

  select * into s from public.stays where id = p_stay_id for update;
  if not found then
    raise exception 'Huésped no encontrado';
  end if;
  if s.status <> 'activo' then
    raise exception 'El huésped ya no está activo';
  end if;

  v_delta := case when p_action = 'entrega' then p_qty else -p_qty end;
  v_old   := s.current_towels;
  v_bal   := v_old + v_delta;

  if v_bal < 0 then
    raise exception 'La devolución dejaría la cuenta de toallas en negativo';
  end if;
  if p_action = 'entrega' and v_bal > s.towel_limit then
    raise exception 'Límite excedido. Solo puede recibir % toalla(s) más.', s.towel_limit - v_old;
  end if;

  v_reason := nullif(public.clean_text(p_reason, 'El motivo', 200), '');

  insert into public.towel_movements (stay_id, user_id, movement_type, quantity, balance_after, reason)
  values (s.id, v_uid, p_action, v_delta, v_bal, v_reason);

  update public.stays set current_towels = v_bal, updated_by = v_uid where id = s.id returning * into s;

  perform public.add_history(v_uid,
    case when p_action = 'entrega' then 'ENTREGA_TOALLAS' else 'DEVOLUCION_TOALLAS' end,
    s.id,
    jsonb_build_object('current_towels', v_old, 'towel_limit', s.towel_limit),
    jsonb_build_object('current_towels', v_bal, 'towel_limit', s.towel_limit));
  return s;
end;
$$;

-- Check-out (recepción, admin). Solo con 0 toallas pendientes.
create or replace function public.checkout_stay(p_id bigint)
returns public.stays
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s     public.stays;
begin
  perform public.require_role(array['recepcion', 'admin']);

  select * into s from public.stays where id = p_id for update;
  if not found then
    raise exception 'Huésped no encontrado';
  end if;
  if s.status <> 'activo' then
    raise exception 'El huésped ya salió';
  end if;
  if s.current_towels <> 0 then
    raise exception 'No se puede hacer check-out. Faltan % toallas por devolver.', s.current_towels;
  end if;

  update public.stays
     set status = 'salido', exit_date = now(), updated_by = v_uid
   where id = s.id
  returning * into s;

  perform public.add_history(v_uid, 'CHECKOUT', s.id,
    jsonb_build_object('status', 'activo', 'current_towels', s.current_towels),
    jsonb_build_object('status', 'salido', 'current_towels', s.current_towels));
  return s;
end;
$$;

-- Escanear tarjeta (cualquier usuario activo). Devuelve el huésped y sus últimos 20 movimientos.
create or replace function public.scan_stay(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  s      public.stays;
begin
  perform public.require_role(array['toallero', 'recepcion', 'admin']);

  if v_code = '' then
    raise exception 'Código requerido';
  end if;

  select * into s
    from public.stays
   where guest_barcode = v_code
   order by case status when 'activo' then 0 else 1 end, id desc
   limit 1;

  if not found then
    raise exception 'Tarjeta no encontrada';
  end if;

  return to_jsonb(s)
    || jsonb_build_object(
         'entry_date_cdmx', public.fmt_cdmx(s.entry_date),
         'exit_date_cdmx',  public.fmt_cdmx(s.exit_date),
         'movements', coalesce((
           select jsonb_agg(to_jsonb(m) order by m.id desc)
             from (
               select tm.*, public.fmt_cdmx(tm.created_at) as created_at_cdmx, p.username
                 from public.towel_movements tm
                 left join public.profiles p on p.id = tm.user_id
                where tm.stay_id = s.id
                order by tm.id desc
                limit 20
             ) m
         ), '[]'::jsonb));
end;
$$;

-- Registrar inicio/cierre de sesión en el historial
create or replace function public.log_event(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_role(array['toallero', 'recepcion', 'admin']);
  if p_action not in ('LOGIN', 'LOGOUT') then
    raise exception 'Evento inválido';
  end if;
  perform public.add_history(auth.uid(), p_action, null, null, null);
end;
$$;

-- Administración de usuarios (solo admin): rol, activo, nombre. Parámetros en null = sin cambio.
create or replace function public.admin_set_profile(
  p_id         uuid,
  p_role       text default null,
  p_active     boolean default null,
  p_full_name  text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_old    jsonb;
  v_action text;
  pr       public.profiles;
begin
  perform public.require_role(array['admin']);

  select * into pr from public.profiles where id = p_id for update;
  if not found then
    raise exception 'Usuario no encontrado';
  end if;

  if p_role is not null and p_role not in ('admin', 'recepcion', 'toallero') then
    raise exception 'Rol inválido';
  end if;
  if p_id = v_uid and p_active = false then
    raise exception 'No puedes desactivar tu propio usuario';
  end if;
  if p_id = v_uid and p_role is not null and p_role <> 'admin' then
    raise exception 'No puedes quitarte el rol de administrador';
  end if;

  v_old := jsonb_build_object('username', pr.username, 'role', pr.role, 'active', pr.active, 'full_name', pr.full_name);

  update public.profiles
     set role      = coalesce(p_role, role),
         active    = coalesce(p_active, active),
         full_name = case when p_full_name is null then full_name
                          else public.clean_text(p_full_name, 'El nombre completo', 100, true) end
   where id = p_id
  returning * into pr;

  v_action := case
    when p_active is not null and p_active is distinct from (v_old ->> 'active')::boolean
      then case when pr.active then 'ACTIVAR_USUARIO' else 'DESACTIVAR_USUARIO' end
    else 'ACTUALIZAR_USUARIO'
  end;

  perform public.add_history(v_uid, v_action, null, v_old,
    jsonb_build_object('username', pr.username, 'role', pr.role, 'active', pr.active, 'full_name', pr.full_name));
  return pr;
end;
$$;

-- Limpiar historial después de exportar a Excel (solo admin).
-- La app lee todo, genera el Excel y luego llama a esta función con el id más alto exportado.
-- Conserva usuarios, huéspedes (activos y con check-out) y movimientos.
create or replace function public.purge_history(p_max_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
  v_active  integer;
  v_exited  integer;
  v_users   integer;
begin
  perform public.require_role(array['admin']);

  delete from public.history where id <= coalesce(p_max_id, 0);
  get diagnostics v_deleted = row_count;

  select count(*) filter (where status = 'activo'),
         count(*) filter (where status <> 'activo')
    into v_active, v_exited
    from public.stays;
  select count(*) into v_users from public.profiles;

  perform public.add_history(auth.uid(), 'EXPORTAR_BD', null, null,
    jsonb_build_object('usuarios', v_users, 'huespedes_activos', v_active, 'huespedes_checkout', v_exited));

  return v_deleted;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. VISTAS (con fechas en hora de CDMX). Respetan la seguridad de quien consulta.
-- ---------------------------------------------------------------------
create or replace view public.v_stays with (security_invoker = true) as
select s.*,
       public.fmt_cdmx(s.entry_date) as entry_date_cdmx,
       public.fmt_cdmx(s.exit_date)  as exit_date_cdmx
  from public.stays s;

create or replace view public.v_movements with (security_invoker = true) as
select tm.*,
       public.fmt_cdmx(tm.created_at) as created_at_cdmx,
       p.username,
       s.guest_name,
       s.room_number
  from public.towel_movements tm
  left join public.profiles p on p.id = tm.user_id
  left join public.stays s    on s.id = tm.stay_id;

create or replace view public.v_history with (security_invoker = true) as
select h.*,
       public.fmt_cdmx(h.created_at) as created_at_cdmx,
       p.username,
       p.full_name,
       s.guest_name,
       s.room_number
  from public.history h
  left join public.profiles p on p.id = h.user_id
  left join public.stays s    on s.id = h.stay_id;


-- ---------------------------------------------------------------------
-- 6. SEGURIDAD POR FILAS (RLS)
--    Lectura según el rol. NO hay políticas de escritura: todo cambio pasa por las funciones.
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.stays           enable row level security;
alter table public.towel_movements enable row level security;
alter table public.history         enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.app_role() in ('admin', 'recepcion'));

drop policy if exists stays_select on public.stays;
create policy stays_select on public.stays
  for select to authenticated
  using (public.app_role() in ('admin', 'recepcion'));

drop policy if exists movements_select on public.towel_movements;
create policy movements_select on public.towel_movements
  for select to authenticated
  using (public.app_role() in ('admin', 'recepcion'));

drop policy if exists history_select on public.history;
create policy history_select on public.history
  for select to authenticated
  using (public.app_role() in ('admin', 'recepcion'));


-- ---------------------------------------------------------------------
-- 7. PERMISOS
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.stays, public.towel_movements, public.history from anon, authenticated;
revoke all on public.v_stays, public.v_movements, public.v_history from anon, authenticated;

grant select on public.profiles, public.stays, public.towel_movements, public.history to authenticated;
grant select on public.v_stays, public.v_movements, public.v_history to authenticated;

-- Funciones internas: nadie las llama desde el navegador
revoke all on function public.require_role(text[])                                  from public, anon, authenticated;
revoke all on function public.add_history(uuid, text, bigint, jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.clean_text(text, text, integer, boolean)              from public, anon, authenticated;
revoke all on function public.handle_new_user()                                     from public, anon, authenticated;

-- Funciones que sí usa la aplicación (solo usuarios con sesión)
revoke all on function public.app_role()                                            from public, anon;
revoke all on function public.fmt_cdmx(timestamptz)                                 from public, anon;
revoke all on function public.create_stay(text, text, text, integer, integer, text) from public, anon;
revoke all on function public.update_stay(bigint, integer, text, text)     from public, anon;
revoke all on function public.move_towels(bigint, text, integer, text)              from public, anon;
revoke all on function public.checkout_stay(bigint)                                 from public, anon;
revoke all on function public.scan_stay(text)                                       from public, anon;
revoke all on function public.log_event(text)                                       from public, anon;
revoke all on function public.admin_set_profile(uuid, text, boolean, text)          from public, anon;
revoke all on function public.purge_history(bigint)                                 from public, anon;

grant execute on function public.app_role()                                            to authenticated;
grant execute on function public.fmt_cdmx(timestamptz)                                 to authenticated;
grant execute on function public.create_stay(text, text, text, integer, integer, text) to authenticated;
grant execute on function public.update_stay(bigint, integer, text, text)     to authenticated;
grant execute on function public.move_towels(bigint, text, integer, text)              to authenticated;
grant execute on function public.checkout_stay(bigint)                                 to authenticated;
grant execute on function public.scan_stay(text)                                       to authenticated;
grant execute on function public.log_event(text)                                       to authenticated;
grant execute on function public.admin_set_profile(uuid, text, boolean, text)          to authenticated;
grant execute on function public.purge_history(bigint)                                 to authenticated;


-- ---------------------------------------------------------------------
-- 8. ACTUALIZACIÓN EN VIVO (Realtime) entre dispositivos
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['stays', 'towel_movements', 'history', 'profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- ya estaba agregada
      when undefined_object then null;   -- la publicación no existe
    end;
  end loop;
end;
$$;


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


-- =====================================================================
--  DESPUÉS DE EJECUTAR ESTE SCRIPT
--
--  1) Authentication > Providers > Email: desactiva "Allow new users to sign up"
--     (los usuarios los creas tú) y, si quieres, "Confirm email".
--
--  2) Crea el PRIMER usuario (será administrador automáticamente):
--     Authentication > Users > Add user > Create new user
--       Email:    admin@hotel.local        (el "usuario" será lo que va antes del @)
--       Password: una contraseña fuerte
--       Marca "Auto Confirm User".
--
--  3) Más usuarios: créalos igual (Authentication > Users). Quedan INACTIVOS como "toallero".
--     Para activarlos y darles rol, en el SQL Editor:
--       update public.profiles set role = 'recepcion', active = true where username = 'maria';
--     (roles: admin, recepcion, toallero)
--
--  4) Comprobar que todo existe (debe devolver 4 tablas):
--       select table_name from information_schema.tables
--        where table_schema = 'public'
--          and table_name in ('profiles','stays','towel_movements','history');
--
--  NOTAS
--   - En el navegador usa SOLO la clave "anon"/publicable. NUNCA pongas la clave "service_role".
--   - Los intentos de login fallidos los controla Supabase Auth (límites propios);
--     ya no se guardan como LOGIN_FALLIDO en el historial.
--   - Este script es para un proyecto nuevo. Para borrar todo y empezar de cero:
--       drop view if exists public.v_history, public.v_movements, public.v_stays;
--       drop table if exists public.history, public.towel_movements, public.stays, public.profiles cascade;
-- =====================================================================
