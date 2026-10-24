-- 0052: Desglose de cada proyecto por cuenta y por mes.
--
-- La pantalla del proyecto en QuickBooks muestra Income − Costs = Profit con
-- cada cuenta abierta (Ventas de equipos, Materiales, Acarreos…). La app solo
-- guardaba los totales, aunque el Estado de Resultados que ya pide en cada
-- Actualizar trae el detalle completo. Esto lo guarda para mostrarlo al tocar
-- el proyecto, sin volver a consultar QuickBooks.
--
-- jsonb porque se lee y se escribe entero:
--   { "desde": "2025-01-01", "actualizado": "2026-10-24T18:00:00Z",
--     "secciones": [
--       { "tipo": "costo_venta", "total": 5120.55,
--         "cuentas": [{ "nombre": "5100 Equipos y Accesorios", "total": 5120.55,
--                       "meses": { "2026-06-01": 3390, "2026-07-01": 58, "2026-08-01": 1672.55 } }] },
--       … ] }
--
-- NULL = todavía no se trajo. Hasta correr esto, el desglose se puede traer a
-- pedido desde el proyecto pero no queda guardado.
--
-- La tabla ya tiene RLS; una columna nueva queda cubierta por las mismas
-- políticas.

alter table cotiza.qbo_project_state
  add column if not exists desglose jsonb;

comment on column cotiza.qbo_project_state.desglose is
  'Estado de Resultados del proyecto por cuenta y por mes (QuickBooks). Lo muestra el resumen al expandir el proyecto.';
