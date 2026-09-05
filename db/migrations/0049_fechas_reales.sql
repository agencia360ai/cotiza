-- 0049: De dónde salió la ventana de actividad de cada proyecto.
--
-- `first_txn_date` / `last_txn_date` venían del P&L agrupado por MES, así que
-- siempre caían en día 1 — no porque el proyecto arrancara el 1 sino porque así
-- se agrupó el reporte. El board no podía distinguir eso de un día real, y
-- mostrar "1 jul 2026" hacía pasar por dato lo que era un artefacto.
--
-- Ahora esas mismas columnas también las puede llenar la lectura de
-- TRANSACCIONES (facturas, recibos, compras, gastos), donde `TxnDate` sí es un
-- día de calendario. Esta columna dice cuál de las dos escribió el valor, que
-- es lo único que hace falta para saber si el día se puede mostrar.
--
--   'mes'         → del reporte mensual: el día no significa nada
--   'transaccion' → de una transacción real: el día es un dato
--
-- NULL = todavía no se sincronizó con la lectura nueva; se trata como 'mes',
-- que es el comportamiento conservador (no mostrar un día que no se sabe).

alter table cotiza.qbo_project_state
  add column if not exists txn_dates_source text;

alter table cotiza.qbo_project_state
  drop constraint if exists qbo_project_state_txn_dates_source_check;

alter table cotiza.qbo_project_state
  add constraint qbo_project_state_txn_dates_source_check
  check (txn_dates_source is null or txn_dates_source in ('mes', 'transaccion'));

comment on column cotiza.qbo_project_state.txn_dates_source is
  'Origen de first_txn_date/last_txn_date: mes = reporte mensual (día sin valor), transaccion = TxnDate real.';
