-- CL-3.5 — Linkear cotizaciones/licitaciones a la sucursal (client_location).
-- "Esa Flaca Rica – David" = cliente(Esa Flaca Rica) + location(David). El
-- backfill lo hace el "Aplicar" de Estandarizar (re-correrlo). Idempotente.

ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES cotiza.client_locations(id) ON DELETE SET NULL;
ALTER TABLE cotiza.tenders      ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES cotiza.client_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_quotes_location ON cotiza.sales_quotes(location_id);
CREATE INDEX IF NOT EXISTS idx_tenders_location      ON cotiza.tenders(location_id);
