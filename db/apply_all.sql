-- DICEC · Potenciales (Fase C) — aplicar UNA vez en Supabase SQL Editor.
-- Crea tablas + RLS + budget, e importa 316 cotizaciones + 41 licitaciones.
-- Generado a partir de db/migrations + db/seed.

BEGIN;

-- ── 1. Schema ──────────────────────────────────────────────
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

-- ── 2. Cotizaciones (parte 1/3) ───────────────────────────
INSERT INTO cotiza.sales_quotes (org_id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, source)
SELECT (SELECT id FROM cotiza.organizations WHERE name ILIKE '%dicec%' ORDER BY created_at LIMIT 1), v.* FROM (VALUES
('COT DC 26-001',2026,'2026-01-01',8800.0,'aprobada','facturado','pendiente','Lcdo. Rubén Ríos','Cotización de remplazo de los compresores No. 1 y No.3, enfriador de agua No. 1.',NULL,'DC',0.7,NULL,'excel_import'),
('COT DC 26-002',2026,'2026-01-06',1578.25,'aprobada','facturado','pendiente','Esa Flaca Rica - Producción','Reemplazo e instalación del compresor al cuarto de congelación. Incluye: Instalación completa, filtro secador, filtro de succión, contactor 40amp, barrido completo del sistema, carga de refrigerante 404ª, arranque del sistema y monitoreo de la unidad.',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-003',2026,'2026-01-19',475.0,'aprobada','facturado','pendiente','SGS – Ciudad del Saber','Reemplazo e instalación de motor de fan a unidad evaporadora ¾ HP, 3 velocidades 230V, 1075 RPM.',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-004',2026,'2026-01-19',518.95,'aprobada','facturado','pendiente','Cervecería Clandestina','Reparación de cuarto frío. Suministro y reemplazo de motor axial a unidad condensadora, contactor, revisión y conexión eléctrica, ajuste de presostato, arranque de equipo y monitoreo.',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-005',2026,'2026-01-19',411.95,'aprobada','facturado','pendiente','Golden Lion Casino','Mantenimiento preventivo de dos unidades de aire acondicionado chillers.',NULL,'DM',0.7,NULL,'excel_import'),
('COT DC 26-006',2026,'2026-01-19',535.0,'rechazada',NULL,NULL,'Mechanical System','Revisión de enfriador de agua.',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 26-006A',2026,'2026-01-21',7690.0,'rechazada',NULL,NULL,'S.T.R.I Panamá','Suministro de equipos, materiales y mano de obra para el remplazo de una (1) unidad condensadora de 5 toneladas de refrigeración para las unidades evaporadoras que sirven el edifico administrativo (EDIFICIO 356), ubicadas en Isla Naos.',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 26-007',2026,'2026-01-21',96.3,'aprobada','facturado','cancelada','Esa Flaca Rica - David','Corto circuito en cometida eléctrica de unidad de aire acondicionado. Verificación, reemplazo y corrección de alambrado y cometida eléctrica. Incluye pruebas en sitio.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-008',2026,'2026-01-21',1337.5,'aprobada','facturado','cancelada','Esa Flaca Rica - David','Suministro e instalación de compresor para unidad de aire acondicionado tipo casete.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-009',2026,'2026-01-23',920.2,'aprobada','facturado','cancelada','Farmazona, Boulevart','Mantenimiento preventivo y revisión trimestral de los enfriadores de agua No. 1 y No. 2, ubicados en Farmazona, Boulevart Ernesto Pérez Balladares, ZONA LIBRE.',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 26-010',2026,'2026-02-04',2300.5,'rechazada',NULL,NULL,'Esa Flaca Rica','Desinstalación de unidades ubicada en Cantina del Tigre. Desinstalación de unidad ubicada en San Francisco. Desinstalación de unidad ubicada en Centennial. Movilización e instalación de unidad para San Francisco. Movilización e instalación de unidad para Centennial.',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 26-011',2026,'2026-02-04',144.45,'aprobada','facturado','cancelada','Cantina del Tigre','Reparación de congelador de barra. Deshielo manual, mantenimiento profundo, corrección de parámetros, cambio de full gauge.',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 26-012',2026,'2026-02-04',187.25,'aprobada','facturado','cancelada','Cantina del Tigre','Reparación de central R22. Se encontró fuga en el sistema, la misma fue reparada. Recarga de refrigerante R22 al sistema completo.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-013',2026,'2026-02-04',294.25,'aprobada','facturado','cancelada','Esa Flaca Rica – Vía Argentina','Reparación de nevera de armado. Reemplazo de compresor, flush a evaporador y condensador, recorrido de tuberías, aislamiento nuevo a tuberías, conexión eléctrica, programación de full gauge, puesta en marcha.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-014',2026,'2026-02-04',176.55,'aprobada','facturado','cancelada','Esa Flaca Rica – Brisas del Golf','Reparación de nevera de vegetales. Reemplazo de controlador de temperatura, ajuste de full gauge, recarga de refrigerante R600, arranque del sistema y pruebas de funcionamiento.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-015',2026,'2026-02-04',304.95,'aprobada','facturado','cancelada','Esa Flaca Rica – Costa Verde','Diagnóstico y corrección de cableado eléctrico. Instalación de controlador de temperatura nuevo, conexión de evaporador y condensador, ajuste de presostato de baja presión y verificación del sistema. Puesta en marcha del equipo y seguimiento de la buena operación del equipo.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-016',2026,'2026-02-05',138660.0,'enviada',NULL,NULL,'I.C.G.E.S','Suministro e instalación de un enfriador de agua.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 26-017',2026,'2026-04-06',680.0,'aprobada','facturado',NULL,'Smithsonian Tropical Research Institute Panamá, Ciudad','Inspección del sistema de control de aires acondicionado del Nivel 100, Edifico Tupper, Panamá.',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-018',2026,'2026-02-05',93258.0,'enviada',NULL,NULL,'Mantenimiento C.S.S','Suministro de materiales y mano de obra para el remplazo del compresor No. 1 del enfriador de agua helada No. 2, del Complejo Hospitalario Dr. Rafael Hernández L.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 26-019',2026,'2026-02-05',7880.0,'aprobada','facturado',NULL,'S.T.R.I Panamá, Ciudad','Suministro de equipos, materiales y mano de obra para la instalación de tres (3) cajas de volumen variable modulante para oficinas ubicada en el nivel 500 y nivel 600, Edificio Earl Tupper.',NULL,'DC',0.7,NULL,'excel_import'),
('COT DC 26-020',2026,'2026-04-06',3970.0,'enviada',NULL,NULL,'S.T.R.I Panamá, Ciudad','Suministro de todos los materiales y mano de obra para desinstalar las válvulas existentes y la instalación de los nuevas en sus áreas respectivamente.',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 26-020 rev 2',2026,'2026-06-15',6970.0,'enviada',NULL,NULL,'S.T.R.I Panamá, Ciudad','Suministro de equipos, materiales y mano de obra para la instalación de tres (3) válvulas de tres vías (variable modulante), para unidades manejadoras de aire ubicada en el nivel 500,600 y 700 del Edificio Earl Tupper.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 26-021',2026,'2026-02-07',1200.0,'aprobada','facturado','cancelada','Centro Misionero Cristiano','Cotización para el cambio del aislamiento a cuatro (4) condensadoras.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-022',2026,'2026-02-04',53.5,'aprobada','facturado','cancelada','Esa Flaca Rica – Centennial','Reemplazo de controlador y programación. Nevera de plancha',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-023',2026,'2026-01-23',53.5,'aprobada','facturado','cancelada','Esa Flaca Rica – Centennial','Reemplazo de controlador y sensor. Nevera de caja.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 26-024',2026,'2026-02-09',4350.0,'enviada',NULL,NULL,'S.T.R.I Panamá','Reubicación de sistema central de 5 ton - Edificio 235 CTPA, Ancón','Importado de Dropbox 2026','DS',0.3,NULL,'excel_import'),
('COT DC 26-025',2026,'2026-03-18',1690.0,'aprobada','facturado',NULL,'S.T.R.I Panamá','Reemplazo de filamentos de calentador de aire nivel 600 - Edificio Earl Tupper','Importado de Dropbox 2026','DS',0.7,NULL,'excel_import'),
('COT DC 26-026',2026,'2026-02-09',85.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Centennial','Reemplazo de motor fan a nevera','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-027',2026,'2026-02-21',5671.0,'rechazada',NULL,NULL,'Hermenegildo Cedeño','Suministro de refrigerante R-134A, tanque 30 lbs (x40)','Importado de Dropbox 2026','DV',0.0,NULL,'excel_import'),
('COT DC 26-030',2026,'2026-02-23',4763.32,'rechazada',NULL,NULL,'Hermenegildo Cedeño','Suministro de Split inverter Daikin 12K y 24K BTU','Importado de Dropbox 2026','DV',0.0,NULL,'excel_import'),
('COT DC 26-031',2026,'2026-02-24',2914.68,'rechazada',NULL,NULL,'Ángel Hernández','Suministro Piso/Techo Halana 60000 BTU (evaporadora y condensadora)','Importado de Dropbox 2026','DV',0.0,NULL,'excel_import'),
('COT DC 26-032',2026,'2026-02-24',4763.32,'rechazada',NULL,NULL,'Isaac Moreno','Suministro de Split inverter Daikin 12K y 24K BTU','Importado de Dropbox 2026','DV',0.0,NULL,'excel_import'),
('COT DC 26-033',2026,'2026-03-04',620.6,'rechazada',NULL,NULL,'Achurra & Navarro','Suministro e instalación de Split 12,000 BTU Halana','Importado de Dropbox 2026','DS',0.0,NULL,'excel_import'),
('COT DC 26-033B',2026,'2026-03-04',502.9,'aprobada','facturado','cancelada','Achurra & Navarro','Suministro e instalación de Split 12,000 BTU Halana (opción B)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-034',2026,'2026-03-04',180.0,'aprobada','facturado',NULL,'Aprocosa','Calibración de diferenciales de presión de agua chiller 1 y 2 (Dunham Bush)','Importado de Dropbox 2026','DS',0.7,NULL,'excel_import'),
('COT DC 26-035',2026,'2026-03-09',10850.0,'enviada',NULL,NULL,'S.T.R.I Panamá','Sistema de ventilación y renovación de aire (2 extractores) - Laboratorio Ambient Lab, STRI Gamboa (Rev.)','Importado de Dropbox 2026','DC',0.3,NULL,'excel_import'),
('COT DC 26-036',2026,'2026-03-08',1466.76,'aprobada','facturado',NULL,'S.T.R.I Panamá','Suministro de sellos mecánicos y partes para bombas de agua fría y condensación - Edif. Earl Tupper','Importado de Dropbox 2026','DV',0.7,NULL,'excel_import'),
('COT DC 26-037',2026,'2026-03-12',15275.0,'enviada',NULL,NULL,'S.T.R.I Panamá','Suministro de bomba Patterson Split Case S4C11A-1 con motor 30HP - Edif. Earl Tupper','Importado de Dropbox 2026','DV',0.3,NULL,'excel_import'),
('COT DC 26-039',2026,'2026-03-09',165.0,'aprobada','facturado','cancelada','Albrook','Revisión y mantenimiento profundo a dos (2) unidades tipo Split','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-040A',2026,'2026-03-10',360.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Mantenimiento bimensual preventivo de cuatro (4) cuartos fríos','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-040B',2026,'2026-03-10',200.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Mantenimiento bimensual de 4 centrales RHEEM (4 y 5 ton)','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-041',2026,'2026-03-10',925.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Costa del Este','Reparación de nevera de plancha (compresor, full gauge y otros)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-042',2026,'2026-03-12',175.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Brisas del Golf','Suministro de 2 blower a piso techo','Importado de Dropbox 2026','DV',1.0,NULL,'excel_import'),
('COT DC 26-043',2026,'2026-02-13',410.0,'aprobada','facturado',NULL,'S.T.R.I Panamá','Confección de base de metal para unidad A/A 60,000 BTU - Punta Culebra','Importado de Dropbox 2026','DS',0.7,NULL,'excel_import'),
('COT DC 26-044',2026,'2026-03-13',190.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Vía Argentina','Mantenimiento profundo a unidad piso techo de cocina 5 ton','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-045',2026,'2026-03-13',175.0,'aprobada','facturado','cancelada','Cantina del Tigre','Mantenimiento profundo a unidad piso techo de cocina 5 ton','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-046',2026,'2026-03-21',19780.0,'aprobada','facturado',NULL,'Acesco Panamá','Instalación de dos torres de enfriamiento (sistema de condensación por agua) (Rev1)','Importado de Dropbox 2026','DC',0.7,NULL,'excel_import'),
('COT DC 26-047',2026,'2026-03-23',876.0,'aprobada','facturado','cancelada','Esa Flaca Rica – David','Reparación de cuartos fríos de baja y media temperatura','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-048',2026,'2026-03-23',375.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Costa Verde','Reparación de cuarto frío de media temperatura','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-049',2026,'2026-03-23',180.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Vía Argentina','Suministro de empaque a nevera marca True (2)','Importado de Dropbox 2026','DV',1.0,NULL,'excel_import'),
('COT DC 26-050',2026,'2026-03-23',20725.0,'rechazada',NULL,NULL,'CELMEC - Nueva Policlínica de Antón','Balance de sistema de aire acondicionado','Importado de Dropbox 2026','DC',0.0,NULL,'excel_import'),
('COT DC 26-051',2026,'2026-03-23',210.0,'aprobada','facturado','cancelada','SGS – Ojo de Agua','Suministro e instalación de 2 capacitadores y revisión de carga de refrigerante','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-054',2026,'2026-03-31',3075.0,'aprobada','facturado',NULL,'Nestlé Panamá - Natá','Revisión, mantenimiento y puesta en marcha de cuartos fríos de Materia Prima (Rev1)','Importado de Dropbox 2026','DM',0.7,NULL,'excel_import'),
('COT DC 26-055',2026,'2026-04-14',1150.0,'aprobada','facturado','cancelada','Esa Flaca Rica – San Francisco','Desinstalación, movilización e instalación de unidades Split','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-056',2026,'2026-04-20',1400.0,'enviada',NULL,NULL,'PH Santa Familia - Casco Antiguo','Mantenimiento preventivo a Jet fans y extractores centrífugos de monóxido de carbono','Importado de Dropbox 2026','DM',0.3,NULL,'excel_import'),
('COT DC 26-056B',2026,'2026-04-23',13375.0,'rechazada',NULL,NULL,'Panama Christian Academy','Sistema de ventilación por inducción (6 ventiladores VRG) - Cancha semiabierta','Importado de Dropbox 2026','DC',0.0,NULL,'excel_import'),
('COT DC 26-056C',2026,'2026-04-30',20308.6,'rechazada',NULL,NULL,'Panama Christian Academy','Sistema de ventilación por inducción (12 ventiladores VRG) - Cancha semiabierta','Importado de Dropbox 2026','DC',0.0,NULL,'excel_import'),
('COT DC 26-057',2026,'2026-04-21',360.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Vía Argentina','Mantenimiento profundo a dos (2) unidades split de salón 3 ton','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-058',2026,'2026-04-21',245.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Vía Argentina','Materiales para reparación de piso techo 5 ton (motor, display, capacitador)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-059',2026,'2026-04-21',30.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Visita técnica por filtración (origen en red hidráulica)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-060',2026,'2026-04-22',270.0,'enviada',NULL,NULL,'Cantina del Tigre','Suministro e instalación de 18 termómetros digitales','Importado de Dropbox 2026','DS',0.3,NULL,'excel_import'),
('COT DC 26-061',2026,'2026-04-22',75.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Centennial','Reemplazo de luminaria e inspección de cableado en cuarto frío','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-062',2026,'2026-05-05',910.0,'aprobada','facturado','cancelada','SGS','Mantenimiento de 10 unidades split y 1 central','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-063',2026,'2026-05-05',80.0,'aprobada','facturado','cancelada','SGS – Ojo de Agua','Reparación de Flare a 2 unidades split 12,000 BTU (Lab. Marín)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-064',2026,'2026-05-05',290.75,'aprobada','facturado','cancelada','SGS – Clayton','Mantenimiento de 1 unidad split y 2 centrales','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-067',2026,'2026-05-07',80.0,'aprobada','facturado','cancelada','Esa Flaca Rica – San Francisco','Suministro y reemplazo de controlador digital full gauge en nevera de armado','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-068',2026,'2026-05-07',185.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Costa Verde','Reparación de piso techo 5 ton (corrección de fuga, carga R410-A)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-069',2026,'2026-05-07',360.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Centennial','Revisión de cuarto frío, reemplazo de contactor y breaker','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-070',2026,'2026-05-07',160.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Centennial','Conversión de control en nevera de armado (full gauge digital)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-071',2026,'2026-05-07',235.0,'aprobada','facturado','cancelada','Cantina del Tigre','Suministro e instalación de 2 termostatos digitales','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-072',2026,'2026-05-07',75.0,'aprobada','facturado','cancelada','Cantina del Tigre','Deshielo manual y limpieza del congelador de bar','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-073',2026,'2026-05-07',95.0,'aprobada','facturado','cancelada','Cantina del Tigre','Corrección de fuga en vástago de válvula del condensador','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-074',2026,'2026-05-07',285.0,'aprobada','facturado','cancelada','Cantina del Tigre','Diagnóstico y reconfiguración de sistema de control en cuarto frío de media','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-075',2026,'2026-05-11',37000.0,'enviada',NULL,NULL,'LOOM Residences - Ing. Moisés Polanco','Sistema HVAC VRF y ventilación - Climatización mezzanine','Importado de Dropbox 2026','DC',0.3,NULL,'excel_import'),
('COT DC 26-076',2026,'2026-05-12',250.0,'aprobada','facturado','cancelada','Juan Carlos Noriega - PH Santa María Albatross','Mantenimiento trimestral de 6 fan coils (Piso 29B)','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-077',2026,'2026-05-12',250.0,'aprobada','facturado','cancelada','Ana Arias - PH Empire Residences','Mantenimiento trimestral de 6 fan coils (Piso 25A)','Importado de Dropbox 2026','DM',1.0,NULL,'excel_import'),
('COT DC 26-078',2026,'2026-05-12',80.0,'aprobada','facturado','cancelada','SGS – Ojo de Agua','Suministro e instalación de supresor de voltaje a unidad split 18K (Lab. hidrocarburos)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-080',2026,'2026-05-26',300.0,'aprobada','facturado','cancelada','Cantina del Tigre','Reemplazo de motor de abanico del condensador (cuarto frío media)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-081',2026,'2026-05-26',300.0,'aprobada','facturado','cancelada','Cantina del Tigre','Reemplazo de motor de abanico del condensador (cuarto frío baja)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-082',2026,'2026-05-26',375.0,'aprobada','facturado','cancelada','Cantina del Tigre','Reparación de ductos no unidos a difusores (terraza)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-083',2026,'2026-05-26',150.0,'aprobada','facturado','cancelada','Cantina del Tigre','Reemplazo de cerradura y luminaria del cuarto frío de mamón chino','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-084',2026,'2026-05-26',2850.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Reparación integral de cuarto frío de media temperatura (área de lúpulos)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-085',2026,'2026-05-26',480.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Reparación integral de fuga a cuarto frío de media (5 hp)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-086',2026,'2026-05-26',135.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Reparación integral de fuga a cuarto frío pequeño','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-087',2026,'2026-05-26',70.0,'aprobada','facturado','cancelada','Cervecería Clandestina','Reparación de fuga eléctrica a cuarto frío de lúpulos','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-088',2026,'2026-03-27',515.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Costa del Este','Reparación de unidad condensadora 5 ton (capacitores, contactor, fuga)','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-090',2026,'2026-05-27',55.0,'aprobada','facturado','cancelada','Esa Flaca Rica – David','Reemplazo de armaflex a nevera de armado','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-094',2026,'2026-05-26',5400.0,'enviada',NULL,NULL,'Hotel Gamboa Rainforest Resort','Reemplazo de bomba de chiller Dunham Bush','Importado de Dropbox 2026','DC',0.3,NULL,'excel_import'),
('COT DC 26-095',2026,'2026-05-27',172.5,'aprobada','facturado','cancelada','Esa Flaca Rica – David','Reparación de aire acondicionado tipo cassette 5 ton','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-096',2026,'2026-05-27',75.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Brisas del Golf','Suministro y reemplazo de cable de alimentación de nevera comercial','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-097',2026,'2026-05-27',85.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Costa Verde','Reparación de cuarto frío de congelación','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-098',2026,'2026-05-27',75.0,'aprobada','facturado','cancelada','Esa Flaca Rica – Brisas del Golf','Suministro y reemplazo de cable de alimentación de nevera comercial','Importado de Dropbox 2026','DS',1.0,NULL,'excel_import'),
('COT DC 26-101',2026,'2026-05-30',190.0,'aprobada','facturado','pendiente','Cantina del Tigre','Reemplazo de dos (2) empaques a nevera de congelador (bar)','Importado de Dropbox 2026','DS',0.7,NULL,'excel_import'),
('COT DC 26-105',2026,'2026-06-16',7199.76,'enviada',NULL,NULL,'COPAMA – La Chorrera','Suministro e instalación de equipos de A/A mini split Halana (archivo nombrado 26-104)','Importado de Dropbox 2026','DC',0.3,NULL,'excel_import'),
('COT DC 26-028',2026,'2026-02-23',400.0,'aprobada','facturado','pendiente','Granada Radiology Center','Mantenimiento preventivo y revisión bimensual del sistema de A/A Lennox tipo VRF',NULL,'DM',0.7,NULL,'excel_import'),
('COT DC 26-038',2026,'2026-03-09',275.0,'aprobada','facturado','pendiente','Ana Arias – PH Santa María Albatross','Mantenimiento trimestral de equipos de A/A (5 Fan Coil y 1 Split 12k BTU)',NULL,'DM',0.7,NULL,'excel_import'),
('COT DC 26-053',2026,'2026-03-23',180.0,'aprobada','facturado','pendiente','Esa Flaca Rica – Vía Argentina','Suministro de empaque a nevera marca True (2)',NULL,'DV',0.7,NULL,'excel_import'),
('COT DC 26-065',2026,'2026-05-06',5900.0,'enviada',NULL,NULL,'Hospital Rafael Estévez, Aguadulce (C.S.S.)','Suministro de dos (2) abanicos de condensación para enfriadores de agua Carrier',NULL,'DV',0.3,NULL,'excel_import'),
('COT DC 26-066',2026,'2026-05-06',1220.0,'enviada',NULL,NULL,'Hospital Rafael Estévez, Aguadulce (C.S.S.)','Suministro de repuestos (contactores, protecciones termomagnéticas y protectores de voltaje) para enfriadores Carrier',NULL,'DV',0.3,NULL,'excel_import'),
('COT DC 26-079',2026,'2026-05-07',285.0,'aprobada','facturado','pendiente','Cantina del Tigre','Diagnóstico, corrección y reconfiguración del sistema de control del cuarto frío de media temperatura',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-089',2026,'2026-05-16',2725.02,'enviada',NULL,NULL,'Hospital Rafael Estévez, Aguadulce (C.S.S.)','Suministro de dos (2) Flow Switch Carrier para enfriadores de agua',NULL,'DV',0.3,NULL,'excel_import'),
('COT DC 26-091',2026,'2026-05-19',145.0,'aprobada','facturado',NULL,'Hotel Gamboa Rainforest Resort','Revisión del enfriador de agua marca Dunham Bush',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-092',2026,'2026-05-26',1375.0,'enviada',NULL,NULL,'CIRION Panamá – Century Link, Fort Amador','Reparación de dos (2) unidades de A/A (motores sala de transmisión) y recarga de gas R-407C',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 26-093',2026,'2026-05-26',875.0,'enviada',NULL,NULL,'CIRION Panamá – Century Link, Ambush Range','Reparación de dos (2) motores de sala de transmisión (Westric)',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 26-099',2026,'2026-05-27',172.5,'aprobada','facturado','pendiente','Esa Flaca Rica – David','Reparación de aire acondicionado tipo cassette 5 ton (cambio de balineras del motor)',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 26-100',2026,'2026-05-09',776.66,'aprobada','facturado','pendiente','Finca San Lorenzo','Mantenimiento bimensual de la línea fría completa',NULL,'DM',0.7,NULL,'excel_import'),
('COT DC 26-102',2026,'2026-06-16',2580.0,'enviada',NULL,NULL,'S.T.R.I Panamá','Suministro e instalación: reemplazo del variador de frecuencia 7.5 HP/460V, control de aire nivel 600, Edificio Earl Tupper (ABB)',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 26-106',2026,'2026-06-18',27000.0,'enviada',NULL,NULL,'COPAMA – Sucursal La Chorrera','Suministro e instalación del sistema de A/A del showroom (evaporadora Bryant 15 ton + 2 condensadores 7.5 ton)',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 26-107',2026,'2026-06-19',2790.0,'enviada',NULL,NULL,'Sra. Ana Patricia Chen – PH Titanium, Costa del Este','Suministro e instalación de unidad central de 3 toneladas (Halana); reemplazo de equipos York R-22',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-007',2025,'2025-01-23',1337.5,'aprobada','facturado','cancelada','HW Hotel','Mantenimiento preventivo de los enfriadores de agua',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-001',2025,'2025-01-07',5250.0,'aprobada','facturado','cancelada','LABORAROTORIO WET LAB, Edificio 356, Naos, STRI','SUMINITRO DE UNIDAD CENTRAL DE 3 TONS WET LAB EDIFICIO 356',NULL,'DV',1.0,NULL,'excel_import'),
('COT DC 25-002',2025,'2025-01-10',2350.0,'aprobada','facturado','cancelada','Autoridad del Canal de Panamá','Verificacion de funcionamiento de equipo ACP',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-003',2025,'2025-01-21',990.0,'aprobada','facturado','cancelada','STRI','REMPLAZO DE SELLOS MECÁNICOS DE BOMBA DE COND No. 1',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-003A',2025,'2025-01-21',1580.0,'enviada',NULL,NULL,'STRI','REMPLAZO DE SELLOS MECÁNICOS DE BOMBA DE COND No. 2 y No. 1.','No se encuentra registro Sra Jesi','DS',0.3,NULL,'excel_import'),
('COT DC 25-004',2025,'2025-01-21',358.0,'aprobada','facturado','cancelada','Pol. JJ Vallarino','SENSOR DE PRESION DE BAJA',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-005',2025,'2025-01-21',146921.7,'rechazada',NULL,NULL,'INMOBILIARIA PUNTA VIEJA S.A','instalacion de AA VIVIENDA FAMILIAR',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-006',2025,'2025-01-22',52550.0,'rechazada',NULL,NULL,'Hosp. Regional Rafael Hernández','equipo 20 toneladas administracion',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-008',2025,'2025-01-24',299.6,'aprobada','facturado','cancelada','Casino Golden Lion','MANTENIMIENTO DE 1 ENFRIADOR',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-009',2025,'2025-02-04',6302.3,'aprobada','facturado','cancelada','Casa de Oración Cristiana','REPARACION DE UNIDADES DE A/A',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 25-013',2025,'2025-02-12',1016.5,'rechazada',NULL,NULL,'Ingeniería Atlántico, Cia.','Reemplazo de sensores de nivel de líquido y temperatura. Enfriador 1,2 y 3.',NULL,'DS',0.0,NULL,'excel_import')
) AS v(quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, source);

-- ── 3. Cotizaciones (parte 2/3) ───────────────────────────
INSERT INTO cotiza.sales_quotes (org_id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, source)
SELECT (SELECT id FROM cotiza.organizations WHERE name ILIKE '%dicec%' ORDER BY created_at LIMIT 1), v.* FROM (VALUES
('COT DC 25-015',2025,'2025-02-18',390.0,'rechazada',NULL,NULL,'Pol. Roberto Ramirez de Diego','Suministro de Relé de monitoreo trifásico','No hay registro','DV',0.0,NULL,'excel_import'),
('COT DC 24-078A',2025,'2025-02-19',2675.0,'aprobada','facturado','cancelada','Granada Radiology Center','Sistema de Inyección y extracción de aire Granada Radiology Center','Radiology tiene una factura total de $86,028.00 del han abonado $79,000.00','DS',1.0,NULL,'excel_import'),
('COT DC 24-078B',2025,'2025-02-25',4815.0,'aprobada','facturado','cancelada','Granada Radiology Center','AA para cuarto de control de Tomógrafo','Radiology tiene una factura total de $86,028.00 del han abonado $79,000.00','DS',1.0,NULL,'excel_import'),
('COT DC 25-014',2025,'2025-02-28',2675.0,'aprobada','facturado','cancelada','Oficinas en Ave. Andrés Mojica, San Francisco, Panamá','Instalación y movilización de rejillas de suministro y retorno.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-017',2025,'2025-03-07',410.0,'aprobada','facturado','cancelada','EFR Brisas del Golf','Propuesta de mantenimiento de equipos de línea fría',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-019',2025,'2025-03-07',83823.8,'rechazada',NULL,NULL,'CRUTA','Descontaminación y limpieza de fibra de vidrio',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-020',2025,'2025-03-07',5800.0,'aprobada','facturado','cancelada','CSS HRRE Aguadulce','Reparación de Blower de UMA Quirofano',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 25-027',2025,'2025-03-07',470.8,'aprobada','facturado','pendiente','AV&CO','Mantenimiento cada 4 meses','Se pagó solo el mantto. los $278.20 de la factura','DM',0.7,NULL,'excel_import'),
('COT DC 25-010',2025,'2025-03-10',7800.0,'rechazada',NULL,NULL,'Autoridad Aeronáutica Civil','Reparación de motores de abanicos de condensación',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-021',2025,'2025-03-10',267.5,'aprobada','facturado','cancelada','VENTURIA LEGAL','Mantenimiento Bimensual',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-022',2025,'2025-03-10',481.5,'rechazada',NULL,NULL,'HOLDAY INN','Instalación de Motor de blower y contactor',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-023',2025,'2025-03-12',6366.5,'aprobada','facturado','cancelada','FARMAZONA','Reemplazo de aceite de enfriador 2','Factura excenta de ITBMS enviada en agosto','DC',1.0,NULL,'excel_import'),
('COT DC 25-026',2025,'2025-03-13',374.5,'aprobada','facturado','cancelada','K&B Family Office','Mantenimiento bimensual',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-028',2025,'2025-03-13',1674.55,'aprobada','facturado','cancelada','Villa Bonita','Revisión de fuga y recarga de gas R 410 A',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-029',2025,'2025-03-13',786.45,'rechazada',NULL,NULL,'Inchcape Shipping Services Panama','Mantenimiento bimensual',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-030',2025,'2025-03-14',4600.0,'aprobada','facturado','cancelada','POLICLINICA DE DAVID','POLICLINICA DE DAVID STAR UP',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-018',2025,'2025-03-17',74632.5,'rechazada',NULL,NULL,'CRUTA','Descontaminación y limpieza de fibra de vidrio Edifico PCC',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-019',2025,'2025-03-17',90778.8,'rechazada',NULL,NULL,'CRUTA','Limpieza de fibra de vidro planta alta de edificio administrativo',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-025',2025,'2025-03-18',11689.75,'rechazada',NULL,NULL,'Ingeniería Atlantico','Trabajos varios',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-031',2025,'2025-03-18',567.9,'aprobada','facturado','cancelada','EFR CdE','Reemplazo de compresor, nevera de plancha',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-012',2025,'2025-03-19',294.25,'aprobada','facturado','cancelada','Ana Arias','Mantenimiento de equipos de aire acondicionado','Se hizo ajuste al precio y se canceló $240.75 incluyendo ya el ITBMS','DM',1.0,NULL,'excel_import'),
('COT DC 25-032',2025,'2025-03-20',45302.21,'rechazada',NULL,NULL,'HRRE Aguadulce CSS','Suministro de Serpentines de Enfriamiento para UMAs',NULL,'DV',0.0,NULL,'excel_import'),
('COT DC 25-033A',2025,'2025-03-25',4975.5,'rechazada',NULL,NULL,'Panama Christian Academy','Limpieza de ductos de aire acondicionado',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-034',2025,'2025-03-26',88.0,'rechazada',NULL,NULL,'Casa Miller','Mantenimiento unidades split',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-035',2025,'2025-03-26',16100.0,'aprobada','facturado','cancelada','HRRH Chiriqui','MANTENIMIENTO PREVENTIVO BIMENSUAL abril-diciembre',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-036',2025,'2025-03-27',497.55,'aprobada','facturado','cancelada','Villa Bonita','Mantenimiento de sistema de aire acondicionado','El precio cotizado cambiará a mayor valor','DM',1.0,NULL,'excel_import'),
('COT DC 25-037',2025,'2025-03-31',8790.0,'aprobada','facturado','cancelada','ICGES','Reparacion de blower caracol Uma PISO 2','Se pagó $8,500.00','DC',1.0,NULL,'excel_import'),
('COT DC 25-038',2025,'2025-04-03',2950.0,'aprobada','facturado','cancelada','Policlínica de David','Arranque de chiller',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-039',2025,'2025-04-04',315.65,'aprobada','facturado','cancelada','Hotel Gamboa Rainforest Resort','Reemplazo de TARJETA CHILLER CARRIER',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-040',2025,'2025-04-04',304.95,'rechazada',NULL,NULL,'Compañía Rigaservice S.A','REPROGRAMACION DE TARJETA PENONOME',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-042',2025,'2025-04-05',2728.5,'aprobada','facturado','cancelada','EFR PRODUCCION','Suministro e instalación de Piso Techo en Producción','No se facturó','DS',1.0,NULL,'excel_import'),
('COT DC 25-043',2025,'2025-04-05',267.5,'aprobada','facturado','cancelada','EFR CENTENNIAL','Trabajos en Cuarto Frío de Baja Temperatura',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-041',2025,'2025-04-07',8399.5,'rechazada',NULL,NULL,'AQUAVIVA','Suministro e Instalación de Fan Coil de 5 toneladas en cuarto de máquinas',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-044',2025,'2025-04-07',588.5,'aprobada','facturado','cancelada','Casino Golden Lion','Mantenimiento Preventivo de Enfriador y Reemplazo de motor de abanico',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-046',2025,'2025-04-09',246.1,'aprobada','facturado','cancelada','Hotel Gamboa Rainforest Resort','Reemplazo de tarjeta MBB',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-047',2025,'2025-04-11',7900.0,'rechazada',NULL,NULL,'Autoridad Aeronautica Civil','Equipos Tipo Casete Edificio 611',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-048',2025,'2025-04-11',9900.0,'rechazada',NULL,NULL,'Autoridad Aeronautica Civil','Equipos Tipo Casete Edificio 646',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-049',2025,'2025-04-11',1500.0,'rechazada',NULL,NULL,'Autoridad de Aeronáutica Civil','Suministro e instalación de nuevo controlador MICRO-MAG',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-050',2025,'2025-04-17',10800.0,'rechazada',NULL,'cancelada','Hosp. Rafael Hernandez','Limpieza de condensadores',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-051',2025,'2025-04-21',1209.1,'aprobada','facturado','cancelada','Casino Golden Lion','MANTENIMIENTO DE UMA PLANTA ALTA',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-053',2025,'2025-04-25',113900.0,'rechazada',NULL,NULL,'Hosp. Rafael Hernandez','Reparacion CH 1 Comp A 1 y B1',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-054',2025,'2025-04-25',68600.0,'rechazada',NULL,NULL,'Hosp. Rafael Hernandez','Reparacion CH2 comp B1',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-055',2025,'2025-04-25',2889.0,'aprobada','facturado','cancelada','FSL PLANTA, S.A','Propuesta de Mantenimiento Bimensual','Se hizo ajuste a $2,514.50, y se emitio factura proforma','DM',1.0,NULL,'excel_import'),
('COT DC 25-057',2025,'2025-04-28',363.8,'rechazada',NULL,NULL,'Cerveceria Clandestina','Mantenimiento Preventivo',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-052',2025,'2025-04-29',1016.5,'aprobada','facturado','cancelada','Granada Radiology Center','Suministro de rejillas de inspección','Radiology tiene una factura total de $86,028.00 del han abonado $79,000.00','DV',1.0,NULL,'excel_import'),
('COT DC 25-051A',2025,'2025-04-30',197.95,'aprobada','facturado','cancelada','Casino Golden Lion','MANTENIMIENTO DE UMAS',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-056',2025,'2025-04-30',235150.0,'rechazada',NULL,NULL,'HOSP. RAFAEL HERNANDEZ','Instalacion de chiller nuevo',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-058',2025,'2025-04-30',492.2,'aprobada','facturado','cancelada','ACHURRA NAVARRO & ASOCIADOS','Reparacion de equipos','Factura adicional por la reparación de equipo y breaker $133.75 que esta pendiente por pago','DS',1.0,NULL,'excel_import'),
('COT DC 25-011',2025,'2025-05-05',950.0,'aprobada','facturado','cancelada','STRI','Suministro de válvula de prevención de flujo inverso',NULL,'DV',1.0,NULL,'excel_import'),
('COT DC 25-059',2025,'2025-05-05',1245.0,'aprobada','facturado','cancelada','F.S.U PANAMÁ','REPARACIONES DE PISO #4',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-060',2025,'2025-05-09',19900.0,'aprobada','facturado','cancelada','Policlínica Roberto Ramírez de Diego','Servicio de Mantenimiento Preventivo','Se realizó la primera factura por $8,800.00 y la siguiente factura se realizará en diciembre.','DM',1.0,NULL,'excel_import'),
('COT DC 25-061',2025,'2025-05-14',1053.95,'rechazada',NULL,NULL,'Granada Radiology Center','limpieza y descontaminacion de ductos',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-061A',2025,'2025-05-16',1112.8,'rechazada',NULL,NULL,'POSCO ECO & CHALLENGE','Aislamiento',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-062',2025,'2025-05-16',1112.8,'rechazada',NULL,NULL,'Ingeniería y Sistemas Acondicionados','Aislamiento',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-063',2025,'2025-05-16',1112.8,'rechazada',NULL,NULL,'A quien concierna','Aislamiento',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-064',2025,'2025-05-20',1650.0,'aprobada','facturado','cancelada','PUERTO ARMUELLES','ASISTENCIA TÉCNICA EN REPARACIÓN DE EQUIPOS',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-066',2025,'2025-05-20',1112.8,'rechazada',NULL,NULL,'Puertas y closet PTY','Aislamiento',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-065',2025,'2025-05-21',8750.0,'rechazada',NULL,NULL,'IRMA ZANETATO','REPARACION DE BLOWER',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-067',2025,'2025-05-21',88038.0,'rechazada',NULL,NULL,'Complejo Hospitalario Dr. Rafael Hernández L.','REMPLAZO DE COMPRESOR No. 1 CHILLER 2',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-067',2025,'2025-05-21',278.2,'rechazada',NULL,NULL,'A quien concierna 3','Aislamiento',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-068',2025,'2025-05-27',3103.0,'rechazada',NULL,NULL,'AV&CO','Limpieza de ductos',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-069',2025,'2025-05-27',1112.8,'aprobada','facturado','cancelada','Hotel Gamboa Rainforest Resort','Suministro de rollos de poliester','No hay registro Sra. Jessi','DV',1.0,NULL,'excel_import'),
('COT DC 25-070',2025,'2025-05-27',6313.0,'rechazada',NULL,NULL,'Consultorio 002 - Ph. Park Square','Instalación y suministro de equipo de refrigeración Consultorio 002',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-070',2025,'2025-05-27',2500.0,'rechazada',NULL,NULL,'Consultorio 002 - Ph. Park Square','Instalación y suministro de equipo de refrigeración',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-071',2025,'2025-05-27',1200.0,'rechazada',NULL,'pendiente','Mantenimiento C.S.S Aguadulce Coclé','Reparacion y mantenimiento equipo de precision',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-073',2025,'2025-05-28',224.7,'aprobada','facturado','cancelada','Hotel Gamboa Rainforest Resort','Reemplazo de sello mecanico de bomba de chiller 2',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-074',2025,'2025-05-29',214.0,'rechazada',NULL,NULL,'CONSTRUCCIONES JSM','Suministro de rollos de poliester',NULL,'DV',0.0,NULL,'excel_import'),
('COT DC 25-072',2025,'2025-05-30',15140.5,'aprobada','facturado','cancelada','Hotel Gamboa Rainforest Resort','Reemplazo de compresores y valvula de expanción','Abonaron el 50%','DC',1.0,NULL,'excel_import'),
('COT DC 24-078C',2025,'2025-06-02',481.5,'rechazada',NULL,NULL,'Granada Radiology Center','Extensión de Sistema de defogue de condensación (vacío)',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-075',2025,'2025-06-02',1350.0,'rechazada',NULL,NULL,'ACHURRA NAVARRO & ASOCIADOS','Reparacion de equipos',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-076',2025,'2025-06-03',1926.0,'rechazada',NULL,NULL,'Cia. Climatizadora, S.A.','Aislamiento Polyester',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-079A',2025,'2025-06-05',630.0,'rechazada',NULL,NULL,'Policlinica Roberto Ramirez de Diego','Suministro de Interruptor de Flujo',NULL,'DV',0.0,NULL,'excel_import'),
('COT DC 25-079B',2025,'2025-06-05',560.0,'rechazada',NULL,NULL,'Policlinica Roberto Ramirez de Diego','Suministro de Diferencial de Presión',NULL,'DV',0.0,NULL,'excel_import'),
('COT DC 25-080',2025,'2025-06-05',24941.7,'rechazada',NULL,NULL,'Finca San Lorenzo','Suministro e Instalación de Nuevo Cuarto de Congelación',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-081',2025,'2025-06-06',802.5,'rechazada',NULL,NULL,'Casino Golden Lion','Reparación de motores de abanicos de condensación',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-083',2025,'2025-06-16',214.0,'aprobada','facturado','cancelada','Cerveceria Clandestina','Mantenimiento Preventivo 4 unidades de 4 y 5 toneladas',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-084',2025,'2025-06-17',5900.0,'rechazada',NULL,NULL,'Hosp. Dr Rafael Estévez','Variador de Frecuencia Bomba de agua Fría','No hay registro Sra Jessi','DC',0.0,NULL,'excel_import'),
('COT DC 25-085',2025,'2025-06-18',5290.0,'aprobada','facturado','cancelada','Hospital Susana Jones','Reparacion de blower caracol Uma 13','El precio real de la licitacion $5,450.00','DC',1.0,NULL,'excel_import'),
('COT DC 25-078',2025,'2025-06-19',5500.0,'enviada',NULL,NULL,'Hosp. Dr Rafael Estévez','Suministro de Abanicos de Condensación Enfriadores Carrier','No hay registro Sra Jessi','DV',0.3,NULL,'excel_import'),
('COT DC 25-086',2025,'2025-06-19',5500.0,'enviada',NULL,NULL,'Hospital Susana Jones','Unidad condensadora de 1.5 hp cuarto frio','No hay registro Sra Jessi','DC',0.3,NULL,'excel_import'),
('COT DC 25-087',2025,'2025-06-19',6350.0,'aprobada','facturado','cancelada','FARMAZONA','Remplazo de válvula de expansión termostática',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 25-088',2025,'2025-06-19',195023.55,'rechazada',NULL,NULL,'Distribuidora 22','Sistema de Acondicionamiento de Aire',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-082',2025,'2025-06-20',2875.0,'aprobada','facturado','cancelada','TUPPER','REMPLAZO DE VALVULAS DE CIERRE AGUA DE CONDENSACIÓN',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-089',2025,'2025-06-20',513.6,'aprobada','facturado','cancelada','Casino Golden Lion','Mantenimiento de Unidades Manejadoras',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-090',2025,'2025-06-20',2043.7,'aprobada','facturado','cancelada','Refrigeración y Servicios Johan','Partes para Chiller','Abonaron $1,043.70','DS',1.0,NULL,'excel_import'),
('COT DC 25-091',2025,'2025-06-25',299.6,'rechazada',NULL,NULL,'Casino Golden Lion','Mantenimiento de un enfriador de agua',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-092',2025,'2025-06-25',802.5,'rechazada',NULL,NULL,'FARMAZONA','Mantenimiento Preventivo de los enfriadores de agua No. 1 y No.2',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-077',2025,'2025-06-26',9202.0,'aprobada','facturado','cancelada','Casino Golden Lion','Reemplazo de serpentines de condensación',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 25-093',2025,'2025-06-27',79986.82,'rechazada',NULL,NULL,'Ambush Range CIRION','Reemplazo de Unidades Condensadoras',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-095',2025,'2025-06-27',1128.85,'rechazada',NULL,'pendiente','AMBUSH RANGE CIRION','Reparaciones de equipo sala de bateria y pasillos',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-096',2025,'2025-06-27',791.8,'rechazada',NULL,'pendiente','FORT AMADOR CIRION','Cotización de reparaciones',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-097',2025,'2025-07-02',3600.0,'aprobada','facturado','cancelada','Edificio 235 Ancon STRI','Mantenimiento Correctivo (Reparación) UMA',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-098',2025,'2025-07-02',5700.0,'aprobada','facturado','cancelada','Hosp. Dr Rafael Estévez','Suministro e instalación de unidad condensadora de Cuarto Frío Nutrición y Dietética - Hosp. Regional Dr',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 25-099',2025,'2025-07-02',8303.2,'rechazada',NULL,NULL,'CIRION Fort Amador','Mantenimiento Preventivo de Unidades de Aire Acondicionado',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-101',2025,'2025-07-02',524.3,'aprobada','facturado','cancelada','SGS PANAMA','Cambio de Sistema Electrónico a Electromecánico',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-102',2025,'2025-07-02',1819.0,'aprobada','facturado','cancelada','Rest Lung Fung','Instalación de extractores',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-096 R',2025,'2025-07-04',1663.85,'rechazada',NULL,NULL,'CIRION','Reparaciones de equipo sala de bateria y pasillos',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-103',2025,'2025-07-07',4350.0,'rechazada',NULL,NULL,'CTPA ANCON','REUBICACION DE UNIDAD EVAPORADORA',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-100',2025,'2025-07-09',7490.0,'rechazada',NULL,NULL,'CIRION Panamá','Mantenimiento Preventivo de unidades de Aire Acondicionado',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-104',2025,'2025-07-10',70762.0,'enviada',NULL,NULL,'Caja de Seguro Social','Serpentines Policlinica San Juan de Dios de Natá','No se ha aprobado','DC',0.3,NULL,'excel_import'),
('COT DC 25-024',2025,'2025-07-16',4600.0,'aprobada','facturado','cancelada','STRI NAOS','Reemplazo de unidad condensadora 10 ton. EDF. 356',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-105',2025,'2025-07-17',8025.0,'rechazada',NULL,NULL,'FINCA SAN LORENZO','Fusión de Cuartos Fríos para Cuarto de Congelación',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-106',2025,'2025-07-21',560.0,'aprobada','facturado','cancelada','STRI','Suministro e instalación de válvula en Edificio Tupper',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-107',2025,'2025-07-23',35850.0,'rechazada',NULL,NULL,'Autoridad de Aeronáutica Civil','Movilización e instalación de nuevo enfriador en Edificio 236',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-108',2025,'2025-08-01',267.5,'aprobada','facturado','cancelada','Rest. Lung Fung','Inspección y corrección de sistemas de inyección',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-110',2025,'2025-08-01',350.0,'aprobada','facturado','cancelada','Compañía RIGASERVICE S.A','ASISTENCIA TECNICA PARA LA PROGRAMACION DE DIRECCIONES IP UNIDADES DE PRESICION',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-111',2025,'2025-08-07',6750.0,'rechazada',NULL,NULL,'Punta Culebra Bunker 3','Remplazo de ductos',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-066.1',2025,'2025-08-08',92579.0,'rechazada',NULL,NULL,'Complejo Hospitalario Dr. Rafael Hernández L.','REMPLAZO DE COMPRESOR No. 1 CHILLER 1',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-016',2025,'2025-08-11',6850.0,'rechazada',NULL,NULL,'Hospital Regional Rafael Hernández','Suministro e instalación de 8 diferenciales de presión.',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-045',2025,'2025-08-11',3709.8,'rechazada',NULL,NULL,'Hospital Rafael Hernandez','partes de chillers',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-045A',2025,'2025-08-11',2462.4,'rechazada',NULL,NULL,'Complejo Hospitalario Dr. Rafael Hernández L.','A partes de chillers',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-112',2025,'2025-08-11',283.55,'aprobada','facturado','cancelada','Café Santé','Mantenimiento Bimensual',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-113',2025,'2025-08-11',37.45,'aprobada','facturado','cancelada','EFR Costa Verde','EFR Costa Verde Cambio de display',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-114',2025,'2025-08-11',9800.0,'rechazada',NULL,NULL,'Complejo Hospitalario Dr. Rafael Hernández L.','REPUESTOS DE EQUIPOS CABEZALES',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-094',2025,'2025-08-15',513.6,'aprobada','facturado','cancelada','Granada Radiology Center','Propuesta de Mantenimiento de Sistema de Aire Acondicionado',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-115',2025,'2025-08-18',481.5,'aprobada','facturado','cancelada','Café Santé','Reparaciones',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 24-115',2025,'2025-08-20',32450.0,'aprobada','facturado','cancelada','Universidad ISAE','Suministro e instalacion de unidades condensadoras 7.5',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 24-115B',2025,'2025-08-20',46930.0,'rechazada',NULL,NULL,'Universidad ISAE','Suministro e instalacion unidad aurocntenida de 25 toneladas',NULL,'DC',0.0,NULL,'excel_import'),
('COT DC 25-116',2025,'2025-08-20',294.25,'aprobada','facturado','cancelada','EFR Costa del Este','Reparación de acoples para puerta en nevera de carnes y quesos',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-117',2025,'2025-08-20',139.1,'aprobada','facturado','cancelada','Sky Kitchens','Inspección Profunda',NULL,'DS',1.0,NULL,'excel_import')
) AS v(quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, source);
-- ── 4. Cotizaciones (parte 3/3) ───────────────────────────
INSERT INTO cotiza.sales_quotes (org_id, quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, source)
SELECT (SELECT id FROM cotiza.organizations WHERE name ILIKE '%dicec%' ORDER BY created_at LIMIT 1), v.* FROM (VALUES
('COT DC 25-118',2025,'2025-08-28',3156.5,'aprobada','facturado','cancelada','EFR El Dorado','Desinstalación, movilización e instalación de unidades','Se le hizo factura proforma','DS',1.0,NULL,'excel_import'),
('COT DC 25-119',2025,'2025-09-02',535.0,'aprobada','facturado','cancelada','Cerveceria Clandestina','Mantenimiento Preventivo Cerveceria Clandestina cuarto frío','Se adicionó una factura por el monto de $214.00 por el mantenimiento de las 4 unidades de 4 y 5 toneladas respectivamente.','DM',1.0,NULL,'excel_import'),
('COT DC 25-120',2025,'2025-09-02',1650.0,'aprobada','facturado','cancelada','Policlinica de Bugaba','Arranque de chiller',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-121',2025,'2025-09-03',26.75,'aprobada','facturado','cancelada','EFR Chiriquí','Control Remoto',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-122',2025,'2025-09-04',288.9,'aprobada','facturado','cancelada','SGS','Mantenimiento a unidades',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 24-108A',2025,'2025-09-08',15850.0,'enviada',NULL,NULL,'S.T.R.I Panamá, Ciudad','Reemplazo de unidades condensadoras 7.5 y 5 ton. EDF. 356 ADMINISTRACION STRI NAOS',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 24-109A',2025,'2025-09-08',35975.0,'enviada',NULL,NULL,'S.T.R.I Panamá, Ciudad','Suministro e instalacion de unidades condensadoras 7.5 y 5 ton. EDF. 356 ADMINISTRACION STRI NAOS',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-123',2025,'2025-09-09',133.75,'aprobada','facturado','cancelada','Cantina del Tigre','Suministro de protector de voltaje neveras',NULL,'DV',1.0,NULL,'excel_import'),
('COT DC 25-125',2025,'2025-09-11',288.9,'enviada',NULL,NULL,'Sky Kitchen','Inspección y mantenimiento',NULL,'DM',0.3,NULL,'excel_import'),
('COT DC 25-126',2025,'2025-09-11',192.6,'aprobada','facturado','cancelada','EFR Brisas del Golf','Suministro e instalación de Empaque Magnético TRUE',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-127',2025,'2025-09-15',6420.0,'enviada',NULL,NULL,'Distribuidora 22 Juan Diaz','Suministro e Instalación de piso techo 5 ton.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-128',2025,'2025-09-15',267.5,'aprobada','facturado','cancelada','Oficina La Popular','Limpieza Profunda de Piso Techo de Oficia',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-129',2025,'2025-09-15',128.4,'aprobada','facturado','cancelada','Cantina del Tigre','Servicio de desmontaje e instalación de piso techo de 5 ton.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-130',2025,'2025-09-16',3250.66,'enviada',NULL,NULL,'Hosp. Dra. Susana Jones Cano','Suministro e Instalacion de cortinas de aires para el',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-131',2025,'2025-09-17',6324.8,'enviada',NULL,NULL,'Tocumen Panamá S.A','REPUESTOS Y PROGRAMACION DE ENFRIADOR',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-124',2025,'2025-09-18',6760.0,'aprobada','facturado','cancelada','CTPA','Remplazo de fibra de vidrio',NULL,'DC',1.0,NULL,'excel_import'),
('COT DC 25-132',2025,'2025-09-18',133.75,'aprobada','facturado','pendiente','A. Vergara','Reparación de damper para el balance de ductos AV&CO',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 25-133',2025,'2025-09-18',96.3,'aprobada','facturado','cancelada','Finca San Lorenzo','Inspección general, suministro e instalación protector de voltaje - Finca San Lorenzo',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-134',2025,'2025-09-23',245.0,'aprobada','facturado','cancelada','EFR Brisas del Golf','Instalación y Suministro de 7 Protectores de Voltaje - EFR Brisas del Golf',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-135',2025,'2025-09-25',4986.2,'enviada',NULL,NULL,'FSL PLANTA, S.A','Mantenimiento Bimensual',NULL,'DM',0.3,NULL,'excel_import'),
('COT DC 25-136',2025,'2025-09-26',4750.0,'enviada',NULL,NULL,'Hospital de Bugaba','Hospital de Bugaba STAR UP',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-137',2025,'2025-09-26',150.0,'aprobada','facturado','cancelada','Cantina del Tigre','Reparación de Cuarto Frío de Pase (Protector de Voltaje Dañado)',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-138',2025,'2025-10-06',37000.0,'enviada',NULL,NULL,'CIASA','CIASA EVERLLANCE',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-139',2025,'2025-10-03',25894.0,'enviada',NULL,NULL,'CIRION','Reparación de Cuarto Frío de Pase (Protector de Voltaje Dañado)',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-140',2025,'2025-10-07',1011.15,'rechazada',NULL,NULL,'SGS','Mantenimiento Bimensual',NULL,'DM',0.0,NULL,'excel_import'),
('COT DC 25-141',2025,'2025-10-08',845.0,'enviada',NULL,NULL,'Banco Nacional de Panamá','Servicio de mantenimiento unida enfriadora de agua',NULL,'DM',0.3,NULL,'excel_import'),
('COT DC 25-142',2025,'2025-10-09',422.65,'aprobada','facturado','cancelada','Esa Flaca Rica Vía Argentina','Suministro e instalación de los siguientes equipos: • Nueve (9) protectores de voltaje • Diez (10) termómetros digitales para refrigerador y congelador',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-143',2025,'2025-10-09',77.04,'aprobada','facturado','cancelada','Esa Flaca Rica Brisas del Golf','Suministro e instalación de los siguientes equipos: • Nueve (9) termómetros digitales para refrigerador y congelador:',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-144',2025,'2025-10-09',77.04,'aprobada','facturado','cancelada','Esa Flaca Rica Costa Verde','Suministro e instalación de los siguientes equipos: • Nueve (2) termómetros digitales para refrigerador y congelador:',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-146',2025,NULL,23.43,'aprobada','facturado','cancelada','Esa Flaca Rica Costa del Este','Suministro e instalación de los siguientes equipos: • Nueve (2) termómetros digitales para refrigerador y congelador:',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-147',2025,NULL,251.45,'aprobada','facturado','cancelada','Ing. Andrés Vergara Rios','Mantenimiento Preventivo a unidades Split.',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-148',2025,NULL,390.55,'aprobada','facturado','cancelada','Esa Flaca Rica San Francisco','Suministro e instalación del compresor de la nevera de plancha',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-149',2025,NULL,3611.25,'rechazada',NULL,NULL,'SGS PANAMA','Instalación completa de dos (2) sistemas de aire acondicionado tipo Split de 12,000 BTU, incluyendo materiales, mano de obra, pruebas de funcionamiento y adecuaciones en gypsum para ocultar tuberías y drenajes, garantizando una instalación limpia y funcional.',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-150',2025,NULL,909.5,'enviada',NULL,NULL,'ACHURRA NAVARRO & ASOCIADOS','Reparaciones de la tubería de cobre de dos (2) equipos de cinco (5) toneladas d de refrigeración, del sistema de acondicionamiento de aire de las Oficinas de Achurra Navarro & Asociados.',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-151',2025,NULL,260.0,'enviada',NULL,NULL,'S.T.R.I Panamá, Panamá','Instalación de termostato Neptronic NF TF24F3XYZ3 para la unidad manejadora No. 3 del edificio CTPA Ancón, Panamá.',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-152',2025,NULL,545.0,'enviada',NULL,NULL,'F.S.U PANAMÁ','Remplazo del eje de la unidad manejadora aire acondicionado UMA - 1 del piso No. 1,',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-153',2025,NULL,706.2,'aprobada','facturado','cancelada','Esa Flaca Rica Costa del Este','Suministro e instalación de Empaques Magnéticos a las neveras marca TRUE.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-154',2025,NULL,22470.0,'enviada',NULL,NULL,'Sr. Rubén Serrano','Instalación del Sistema de Condensación por agua, para enfriamiento del sistema de extrusión de plástico, de su planta ubicada en el Sector de la Locería.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-155',2025,'2025-11-08',674.1,'enviada',NULL,NULL,'Casa de Oración Cristiana','Suministro de materiales y mano de obra para remoción de ductos de la unidad autocontenida de aire acondicionado No. 4, que se encuentra fuera de servicio, ubicada en el Templo Casa de Oración Cristiana.',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-156',2025,'2025-11-11',513.6,'aprobada','facturado','cancelada','Golden Lion Casino, El Dorado','Mantenimiento preventivo, para las unidades de aire acondicionado de las instalaciones de Golden Lion Casino, El Dorado.',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-157',2025,'2025-11-11',13680.0,'enviada',NULL,NULL,'Smithsonian Tropical Research Institute Panamá, Ciudad','Suministro mano de obra, materiales y todo lo necesario el remplazo de serpentín de enfriamiento para la unidad manejadora No. 3, planta baja, en el Edificio CTPA, Panamá.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-158',2025,'2025-11-12',880.0,'enviada',NULL,NULL,'Smithsonian Tropical Research Institute Panamá, Ciudad','suministro mano de obra, materiales y todo lo necesario la reparación y cambio apertura de la puerta de la jaula de unidades condensadoras de aire acondicionado en edificio de tráfico, S.T.R.I, Panamá.',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-159',2025,'2025-11-12',6875.0,'enviada',NULL,NULL,'Smithsonian Tropical Research Institute Panamá, Ciudad','Suministro mano de obra, materiales y todo lo necesario la reparación de bandeja de unidad manejadora No. 5 que sirve a planta alta del edificio 235 CTPA,Ancón, Panamá.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-160',2025,'2025-11-19',9512.3,'enviada',NULL,NULL,'NESTLE PANAMA','instalación de un compresor para el enfriador de agua modelo GCC3B13201317E, serial 1930031A, de la planta de proceso de NESTLE de Natá, provincia de Coclé.',NULL,'DC',0.3,NULL,'excel_import'),
('COT DC 25-161',2025,'2025-11-19',490.0,'enviada',NULL,NULL,'S.T.R.I Panamá, Ciudad','Suministro de materiales y mano de obra para instalación de extractor y adecuación de ductos de sistema de extracción FUME HOOD de los laboratorios de Edificio Tupper, Stri Panamá.',NULL,'DS',0.3,NULL,'excel_import'),
('COT DC 25-162',2025,'2025-11-19',374.5,'aprobada','facturado','cancelada','SGS Panamá','Revisión del sistema Evaluación del flujo de aire. Medición y evaluación de parámetros ambientales. Revisión del equipo principal. Documentación de hallazgos.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-163',2025,'2025-10-20',69.55,'aprobada','facturado','cancelada','Esa Flaca Rica San Francisco','Inspección, suministro e instalación de luminarias en el cuarto frío ubicado en la Sucursal de San Francisco.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-164',2025,'2025-10-05',294.25,'aprobada','facturado','cancelada','Esa Flaca Rica San Francisco','Reparación de la nevera de papas ubicada en la Sucursal de San Francisco.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-165',2025,'2025-11-20',150.0,'aprobada','facturado','cancelada','SGS Panamá','Reparación unidad Hisense. Reparación unidad Premier.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-166',2025,'2025-11-25',1090.0,'aprobada','facturado','cancelada','SGS Panamá','Cambio del aislamiento y corrección del drenaje a cinco (5) unidades tipo Split.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-167',2025,'2025-11-26',294.25,'aprobada','facturado','cancelada','Hotel Gamboa Rainforest Resort','Suministro e instalación de un sensor de presión de alta, para el chiller Dunham Bush del área de Corotú, Hotel Gamboa Rainforest Resort',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-168',2025,'2025-11-26',290.75,'aprobada','facturado','cancelada','SGS Clayton','Mantenimiento de Unidad Split Mantenimiento de Central',NULL,'DM',1.0,NULL,'excel_import'),
('COT DC 25-169',2025,'2025-11-20',90.95,'aprobada','facturado','cancelada','FSL PLANTA, S.A','Inspección y cambio del breaker de la unidad de 36mil BTU/H',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-170',2025,'2025-11-08',240.75,'aprobada','facturado','cancelada','Cantina del Tigre San Francisco','Revisión general de cuarto frío de media temperatura de cocina de pase. Revisión y reparación de congelador de cocina de pase.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-171',2025,'2025-11-28',96.3,'aprobada','facturado',NULL,'Señor Alberto Alemán','Suministro de materiales y mano de obra para la reparación de fuga y recarga de gas refrigerante del sistema tipo minisplits que sirve a la cocina.',NULL,'DS',0.7,NULL,'excel_import'),
('COT DC 25-172',2025,'2025-11-18',197.95,'aprobada','facturado','cancelada','Cantina del Tigre San Francisco','Revisión general e inspección de unidad 7.5 Toneladas. SOS Domingo.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-173',2025,'2025-11-15',101.65,'aprobada','facturado','cancelada','Cantina del Tigre San Francisco','Suministro e instalación de overload. Suministro e instalación de relay.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-174',2025,'2025-11-28',74.9,'aprobada','facturado','cancelada','Cantina del Tigre San Francisco','Revisión de unidad A/C de mariscos. Bomba de desagüe tapada. Ductos de drenajes de A/C de pasillo desacoplado.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-175',2025,'2025-11-12',117.7,'aprobada','facturado',NULL,'Cervecería Clandestina','Revisión general de enfriador de compresor de aire. Mantenimiento de condensador, reemplazo de motor.',NULL,'DM',0.7,NULL,'excel_import'),
('COT DC 25-176',2025,NULL,80.25,'aprobada','facturado','cancelada','Esa Flaca Rica Altaplaza','Revisión general de nevera de armado. Instalación de terminales nuevos. Instalación de relay nuevo del compresor.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-177',2025,NULL,48.15,'aprobada','facturado','cancelada','Esa Flaca Rica Altaplaza','Revisión general de nevera vertical. Reparación de motor del evaporador Lubricación de bujes',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-178',2025,NULL,181.9,'aprobada','facturado','cancelada','Esa Flaca Rica Costa del Este','Suministro e instalación de sensor de deshielo y programación de full gauge. Congelador de carnes Suministro e instalación de capacitador de arranque. Congelador de papas',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-179',2025,NULL,101.65,'aprobada','facturado','cancelada','Esa Flaca Rica San Francisco','Suministro e instalación de breaker de 2 polos que alimental el panel de 2 circuitos',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-180',2025,NULL,240.75,'aprobada','facturado','cancelada','Esa Flaca Rica - Producción','Desinstalación de sistema eléctrico análogo e instalación de nuevo sistema por controlador full gauge con su sistema eléctrico completo.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-181',2025,'2025-11-11',133.75,'aprobada','facturado','cancelada','Esa Flaca Rica, Costa Verde','Impermeabilización de entrada de tubería de refrigeración.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-182',2025,NULL,69.55,'aprobada','facturado','cancelada','Esa Flaca Rica, Costa Verde','Reparación de bomba de desagüe',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-183',2025,NULL,1819.0,'rechazada',NULL,NULL,'Palacio Lung Fung, Los Ángeles','Opción 1 – Ducto en lámina galvanizada Calibre 26 Precio total: B/. 1700.00 + itbms (7%) Opción 2 – Ducto en lámina galvanizada Calibre 24 Precio total: B/. 2050.00 + itbms (7%)',NULL,'DS',0.0,NULL,'excel_import'),
('COT DC 25-184',2025,NULL,946.95,'aprobada','facturado','cancelada','Esa Flaca Rica San Francisco','Suministro e instalación de la condensadora y evaporadora de la nevera de plancha',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-185',2025,NULL,449.5,'aprobada','facturado','cancelada','Esa Flaca Rica - Producción','Revisión del sistema completo eléctrico análogo de termostato. Reemplazo del sistema eléctrico completo e instalación de nuevo sistema por controlador full gauge con su sistema eléctrico completo. Incluye: caja, cableado eléctrico. Arranque del sistema y monitoreo.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-186',2025,NULL,481.5,'aprobada','facturado','cancelada','Esa Flaca Rica - Producción','Deshielo de evaporador de media temperatura Reemplazo de ambos motores del abanico de la condensadora que presentaban problemas. Sustitución de válvulas solenoides y recarga de refrigerante',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-187',2025,NULL,160.5,'aprobada','facturado','cancelada','Esa Flaca Rica - Centennial','Suministro de cinco (5) protectores voltaje.',NULL,'DV',1.0,NULL,'excel_import'),
('COT DC 25-188',2025,NULL,321.0,'aprobada','facturado','cancelada','Esa Flaca Rica - Alta Plaza','Suministro de diez (10) protectores voltaje.',NULL,'DV',1.0,NULL,'excel_import'),
('COT DC 25-189',2025,NULL,101.65,'aprobada','facturado','cancelada','Esa Flaca Rica - Costa del Este','Suministro e instalación de bisagra a nevera marca: TRUE.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-190',2025,NULL,187.25,'aprobada','facturado','cancelada','Esa Flaca Rica - David','Revisión y reparación de aire acondicionado tipo casete de 5 toneladas.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-191',2025,NULL,304.95,'aprobada','facturado','cancelada','Esa Flaca Rica - David','Revisión y reparación de cuarto frío de baja temperatura.',NULL,'DS',1.0,NULL,'excel_import'),
('COT DC 25-192',2025,NULL,481.5,'aprobada','facturado','cancelada','Esa Flaca Rica - Costa Verde','Revisión y reparación de nevera de armado.',NULL,'DS',1.0,NULL,'excel_import')
) AS v(quote_number, year, sent_date, amount_usd, status, payment_status, invoice_status, client_name, description, notes, rubro, progress, follow_up_date, source);
-- ── 5. Licitaciones ───────────────────────────────────────
INSERT INTO cotiza.tenders (org_id, acto_number, year, modalidad, entity, location_text, objeto, status, execution_status, amount_ref_usd, delivery_date, notes, rubro, progress, source)
SELECT (SELECT id FROM cotiza.organizations WHERE name ILIKE '%dicec%' ORDER BY created_at LIMIT 1), v.* FROM (VALUES
('2025-1-10-01-06-CL-020888',2025,'contratacion_menor','Policlínica Roberto Ramírez de Diego, Chitré','Chitré, Herrera','Suministro de Motor Ventilador para Enfriadores','en_revision','OC en espera',5800.0,NULL,NULL,'DV',0.6,'excel_import'),
('2024-2-38-01-08-CM-000238',2024,'compra_menor','Aeronáutica Civil','Ciudad de Panamá','Suministro de partes y accesorios para la reparación del sistema de aire acondicionado Edificio 646','no_ganada','Terminado',15500.0,NULL,'Quedó desierta, no cumplimos','DC',0.0,'excel_import'),
('2025-0-03-01-08-LP-000004',2025,'licitacion_publica','Ministerio de la Presidencia','Ciudad de Panamá','Servicio de mantenimiento preventivo y correctivo de las unidades de aire acondicionado','no_ganada','Terminado',260796.45,NULL,NULL,'DM',0.0,'excel_import'),
('2025-0-40-01-08-LP-000002',2025,'licitacion_publica','Tribunal Electoral','Ciudad de Panamá','Servicio de mantenimiento preventivo y correctivo de aire','no_ganada','Terminado',141400.0,NULL,NULL,'DM',0.0,'excel_import'),
('2025-1-10-01-02-CL-010054',2025,'contratacion_menor','Policlínica San Juan de Dios de Natá','Natá, Coclé','Mantenimiento de chillers','ganada','Terminado',4800.0,NULL,NULL,'DM',1.0,'excel_import'),
('2025-1-10-01-02-CL-014870',2025,'contratacion_menor','Hospital Rafael Estévez, Aguadulce','La Chorrera, Panamá Oeste','Reparación de blower de UMA HRRE','ganada','Terminado',5500.0,NULL,NULL,'DC',1.0,'excel_import'),
('2025-1-10-01-02-CL-024132',2025,'contratacion_menor','Policlínica San Juan de Dios de Natá','Natá, Coclé','Mantenimiento Agosto - Enero','no_ganada','Terminado',4800.0,NULL,'Inexistente','DM',0.0,'excel_import'),
('2025-1-10-01-02-CL-025576',2025,'contratacion_menor','Hospital Rafael Estévez, Aguadulce','Aguadulce, Coclé','Suministro de mano de obra, materiales y repuestos para reparación de equipo de refrigeración','no_ganada','Terminado',5800.0,NULL,NULL,'DC',0.0,'excel_import'),
('2025-1-10-01-02-CL-026103',2025,'contratacion_menor','Hospital Rafael Estévez, Aguadulce','Aguadulce, Coclé','Mantenimiento Preventivo y Correctivo de UMA DB Sala de Medicina Nuclear','ganada','En ejecución',6000.0,NULL,NULL,'DM',0.9,'excel_import'),
('2025-1-10-01-02-CM-012589',2025,'compra_menor','Hospital Rafael Estévez, Aguadulce','Aguadulce, Coclé','Serpentines de UMA','en_revision','OC en espera',32106.0,NULL,NULL,'DC',0.6,'excel_import'),
('2025-1-10-01-02-CM-015412',2025,'compra_menor','Hospital Rafael Estévez, Aguadulce','Aguadulce, Coclé','Suministro de mantenimiento preventivo para 4 unidades enfriadoras de agua','ganada','OC en espera',23950.0,NULL,NULL,'DM',0.75,'excel_import'),
('2025-1-10-01-04-CL-021904',2025,'contratacion_menor','Hospital Rafael Hernández','David, Chiriquí','Mantenimiento Mensual','en_revision','OC en espera',9800.0,NULL,NULL,'DM',0.6,'excel_import'),
('2025-1-10-01-04-CM-009329',2025,'compra_menor','Hospital Rafael Hernández','David, Chiriquí','Servicio de reparación de aislamiento de máquina de aire acondicionado','no_ganada','Terminado',16500.0,NULL,NULL,'DC',0.0,'excel_import'),
('2025-1-10-01-04-CM-011769',2025,'compra_menor','Hospital Rafael Hernández','David, Chiriquí','Reemplazo de aislamiento en ductos de quirófanos','no_ganada','Terminado',48000.0,NULL,NULL,'DC',0.0,'excel_import'),
('2025-1-10-01-06-CM-013453',2025,'compra_menor','Policlínica Roberto Ramírez de Diego, Chitré','Chitré, Herrera','Dos Mantenimientos de Enfriadores','ganada','OC en espera',19000.0,NULL,NULL,'DM',0.75,'excel_import'),
('2025-1-10-01-08-CL-024319',2025,'contratacion_menor','Hospital Susana Jones','La Chorrera, Panamá Oeste','Reparación de UMA #13','ganada','OC en espera',5450.0,NULL,NULL,'DC',0.75,'excel_import'),
('2025-1-10-01-13-CM-014549',2025,'compra_menor','Policlínica Dr. Blas Gómez, Arraiján','Arraiján, Panamá Oeste','Servicio de Mantenimiento Preventivo a UMAS','no_ganada','Terminado',18960.0,NULL,NULL,'DM',0.0,'excel_import'),
('2025-1-11-01-08-CL-001318',2025,'contratacion_menor','ICGES','Ciudad de Panamá','Ventilador centrífugo','ganada','OC en espera',8500.0,NULL,NULL,'DC',0.75,'excel_import'),
('2025-1-11-01-08-CM-001207',2025,'compra_menor','ICGES','Ciudad de Panamá','Mantenimiento de Manejadoras y Chillers','no_ganada','Terminado',17300.0,NULL,NULL,'DM',0.0,'excel_import'),
('2025-2-38-01-08-CL-000288',2025,'contratacion_menor','Autoridad de Aeronáutica Civil','Ciudad de Panamá','Reparación e instalación de 8 motores de abanicos de condensación','no_ganada','Terminado',7200.0,NULL,NULL,'DC',0.0,'excel_import'),
('2025-1-10-01-02-LP-000095',2025,'licitacion_publica','CSS - Coordinación Administrativa, Coclé','Coclé','Serpentines para las Unidades Manejadoras de Aire Acondicionado','ganada','OC en espera',NULL,NULL,'Licitación pública',NULL,0.75,'excel_import'),
('2025-1-10-01-08-CM-017698',2025,'compra_menor','CSS - Policlínica Joaquín José Vallarino','Ciudad de Panamá','Suministro, instalación y programación del sistema de control para la climatización de los quirófanos','por_partir',NULL,33400.0,NULL,NULL,'DC',0.1,'excel_import'),
('2025-1-10-01-08-CL-033416',2025,'contratacion_menor','CSS - Dirección Nacional de Compras','Ciudad de Panamá','Suministro e instalación de cortinas de aire para el Hospital Dra. Susana Jones Cano','ganada','OC en espera',4050.0,NULL,NULL,'DS',0.75,'excel_import'),
('2026-1-10-01-03-CM-019578',2026,'compra_menor','CSS - Policlínica Dr. Hugo Spadafora, Colón',NULL,'Policlinica Dr Hugo Spadafora - CENTRAL DE AIRE ACONDICIONADO DE 15 TONELADA LABORATORIO','no_ganada',NULL,40150.0,NULL,'Importado de Dropbox 2026','DC',0.0,'excel_import'),
('2026-1-11-01-08-LP-000014',2026,'licitacion_publica','CSS/ICGES - Gorgas (manejadoras RRHH y BSL-2)',NULL,'SUMINISTRO DE MANEJADORAS DE AIRE RECURSOS HUMANOS Y BSL 2 GORGAS','no_ganada',NULL,NULL,NULL,'Monto por completar','DV',0.0,'excel_import'),
('2026-2-96-01-03-CM-000882',2026,'compra_menor','Zona Libre de Colón - Edificio Administrativo',NULL,'Mantenimiento Zona Libre de Colon - Edificio Administrativo','no_ganada',NULL,16659.9,NULL,'Importado de Dropbox 2026','DM',0.0,'excel_import'),
('2026-1-11-01-08-CM-001968',2026,'compra_menor','ICGES (Gorgas)',NULL,'ICGES-Serv. Mant AA (25-03-2026)','presentada',NULL,25000.0,NULL,'Importado de Dropbox 2026','DM',0.4,'excel_import'),
('2026-0-36-01-08-CM-003010',2026,'compra_menor','Procuraduría de la Nación',NULL,'Mantenimiento de AA de presición Procaduria de la nación','presentada',NULL,NULL,NULL,'Monto por completar','DM',0.4,'excel_import'),
('2026-1-10-01-04-CM-019759',2026,'compra_menor','CSS - Hospital Rafael Hernández, David',NULL,'CSS - Hospital RDr. R Hernandez (16-03-2026)','presentada',NULL,9500.0,NULL,'Suministro de coil quirófanos 7 y 9','DC',0.4,'excel_import'),
('2026-1-10-01-04-LP-000152',2026,'licitacion_publica','CSS - Hospital Rafael Hernández, David',NULL,'SUMINISTRO E INSTALACION DE UN SISTEMA DE AIRE ACONDICIONADO TIPO EXPANSION DIRECTA PARA EL AREA DE ESPECIALIDADES MEDICAS DEL HOSP','presentada',NULL,81320.0,NULL,'Precio referencia (Especialidades Médicas B)','DC',0.4,'excel_import'),
('2026-1-10-01-04-LP-000142',2026,'licitacion_publica','CSS - Hospital Regional Rafael Hernández, David',NULL,'CSS-HRegional RH, David (18 de marzo 26)','presentada',NULL,84150.0,NULL,'Sala de Cirugía - DX','DC',0.4,'excel_import'),
('2026-0-30-01-06-LP-000056',2026,'licitacion_publica','Órgano Judicial - Edif. SPA Herrera',NULL,'EDIFICIO SISTEMA PENAL ACUSATORIO DE HERRERA','no_ganada',NULL,69426.95,NULL,'Importado de Dropbox 2026','DC',0.0,'excel_import'),
('2026-0-362-01-04-LP-000022',2026,'licitacion_publica','IMELCF - Chiriquí, David',NULL,'Desinstalación y suministro de 2 centrales de 20 TON CHIRIQUI','no_ganada',NULL,68500.0,NULL,'2 centrales DX 20 ton','DC',0.0,'excel_import'),
('2026-1-31-01-08-LP-000034',2026,'licitacion_publica','SERTV',NULL,'Mantenimiento equipos SERTV','no_ganada',NULL,71580.0,NULL,'Importado de Dropbox 2026','DM',0.0,'excel_import'),
('2026-1-10-01-02-CL-037142',2026,'contratacion_menor','CSS - Policlínica San Juan de Dios de Natá',NULL,'CSS-Mant chiller, Nata (de febrero a abril 2026)','ganada',NULL,2400.0,NULL,'Mant chiller 3 meses','DM',0.7,'excel_import'),
('2026-2-79-01-06-LP-000021',2026,'licitacion_publica','Mercado Público de Chitré',NULL,'SERVICIO DE MANTENIMIENTO CORRECTIVO Y PREVENTIVO DEL SISTEMA DE AIRE ACONDICIONADO DEL MERCADO PÚBLICO DE CHITRÉ','no_ganada',NULL,NULL,NULL,'Monto por completar','DM',0.0,'excel_import'),
('2026-0-16-01-08-CL-001045',2026,'contratacion_menor','DGI - Ave. Balboa',NULL,'Servicio de desinstalación, suministro e instalación de aires acondicionados en el edificio de la DGI, ubicado en Ave. Balboa','presentada',NULL,NULL,NULL,'Monto por completar',NULL,0.4,'excel_import'),
('CAN Licitación No. 213427',2026,'otro','Autoridad del Canal de Panamá (ACP)',NULL,'CAN Licitación No. 213427','no_ganada',NULL,22500.0,NULL,'Oferta en USD (Carrier)','DC',0.0,'excel_import'),
('2026-1-10-01-01-LP-000158',2026,'licitacion_publica','CSS - Hospital Raúl Ávila Mena, Bocas del Toro',NULL,'Suministro e instalacion de 3 enfriadores de agua Hospital Raul Avila Mena, Bocas del toro','no_ganada',NULL,NULL,NULL,'Monto por completar',NULL,0.0,'excel_import'),
('2026-1-10-01-04-LP-000157',2026,'licitacion_publica','CSS - Hospital Regional Rafael Hernández, David',NULL,'SALA DE CIRUGIA DEL HOSPITAL REGIONAL DR. RAFAEL HERNÁNDEZ L UBICADO EN DAVID','presentada',NULL,82000.0,NULL,'Sala de Cirugía 40 ton DX','DC',0.4,'excel_import'),
('2026-2-38-01-08-CM-000566',2026,'compra_menor','Autoridad de Aeronáutica Civil - compresores 646',NULL,'AAC compresores del 646','presentada',NULL,NULL,NULL,'Monto por completar',NULL,0.4,'excel_import')
) AS v(acto_number, year, modalidad, entity, location_text, objeto, status, execution_status, amount_ref_usd, delivery_date, notes, rubro, progress, source);
COMMIT;
