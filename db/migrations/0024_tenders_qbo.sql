-- 0024: link a QuickBooks para licitaciones GANADAS. Igual que las cotizaciones
-- (0022), una licitación ganada se puede enviar a proyectos (crea el customer/
-- proyecto en QBO); qbo_job_id da idempotencia (no re-enviar).

ALTER TABLE cotiza.tenders ADD COLUMN IF NOT EXISTS qbo_job_id text;
ALTER TABLE cotiza.tenders ADD COLUMN IF NOT EXISTS qbo_sent_at timestamptz;
