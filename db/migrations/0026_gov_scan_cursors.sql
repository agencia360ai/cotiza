-- 0026: cursores de paginación reanudable para el escaneo de PanamaCompra.
-- (Aplicada en producción vía MCP; este archivo es el registro.)
--
-- El escaneo completo reiniciaba la paginación desde la página 0 en cada
-- corrida, así que un tipo con miles de procesos (programada: 2803) topaba
-- siempre el cap de páginas y re-correrlo nunca avanzaba — de ahí el eterno
-- "hay más páginas, corre otra vez". Ahora cada tipo guarda su cursor
-- (valorSiguiente de la API) y su estado; la próxima corrida CONTINÚA donde
-- quedó. Cuando todos los tipos terminan el ciclo, se resetean para el
-- siguiente escaneo fresco (diario).

create table if not exists cotiza.gov_scan_cursors (
  org_id uuid not null references cotiza.organizations(id) on delete cascade,
  tipo text not null,
  cursor text,
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (org_id, tipo)
);

alter table cotiza.gov_scan_cursors enable row level security;
drop policy if exists gov_scan_cursors_rw on cotiza.gov_scan_cursors;
create policy gov_scan_cursors_rw on cotiza.gov_scan_cursors
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
