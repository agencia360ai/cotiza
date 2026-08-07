-- 0043: Arregla la invitación de correos FUERA de @dicecpanama.com.
--
-- La 0025 dejaba pasar a los invitados mirando raw_app_meta_data->>'invited' en
-- un trigger BEFORE INSERT. Eso nunca funcionó: Supabase no escribe el
-- app_metadata que manda la API admin en ese INSERT (se comprobó: ningún
-- usuario creado por invitación tiene la bandera). El bug quedó oculto porque
-- todas las invitaciones previas eran del dominio de la casa, que pasa igual.
--
-- Ahora la exención es explícita y verificable: el flujo de invitación anota el
-- correo en esta lista ANTES de crear al usuario, y el candado la consulta. Así
-- se mantiene el candado a nivel de base (una llamada cruda con la anon key
-- sigue bloqueada) sin depender de metadata que no está disponible a tiempo.

create table if not exists cotiza.signup_allowlist (
  email      text primary key,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Sin policies: solo el service_role (el flujo de invitación) la toca.
alter table cotiza.signup_allowlist enable row level security;

create or replace function cotiza.handle_new_user_domain_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    raise exception 'Registro permitido solo para correos @dicecpanama.com';
  end if;
  -- Invitado explícitamente desde Configuración → Miembros: cualquier dominio.
  if exists (select 1 from cotiza.signup_allowlist a where a.email = lower(new.email)) then
    return new;
  end if;
  if new.email !~* '@dicecpanama\.com$' then
    raise exception 'Registro permitido solo para correos @dicecpanama.com';
  end if;
  return new;
end;
$$;

-- El auto-join sigue siendo solo para el alta autoservicio del dominio propio:
-- a los invitados les pone la membresía y el rol el flujo de invitación.
create or replace function cotiza.handle_new_user_autojoin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email ~* '@dicecpanama\.com$'
     and not exists (select 1 from cotiza.signup_allowlist a where a.email = lower(new.email)) then
    insert into cotiza.org_members (org_id, user_id, role)
    values ('def371b1-ffed-4249-88a0-758026f9bf1e', new.id, 'engineer')
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
