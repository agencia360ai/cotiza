-- 0017: carpeta de Dropbox por licitación del gobierno (para juntar los
-- documentos del pliego). path interno + link compartido para abrirla.

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS dropbox_folder_path text;
ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS dropbox_folder_url text;
