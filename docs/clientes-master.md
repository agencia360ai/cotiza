# Plan — Lista de clientes maestra y estandarizada (single source of truth)

> Estado: **plan / documentación**. No implementado todavía.
> Objetivo: una sola lista canónica de clientes, usada de forma consistente en
> **toda la plataforma** (cotizaciones, proyectos, mantenimiento) y **sincronizada
> con QuickBooks**. Cada cliente real = un único registro, con sus variantes de
> nombre resueltas y sus sucursales como ubicaciones.

---

## 1. El problema (con data real)

Hoy conviven **tres fuentes de "cliente" desalineadas**:

| Fuente | Cómo guarda el cliente | ¿Linkeado? |
|---|---|---|
| App — `cotiza.clients` | registro estructurado (nombre, categoría, logo…) | sí: proyectos y mantenimiento usan `client_id` |
| App — `sales_quotes` / `tenders` | **texto libre** (`client_name` / `entity`) | **no** — string suelto |
| QuickBooks | customers | independiente |

Medición sobre las 320 cotizaciones importadas:
- **316 cotizaciones → 171 nombres de cliente distintos.**
- Clustering conservador (solo formato/acentos): **22 clientes reales aparecen como 65 nombres**. Cruzando abreviaturas el número real es mayor.

### Tipos de variación detectados
1. **Sucursales del mismo cliente** (el caso más grande):
   `Esa Flaca Rica` aparece en **15 formas** = 1 cliente con ~8 sucursales:
   Vía Argentina, David, Centennial, Costa Verde, Costa del Este, Brisas del Golf,
   San Francisco, Producción, Alta Plaza.
2. **Abreviaturas / nombres comerciales vs. legales:**
   `EFR` = `Esa Flaca Rica`; `STRI` = `S.T.R.I Panamá` = `Smithsonian Tropical Research Institute` = `TUPPER`/`CTPA` (edificios).
3. **Acentos y mayúsculas:** `Cervecería Clandestina` vs `Cerveceria Clandestina`; `SGS Panamá` vs `SGS PANAMA`.
4. **Sufijos legales / ciudad redundantes:** `Compañía Rigaservice S.A` vs `Compañía RIGASERVICE S.A`; `S.T.R.I Panamá, Ciudad`.
5. **Entidades públicas (CSS / hospitales):** `Hospital Rafael Estévez, Aguadulce` = `CSS HRRE Aguadulce` = `HRRE Aguadulce CSS` = `Hosp. Dr Rafael Estévez`.

Ejemplos de clusters reales:

```
[15] Esa Flaca Rica  (1 cliente, ~8 sucursales)
[6]  SGS             (SGS · SGS PANAMA · SGS Panamá · SGS – Ciudad del Saber · – Clayton · – Ojo de Agua)
[4]  CIRION          (CIRION · CIRION Panamá · – Century Link Ambush Range · – Fort Amador)
[3]  STRI            (S.T.R.I Panamá · S.T.R.I Panamá, Ciudad · S.T.R.I Panamá, Panamá  [+ Smithsonian/TUPPER/CTPA])
[2]  Cervecería Clandestina   (acento)
[2]  Autoridad Aeronáutica Civil  (acento)
```

---

## 2. Modelo objetivo (golden record)

```
clients  (MAESTRO canónico — una fila por cliente real)
  ├─ id, org_id
  ├─ name                ← nombre canónico estándar
  ├─ category, logo, brand_color, contact_*
  └─ qb_customer_id      ← (NUEVO) mapeo 1:1 con el customer de QuickBooks

client_locations  (ya existe — SUCURSALES)
  └─ "Esa Flaca Rica – David"  =  client(Esa Flaca Rica) + location(David)

client_aliases  (NUEVA — variantes conocidas para auto-match)
  ├─ id, org_id, client_id
  ├─ alias_norm         ← texto normalizado (sin acentos, minúsculas, sin sufijos)
  ├─ location_id?       ← si el alias apuntaba a una sucursal específica
  └─ source             ← excel | dropbox | quickbooks | manual

sales_quotes.client_id   ← (NUEVO, nullable) linkear cotización al cliente canónico
tenders.client_id        ← (NUEVO, nullable) idem licitaciones
```

**Reglas del modelo**
- **Cliente ≠ sucursal.** Las sucursales van como `client_locations`, no como clientes separados. Esto colapsa naturalmente los 15 "Esa Flaca Rica".
- `clients.name` es el **único nombre canónico**; todo lo demás vive en `client_aliases`.
- `qb_customer_id` enlaza con QuickBooks → habilita el budget vs gastado por cliente/proyecto (Fase D).

---

## 3. Convención de nombres (estándar para todas las plataformas)

- **Nombre canónico** = nombre comercial limpio, con acentos y mayúsculas correctas. Ej: `Esa Flaca Rica`, `Cervecería Clandestina`, `Smithsonian (STRI)`.
- **Sin sucursal en el nombre** del cliente (la sucursal es una location).
- **Sufijo legal**: decidir una regla única (recomendado: *sin* `S.A./Inc.` en el nombre visible, guardándolo en un campo aparte si hace falta para facturación).
- **Entidades públicas**: nombre oficial + sigla. Ej: `CSS — Hospital Rafael Estévez (Aguadulce)`.
- **En QuickBooks**: el *customer* = el cliente canónico; la sucursal va como *sub-customer/job* o como dato de la factura (a definir, ver §6).

---

## 4. Proceso de estandarización (one-time)

1. **Reunir todos los nombres**: `clients` actuales + `sales_quotes.client_name` + `tenders.entity` + customers de QuickBooks.
2. **Clustering asistido por IA**: la IA propone grupos → `{ canónico, alias[], sucursales[] }` con score de confianza. (Maneja acentos, abreviaturas, sucursales.)
3. **Revisión humana** (pantalla de *merge*): confirmás/ajustás cada cluster — cuál es el nombre canónico, qué son sucursales, qué alias descartar. Nada se aplica sin tu OK.
4. **Aplicar**: crea/actualiza `clients` canónicos, crea `client_locations` para sucursales, puebla `client_aliases`, y linkea `sales_quotes.client_id` / `tenders.client_id`.

---

## 5. Matching continuo (de acá en adelante)

- Al importar de Dropbox / crear una cotización: el `client_name` se normaliza y se busca en `client_aliases`.
  - **Match** → linkea `client_id` automático.
  - **Sin match** → queda "sin cliente · a revisar"; ofrecés crear cliente nuevo o asignar a uno existente, y se **guarda el alias** para la próxima.
- Pantalla "clientes sin estandarizar" como cola de limpieza.

---

## 6. Sincronización con QuickBooks

> MCP disponible: `Intuit_QuickBooks` / `Dicec_Finance_MCP` (search/create/get customer).

1. **Pull** — traer customers de QBO → semilla del maestro + match contra lo existente (por nombre normalizado / alias).
2. **Match & merge** — vincular cada cliente de la app con su customer de QBO → guardar `qb_customer_id`.
3. **Push** — clientes que existen en la app pero **no** en QBO → crearlos en QBO con el nombre canónico.
4. **Dirección de verdad**: la **app es el maestro**; QBO se mantiene en sync (crear/renombrar un cliente se refleja en QBO).
5. Resultado: `qb_customer_id` poblado → base para **Fase D** (budget vs gastado por proyecto/cliente desde QuickBooks).

**Decisión pendiente:** ¿en QBO la sucursal es *sub-customer/job* del cliente, o se ignora a nivel customer y solo se usa para etiquetar facturas? Esto define cómo se mapea costo→proyecto después.

---

## 7. Roadmap de implementación (para después de aprobar el plan)

| Fase | Qué | Entregable |
|---|---|---|
| CL-1 | Tablas: `client_aliases`, `clients.qb_customer_id`, `client_id` en quotes/tenders | migración |
| CL-2 | Extracción + clustering IA + **pantalla de revisión/merge** | UI de estandarización |
| CL-3 | Aplicar merge + linkeo masivo de cotizaciones/licitaciones | clientes canónicos + links |
| CL-4 | Sync QuickBooks (pull/match/push + `qb_customer_id`) | clientes ↔ QBO |
| CL-5 | Auto-match en imports (Dropbox/nuevas) + cola de revisión | matching continuo |

---

## 8. Decisiones que necesito para cerrar el plan

1. **Sucursales**: ¿como `locations` del mismo cliente (recomendado) o clientes separados?
2. **Nombre canónico**: ¿con o sin sufijo legal (`S.A./Inc.`) en el nombre visible?
3. **QuickBooks**: ¿el *customer* es el cliente (sucursal = sub-customer/job), o cada sucursal es un customer propio?
4. **Fuente de verdad**: ¿la app manda y QBO se sincroniza? (recomendado sí.)
5. **Alcance del primer merge**: ¿estandarizamos solo los clientes de 2026, o todo el histórico (2025 incluido)?
