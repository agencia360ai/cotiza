-- 0028: amplía el check de status de tenders. (Corrida en producción por el
-- usuario en el SQL editor; este archivo es el registro.)
--
-- Agrega 'por_participar' (faltaba y rompía el guardado con el error
-- "tenders_status_check") y 'orden_proceder' (A ejecutar / Orden de proceder:
-- el estado entre GANAR y arrancar la obra — pasa mucho tiempo hasta la OP, y
-- es este el que se envía a Proyectos, no el de ganada). Cambio aditivo: no
-- modifica ninguna fila, solo amplía los valores permitidos.

alter table cotiza.tenders drop constraint if exists tenders_status_check;
alter table cotiza.tenders add constraint tenders_status_check
  check (status = any (array[
    'por_participar'::text,
    'presentada'::text,
    'en_revision'::text,
    'ganada'::text,
    'orden_proceder'::text,
    'no_ganada'::text,
    'por_partir'::text
  ]));
