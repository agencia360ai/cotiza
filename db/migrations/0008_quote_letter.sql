-- Cotizador IA: guardar la carta (renglones, ITBMS, validez, condiciones...)
-- como jsonb en la cotización. La carta imprimible se renderiza de acá.

ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS letter jsonb;
