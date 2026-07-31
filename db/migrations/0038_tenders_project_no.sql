-- 0038: Nº de proyecto también en Mis Licitaciones.
--
-- Mismo cruce que la 0037 hizo para las cotizaciones: una licitación ganada
-- termina siendo un proyecto en QuickBooks, y hasta ahora ese vínculo solo vivía
-- como el id interno de QBO (tenders.qbo_job_id). Se guarda el número legible
-- para verlo y editarlo en la tabla.
--
-- Cambio ADITIVO: sin valor, todo se ve como antes.

alter table cotiza.tenders add column if not exists qbo_project_no text; -- "DC26-11"

-- Backfill de lo ya vinculado: el nombre del proyecto en QBO viene como
-- "DC26-11 Instalación…"; se extrae el correlativo del inicio.
update cotiza.tenders t
set qbo_project_no = coalesce(
      substring(s.name from '^\s*(D[CMSV]\s*-?\s*[0-9]{2}\s*-\s*[0-9]+)'),
      s.name)
from cotiza.qbo_project_state s
where s.org_id = t.org_id
  and s.qb_job_id = t.qbo_job_id
  and t.qbo_job_id is not null
  and t.qbo_project_no is null
  and s.name is not null;
