# Plan — Lista de clientes maestra y estandarizada (QuickBooks = source of truth)

> Estado: **plan / documentación**. No implementado todavía.
> Objetivo: una sola lista canónica de clientes, usada de forma consistente en
> **toda la plataforma** (cotizaciones, proyectos, mantenimiento).
>
> **Decisión clave: QuickBooks es el MAESTRO.** La lista de customers de QBO —
> con su email/WhatsApp y POCs — es la verdad. La app **espeja** esa lista
> (keyed por `qb_customer_id`) y resuelve las variantes de nombre matcheándolas
> contra QBO. Esto simplifica la estandarización: no inventamos nombres
> canónicos, **adoptamos los DisplayName de QBO**.

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

## 2. Modelo objetivo (espejo de QuickBooks)

```
clients  (ESPEJO de QBO — una fila por customer de QuickBooks)
  ├─ id, org_id
  ├─ qb_customer_id      ← ANCLA: id del customer de QBO (la llave de verdad)
  ├─ name                ← = DisplayName de QBO (canónico, no editable en la app)
  ├─ category, logo, brand_color   ← enriquecimiento solo-app
  └─ synced_at, sync_status

client_contacts  (NUEVA — POCs del cliente; primario viene de QBO)
  ├─ id, org_id, client_id
  ├─ name, role
  ├─ email, phone (WhatsApp)
  └─ source             ← quickbooks | manual   (primario = QBO; extras = manual)

client_locations  (ya existe — SUCURSALES)
  └─ "Esa Flaca Rica – David"  =  client(Esa Flaca Rica) + location(David)

client_aliases  (NUEVA — variantes conocidas para auto-match)
  ├─ id, org_id, client_id
  ├─ alias_norm         ← texto normalizado (sin acentos, minúsculas, sin sufijos)
  ├─ location_id?       ← si el alias apuntaba a una sucursal específica
  └─ source             ← excel | dropbox | quickbooks | manual

sales_quotes.client_id   ← (NUEVO, nullable) linkear cotización al cliente
tenders.client_id        ← (NUEVO, nullable) idem licitaciones
```

**Reglas del modelo**
- **QBO manda.** `clients.name` = DisplayName de QBO; no se edita en la app (cambiar el nombre se hace en QBO y se re-sincroniza).
- **`qb_customer_id` es la llave.** Todo cliente espejado lo tiene. Un cliente creado primero en la app se **empuja a QBO** y recién ahí queda canónico.
- **Cliente ≠ sucursal.** Las sucursales van como `client_locations`. Colapsa los 15 "Esa Flaca Rica" en 1 cliente.
- **Contactos/POCs**: el primario (email/teléfono) se trae de QBO; POCs adicionales se agregan en `client_contacts` (manual). De ahí salen el WhatsApp/email para el seguimiento de cotizaciones.

---

## 3. Convención de nombres (estándar para todas las plataformas)

- **Nombre canónico = el `DisplayName` del customer en QuickBooks.** No se inventa
  en la app; se **adopta** de QBO. Si un cliente todavía no existe en QBO, se crea
  ahí primero (con la convención de abajo) y recién entonces queda canónico.
- **Convención al crear/limpiar en QBO** (para que el DisplayName quede consistente):
  - Nombre comercial limpio, con acentos y mayúsculas correctas. Ej: `Esa Flaca Rica`, `Cervecería Clandestina`, `Smithsonian (STRI)`.
  - **Sin sucursal en el nombre** del cliente (la sucursal es una location / sub-customer).
  - **Sufijo legal** *fuera* del nombre visible (`S.A./Inc.` va en un campo aparte si hace falta para facturación).
  - **Entidades públicas**: nombre oficial + sigla. Ej: `CSS — Hospital Rafael Estévez (Aguadulce)`.
- **En QuickBooks**: el *customer* = el cliente canónico; la sucursal va como *sub-customer/job* o como dato de la factura (a definir, ver §6).
- La app **nunca renombra** localmente: para corregir un nombre se edita en QBO y se re-sincroniza.

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

## 6. Sincronización con QuickBooks (QBO = maestro)

> MCP disponible: `Intuit_QuickBooks` / `Dicec_Finance_MCP` (search/create/get customer).

**Dirección de verdad: QBO manda.** El sync es **pull-first** — primero traemos
la verdad de QBO, después conciliamos lo que la app tenía suelto.

1. **Pull (siembra)** — traer *todos* los customers de QBO con sus campos:
   `DisplayName`, email, teléfono/WhatsApp, y sub-customers (sucursales). Cada uno
   crea/actualiza una fila en `clients` keyed por `qb_customer_id`. El POC primario
   (email/phone de QBO) entra en `client_contacts` con `source = quickbooks`.
2. **Match** — conciliar los nombres sueltos (`sales_quotes.client_name`,
   `tenders.entity`, `clients` viejos) contra los customers ya espejados, por nombre
   normalizado / alias. Cada match guarda un `client_aliases` y linkea `client_id`.
3. **Push (sólo lo que falta)** — un nombre que existe en la app pero **no** en QBO
   no se vuelve canónico hasta crearlo en QBO. Se crea el customer (con la convención
   de §3), se lee de vuelta su `qb_customer_id`/`DisplayName`, y recién ahí espeja.
4. **Re-sync periódico** — un pull posterior actualiza nombres/contactos cambiados en
   QBO. La app **no** escribe nombres a QBO salvo el push de alta del paso 3.
5. Resultado: `qb_customer_id` poblado en todo cliente → base para **Fase D**
   (budget vs gastado por proyecto/cliente desde QuickBooks).

**Decisión pendiente:** ¿en QBO la sucursal es *sub-customer/job* del cliente, o se ignora a nivel customer y solo se usa para etiquetar facturas? Esto define cómo se mapea costo→proyecto después.

---

## 7. Roadmap de implementación (para después de aprobar el plan)

El orden refleja **pull-first**: QBO siembra el maestro *antes* de limpiar lo demás.

| Fase | Qué | Entregable |
|---|---|---|
| CL-1 | Tablas: `clients.qb_customer_id`/`legal_name`/sync, `client_contacts`, `client_aliases`, `client_id` en tenders, `qb_sub_customer_id` en locations | ✅ `db/migrations/0004_clients_master.sql` |
| CL-2 | **Pull de QuickBooks** → espejar customers (+ contactos + sub-customers) en `clients`/`client_contacts` | maestro sembrado desde QBO |
| CL-3 | Clustering IA de nombres sueltos **contra el maestro de QBO** + **pantalla de revisión/merge** | UI de estandarización |
| CL-4 | Aplicar merge: linkeo masivo de cotizaciones/licitaciones + alta en QBO de los que faltan (push) | clientes canónicos + links |
| CL-5 | Auto-match en imports (Dropbox/nuevas) + cola de revisión + re-sync periódico de QBO | matching continuo |

---

## 8. Decisiones (tomadas)

- ✅ **Fuente de verdad: QuickBooks manda.** El maestro se siembra desde QBO
  (pull-first) y la app espeja por `qb_customer_id`. La app no renombra; sólo da
  de alta en QBO los clientes que aún no existen ahí.
- ✅ **Sucursales = `client_locations`** del mismo cliente (no clientes separados).
  Colapsa los 15 "Esa Flaca Rica" en 1 cliente con ~8 ubicaciones.
- ✅ **Sufijo legal fuera del nombre visible.** El `DisplayName` va sin `S.A./Inc.`;
  la razón social se guarda en `clients.legal_name`.
- ✅ **Mapeo de sucursal en QBO: se adopta lo que QBO traiga** en el pull inicial
  (sub-customer/job si existe). La columna `client_locations.qb_sub_customer_id`
  queda lista para guardarlo (base del costo→sucursal→proyecto en Fase D).
- ✅ **Contactos/POCs**: contacto primario desde QBO + POCs adicionales manuales en
  `client_contacts`. Sin importación de contactos desde otra fuente por ahora.
- ✅ **Alcance del primer merge: todo el histórico (2025 + 2026).**

> Reabrir cualquiera de estas es barato: el esquema CL-1 no depende de ellas
> (sólo cambian el merge de CL-3/CL-4 y el mapeo de Fase D).
