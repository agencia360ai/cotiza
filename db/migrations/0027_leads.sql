-- 0027: Leads — CRM-lite de seguimiento a clientes potenciales que pueden
-- convertirse en cotización. (Aplicada en producción vía MCP; este archivo es
-- el registro.)
--
-- Pipeline (status): nuevo → contactado → en_seguimiento → cotizado →
-- ganado / perdido. Se ve como tablero Kanban por etapa. El seguimiento vive
-- en next_follow_up (próximo toque) + activity (bitácora de interacciones).
-- Al cotizar, converted_quote_id enlaza la cotización creada.

create table if not exists cotiza.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references cotiza.organizations(id) on delete cascade,
  company_name text,       -- cliente / empresa
  contact_name text,       -- persona de contacto
  whatsapp text,
  email text,
  description text,        -- descripción del proyecto
  status text not null default 'nuevo',
  estimated_value numeric, -- valor estimado del proyecto (opcional)
  source text,             -- referido, web, llamada, feria, otro
  next_follow_up date,     -- próximo seguimiento
  last_contact_at timestamptz,
  lost_reason text,
  client_id uuid references cotiza.clients(id) on delete set null,
  converted_quote_id uuid references cotiza.sales_quotes(id) on delete set null,
  activity jsonb not null default '[]'::jsonb, -- bitácora: [{at, text}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_org_status_idx on cotiza.leads (org_id, status);

alter table cotiza.leads enable row level security;
drop policy if exists leads_rw on cotiza.leads;
create policy leads_rw on cotiza.leads
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));

drop trigger if exists set_updated_at on cotiza.leads;
create trigger set_updated_at before update on cotiza.leads
  for each row execute function cotiza.set_updated_at();
