-- Draft mode + publicación a Dropbox + portal de ingenieros.
-- 'borrador' = cotización creada en el cotizador cuyo PDF aún no se generó/subió.
-- Al publicar (PDF → Dropbox) pasa a 'enviada'. Dropbox sigue siendo la fuente
-- de verdad: las cartas manuales entran igual por el import.

ALTER TABLE cotiza.sales_quotes DROP CONSTRAINT IF EXISTS sales_quotes_status_check;
ALTER TABLE cotiza.sales_quotes
  ADD CONSTRAINT sales_quotes_status_check
  CHECK (status IN ('borrador', 'enviada', 'aprobada', 'rechazada'));

-- Link compartido de Dropbox del PDF (para reenviar por WhatsApp/Email).
ALTER TABLE cotiza.sales_quotes ADD COLUMN IF NOT EXISTS dropbox_shared_url text;

-- Token del portal de cotizador para ingenieros (/q/<token>, sin login).
ALTER TABLE cotiza.organizations ADD COLUMN IF NOT EXISTS cotizador_token text;
