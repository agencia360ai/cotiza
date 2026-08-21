-- 0048: Separar lo FACTURADO de lo COBRADO en cada proyecto.
--
-- Hasta ahora el board mostraba una sola cifra de ingreso, sacada del P&L de
-- QuickBooks. Ese número es lo FACTURADO (base devengado): incluye facturas
-- emitidas que el cliente todavía no pagó. Llamarlo "Cobro" hacía leer como
-- plata en la mano algo que puede seguir siendo una cuenta por cobrar.
--
-- Ahora son tres números distintos:
--   income  → Total del proyecto (lo facturado)
--   paid    → lo que efectivamente entró
--   cost    → el gasto
--
-- `paid` sale de restarle al facturado el saldo pendiente que QuickBooks
-- reporta para ese proyecto. Es null cuando no se pudo determinar: un cero
-- inventado diría "no nos pagaron nada", que es muy distinto de "no sé".

alter table cotiza.qbo_project_state
  add column if not exists paid          numeric(14,2),
  add column if not exists paid_synced_at timestamptz;

comment on column cotiza.qbo_project_state.paid is
  'Cobrado de verdad = facturado - saldo pendiente en QBO. NULL = no se pudo determinar.';
