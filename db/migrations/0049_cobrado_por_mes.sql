-- 0049: Cobrado mes a mes, a nivel empresa.
--
-- El `paid` de la 0048 es una FOTO: sale de restarle al facturado el saldo
-- pendiente de HOY, así que dice cuánto se cobró de cada proyecto pero no
-- CUÁNDO entró. Para la gráfica hace falta la otra pregunta: cuánta plata
-- entró en cada mes.
--
-- Sale del mismo reporte de P&L pero en base CAJA: en devengado el ingreso se
-- registra al facturar, y en caja al cobrar. La misma consulta, un parámetro
-- distinto, y la diferencia entre las dos curvas es exactamente lo que se
-- financia con capital propio.
--
-- Va a nivel empresa, no por proyecto: la gráfica muestra totales, así que una
-- sola llamada alcanza y evita duplicar las ~80 consultas por proyecto que ya
-- son la parte lenta del refresh.

create table if not exists cotiza.qbo_cobrado_month (
  org_id     uuid not null references cotiza.organizations(id) on delete cascade,
  month      date not null,          -- primer día del mes
  cobrado    numeric(14,2) not null default 0,
  synced_at  timestamptz not null default now(),
  primary key (org_id, month)
);

alter table cotiza.qbo_cobrado_month enable row level security;

drop policy if exists qbo_cobrado_month_select on cotiza.qbo_cobrado_month;
create policy qbo_cobrado_month_select on cotiza.qbo_cobrado_month
  for select using (cotiza.is_org_member(org_id));

-- Lo escribe la sincronización con service role, igual que el resto de los
-- datos que vienen de QuickBooks: no es algo que una persona edite.
