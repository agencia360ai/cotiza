-- 0016: status de negocio por proyecto QBO, editable desde Reportme.
--   activo     = en ejecución (se refresca de QBO)
--   por_cobrar = entregado, pendiente de cobro (se refresca)
--   cerrado    = terminado/cobrado (congela los números, no se re-consulta)
-- `closed` se mantiene como derivado (closed = status = 'cerrado') para la
-- lógica de refresco existente.

ALTER TABLE cotiza.qbo_project_state
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'activo'
  CHECK (status IN ('activo', 'por_cobrar', 'cerrado'));

-- Alinear con el estado previo de abierto/cerrado.
UPDATE cotiza.qbo_project_state SET status = 'cerrado' WHERE closed = true AND status = 'activo';
