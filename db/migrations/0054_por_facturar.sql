-- 0054: Lo que cada proyecto todavía no facturó (las facturas EST).
--
-- El equipo carga en QuickBooks como "factura" el monto del contrato que falta
-- facturar, con número EST… y fecha en un mes futuro para no tocar la
-- contabilidad del mes. La app lee QuickBooks hasta hoy, así que esos montos
-- no aparecían: proyectos adjudicados y en curso se veían en $0.
--
-- Se guardan aparte de lo facturado:
--   { "neto": 48200, "cobrado": 0,
--     "docs": [{ "numero": "ESTDC26-23", "fecha": "2026-12-01", "neto": 48200,
--                "total": 48200, "cobrado": 0,
--                "cuentas": [{ "cuenta": "4201 Ingresos por Contratos y Proyectos", "monto": 48200 }] }] }
--
-- NULL = el proyecto no tiene EST (o todavía no se sincronizó).
-- La tabla ya tiene RLS; la columna nueva queda cubierta por las mismas políticas.

alter table cotiza.qbo_project_state
  add column if not exists por_facturar jsonb;

comment on column cotiza.qbo_project_state.por_facturar is
  'Facturas EST de QuickBooks (monto por facturar del proyecto). No se suma a income.';
