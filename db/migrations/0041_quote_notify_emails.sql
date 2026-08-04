-- 0041: A quién se le avisa cuando una cotización queda APROBADA.
--
-- Como ya no se pueden crear proyectos en QuickBooks desde la app, el registro
-- lo hace administración a mano. Este correo es el disparador de esa tarea:
-- lleva el PDF y los datos listos para copiar.
--
-- Editable desde Ajustes; sin correos en la lista simplemente no se manda nada.

alter table cotiza.organizations
  add column if not exists quote_notify_emails text[] not null default '{}';
