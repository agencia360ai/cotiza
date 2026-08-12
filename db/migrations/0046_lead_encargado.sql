-- 0046: Encargado de cada lead + nombre visible del miembro.
--
-- Un lead sin dueño es un lead que nadie sigue: en la lista no se ve quién lo
-- está trabajando y los follow-ups vencidos no tienen a quién reclamarle.
--
-- El encargado apunta a org_members y no a auth.users porque el que asigna
-- elige de la lista de MIEMBROS de esta organización. `on delete set null`:
-- si alguien deja la empresa, sus leads quedan sin encargado (visibles, para
-- repartir) en vez de desaparecer o romper la referencia.

alter table cotiza.leads
  add column if not exists owner_member_id uuid references cotiza.org_members(id) on delete set null;

create index if not exists leads_owner_idx on cotiza.leads(org_id, owner_member_id);

-- Nombre para mostrar del miembro. La app nunca pidió un nombre: los miembros
-- solo tienen su email (en auth.users), y "jfguerra@dicecpanama.com" como
-- etiqueta de encargado en una tabla es ruido. Es opcional — sin él se muestra
-- la parte del email antes de la arroba.
alter table cotiza.org_members
  add column if not exists display_name text;
