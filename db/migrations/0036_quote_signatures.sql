-- 0036: Biblioteca de firmas (PNG) para las cartas de cotización.
--
-- La firma se guarda como data URL (base64) en la propia fila: son imágenes
-- chicas (decenas de KB) y hay pocas por org, así el render del PDF —que corre
-- en el servidor— lee los bytes sin pasar por Storage ni por links firmados.
--
-- La POSICIÓN y el TAMAÑO NO viven aquí: son por cotización y se guardan en el
-- jsonb `letter` (letter.firma = { id, x, y, w } en fracciones de la página), de
-- modo que la misma firma puede ir acomodada distinto en cada carta.
--
-- Cambio ADITIVO: sin firma seleccionada, la carta se ve exactamente igual que antes.

create table if not exists cotiza.quote_signatures (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references cotiza.organizations(id) on delete cascade,
  label      text not null,               -- "Jorge Guerra", "Ing. Pérez"
  data_url   text not null,               -- "data:image/png;base64,…"
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists quote_signatures_org_idx on cotiza.quote_signatures(org_id);

alter table cotiza.quote_signatures enable row level security;
drop policy if exists quote_signatures_rw on cotiza.quote_signatures;
create policy quote_signatures_rw on cotiza.quote_signatures
  for all using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
