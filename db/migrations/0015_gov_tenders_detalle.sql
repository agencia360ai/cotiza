-- 0015: detalle completo del pliego para licitaciones de alto puntaje (>60 del
-- tamiz), para evaluar si DICEC puede participar. jsonb con objeto, contacto,
-- entidad, forma de pago/entrega, fechas y renglones del pliego.

ALTER TABLE cotiza.gov_tenders ADD COLUMN IF NOT EXISTS detalle jsonb;
