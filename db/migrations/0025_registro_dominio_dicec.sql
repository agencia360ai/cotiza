-- 0025: registro autoservicio solo para @dicecpanama.com + auto-join al org Dicec.
-- (Aplicada en producción el 2026-07-13 vía MCP; este archivo es el registro.)
--
-- El signup público de Supabase queda habilitado, pero el candado vive en la
-- base: cualquier alta en auth.users con otro dominio se rechaza (incluida la
-- API cruda con la anon key, no solo el formulario de la app). Los usuarios
-- creados por INVITACIÓN (API admin desde Configuración → Miembros) llevan
-- app_metadata.invited = true y quedan exentos de las dos reglas: ni candado
-- de dominio ni auto-join (su membresía y rol los pone el flujo de invitación).
--
-- Modo single-org "por ahora": el auto-join apunta al org Dicec Inc por id.
-- Si algún día se reactiva multi-org, reemplazar por dominios por organización.

create or replace function cotiza.handle_new_user_domain_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invitados (API admin, Configuración → Miembros) pasan sin candado de dominio.
  if coalesce((new.raw_app_meta_data->>'invited')::boolean, false) then
    return new;
  end if;
  if new.email is null or new.email !~* '@dicecpanama\.com$' then
    raise exception 'Registro permitido solo para correos @dicecpanama.com';
  end if;
  return new;
end;
$$;

create or replace trigger cotiza_domain_gate
  before insert on auth.users
  for each row execute function cotiza.handle_new_user_domain_gate();

create or replace function cotiza.handle_new_user_autojoin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo el auto-registro con dominio de la casa; los invitados reciben su
  -- membresía (y rol elegido) del flujo de invitación.
  if not coalesce((new.raw_app_meta_data->>'invited')::boolean, false)
     and new.email ~* '@dicecpanama\.com$' then
    insert into cotiza.org_members (org_id, user_id, role)
    values ('def371b1-ffed-4249-88a0-758026f9bf1e', new.id, 'engineer')
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace trigger cotiza_autojoin
  after insert on auth.users
  for each row execute function cotiza.handle_new_user_autojoin();
