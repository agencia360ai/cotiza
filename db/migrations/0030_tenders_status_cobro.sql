-- 0030: agrega 'por_cobrar' y 'cobrado' al check de status de tenders.
-- Etapas del pipeline DESPUÉS de ganada/orden_proceder: la obra se ejecutó y
-- ahora se factura → Por cobrar (factura pendiente) → Cobrado (fin del ciclo).
-- Cambio aditivo: no toca ninguna fila, solo amplía los valores permitidos.

alter table cotiza.tenders drop constraint if exists tenders_status_check;
alter table cotiza.tenders add constraint tenders_status_check
  check (status = any (array[
    'por_participar'::text,
    'presentada'::text,
    'en_revision'::text,
    'ganada'::text,
    'orden_proceder'::text,
    'por_cobrar'::text,
    'cobrado'::text,
    'no_ganada'::text,
    'por_partir'::text
  ]));
