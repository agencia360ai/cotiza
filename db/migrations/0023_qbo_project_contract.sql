-- 0023: monto total del contrato por proyecto QBO. Junto con start_date/end_date
-- (0022) permite PRORRATEAR proyectos multi-año: al filtrar "este año", el monto
-- mostrado es la porción del contrato que cae dentro del rango, no el total.
-- Se siembra desde la cotización al enviar a QBO y es editable en el board.

ALTER TABLE cotiza.qbo_project_state ADD COLUMN IF NOT EXISTS contract_total numeric(14,2);
