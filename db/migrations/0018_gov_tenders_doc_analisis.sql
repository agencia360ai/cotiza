-- 0018: análisis IA de los DOCUMENTOS reales del pliego (PDFs en la carpeta de
-- Dropbox de la licitación). jsonb: resumen, requisitos[], plazo, garantías,
-- criterios, cumplimos (si|parcial|no), motivo, banderas[], docsLeidos, at.

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS doc_analisis jsonb;
