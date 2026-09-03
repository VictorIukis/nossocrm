-- Atividade nasce sem dono.
--
-- A tela não envia owner_id, e nada preenchia: toda atividade criada no CRM
-- ficava com owner_id nulo. Três consequências, e só a terceira era visível:
--
--  - filtro por responsável ("minhas atividades") nunca encontra essas linhas;
--  - relatório por pessoa conta errado;
--  - e a agenda do Google não sincroniza, porque o gatilho de envio não sabe
--    para a agenda de QUEM mandar -- foi assim que o problema apareceu.
--
-- O mesmo gatilho que já preenchia a organização passa a preencher o dono.
-- Preencher no banco, e não na tela, cobre todos os caminhos de escrita: a
-- tela, o agente de IA e a API pública.
--
-- Só preenche quando está vazio: quem informa o responsável de propósito
-- (atribuir uma tarefa a outra pessoa) continua mandando.

CREATE OR REPLACE FUNCTION public.set_organization_id_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM profiles
    WHERE id = (SELECT auth.uid());
  END IF;

  -- auth.uid() é nulo quando quem escreve é o servidor com credencial de
  -- serviço (webhook, rotina). Nesse caso não há dono a assumir, e deixar nulo
  -- é mais honesto do que atribuir a alguém arbitrário.
  IF to_jsonb(NEW) ? 'owner_id' AND NEW.owner_id IS NULL THEN
    NEW.owner_id := (SELECT auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_organization_id_from_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_organization_id_from_profile() FROM anon;
REVOKE ALL ON FUNCTION public.set_organization_id_from_profile() FROM authenticated;
