-- 0032: Sitios de asistencia (geocercas) con CRUD libre + nombre del sitio
-- matcheado en cada marca.
--
-- attendance_sites: puntos de geocerca que el manager agrega/edita/elimina
-- libremente desde el tablero (no atados a un cliente). El matcheo de una marca
-- considera estos sitios + los sitios de cliente con coordenadas + la sede.
-- attendance_events.matched_name: nombre del sitio matcheado (venga de donde
-- venga), para mostrarlo en el tablero sin depender del FK a client_locations.
-- Cambio ADITIVO.

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
