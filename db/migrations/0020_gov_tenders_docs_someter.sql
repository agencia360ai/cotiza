-- 0020: plan de "documentos a someter" por licitación. Guarda el checklist de
-- documentos que el pliego exige presentar (aviso de operación, idoneidad, paz y
-- salvo, fianzas, etc.), su estado (copiado de una licitación pasada / falta /
-- por renovar / por hacer a medida) y de dónde se copió cada uno.

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS docs_someter jsonb;
