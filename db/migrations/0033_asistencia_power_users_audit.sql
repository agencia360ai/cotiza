-- 0033: Sede como sitio normal + power users + log de auditoría de asistencia.
--
-- (a) La sede (attendance_settings.hq_*) pasa a ser un sitio más en
--     attendance_sites, para administrarla como cualquier otro punto.
-- (b) power_user_emails: quién puede editar/borrar/crear marcas a mano.
-- (c) attendance_audit: quién cambió qué marca y cómo (antes → después).
--
-- Incluye defensivamente las piezas de 0032 (attendance_sites + matched_name)
-- para poder correrse solo. Todo idempotente.

-- ── 0032 (defensivo, por si aún no se corrió) ─────────────────────────────────
create table if not exists cotiza.attendance_sites (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references cotiza.organizations(id) on delete cascade,
  name              text not null,
  lat               double precision,
  lng               double precision,
  geofence_radius_m integer not null default 150,
  created_at        timestamptz not null default now()
);
create index if not exists attendance_sites_org_idx on cotiza.attendance_sites(org_id);
alter table cotiza.attendance_sites enable row level security;
drop policy if exists attendance_sites_rw on cotiza.attendance_sites;
create policy attendance_sites_rw on cotiza.attendance_sites
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
alter table cotiza.attendance_events add column if not exists matched_name text;

-- ── (a) Sede → sitio normal ───────────────────────────────────────────────────
insert into cotiza.attendance_sites (org_id, name, lat, lng, geofence_radius_m)
select s.org_id, coalesce(nullif(btrim(s.hq_name), ''), 'Sede'), s.hq_lat, s.hq_lng, coalesce(s.hq_radius_m, 150)
from cotiza.attendance_settings s
where s.hq_lat is not null and s.hq_lng is not null
  and not exists (
    select 1 from cotiza.attendance_sites a
    where a.org_id = s.org_id
      and lower(a.name) = lower(coalesce(nullif(btrim(s.hq_name), ''), 'Sede'))
  );

-- ── (b) Power users ───────────────────────────────────────────────────────────
alter table cotiza.attendance_settings add column if not exists power_user_emails text[];
update cotiza.attendance_settings
set power_user_emails = array[
  'jfguerra@dicecpanama.com',
  'yjaen@dicecpanama.com',
  'psolis@dicecpanama.com',
  'eosorio@dicecpanama.com'
]
where power_user_emails is null or cardinality(power_user_emails) = 0;

-- ── (c) Auditoría de cambios manuales a marcas ────────────────────────────────
create table if not exists cotiza.attendance_audit (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references cotiza.organizations(id) on delete cascade,
  event_id       uuid,                  -- puede quedar colgado si se borró la marca
  technician_id  uuid,                  -- snapshot para mostrar el nombre aunque se borre
  actor_id       uuid,
  actor_email    text,
  action         text not null check (action in ('create','update','delete')),
  changes        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists attendance_audit_org_idx on cotiza.attendance_audit(org_id, created_at desc);

alter table cotiza.attendance_audit enable row level security;
drop policy if exists attendance_audit_sel on cotiza.attendance_audit;
create policy attendance_audit_sel on cotiza.attendance_audit
  for select using (cotiza.is_org_member(org_id));
drop policy if exists attendance_audit_ins on cotiza.attendance_audit;
create policy attendance_audit_ins on cotiza.attendance_audit
  for insert with check (cotiza.is_org_member(org_id));
