-- 0014: marcador "ya consulté el pliego y el gobierno no publica precio" como
-- COLUMNA (antes vivía dentro de raw jsonb y el upsert de cada sync lo borraba,
-- degradando el backfill de precios con el tiempo).

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS precio_checked boolean NOT NULL DEFAULT false;

-- Migrar los que ya tenían el marcador viejo dentro de raw.
UPDATE cotiza.gov_tenders SET precio_checked = true
WHERE precio_checked = false AND (raw->>'_precio_checked') = 'true';
