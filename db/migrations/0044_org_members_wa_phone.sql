-- 0044: Teléfono de WhatsApp de cada miembro.
--
-- La autorización para reenviarle al bot la PROGRAMACIÓN del día vivía en una
-- lista suelta de números (attendance_settings.roster_wa_ids). Mantener esa
-- lista aparte de la de miembros es trabajo doble y se desincroniza: quien deja
-- la empresa se quita de miembros pero su número queda autorizado.
--
-- Ahora el número vive EN el miembro y la autorización sale de ahí. La lista
-- suelta se conserva para números que no son usuarios de la app.

alter table cotiza.org_members
  add column if not exists wa_phone text;
