-- Fase C — Potenciales: tablas de cotizaciones y licitaciones + budget en proyectos.
-- Schema: cotiza. RLS con cotiza.is_org_member(uuid). Aplicar una sola vez.

-- ─────────────────────────────────────────────────────────────────────────
-- Cotizaciones (sales_quotes)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotiza.sales_quotes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES cotiza.organizations(id) ON DELETE CASCADE,
  quote_number         text NOT NULL,                       -- "COT DC 26-001"
  year                 int,
  sent_date            date,
  amount_usd           numeric(14,2),
  status               text NOT NULL DEFAULT 'enviada'
                         CHECK (status IN ('enviada','aprobada','rechazada')),
  payment_status       text CHECK (payment_status IN ('facturado')),          -- nullable
  invoice_status       text CHECK (invoice_status IN ('pendiente','cancelada')), -- cancelada = cobrada
  client_name          text,                                -- texto libre (Excel)
  client_id            uuid REFERENCES cotiza.clients(id) ON DELETE SET NULL,
  description          text,
  notes                text,
  rubro                text CHECK (rubro IN ('DC','DM','DS','DV')),
  progress             numeric(4,3) DEFAULT 0,              -- 0..1
  follow_up_date       date,                                -- seguimiento de 'enviada'
  rejection_reason     text,                                -- motivo de 'rechazada'
  converted_project_id uuid REFERENCES cotiza.client_projects(id) ON DELETE SET NULL,
  source               text DEFAULT 'manual',               -- excel_import | dropbox | manual
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_quotes_org      ON cotiza.sales_quotes(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_status   ON cotiza.sales_quotes(org_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_year     ON cotiza.sales_quotes(org_id, year);
CREATE INDEX IF NOT EXISTS idx_sales_quotes_project  ON cotiza.sales_quotes(converted_project_id);

ALTER TABLE cotiza.sales_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_quotes_select ON cotiza.sales_quotes FOR SELECT USING (cotiza.is_org_member(org_id));
CREATE POLICY sales_quotes_insert ON cotiza.sales_quotes FOR INSERT WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY sales_quotes_update ON cotiza.sales_quotes FOR UPDATE USING (cotiza.is_org_member(org_id)) WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY sales_quotes_delete ON cotiza.sales_quotes FOR DELETE USING (cotiza.is_org_member(org_id));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON cotiza.sales_quotes
  FOR EACH ROW EXECUTE FUNCTION cotiza.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Licitaciones (tenders)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotiza.tenders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES cotiza.organizations(id) ON DELETE CASCADE,
  acto_number          text,                                -- "2025-1-10-..."
  year                 int,
  modalidad            text CHECK (modalidad IN ('licitacion_publica','compra_menor','contratacion_menor','otro')),
  entity               text,                                -- Entidad / Cliente
  location_text        text,                                -- Lugar / Ciudad
  objeto               text,                                -- Objeto de la licitación
  status               text NOT NULL DEFAULT 'presentada'
                         CHECK (status IN ('ganada','no_ganada','presentada','en_revision','por_partir')),
  execution_status     text,                                -- OC en espera / Terminado / En ejecución
  amount_ref_usd       numeric(14,2),
  delivery_date        date,
  notes                text,
  folder_url           text,                                -- carpeta Dropbox
  rubro                text CHECK (rubro IN ('DC','DM','DS','DV')),
  progress             numeric(4,3) DEFAULT 0,
  converted_project_id uuid REFERENCES cotiza.client_projects(id) ON DELETE SET NULL,
  source               text DEFAULT 'manual',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenders_org      ON cotiza.tenders(org_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status   ON cotiza.tenders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_tenders_project  ON cotiza.tenders(converted_project_id);

ALTER TABLE cotiza.tenders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenders_select ON cotiza.tenders FOR SELECT USING (cotiza.is_org_member(org_id));
CREATE POLICY tenders_insert ON cotiza.tenders FOR INSERT WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY tenders_update ON cotiza.tenders FOR UPDATE USING (cotiza.is_org_member(org_id)) WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY tenders_delete ON cotiza.tenders FOR DELETE USING (cotiza.is_org_member(org_id));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON cotiza.tenders
  FOR EACH ROW EXECUTE FUNCTION cotiza.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Budget en proyectos (para QuickBooks, Fase D)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cotiza.client_projects ADD COLUMN IF NOT EXISTS budget_usd     numeric(14,2);
ALTER TABLE cotiza.client_projects ADD COLUMN IF NOT EXISTS qb_customer_id text;
