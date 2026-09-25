-- 0050: Qué secciones puede ver cada miembro — y que la BASE lo haga cumplir.
--
-- Dos ejes que no se mezclan:
--   role       → qué puede HACER (owner/admin/engineer/viewer). Sin cambios acá.
--   secciones  → qué puede VER. NULL = todas.
--
-- Por qué esto vive en las políticas y no solo en el menú: la app habla con
-- Supabase directo desde el navegador, con la sesión del usuario. Esconder el
-- link de Proyectos a alguien de "solo licitaciones" no le impide abrir la
-- consola y leer qbo_project_state. Si la restricción no llega a la base, es
-- decorado.
--
-- Nadie pierde acceso al correr esto: todos los miembros actuales quedan con
-- secciones = NULL, y puede_ver() con NULL se comporta EXACTAMENTE como
-- is_org_member(). El cambio de comportamiento empieza recién cuando un admin
-- le asigna secciones a alguien.
--
-- Owner y admin ven todo siempre, tengan lo que tengan guardado: son quienes
-- administran la plataforma, y restringirlos solo sirve para que alguien se
-- deje afuera a sí mismo.
--
-- Qué se restringe y qué no: cada tabla declara qué secciones la LEEN, sacado
-- del mapa real de lecturas de cada ruta (no de lo que "debería" leer). Las
-- tablas de referencia que usan casi todas las secciones —clients,
-- client_locations, client_aliases, client_contacts, client_projects,
-- organizations, org_members— quedan como estaban: cerrarlas rompería media
-- plataforma, y un directorio de clientes no es lo sensible. Lo sensible —
-- montos de proyectos, precios de cotizaciones, datos del personal— sí se
-- cierra.
--
-- Los comandos de cada tabla se respetan exactos: attendance_audit sigue
-- siendo solo INSERT+SELECT (es un log), tender_pc_events solo SELECT+UPDATE.
-- Solo cambia el predicado de membresía.

-- ── 1. La columna ────────────────────────────────────────────────────────────

alter table cotiza.org_members
  add column if not exists secciones text[];

alter table cotiza.org_members
  drop constraint if exists org_members_secciones_check;

-- Solo nombres de sección conocidos: un typo guardado acá sería un miembro que
-- no ve nada sin que nadie entienda por qué.
alter table cotiza.org_members
  add constraint org_members_secciones_check
  check (
    secciones is null
    or secciones <@ array['inicio','proyectos','mantenimiento','leads','cotizaciones','licitaciones','clientes','personal']::text[]
  );

comment on column cotiza.org_members.secciones is
  'Secciones que ve el miembro. NULL = todas. Owner/admin ven todo sin importar este valor.';

-- ── 2. El predicado ──────────────────────────────────────────────────────────

-- ¿El usuario actual puede ver ALGUNA de estas secciones en esta org?
-- "Alguna" porque las tablas se comparten: sales_quotes la leen Cotizaciones,
-- Leads, Proyectos y Clientes, y cualquiera de las cuatro alcanza.
create or replace function cotiza.puede_ver(_org_id uuid, _secciones text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from cotiza.org_members m
    where m.org_id = _org_id
      and m.user_id = auth.uid()
      and (
        m.role in ('owner', 'admin')
        or m.secciones is null
        or m.secciones && _secciones
      )
  );
$$;

-- ── 3. Las políticas ─────────────────────────────────────────────────────────

-- qbo_project_state: proyectos, cotizaciones, inicio
drop policy if exists qbo_project_state_select on cotiza.qbo_project_state;
create policy qbo_project_state_select on cotiza.qbo_project_state for select using (cotiza.puede_ver(org_id, array['proyectos', 'cotizaciones', 'inicio']));
drop policy if exists qbo_project_state_insert on cotiza.qbo_project_state;
create policy qbo_project_state_insert on cotiza.qbo_project_state for insert with check (cotiza.puede_ver(org_id, array['proyectos', 'cotizaciones', 'inicio']));
drop policy if exists qbo_project_state_update on cotiza.qbo_project_state;
create policy qbo_project_state_update on cotiza.qbo_project_state for update using (cotiza.puede_ver(org_id, array['proyectos', 'cotizaciones', 'inicio'])) with check (cotiza.puede_ver(org_id, array['proyectos', 'cotizaciones', 'inicio']));
drop policy if exists qbo_project_state_delete on cotiza.qbo_project_state;
create policy qbo_project_state_delete on cotiza.qbo_project_state for delete using (cotiza.puede_ver(org_id, array['proyectos', 'cotizaciones', 'inicio']));

-- qbo_project_month: proyectos, inicio
drop policy if exists qbo_project_month_rw on cotiza.qbo_project_month;
create policy qbo_project_month_rw on cotiza.qbo_project_month for all using (cotiza.puede_ver(org_id, array['proyectos', 'inicio'])) with check (cotiza.puede_ver(org_id, array['proyectos', 'inicio']));

-- projects: proyectos
drop policy if exists projects_all on cotiza.projects;
create policy projects_all on cotiza.projects for all using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));

-- documents: proyectos
drop policy if exists documents_all on cotiza.documents;
create policy documents_all on cotiza.documents for all using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));

-- project_extractions: proyectos
drop policy if exists project_extractions_all on cotiza.project_extractions;
create policy project_extractions_all on cotiza.project_extractions for all using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));

-- project_milestones: proyectos
drop policy if exists project_milestones_select on cotiza.project_milestones;
create policy project_milestones_select on cotiza.project_milestones for select using (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestones_insert on cotiza.project_milestones;
create policy project_milestones_insert on cotiza.project_milestones for insert with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestones_update on cotiza.project_milestones;
create policy project_milestones_update on cotiza.project_milestones for update using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestones_delete on cotiza.project_milestones;
create policy project_milestones_delete on cotiza.project_milestones for delete using (cotiza.puede_ver(org_id, array['proyectos']));

-- project_sections: proyectos
drop policy if exists project_sections_select on cotiza.project_sections;
create policy project_sections_select on cotiza.project_sections for select using (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_sections_insert on cotiza.project_sections;
create policy project_sections_insert on cotiza.project_sections for insert with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_sections_update on cotiza.project_sections;
create policy project_sections_update on cotiza.project_sections for update using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_sections_delete on cotiza.project_sections;
create policy project_sections_delete on cotiza.project_sections for delete using (cotiza.puede_ver(org_id, array['proyectos']));

-- project_milestone_media: proyectos
drop policy if exists project_milestone_media_select on cotiza.project_milestone_media;
create policy project_milestone_media_select on cotiza.project_milestone_media for select using (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestone_media_insert on cotiza.project_milestone_media;
create policy project_milestone_media_insert on cotiza.project_milestone_media for insert with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestone_media_update on cotiza.project_milestone_media;
create policy project_milestone_media_update on cotiza.project_milestone_media for update using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestone_media_delete on cotiza.project_milestone_media;
create policy project_milestone_media_delete on cotiza.project_milestone_media for delete using (cotiza.puede_ver(org_id, array['proyectos']));

-- project_milestone_entries: proyectos
drop policy if exists project_milestone_entries_select on cotiza.project_milestone_entries;
create policy project_milestone_entries_select on cotiza.project_milestone_entries for select using (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestone_entries_insert on cotiza.project_milestone_entries;
create policy project_milestone_entries_insert on cotiza.project_milestone_entries for insert with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestone_entries_update on cotiza.project_milestone_entries;
create policy project_milestone_entries_update on cotiza.project_milestone_entries for update using (cotiza.puede_ver(org_id, array['proyectos'])) with check (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_milestone_entries_delete on cotiza.project_milestone_entries;
create policy project_milestone_entries_delete on cotiza.project_milestone_entries for delete using (cotiza.puede_ver(org_id, array['proyectos']));

-- project_acceptances: proyectos
drop policy if exists project_acceptances_select on cotiza.project_acceptances;
create policy project_acceptances_select on cotiza.project_acceptances for select using (cotiza.puede_ver(org_id, array['proyectos']));
drop policy if exists project_acceptances_insert on cotiza.project_acceptances;
create policy project_acceptances_insert on cotiza.project_acceptances for insert with check (cotiza.puede_ver(org_id, array['proyectos']));

-- share_links: proyectos, clientes
drop policy if exists share_links_all on cotiza.share_links;
create policy share_links_all on cotiza.share_links for all using (cotiza.puede_ver(org_id, array['proyectos', 'clientes'])) with check (cotiza.puede_ver(org_id, array['proyectos', 'clientes']));

-- sales_quotes: cotizaciones, leads, proyectos, clientes, inicio
drop policy if exists sales_quotes_select on cotiza.sales_quotes;
create policy sales_quotes_select on cotiza.sales_quotes for select using (cotiza.puede_ver(org_id, array['cotizaciones', 'leads', 'proyectos', 'clientes', 'inicio']));
drop policy if exists sales_quotes_insert on cotiza.sales_quotes;
create policy sales_quotes_insert on cotiza.sales_quotes for insert with check (cotiza.puede_ver(org_id, array['cotizaciones', 'leads', 'proyectos', 'clientes', 'inicio']));
drop policy if exists sales_quotes_update on cotiza.sales_quotes;
create policy sales_quotes_update on cotiza.sales_quotes for update using (cotiza.puede_ver(org_id, array['cotizaciones', 'leads', 'proyectos', 'clientes', 'inicio'])) with check (cotiza.puede_ver(org_id, array['cotizaciones', 'leads', 'proyectos', 'clientes', 'inicio']));
drop policy if exists sales_quotes_delete on cotiza.sales_quotes;
create policy sales_quotes_delete on cotiza.sales_quotes for delete using (cotiza.puede_ver(org_id, array['cotizaciones', 'leads', 'proyectos', 'clientes', 'inicio']));

-- quote_signatures: cotizaciones
drop policy if exists quote_signatures_rw on cotiza.quote_signatures;
create policy quote_signatures_rw on cotiza.quote_signatures for all using (cotiza.puede_ver(org_id, array['cotizaciones'])) with check (cotiza.puede_ver(org_id, array['cotizaciones']));

-- quotes: cotizaciones, proyectos
drop policy if exists quotes_all on cotiza.quotes;
create policy quotes_all on cotiza.quotes for all using (cotiza.puede_ver(org_id, array['cotizaciones', 'proyectos'])) with check (cotiza.puede_ver(org_id, array['cotizaciones', 'proyectos']));

-- quote_items: cotizaciones, proyectos
drop policy if exists quote_items_all on cotiza.quote_items;
create policy quote_items_all on cotiza.quote_items for all using (exists (select 1 from cotiza.quotes q where q.id = quote_items.quote_id and cotiza.puede_ver(q.org_id, array['cotizaciones', 'proyectos']))) with check (exists (select 1 from cotiza.quotes q where q.id = quote_items.quote_id and cotiza.puede_ver(q.org_id, array['cotizaciones', 'proyectos'])));

-- leads: leads, inicio
drop policy if exists leads_rw on cotiza.leads;
create policy leads_rw on cotiza.leads for all using (cotiza.puede_ver(org_id, array['leads', 'inicio'])) with check (cotiza.puede_ver(org_id, array['leads', 'inicio']));

-- tenders: licitaciones, cotizaciones, clientes, inicio
drop policy if exists tenders_select on cotiza.tenders;
create policy tenders_select on cotiza.tenders for select using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones', 'clientes', 'inicio']));
drop policy if exists tenders_insert on cotiza.tenders;
create policy tenders_insert on cotiza.tenders for insert with check (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones', 'clientes', 'inicio']));
drop policy if exists tenders_update on cotiza.tenders;
create policy tenders_update on cotiza.tenders for update using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones', 'clientes', 'inicio'])) with check (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones', 'clientes', 'inicio']));
drop policy if exists tenders_delete on cotiza.tenders;
create policy tenders_delete on cotiza.tenders for delete using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones', 'clientes', 'inicio']));

-- tender_pc_events: licitaciones
drop policy if exists tender_pc_events_select on cotiza.tender_pc_events;
create policy tender_pc_events_select on cotiza.tender_pc_events for select using (cotiza.puede_ver(org_id, array['licitaciones']));
drop policy if exists tender_pc_events_update on cotiza.tender_pc_events;
create policy tender_pc_events_update on cotiza.tender_pc_events for update using (cotiza.puede_ver(org_id, array['licitaciones'])) with check (cotiza.puede_ver(org_id, array['licitaciones']));

-- gov_tenders: licitaciones, cotizaciones
drop policy if exists gov_tenders_select on cotiza.gov_tenders;
create policy gov_tenders_select on cotiza.gov_tenders for select using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones']));
drop policy if exists gov_tenders_insert on cotiza.gov_tenders;
create policy gov_tenders_insert on cotiza.gov_tenders for insert with check (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones']));
drop policy if exists gov_tenders_update on cotiza.gov_tenders;
create policy gov_tenders_update on cotiza.gov_tenders for update using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones'])) with check (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones']));
drop policy if exists gov_tenders_delete on cotiza.gov_tenders;
create policy gov_tenders_delete on cotiza.gov_tenders for delete using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones']));

-- gov_scan_cursors: licitaciones, cotizaciones
drop policy if exists gov_scan_cursors_rw on cotiza.gov_scan_cursors;
create policy gov_scan_cursors_rw on cotiza.gov_scan_cursors for all using (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones'])) with check (cotiza.puede_ver(org_id, array['licitaciones', 'cotizaciones']));

-- maintenance_schedules: mantenimiento, clientes, inicio
drop policy if exists maintenance_schedules_all on cotiza.maintenance_schedules;
create policy maintenance_schedules_all on cotiza.maintenance_schedules for all using (cotiza.puede_ver(org_id, array['mantenimiento', 'clientes', 'inicio'])) with check (cotiza.puede_ver(org_id, array['mantenimiento', 'clientes', 'inicio']));

-- maintenance_reports: mantenimiento, inicio
drop policy if exists maintenance_reports_all on cotiza.maintenance_reports;
create policy maintenance_reports_all on cotiza.maintenance_reports for all using (cotiza.puede_ver(org_id, array['mantenimiento', 'inicio'])) with check (cotiza.puede_ver(org_id, array['mantenimiento', 'inicio']));

-- report_items: mantenimiento, inicio
drop policy if exists report_items_all on cotiza.report_items;
create policy report_items_all on cotiza.report_items for all using (exists (select 1 from cotiza.maintenance_reports r where r.id = report_items.report_id and cotiza.puede_ver(r.org_id, array['mantenimiento', 'inicio']))) with check (exists (select 1 from cotiza.maintenance_reports r where r.id = report_items.report_id and cotiza.puede_ver(r.org_id, array['mantenimiento', 'inicio'])));

-- report_acceptances: mantenimiento
drop policy if exists report_acceptances_all on cotiza.report_acceptances;
create policy report_acceptances_all on cotiza.report_acceptances for all using (exists (select 1 from cotiza.maintenance_reports r where r.id = report_acceptances.report_id and cotiza.puede_ver(r.org_id, array['mantenimiento']))) with check (exists (select 1 from cotiza.maintenance_reports r where r.id = report_acceptances.report_id and cotiza.puede_ver(r.org_id, array['mantenimiento'])));

-- client_equipment: mantenimiento, clientes, inicio
drop policy if exists client_equipment_all on cotiza.client_equipment;
create policy client_equipment_all on cotiza.client_equipment for all using (exists (select 1 from cotiza.client_locations l join cotiza.clients c on c.id = l.client_id where l.id = client_equipment.location_id and cotiza.puede_ver(c.org_id, array['mantenimiento', 'clientes', 'inicio']))) with check (exists (select 1 from cotiza.client_locations l join cotiza.clients c on c.id = l.client_id where l.id = client_equipment.location_id and cotiza.puede_ver(c.org_id, array['mantenimiento', 'clientes', 'inicio'])));

-- technicians: personal, mantenimiento, clientes, inicio
drop policy if exists technicians_all on cotiza.technicians;
create policy technicians_all on cotiza.technicians for all using (cotiza.puede_ver(org_id, array['personal', 'mantenimiento', 'clientes', 'inicio'])) with check (cotiza.puede_ver(org_id, array['personal', 'mantenimiento', 'clientes', 'inicio']));

-- technician_assignments: personal
drop policy if exists technician_assignments_select on cotiza.technician_assignments;
create policy technician_assignments_select on cotiza.technician_assignments for select using (cotiza.puede_ver(org_id, array['personal']));
drop policy if exists technician_assignments_insert on cotiza.technician_assignments;
create policy technician_assignments_insert on cotiza.technician_assignments for insert with check (cotiza.puede_ver(org_id, array['personal']));
drop policy if exists technician_assignments_update on cotiza.technician_assignments;
create policy technician_assignments_update on cotiza.technician_assignments for update using (cotiza.puede_ver(org_id, array['personal'])) with check (cotiza.puede_ver(org_id, array['personal']));
drop policy if exists technician_assignments_delete on cotiza.technician_assignments;
create policy technician_assignments_delete on cotiza.technician_assignments for delete using (cotiza.puede_ver(org_id, array['personal']));

-- attendance_audit: personal
drop policy if exists attendance_audit_sel on cotiza.attendance_audit;
create policy attendance_audit_sel on cotiza.attendance_audit for select using (cotiza.puede_ver(org_id, array['personal']));
drop policy if exists attendance_audit_ins on cotiza.attendance_audit;
create policy attendance_audit_ins on cotiza.attendance_audit for insert with check (cotiza.puede_ver(org_id, array['personal']));

-- attendance_day: personal
drop policy if exists attendance_day_rw on cotiza.attendance_day;
create policy attendance_day_rw on cotiza.attendance_day for all using (cotiza.puede_ver(org_id, array['personal'])) with check (cotiza.puede_ver(org_id, array['personal']));

-- attendance_events: personal
drop policy if exists attendance_events_rw on cotiza.attendance_events;
create policy attendance_events_rw on cotiza.attendance_events for all using (cotiza.puede_ver(org_id, array['personal'])) with check (cotiza.puede_ver(org_id, array['personal']));

-- attendance_settings: personal
drop policy if exists attendance_settings_rw on cotiza.attendance_settings;
create policy attendance_settings_rw on cotiza.attendance_settings for all using (cotiza.puede_ver(org_id, array['personal'])) with check (cotiza.puede_ver(org_id, array['personal']));

-- attendance_sites: personal
drop policy if exists attendance_sites_rw on cotiza.attendance_sites;
create policy attendance_sites_rw on cotiza.attendance_sites for all using (cotiza.puede_ver(org_id, array['personal'])) with check (cotiza.puede_ver(org_id, array['personal']));

-- ── 4. Un hueco que existía antes de esto ────────────────────────────────────
--
-- org_members_insert permitía "user_id = auth.uid()" sin más condición: un
-- usuario podía insertarse a sí mismo como OWNER de cualquier organización
-- cuyo ID conociera. El caso realista no es un extraño adivinando un UUID: es
-- alguien a quien sacaste del equipo, que ya conoce el ID, volviendo a entrar
-- como dueño.
--
-- El único alta legítima por esta vía es el onboarding: quien crea una
-- organización se agrega como owner de ESA organización. El resto de las altas
-- (invitaciones, el auto-join de @dicecpanama.com) van por el admin client o
-- por un trigger SECURITY DEFINER, y no pasan por esta política.

create or replace function cotiza.creo_la_org(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from cotiza.organizations o
    where o.id = _org_id and o.created_by = auth.uid()
  );
$$;

drop policy if exists org_members_insert on cotiza.org_members;
create policy org_members_insert on cotiza.org_members
  for insert
  with check (
    cotiza.org_role(org_id) = any (array['owner', 'admin'])
    or (user_id = auth.uid() and role = 'owner' and cotiza.creo_la_org(org_id))
  );
