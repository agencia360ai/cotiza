-- 0034: Horario laboral — días laborables + hora de salida.
--
-- workday_days: días de la semana laborables (0=Dom … 6=Sáb). Se usa para
-- calcular "ayer / último día laborable" en el tablero. Default Lun–Vie.
-- workday_end: hora de salida esperada (informativa; complementa workday_start).
-- Cambio ADITIVO e idempotente.

alter table cotiza.attendance_settings add column if not exists workday_days integer[] not null default '{1,2,3,4,5}';
alter table cotiza.attendance_settings add column if not exists workday_end time not null default '17:00';
