-- Tira a identidade do usuario de dentro do laco.
--
-- A politica escrevia `auth.uid()` direto na condicao. Escrito assim, o Postgres
-- reavalia a funcao para CADA linha examinada; envolvendo em um SELECT, ele
-- calcula uma vez e reaproveita. Com poucas linhas nao se nota; com dezenas de
-- milhares, e a diferenca entre a tela abrir e a tela travar.
--
-- A regra de acesso continua exatamente a mesma: so quem e da organizacao le.

DROP POLICY IF EXISTS "Org members can read own pending evaluations" ON public.ai_pending_evaluations;

CREATE POLICY "Org members can read own pending evaluations"
  ON public.ai_pending_evaluations
  FOR SELECT
  USING (
    organization_id IN (
      SELECT profiles.organization_id
        FROM profiles
       WHERE profiles.id = (SELECT auth.uid())
    )
  );
