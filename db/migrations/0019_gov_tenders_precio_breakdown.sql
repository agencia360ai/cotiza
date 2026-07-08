-- 0019: desglose auditable del precio de referencia. Guarda de dónde salió el
-- monto (mayor precio-like del proceso vs suma de renglones vs candidatos) para
-- poder verificar que NO haya errores en un campo tan sensible como el precio.

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS precio_breakdown jsonb;
