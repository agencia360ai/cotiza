-- 0021: unicidad del token/código del portal de ingenieros. Sin este índice,
-- dos orgs podían reclamar el mismo código en una carrera (check-then-set) y
-- ambos portales quedaban rotos (maybeSingle() con 2 filas → error permanente).

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_cotizador_token
  ON cotiza.organizations (cotizador_token)
  WHERE cotizador_token IS NOT NULL;
