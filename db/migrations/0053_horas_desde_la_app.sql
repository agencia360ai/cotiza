-- 0053: Cargar horas de técnicos desde la app, sin entrar a QuickBooks.
--
-- Las horas se siguen guardando en QuickBooks como siempre (Time Activity en
-- el proyecto): la app solo las crea por el ingeniero. QuickBooks les pone el
-- costo por hora del empleado; los de servicio profesional van sin costo
-- porque se pagan con su factura al proyecto.
--
-- 1) Cada técnico de Personal vinculado a su ficha de QuickBooks: empleado
--    (planilla) o proveedor (servicio profesional). Se completa sola, por
--    nombre, la primera vez que se cargan horas.
-- 2) horas_cargadas: lo que se cargó desde la app, con el id del registro en
--    QuickBooks, para poder borrarlo desde la app si se cargó mal.
--
-- Cambio aditivo: no toca filas existentes.

alter table cotiza.technicians
  add column if not exists qbo_tipo text check (qbo_tipo in ('Employee', 'Vendor')),
  add column if not exists qbo_id text,
  add column if not exists qbo_nombre text,
  add column if not exists qbo_costo_hora numeric(10,2),
  add column if not exists qbo_tarifa_factura numeric(10,2),
  add column if not exists qbo_vinculado_at timestamptz;

comment on column cotiza.technicians.qbo_tipo is
  'Employee = planilla (suma su costo por hora); Vendor = servicio profesional (horas sin costo, se paga por factura).';

create table if not exists cotiza.horas_cargadas (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references cotiza.organizations(id) on delete cascade,
  qb_job_id     text not null,
  technician_id uuid references cotiza.technicians(id) on delete set null,
  tecnico       text not null,                 -- nombre en QuickBooks al cargar
  qbo_tipo      text not null check (qbo_tipo in ('Employee', 'Vendor')),
  fecha         date not null,
  horas         numeric(6,2) not null check (horas > 0 and horas <= 24),
  costo_hora    numeric(10,2) not null default 0, -- el que aplicó QuickBooks
  nota          text,
  qbo_time_id   text not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists horas_cargadas_proyecto_idx
  on cotiza.horas_cargadas(org_id, qb_job_id, created_at desc);

alter table cotiza.horas_cargadas enable row level security;

-- Ver: cualquier miembro. Cargar y borrar: quien puede escribir en la
-- contabilidad del proyecto (no los viewer).
drop policy if exists horas_cargadas_select on cotiza.horas_cargadas;
create policy horas_cargadas_select on cotiza.horas_cargadas
  for select using (cotiza.is_org_member(org_id));

drop policy if exists horas_cargadas_insert on cotiza.horas_cargadas;
create policy horas_cargadas_insert on cotiza.horas_cargadas
  for insert with check (cotiza.org_role(org_id) = any (array['owner', 'admin', 'engineer']));

drop policy if exists horas_cargadas_delete on cotiza.horas_cargadas;
create policy horas_cargadas_delete on cotiza.horas_cargadas
  for delete using (cotiza.org_role(org_id) = any (array['owner', 'admin', 'engineer']));
