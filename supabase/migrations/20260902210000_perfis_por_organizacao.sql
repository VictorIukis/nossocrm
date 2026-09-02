-- Fecha a leitura de perfis por organizacao.
--
-- A politica `profiles_select` usava USING (true): qualquer pessoa autenticada
-- lia TODOS os perfis do banco -- nome, e-mail, papel e avatar de todo mundo,
-- de qualquer organizacao.
--
-- Hoje existe uma organizacao so, entao na pratica e o time se vendo, que e o
-- esperado. O problema aparece no dia em que um cliente entrar na mesma
-- instalacao: sem esta correcao, ele veria a equipe inteira das outras contas.
-- E o tipo de falha que so aparece depois de ja ter vazado.
--
-- A condicao mantem dois casos de proposito:
--  - o proprio perfil, sempre. Sem isso, alguem ainda sem organizacao definida
--    nao conseguiria carregar o proprio cadastro e ficaria travado no login.
--  - perfis da mesma organizacao, que e o que as telas de time, de responsavel
--    por negocio e de atribuicao de conversa precisam.

DROP POLICY IF EXISTS profiles_select ON public.profiles;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR organization_id = public.get_user_org_id()
  );
