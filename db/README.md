# Migraciones y seed — Potenciales (Fase C)

SQL para el módulo de **Potenciales** (cotizaciones + licitaciones) y el budget
de proyectos. Se aplica una sola vez sobre el proyecto Supabase
`hliyxksrgqgfatorgbne` (schema `cotiza`).

## Orden de aplicación

1. `migrations/0001_pipeline_tables.sql` — crea `sales_quotes`, `tenders`,
   índices, RLS y agrega `budget_usd` / `qb_customer_id` a `client_projects`.
2. `seed/0002_quotes_part1.sql` … `0004_quotes_part3.sql` — importa las 316
   cotizaciones del Excel (2025 + 2026).
3. `seed/0005_tenders.sql` — importa las 41 licitaciones.

El seed resuelve el `org_id` con
`(SELECT id FROM cotiza.organizations WHERE name ILIKE '%dicec%' ...)`, así que
no hace falta hardcodear UUIDs.

## Cómo aplicar

- **Supabase MCP**: `apply_migration` para el paso 1, `execute_sql` para los
  seeds (2–3).
- **Dashboard SQL Editor**: pegar cada archivo en orden.

## Re-importar (idempotencia)

El seed no es idempotente (no hay unique key en `quote_number` porque el Excel
tiene números repetidos legítimos). Para re-importar limpio:

```sql
DELETE FROM cotiza.sales_quotes WHERE source = 'excel_import';
DELETE FROM cotiza.tenders      WHERE source = 'excel_import';
```

## Estado del código

`src/lib/pipeline/queries.ts` ya lee de estas tablas con **fallback al snapshot**
del Excel (`src/lib/pipeline/types.ts`). Mientras las tablas estén vacías o no
existan, la UI muestra el snapshot; apenas se importe la data, pasa a vivo
automáticamente.
