-- 0047: Vigilancia de licitaciones participadas en PanamaCompra.
--
-- Hoy, cuando una licitación ya se presentó, nadie avisa si el proceso se
-- movió: hay que entrar al portal y revisarlo a mano, proceso por proceso. Si
-- se pide una subsanación y nadie la ve a tiempo, se pierde el contrato.
--
-- La vigilancia se concentra en las PARTICIPADAS a propósito. Son pocas (2 a 8
-- a la vez) y son las únicas donde un cambio exige actuar: en una "por
-- participar" el cambio es información, en una participada es una fecha
-- límite. Escanear las 9.286 del portal para esto sería caro y peor.

-- Última foto del proceso en el portal, sobre la licitación misma: es un dato
-- de ELLA, no una entidad aparte, y así la lista lo lee sin un join más.
alter table cotiza.tenders
  add column if not exists pc_estado         text,        -- idEstado del portal
  add column if not exists pc_snapshot       jsonb,       -- señales que se comparan
  add column if not exists pc_checked_at     timestamptz, -- última revisión OK
  add column if not exists pc_changed_at     timestamptz, -- último cambio detectado
  add column if not exists pc_cambio         text,        -- qué cambió, en palabras
  add column if not exists pc_visto_at       timestamptz; -- cuándo lo marcaron visto

-- Índice para "¿a cuáles toca revisar?": participadas, sin archivar, ordenadas
-- por hace cuánto no se revisan.
create index if not exists tenders_vigilancia_idx
  on cotiza.tenders(org_id, status, pc_checked_at)
  where archived_at is null;

-- Bitácora. La foto de arriba dice el estado de HOY; esto dice cómo llegó ahí.
-- Sin el historial, un cambio que nadie miró queda pisado por el siguiente y
-- se pierde justamente lo que había que ver.
create table if not exists cotiza.tender_pc_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references cotiza.organizations(id) on delete cascade,
  tender_id   uuid not null references cotiza.tenders(id) on delete cascade,
  detectado_at timestamptz not null default now(),
  campo       text not null,   -- 'estado' | 'reclamos' | 'acta_apertura' | 'convocatoria'
  antes       text,
  despues     text,
  resumen     text not null,   -- la frase que lee una persona
  visto_at    timestamptz
);

create index if not exists tender_pc_events_tender_idx
  on cotiza.tender_pc_events(org_id, tender_id, detectado_at desc);

-- Sin ver: lo que el equipo todavía no revisó. Es la consulta del panel de
-- alertas, así que va indexada aparte.
create index if not exists tender_pc_events_sin_ver_idx
  on cotiza.tender_pc_events(org_id, detectado_at desc)
  where visto_at is null;

alter table cotiza.tender_pc_events enable row level security;

drop policy if exists tender_pc_events_select on cotiza.tender_pc_events;
create policy tender_pc_events_select on cotiza.tender_pc_events
  for select using (cotiza.is_org_member(org_id));

-- Los eventos los escribe la revisión automática (service role, que salta RLS).
-- Marcarlos como vistos sí lo hace una persona, y para eso alcanza con ser
-- miembro: es un acuse de lectura, no un dato del negocio.
drop policy if exists tender_pc_events_update on cotiza.tender_pc_events;
create policy tender_pc_events_update on cotiza.tender_pc_events
  for update using (cotiza.is_org_member(org_id)) with check (cotiza.is_org_member(org_id));
