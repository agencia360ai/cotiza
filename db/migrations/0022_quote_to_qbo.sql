-- 0022: cierre del loop cotización → proyecto QBO + seguimiento de enviadas.
--
-- sales_quotes:
--   qbo_job_id / qbo_sent_at — link al proyecto creado en QuickBooks (idempotencia:
--     una cotización ya enviada no se re-envía).
--   seguimiento_descartado_at / _motivo — una enviada vieja se puede descartar de
--     los "action points" de seguimiento (con motivo) sin marcarla rechazada.
--
-- qbo_project_state: campos que QBO pide al crear el proyecto (fechas, notas) —
--   se guardan también acá para verlos desde Reportme.

ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS qbo_job_id text;
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS qbo_sent_at timestamptz;
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS seguimiento_descartado_at timestamptz;
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS seguimiento_descartado_motivo text;

ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS notes text;
