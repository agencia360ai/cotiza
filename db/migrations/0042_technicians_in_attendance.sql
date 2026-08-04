-- 0042: Qué personal aparece en el cuadro de asistencia.
--
-- `active` dice si la persona sigue en la empresa; eso no es lo mismo que si
-- lleva planilla de asistencia diaria. Administración, por ejemplo, está activa
-- pero no va a proyectos. Sin esta bandera, el cuadro mezclaba a todos.
--
-- Por defecto TRUE: al agregar a alguien nuevo entra al cuadro, que es lo
-- esperable; se saca a mano desde Asistencia → Configuración.

alter table cotiza.technicians
  add column if not exists in_attendance boolean not null default true;
