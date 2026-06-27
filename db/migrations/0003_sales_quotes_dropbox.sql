-- Dedup robusto del import de Dropbox: guardar el file-id (estable) y el path
-- del archivo origen. "Ya importada" se evalúa por archivo, no por número.

ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS dropbox_file_id text;
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS dropbox_path    text;

CREATE INDEX IF NOT EXISTS idx_sales_quotes_dropbox
  ON cotiza.sales_quotes(org_id, dropbox_file_id);
