-- 0031: Asistencia por WhatsApp — clock in/out con "Enviar ubicación actual".
--
-- El empleado manda su ubicación al número de WhatsApp de la empresa; el webhook
-- (/api/whatsapp/webhook, service role) identifica al técnico por wa_id, decide
-- entrada/salida (toggle del día, zona America/Panama), matchea geocerca contra
-- client_locations (+ sede propia en attendance_settings) y registra el evento.
-- Turnos (in↔out) se calculan al vuelo — attendance_events es la fuente de verdad.
-- Cambio ADITIVO: no toca filas existentes.

-- ── 1) technicians.wa_id — número E.164 sin '+', tal como llega en messages[].from
alter table cotiza.technicians add column if not exists wa_id text;

-- Backfill desde phone: quitar no-dígitos; 7-8 dígitos ⇒ prefijar 507 (Panamá).
update cotiza.technicians
set wa_id = case
  when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^507\d{7,8}$'
    then regexp_replace(phone, '\D', '', 'g')
  when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^\d{7,8}$'
    then '507' || regexp_replace(phone, '\D', '', 'g')
  else null
end
where wa_id is null and phone is not null;

create unique index if not exists uq_technicians_wa_id
  on cotiza.technicians(org_id, wa_id) where wa_id is not null;

-- ── 2) Geocerca en client_locations (la RLS existente vía clients ya cubre esto)
alter table cotiza.client_locations add column if not exists lat double precision;
alter table cotiza.client_locations add column if not exists lng double precision;
alter table cotiza.client_locations add column if not exists geofence_radius_m integer not null default 150;

-- ── 3) attendance_settings — config por org + sede propia (oficina/taller)
create table if not exists cotiza.attendance_settings (
  org_id             uuid primary key references cotiza.organizations(id) on delete cascade,
  wa_phone_number_id text,                        -- metadata.phone_number_id del webhook → resuelve la org
  hq_name            text,                        -- sede propia opcional (no es un cliente)
  hq_lat             double precision,
  hq_lng             double precision,
  hq_radius_m        integer not null default 150,
  workday_start      time not null default '08:00',
  late_after_min     integer not null default 15,
  require_geofence   boolean not null default false,  -- false = registrar fuera de cerca con aviso
  updated_at         timestamptz not null default now()
);

create unique index if not exists uq_attendance_settings_phone
  on cotiza.attendance_settings(wa_phone_number_id) where wa_phone_number_id is not null;

alter table cotiza.attendance_settings enable row level security;
drop policy if exists attendance_settings_rw on cotiza.attendance_settings;
create policy attendance_settings_rw on cotiza.attendance_settings
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));

drop trigger if exists set_updated_at on cotiza.attendance_settings;
create trigger set_updated_at before update on cotiza.attendance_settings
  for each row execute function cotiza.set_updated_at();

-- ── 4) attendance_events — cada marca, tal como llegó (fuente de verdad)
create table if not exists cotiza.attendance_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references cotiza.organizations(id) on delete cascade,
  technician_id       uuid not null references cotiza.technicians(id) on delete cascade,
  direction           text not null check (direction in ('in','out')),
  occurred_at         timestamptz not null default now(), -- hora OFICIAL = reloj del servidor
  wa_timestamp        timestamptz,                         -- timestamp del mensaje (puede venir viejo)
  lat                 double precision,                    -- null solo en marcas manuales
  lng                 double precision,
  wa_location_name    text,   -- si vienen name/address, el empleado mandó un PIN buscado,
  wa_location_address text,   -- no su ubicación actual ⇒ sospechoso
  matched_location_id uuid references cotiza.client_locations(id) on delete set null,
  matched_hq          boolean not null default false,     -- matcheó la sede propia (settings)
  distance_m          integer,                             -- distancia al sitio matcheado
  status              text not null default 'ok'
                        check (status in ('ok','fuera_de_sitio','sin_sitio','pin_sospechoso','hora_dudosa','manual','corregido')),
  source              text not null default 'whatsapp' check (source in ('whatsapp','manual')),
  wa_message_id       text,                                -- wamid... → idempotencia
  raw                 jsonb,                               -- value.messages[0] completo
  note                text,
  created_at          timestamptz not null default now()
);

create unique index if not exists uq_attendance_events_wamid
  on cotiza.attendance_events(wa_message_id) where wa_message_id is not null;
create index if not exists attendance_events_tech_idx
  on cotiza.attendance_events(org_id, technician_id, occurred_at desc);
create index if not exists attendance_events_org_day_idx
  on cotiza.attendance_events(org_id, occurred_at desc);

alter table cotiza.attendance_events enable row level security;
drop policy if exists attendance_events_rw on cotiza.attendance_events;
create policy attendance_events_rw on cotiza.attendance_events
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
-- El webhook escribe con service role (bypassa RLS); la policy es para el dashboard.
