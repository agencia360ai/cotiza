-- Potenciales: persona de contacto + WhatsApp/email en cotizaciones,
-- para dar seguimiento rápido. Aplicar una vez.

ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS contact_name  text;
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS contact_phone text;  -- WhatsApp (solo dígitos, con código país)
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS contact_email text;
