-- 0055: Lo cobrado de cada proyecto, por mes, sacado de los PAGOS de QuickBooks.
--
-- Antes el cobrado se deducía (facturado − saldo de cuentas por cobrar) y un
-- proyecto que no aparecía en ese reporte se daba por cobrado entero, aunque
-- no tuviera ningún pago registrado. Ahora sale de cada factura: lo pagado es
-- lo que QuickBooks le aplicó (total − saldo), con ITBMS, agrupado por el mes
-- de la factura para que el rango de fechas del tablero funcione:
--
--   [{ "month": "2026-03-01", "facturado": 1003.95, "cobrado": 1003.95 },
--    { "month": "2026-07-01", "facturado": 11700, "cobrado": 0 }]
--
-- Las facturas por facturar (EST y fechadas a futuro, como las P26-…) no van
-- acá: lo que tengan pagado es anticipo y vive en por_facturar.
-- NULL = todavía no se leyó (se llena con el próximo Actualizar).
-- La tabla ya tiene RLS; la columna nueva queda cubierta por las mismas políticas.

alter table cotiza.qbo_project_state
  add column if not exists cobros jsonb;

comment on column cotiza.qbo_project_state.cobros is
  'Por mes de factura: facturado y cobrado con ITBMS, de los pagos registrados en QuickBooks.';

notify pgrst, 'reload schema';
