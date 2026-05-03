# Cotiza

Plataforma de cotizaciones HVAC para Panamá. Multi-tenant, IA-asistida.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- **Estilos**: Tailwind CSS v4 + componentes estilo shadcn/ui (Radix primitives + CVA)
- **Backend**: Supabase (Postgres + Auth + Storage)
  - Proyecto dedicado: `hliyxksrgqgfatorgbne` (org Agencia360)
  - Schema: `cotiza`
- **IA**: Anthropic Claude API (Sonnet 4.6 por defecto, Opus 4.7 para casos complejos)

## Comandos

```bash
npm run dev     # http://localhost:3000
npm run build   # producción + TypeScript check
npm run lint
```

Antes de arrancar: `cp .env.example .env`, completar las vars, y `set -a && source .env && set +a`.

## Estructura

```
src/
├── app/
│   ├── (app)/             # rutas autenticadas con sidebar
│   │   ├── layout.tsx     # shell + verifica que el usuario tenga org
│   │   ├── dashboard/     # lista de proyectos
│   │   ├── projects/      # CRUD + flujo IA (upload → extract → quote)
│   │   ├── quotes/        # ver/editar cotización + export PDF
│   │   └── catalog/       # catálogo de equipos
│   ├── login/             # signin/signup (form único, server actions)
│   ├── onboarding/        # crear primera organización
│   ├── logout/route.ts    # POST → signOut → /login
│   ├── page.tsx           # router por estado de auth
│   └── layout.tsx         # root, fuentes Geist, metadata
├── components/
│   ├── ui/                # button, input, label, card (estilo shadcn)
│   └── app-sidebar.tsx
├── lib/
│   ├── supabase/{client,server,proxy}.ts
│   └── utils.ts           # cn()
└── proxy.ts               # auth gating (Next.js 16: middleware → proxy)
```

## Schema (Supabase, schema `cotiza`)

Tablas:
- `organizations` (multi-tenant)
- `org_members` (user × org × role: owner/admin/engineer/viewer)
- `projects` (status: draft → parsing → clarifying → quoting → completed)
- `documents` (archivos subidos al bucket `cotiza-documents`)
- `project_extractions` (output IA por documento + tokens usados)
- `equipment_catalog` (HVAC SKUs, global)
- `quotes`, `quote_items` (`line_total_usd` es columna calculada)

Setup:
- RLS activo en todas, con helpers `cotiza.is_org_member()` y `cotiza.org_role()` (SECURITY DEFINER, search_path vacío)
- Storage bucket `cotiza-documents` (privado, solo authenticated)
- Triggers `set_updated_at` en organizations/projects/equipment_catalog/quotes

⚠️ **Setup obligatorio una vez** por proyecto Supabase: dashboard → Project Settings → API → Exposed schemas → agregar `cotiza`. Sin esto el cliente PostgREST no puede leer las tablas.

## Setup para ingenieros del equipo

Al clonar el repo, Claude Code carga automáticamente:

- **Skill `ui-ux-pro-max`** → `.claude/skills/ui-ux-pro-max/`
  Motor de razonamiento de diseño. Se activa solo cuando pedís trabajo de UI/UX.

- **MCP `magic` (21st.dev)** → `.mcp.json`
  Generación de componentes UI vía `/ui ...`. Requiere API key personal.

### Configurar las API keys

Cada ingeniero genera sus propias keys. **Nunca se commitea `.env`.**

```bash
cp .env.example .env
# editá .env y completá: TWENTY_FIRST_API_KEY, NEXT_PUBLIC_SUPABASE_*, ANTHROPIC_API_KEY
set -a && source .env && set +a
claude    # o npm run dev
```

Alternativa: [direnv](https://direnv.net/) + `.envrc` con `export ...`.

### Actualizar el skill ui-ux-pro-max

```bash
npx uipro-cli@latest update --ai claude
```

## Convenciones

- **Sin comentarios obvios** — el código bien nombrado se explica solo. Comentar solo el "por qué" cuando no es evidente.
- **Server-first**: data fetching en Server Components y Server Actions. El cliente es solo para interacción.
- **RLS siempre activo** en tablas nuevas, con policies explícitas.
- **Nada de `.env` ni secretos en el repo.**
