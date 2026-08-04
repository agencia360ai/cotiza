-- 0039: Planilla diaria de asistencia (Fase 1).
--
-- Hasta ahora la asistencia eran EVENTOS (attendance_events): entradas/salidas
-- con GPS que el técnico manda por WhatsApp. Eso verifica que estuvo en el
-- sitio, pero no sirve para llevar la planilla del día: quien no marca no
-- aparece, y no hay dónde anotar en qué proyecto trabajó.
--
-- Esta tabla es la PLANILLA: la fuente de verdad de "quién trabajó hoy y en qué".
-- Los eventos con GPS siguen igual y se muestran al lado como evidencia.
--
-- Regla clave: TODOS ASISTEN POR DEFECTO. La ausencia de fila = presente sin
-- proyecto asignado. Solo se guarda fila cuando hay algo que decir (una falta,
-- un proyecto, o una marca que vino del mensaje de WhatsApp), así la tabla no
-- crece con una fila por persona por día para decir "vino, como siempre".

create table if not exists cotiza.attendance_day (
  org_id        uuid not null references cotiza.organizations(id) on delete cascade,
  technician_id uuid not null references cotiza.technicians(id) on delete cascade,
  day           date not null,
  present       boolean not null default true,
  project_no    text,        -- "DM26-08" · o "Transporte" y similares
  site_label    text,        -- "Cirion – Colón" (la sección del mensaje)
  source        text not null default 'manual' check (source in ('manual','whatsapp')),
  note          text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (org_id, technician_id, day)
);

create index if not exists attendance_day_org_day_idx on cotiza.attendance_day(org_id, day);

alter table cotiza.attendance_day enable row level security;
drop policy if exists attendance_day_rw on cotiza.attendance_day;
create policy attendance_day_rw on cotiza.attendance_day
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
