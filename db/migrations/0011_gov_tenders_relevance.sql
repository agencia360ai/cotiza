-- Relevancia DICEC en licitaciones del gobierno: clasificación por keywords
-- HVAC + IA. null = sin clasificar (se reintenta en el próximo refresh).

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS relevante boolean;
ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS relevancia_motivo text;

CREATE INDEX IF NOT EXISTS idx_gov_tenders_relevante ON cotiza.gov_tenders(org_id, relevante);
