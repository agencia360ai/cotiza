# Cotiza

Repositorio de la app Cotiza. Este archivo le da contexto a Claude Code (y a cualquier asistente AI compatible) sobre cómo trabajar en este proyecto.

## Setup para ingenieros del equipo

Al clonar el repo, Claude Code carga automáticamente:

- **Skill `ui-ux-pro-max`** → `.claude/skills/ui-ux-pro-max/`
  Motor de razonamiento de diseño (67 estilos, 96 paletas, 57 combos tipográficos, 13 stacks). Se activa solo cuando pedís trabajo de UI/UX.

- **MCP `magic` (21st.dev)** → `.mcp.json`
  Generación de componentes UI vía `/ui ...`. Requiere API key personal.

### Configurar la API key del MCP de 21st.dev

Cada ingeniero genera su propia key en [21st.dev/magic](https://21st.dev/magic) y la exporta antes de abrir Claude Code:

```bash
export TWENTY_FIRST_API_KEY="tu_api_key"
```

Recomendado: agregalo a tu `~/.zshrc` / `~/.bashrc` para que persista.

La primera vez que Claude Code arranque en este repo va a pedir aprobación para correr el MCP — aceptá.

### Actualizar el skill ui-ux-pro-max

```bash
npx uipro-cli@latest update --ai claude
```

## Convenciones del proyecto

(Pendiente: agregar stack, comandos de test/build/lint, estructura, y reglas del equipo)
