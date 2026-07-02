-- 0013: evaluación IA "¿cumplimos?" por licitación del gobierno.
-- jsonb: { cumplimos: si|parcial|no, resumen, requisitos[], riesgos[], at }

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS eval jsonb;
