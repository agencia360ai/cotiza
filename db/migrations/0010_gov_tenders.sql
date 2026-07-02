-- Licitaciones potenciales del gobierno (PanamaCompra API v3), consumidas
-- directo desde Reportme. Dedup por número de proceso. "Seguir" la copia a
-- cotiza.tenders (pipeline propio) y linkea acá.

CREATE TABLE IF NOT EXISTS cotiza.gov_tenders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES cotiza.organizations(id) ON DELETE CASCADE,
  num_proceso   text NOT NULL,
  titulo        text,
  entidad       text,
  fecha_cierre  timestamptz,
  tipo          text,                -- 'licitacion_publica' (v1)
  precio_ref    numeric(14,2),
  url           text,
  raw           jsonb,
  seen_at       timestamptz,        -- última vez visto en PanamaCompra
  converted_tender_id uuid REFERENCES cotiza.tenders(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_tenders_proceso ON cotiza.gov_tenders(org_id, num_proceso);
CREATE INDEX IF NOT EXISTS idx_gov_tenders_cierre ON cotiza.gov_tenders(org_id, fecha_cierre);

ALTER TABLE cotiza.gov_tenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY gov_tenders_select ON cotiza.gov_tenders FOR SELECT USING (cotiza.is_org_member(org_id));
CREATE POLICY gov_tenders_insert ON cotiza.gov_tenders FOR INSERT WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY gov_tenders_update ON cotiza.gov_tenders FOR UPDATE USING (cotiza.is_org_member(org_id)) WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY gov_tenders_delete ON cotiza.gov_tenders FOR DELETE USING (cotiza.is_org_member(org_id));
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cotiza.gov_tenders
  FOR EACH ROW EXECUTE FUNCTION cotiza.set_updated_at();
