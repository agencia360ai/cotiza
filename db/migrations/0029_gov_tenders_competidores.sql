-- 0029: gov_tenders.competidores — snapshot PERSISTENTE del "Check status".
-- Guarda las propuestas del acto (oferentes + montos + resultado) y el veredicto
-- automático aplicado al tender (ganada / no_ganada / monto ganador), para que
-- el resultado quede en la app aunque PanamaCompra deje de exponer la vista.
-- Shape: { proponentes: [{nombre, monto, extra}], vistaUsada, abierta, at, auto }.
-- Cambio aditivo: columna nullable, sin tocar filas existentes.

alter table cotiza.gov_tenders add column if not exists competidores jsonb;
