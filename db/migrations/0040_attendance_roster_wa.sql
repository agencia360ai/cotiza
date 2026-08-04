-- 0040: Quién puede mandarle al bot la PROGRAMACIÓN del día.
--
-- El bot ya recibe ubicaciones de cualquier técnico registrado (eso marca su
-- propia entrada/salida). Reenviar el mensaje de programación es distinto:
-- marca la asistencia de OTRAS personas, así que solo puede hacerlo un número
-- autorizado. Sin números en la lista, nadie puede (fallar cerrado, no abierto).

alter table cotiza.attendance_settings
  add column if not exists roster_wa_ids text[] not null default '{}';
