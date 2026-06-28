-- CL-1 — Maestro de clientes (QuickBooks = fuente de verdad).
-- Espeja los customers de QBO en cotiza.clients (anclados por qb_customer_id),
-- agrega contactos/POCs, alias para auto-match, y linkea licitaciones.
-- Schema: cotiza. RLS con cotiza.is_org_member(uuid). Idempotente (re-ejecutable).
-- Ver docs/clientes-master.md.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) clients: campos de espejo de QBO + enriquecimiento
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cotiza.clients ADD COLUMN IF NOT EXISTS qb_customer_id text;       -- ancla al customer de QBO
ALTER TABLE cotiza.clients ADD COLUMN IF NOT EXISTS legal_name     text;       -- razón social (S.A./Inc.) fuera del nombre visible
ALTER TABLE cotiza.clients ADD COLUMN IF NOT EXISTS synced_at      timestamptz; -- último pull desde QBO
ALTER TABLE cotiza.clients ADD COLUMN IF NOT EXISTS sync_status    text;       -- synced | pending_push | conflict

-- Un customer de QBO ↔ un cliente por org (cuando está espejado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_qb_customer
  ON cotiza.clients(org_id, qb_customer_id)
  WHERE qb_customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) client_locations: mapeo opcional a sub-customer/job de QBO (Fase D)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cotiza.client_locations ADD COLUMN IF NOT EXISTS qb_sub_customer_id text;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) client_contacts — POCs del cliente (primario viene de QBO)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotiza.client_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES cotiza.organizations(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES cotiza.clients(id) ON DELETE CASCADE,
  name        text,
  role        text,
  email       text,
  phone       text,                                -- WhatsApp / teléfono
  is_primary  boolean NOT NULL DEFAULT false,
  source      text NOT NULL DEFAULT 'manual'
                CHECK (source IN ('quickbooks','manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON cotiza.client_contacts(org_id, client_id);
-- A lo sumo un contacto primario por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_contacts_primary
  ON cotiza.client_contacts(client_id) WHERE is_primary;

ALTER TABLE cotiza.client_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_contacts_select ON cotiza.client_contacts;
DROP POLICY IF EXISTS client_contacts_insert ON cotiza.client_contacts;
DROP POLICY IF EXISTS client_contacts_update ON cotiza.client_contacts;
DROP POLICY IF EXISTS client_contacts_delete ON cotiza.client_contacts;
CREATE POLICY client_contacts_select ON cotiza.client_contacts FOR SELECT USING (cotiza.is_org_member(org_id));
CREATE POLICY client_contacts_insert ON cotiza.client_contacts FOR INSERT WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY client_contacts_update ON cotiza.client_contacts FOR UPDATE USING (cotiza.is_org_member(org_id)) WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY client_contacts_delete ON cotiza.client_contacts FOR DELETE USING (cotiza.is_org_member(org_id));

DROP TRIGGER IF EXISTS set_updated_at ON cotiza.client_contacts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cotiza.client_contacts
  FOR EACH ROW EXECUTE FUNCTION cotiza.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4) client_aliases — variantes de nombre conocidas, para auto-match
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotiza.client_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES cotiza.organizations(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES cotiza.clients(id) ON DELETE CASCADE,
  alias_norm  text NOT NULL,                       -- texto normalizado (sin acentos, minúsculas, sin sufijos)
  location_id uuid REFERENCES cotiza.client_locations(id) ON DELETE SET NULL,
  source      text NOT NULL DEFAULT 'manual'
                CHECK (source IN ('excel','dropbox','quickbooks','manual')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Un alias normalizado resuelve a un solo cliente por org (clave del auto-match).
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_aliases_norm ON cotiza.client_aliases(org_id, alias_norm);
CREATE INDEX IF NOT EXISTS idx_client_aliases_client ON cotiza.client_aliases(org_id, client_id);

ALTER TABLE cotiza.client_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_aliases_select ON cotiza.client_aliases;
DROP POLICY IF EXISTS client_aliases_insert ON cotiza.client_aliases;
DROP POLICY IF EXISTS client_aliases_update ON cotiza.client_aliases;
DROP POLICY IF EXISTS client_aliases_delete ON cotiza.client_aliases;
CREATE POLICY client_aliases_select ON cotiza.client_aliases FOR SELECT USING (cotiza.is_org_member(org_id));
CREATE POLICY client_aliases_insert ON cotiza.client_aliases FOR INSERT WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY client_aliases_update ON cotiza.client_aliases FOR UPDATE USING (cotiza.is_org_member(org_id)) WITH CHECK (cotiza.is_org_member(org_id));
CREATE POLICY client_aliases_delete ON cotiza.client_aliases FOR DELETE USING (cotiza.is_org_member(org_id));

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Linkeo de potenciales al cliente (sales_quotes.client_id ya existe en 0001)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cotiza.tenders ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES cotiza.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_quotes_client ON cotiza.sales_quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_tenders_client      ON cotiza.tenders(client_id);
