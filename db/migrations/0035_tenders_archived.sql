-- 0035: Archivar licitaciones — ocultar de la lista sin borrarlas.
--
-- archived_at: cuándo se archivó (null = activa). Las archivadas se esconden de
-- "Mis licitaciones" por defecto; se pueden ver/restaurar con el toggle.
-- Cambio ADITIVO e idempotente.

alter table cotiza.tenders add column if not exists archived_at timestamptz;
create index if not exists tenders_archived_idx on cotiza.tenders(org_id) where archived_at is not null;
