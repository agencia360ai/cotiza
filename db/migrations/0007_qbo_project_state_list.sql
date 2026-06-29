-- Guardar la LISTA de projects (no solo la rentabilidad) para que abrir la
-- página lea de la base y NO consulte QBO. Solo "Actualizar" pega a QBO.

ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS name        text;
ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS full_name   text;
ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS rubro       text;
ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS year        int;
ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS client_name text;

CREATE INDEX IF NOT EXISTS idx_qbo_project_state_year ON cotiza.qbo_project_state(org_id, year);
