-- 0045: Fechas REALES del proyecto y su movimiento mes a mes en QuickBooks.
--
-- Hasta ahora el rango de un proyecto salía de dos fuentes, ambas flojas:
--   1. start_date/end_date cargadas A MANO (0022) — casi nadie las llena.
--   2. Si no hay nada: el AÑO del correlativo (DC26 ⇒ 2026-01-01..2026-12-31).
-- Ese supuesto es el que pinta el "ene 26 → dic 26*" en el board, y como el
-- prorrateo reparte el monto por días, un trabajo de dos semanas quedaba
-- diluido a lo largo de doce meses. Filtrar por fecha era filtrar por supuesto.
--
-- QuickBooks NO expone por REST las fechas de inicio/fin que se ven en la
-- sección Projects (viven en la API GraphQL de Projects, que pide acceso de
-- partner). Lo que SÍ da, y es real:
--   · MetaData.CreateTime del customer → cuándo se abrió el proyecto en QBO.
--   · El P&L con summarize_column_by=Month → en qué meses hubo movimiento.
-- El primer y último mes con movimiento son la ventana de actividad real, y
-- salen de la MISMA llamada que ya se hacía para traer income/cost: cero
-- consultas extra.

alter table cotiza.qbo_project_state
  add column if not exists qbo_created_at date,
  add column if not exists first_txn_date date,
  add column if not exists last_txn_date  date;

-- Movimiento mensual por proyecto. Con esto el filtro por fecha deja de
-- prorratear un total anual: suma los meses que caen dentro del rango, que es
-- el número que QuickBooks realmente reporta. También es lo que alimenta las
-- gráficas por mes del board.
create table if not exists cotiza.qbo_project_month (
  org_id    uuid not null references cotiza.organizations(id) on delete cascade,
  qb_job_id text not null,
  month     date not null,          -- primer día del mes: 2026-03-01
  income    numeric(14,2) not null default 0,
  cost      numeric(14,2) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (org_id, qb_job_id, month)
);

create index if not exists qbo_project_month_org_month_idx
  on cotiza.qbo_project_month(org_id, month);

alter table cotiza.qbo_project_month enable row level security;
drop policy if exists qbo_project_month_rw on cotiza.qbo_project_month;
create policy qbo_project_month_rw on cotiza.qbo_project_month
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
