-- Estado por proyecto de QBO en Reportme: marcar cerrado/abierto y cachear la
-- rentabilidad. Los QBO Projects se leen vivos; esto guarda la capa de Reportme.
-- Refrescar trae financials SOLO de los abiertos; los cerrados usan lo guardado.

CREATE TABLE IF NOT EXISTS cotiza.qbo_project_state (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES cotiza.organizations(id) ON DELETE CASCADE,
  qb_job_id  text NOT NULL,                 -- id del project (customer) en QBO
  closed     boolean NOT NULL DEFAULT false,
  income     numeric(14,2),                 -- último income leído de QBO
  cost       numeric(14,2),
  synced_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_qbo_project_state ON cotiza.qbo_project_state(org_id, qb_job_id);

ALTER TABLE cotiza.qbo_project_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qbo_project_state_select ON cotiza.qbo_project_state;
DROP POLICY IF EXISTS qbo_project_state_insert ON cotiza.qbo_project_state;
DROP POLICY IF EXISTS qbo_project_state_update ON cotiza.qbo_project_state;
DROP POLICY IF EXISTS qbo_project_state_delete ON cotiza.qbo_project_state;
CREATE POLICY qbo_project_state_select ON cotiza.qbo_project_state FOR SELECT USING (cotiza.is_org_member(org_id));
CREATE POLICY qbo_project_state_insert ON cotiza.qbo_project_state FOR INSERT WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY qbo_project_state_update ON cotiza.qbo_project_state FOR UPDATE USING (cotiza.is_org_member(org_id)) WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY qbo_project_state_delete ON cotiza.qbo_project_state FOR DELETE USING (cotiza.is_org_member(org_id));

DROP TRIGGER IF EXISTS set_updated_at ON cotiza.qbo_project_state;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cotiza.qbo_project_state
  FOR EACH ROW EXECUTE FUNCTION cotiza.set_updated_at();
