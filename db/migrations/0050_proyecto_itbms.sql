-- 0050: El ITBMS deja de esconderse dentro del gasto y pasa a ser su propia cifra.
--
-- QuickBooks mete el ITBMS facturado al cliente en una cuenta de SISTEMA
-- ("VAT Expense", AccountSubType GlobalTaxExpense) que vive dentro de la sección
-- de gastos del P&L, y con signo negativo porque la venta la acredita. El parser
-- sumaba la sección entera, así que ese crédito se restaba del costo del
-- proyecto: seis proyectos con gasto negativo y margen de 107% (#217).
--
-- El impuesto no es un costo del proyecto — es recaudación para el fisco. Ahora
-- se aparta al leer el reporte y se guarda en su propia columna, que es lo que
-- alimenta la columna Tax del board.
--
-- `tax` se guarda POSITIVO = lo cobrado de ITBMS al cliente, aunque en el
-- reporte de QBO venga como crédito.

alter table cotiza.qbo_project_state
  add column if not exists tax numeric(14,2);

comment on column cotiza.qbo_project_state.tax is
  'ITBMS facturado al cliente, apartado del gasto. Positivo = recaudado. NULL = no se pudo leer.';

alter table cotiza.qbo_project_month
  add column if not exists tax numeric(14,2) not null default 0;

comment on column cotiza.qbo_project_month.tax is
  'ITBMS del mes, apartado del gasto para que el filtro por rango lo respete.';
