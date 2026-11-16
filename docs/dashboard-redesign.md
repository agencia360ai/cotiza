# Resumen del negocio: rediseño

La pantalla `/inicio` reúne indicadores, prioridades y exploración de proyectos. Las lecturas siguen siendo del servidor, con la organización activa y las guardias de sección existentes. Abrir el resumen no sincroniza QuickBooks ni escribe en la contabilidad.

## Interacción

- Año del **proyecto** y línea de negocio filtran los indicadores, las prioridades, la tabla y la rentabilidad por rubro. Son acumulados por proyecto, no un estado contable del período.
- Los indicadores y las prioridades llevan a la lista correspondiente. Se puede buscar por proyecto/cliente, mostrar más filas y abrir una ficha sin abandonar el resumen.
- La ficha enlaza a `/proyectos?q=…`; esa búsqueda abre todos los años para no ocultar un proyecto anterior. La visita normal a Proyectos conserva el filtro anual.
- El gráfico permite ver 6/12 meses, tiene una tabla alternativa y diferencia falta de desglose de movimientos registrados en cero. Muestra facturación/costos por mes, no fecha de recepción del efectivo.
- Licitaciones por activar y operación comercial/mantenimiento tienen alcance propio, indicado en pantalla; no cambian con los filtros financieros.
- En móvil, las prioridades anteceden al gráfico y las filas se presentan como tarjetas. Menú y ficha usan diálogos con Escape, foco contenido y retorno al control de origen. Se respeta movimiento reducido.

## Significado de los indicadores

- **Facturado:** `income`, el ingreso del reporte contable de los proyectos seleccionados. No incluye anticipos.
- **Cobrado:** pagos del desglose `cobros`, más anticipos confirmados de `porFacturar.cobrado`. No se reutiliza `paid` como sustituto: las lecturas antiguas pueden incluir notas de crédito. Con datos faltantes, el total conocido se señala como parcial; si no hay ningún dato, se muestra «Sin datos».
- **Por cobrar:** suma de saldos del desglose de facturas, con ITBMS, independientemente del estado manual del proyecto. No implica vencimiento y no es el total facturado de los proyectos marcados «por cobrar».
- **Resultado registrado:** facturación menos costos y horas. Se calcula sobre proyectos con ambos datos válidos, incluyendo gastos de proyectos con ingreso cero. Costos desconocidos/negativos y costos cero en proyectos abiertos con facturación quedan fuera del margen y se indican. No incluye importes todavía por facturar ni representa la utilidad final del contrato.
- **Adjudicado por activar:** montos de referencia de licitaciones ganadas/con orden de proceder, no archivadas y sin proyecto local o de QuickBooks vinculado. No se suma a los ingresos.

Los totales pueden cambiar frente a la pantalla anterior por estas correcciones de significado. No se modifica el cálculo existente de QuickBooks ni se alteran sus registros.

## Validación

- `npm ci --cache /workspace/.cache/npm` con el lockfile existente.
- `npm test`: 171 pruebas, incluidas 10 regresiones de indicadores (anticipos, créditos, saldos, costos incompletos, pérdidas, meses y búsqueda).
- `NODE_USE_SYSTEM_CA=1 NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run build`: compilación y TypeScript.
- Lint completo comparado con `99a881c`: la base tiene 21 errores/32 advertencias y el cambio 20 errores/31 advertencias. No se añaden diagnósticos. Los errores restantes pertenecen a código existente.
- Revisión de los componentes reales en un entorno local aislado con datos sintéticos: 320, 375, 390, 768, 1024, 1440 y 1920 px; filtros, búsqueda, paginación, ficha, enlace a Proyectos, gráfico, menú móvil y navegación por teclado. También estados vacío, error, datos faltantes, ceros y acceso restringido.

El entorno de revisión no tiene una sesión de producción ni credenciales de Supabase. Las capturas contienen datos de demostración y no validan los saldos reales. El entorno aislado no forma parte de las rutas de la aplicación; no se añade ninguna ruta pública de demostración ni se omite autenticación.

No se requieren dependencias nuevas, variables nuevas ni migraciones para este cambio. La configuración de producción de Supabase/QuickBooks se conserva.
