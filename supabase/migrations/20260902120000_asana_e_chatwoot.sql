-- =============================================================================
-- Guarda a conexao com o Asana e prepara o canal do Chatwoot
-- =============================================================================

-- Token do Asana por organizacao. Fica no banco, e nao em variavel de ambiente,
-- porque cada organizacao conecta o proprio Asana e a chave nunca deve chegar
-- ao navegador: quem fala com o Asana e a rota do servidor.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS asana_token TEXT,
  ADD COLUMN IF NOT EXISTS asana_workspace_id TEXT;

COMMENT ON COLUMN public.organization_settings.asana_token IS
  'Token pessoal do Asana. Vinculado a uma pessoa: se ela sair da empresa, a conexao para. Para uso de time, migrar para OAuth.';
COMMENT ON COLUMN public.organization_settings.asana_workspace_id IS
  'Workspace do Asana a consultar. Vazio usa o primeiro que a conta retornar.';

-- Deduplicacao de mensagem por id externo.
--
-- O Chatwoot reenvia o evento quando nao recebe 200 rapido. Sem esta restricao
-- a mesma mensagem apareceria duas vezes no historico do cliente, e o upsert da
-- rota de webhook nao teria em que se apoiar.
--
-- Parcial, ignorando nulo, porque mensagem criada pelo proprio CRM ainda nao
-- tem id externo no instante do INSERT.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messaging_messages_external_id
  ON public.messaging_messages (external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';
