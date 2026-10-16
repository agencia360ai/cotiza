-- 0051: Horas de técnicos como parte del gasto de cada proyecto.
--
-- La pantalla del proyecto en QuickBooks suma al costo las horas cargadas en
-- Time Activity × la tarifa de costo de cada empleado ("Hourly time cost").
-- Eso no es un asiento contable: no está en el Estado de Resultados, que es de
-- donde la app saca `cost`. Por eso el margen de la app salía más alto que el
-- de QuickBooks en cada proyecto con horas (ACESCO: 39% contra 22.7%).
--
-- `cost` sigue siendo SOLO lo contable — así un gasto contable negativo (el
-- ITBMS acreditado a gasto) se sigue detectando. Las horas van aparte y la app
-- muestra la suma.
--
-- jsonb y no columnas sueltas porque se leen y se escriben siempre juntas:
--   { "costo": 3640, "horas": 608, "sinTarifa": 88,
--     "meses":    [{ "month": "2026-05-01", "costo": 1400 }, …],
--     "tecnicos": [{ "nombre": "Luis Fenton", "horas": 332, "costo": 2016 }, …] }
--
-- NULL = sin horas cargadas (o todavía no se sincronizó). Hasta correr esto,
-- la app funciona igual que antes: el gasto no incluye horas.
--
-- La tabla ya tiene RLS; una columna nueva queda cubierta por las mismas
-- políticas.

alter table cotiza.qbo_project_state
  add column if not exists horas_tecnicos jsonb;

comment on column cotiza.qbo_project_state.horas_tecnicos is
  'Horas de técnicos del proyecto (QuickBooks Time Activity × tarifa de costo). Se suman a cost para el gasto que se muestra.';
