-- 0012: avance manual por proyecto QBO (0-100).
-- Lo setea el equipo en la página de Proyectos; es independiente de los
-- números financieros (que vienen de QuickBooks).

ALTER TABLE cotiza.qbo_project_state
  ADD COLUMN IF NOT EXISTS progress smallint
  CHECK (progress IS NULL OR (progress >= 0 AND progress <= 100));
