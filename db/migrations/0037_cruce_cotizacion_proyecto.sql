-- 0037: Cruce visible cotización ↔ proyecto.
--
-- El vínculo ya existía (sales_quotes.qbo_job_id = el Id del proyecto en QBO),
-- pero era un id interno: no servía para leer de un vistazo "esta cotización
-- salió como DS26-27". Se guardan los NÚMEROS legibles a cada lado.
--
-- Se guardan (en vez de derivarlos con un join en cada consulta) por dos razones:
-- se llenan solos al enviar a proyectos, y quedan EDITABLES a mano para los
-- casos que no pasaron por la app (proyecto creado directo en QBO, o cotización
-- vieja) — que es justamente el track que se quiere completar.
--
-- Cambio ADITIVO: sin estos valores, todo se ve como antes.

alter table cotiza.sales_quotes      add column if not exists qbo_project_no text; -- "DS26-27"
alter table cotiza.qbo_project_state add column if not exists quote_number   text; -- "COT DC 26-141"

-- Backfill de lo ya vinculado. El nombre del proyecto en QBO viene como
-- "DS26-27 Reparación de…": se extrae el correlativo del inicio; si no calza el
-- patrón, se deja el nombre completo (mejor eso que nada).
update cotiza.sales_quotes q
set qbo_project_no = coalesce(
      substring(s.name from '^\s*(D[CMSV]\s*-?\s*[0-9]{2}\s*-\s*[0-9]+)'),
      s.name)
from cotiza.qbo_project_state s
where s.org_id = q.org_id
  and s.qb_job_id = q.qbo_job_id
  and q.qbo_job_id is not null
  and q.qbo_project_no is null
  and s.name is not null;

update cotiza.qbo_project_state s
set quote_number = q.quote_number
from cotiza.sales_quotes q
where q.org_id = s.org_id
  and q.qbo_job_id = s.qb_job_id
  and s.quote_number is null;
