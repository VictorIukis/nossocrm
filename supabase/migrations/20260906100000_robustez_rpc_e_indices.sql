-- Fecha duas funções de serviço e indexa as chaves estrangeiras que importam.
--
-- Vem da leitura dos relatórios do Supabase (security e performance) em
-- 06/set/2026, conferindo cada aviso contra o código antes de mexer.

-- ---------------------------------------------------------------------------
-- 1. Funções de serviço abertas a qualquer pessoa logada
-- ---------------------------------------------------------------------------
--
-- `validate_api_key(token)` recebe um token da API pública e devolve a
-- organização dele. Aberta, permitia testar tokens de dentro de qualquer conta
-- logada. O CRM já a chama com credencial de serviço, então fechar não quebra.
--
-- `expire_old_pending_advances()` é trabalho de rotina, chamado pelo pg_cron,
-- que roda como dono do banco e não passa por estes papéis. Nenhum caminho do
-- aplicativo chama com sessão de usuário: conferido antes de mexer.

REVOKE ALL ON FUNCTION public.validate_api_key(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_api_key(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.expire_old_pending_advances() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_old_pending_advances() TO service_role;

-- Única função de gatilho que ainda estava sem search_path fixo. Sem isso, quem
-- conseguir criar um schema no caminho de busca faz a função chamar outra coisa
-- no lugar do que ela pensa que chama.
CREATE OR REPLACE FUNCTION public.update_board_ai_config_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Chaves estrangeiras sem índice
-- ---------------------------------------------------------------------------
--
-- O relatório aponta 77. Criar as 77 seria ritual: as tabelas de configuração
-- têm 5 quadros, 23 etapas e 3 pessoas, e nesse tamanho varredura completa é
-- mais rápida que índice, que só gasta escrita e engorda backup.
--
-- Ficam as que atendem a um dos dois critérios:
--
--  1. a tabela cresce com o uso (um registro por lead, por mensagem, por
--     chamada de IA), então o tamanho de hoje não é o de dezembro;
--  2. a coluna aponta para pai apagado na operação normal (contato, negócio,
--     mensagem). Sem índice, apagar UM contato varre a tabela filha inteira
--     para conferir a cascata, e isso piora sozinho, sem ninguém mudar nada.

CREATE INDEX IF NOT EXISTS idx_rd_conversoes_contact ON public.rd_conversoes (contact_id);
CREATE INDEX IF NOT EXISTS idx_rd_conversoes_deal ON public.rd_conversoes (deal_id);
CREATE INDEX IF NOT EXISTS idx_rd_conversoes_fonte ON public.rd_conversoes (fonte_id);

CREATE INDEX IF NOT EXISTS idx_fila_contato ON public.primeiro_contato_fila (contact_id);
CREATE INDEX IF NOT EXISTS idx_fila_deal ON public.primeiro_contato_fila (deal_id);
CREATE INDEX IF NOT EXISTS idx_fila_conversao ON public.primeiro_contato_fila (conversao_id);
CREATE INDEX IF NOT EXISTS idx_fila_regra ON public.primeiro_contato_fila (regra_id);

CREATE INDEX IF NOT EXISTS idx_msg_sender_user ON public.messaging_messages (sender_user_id);

CREATE INDEX IF NOT EXISTS idx_ai_log_message ON public.ai_conversation_log (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_log_stage ON public.ai_conversation_log (stage_id);
CREATE INDEX IF NOT EXISTS idx_ai_pend_aval_deal ON public.ai_pending_evaluations (deal_id);
CREATE INDEX IF NOT EXISTS idx_ai_pend_aval_org ON public.ai_pending_evaluations (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_pend_adv_conversa ON public.ai_pending_stage_advances (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_pend_adv_etapa_atual ON public.ai_pending_stage_advances (current_stage_id);
CREATE INDEX IF NOT EXISTS idx_ai_pend_adv_etapa_sugerida ON public.ai_pending_stage_advances (suggested_stage_id);
CREATE INDEX IF NOT EXISTS idx_ai_pend_adv_resolvido_por ON public.ai_pending_stage_advances (resolved_by);
CREATE INDEX IF NOT EXISTS idx_ai_decisoes_contato ON public.ai_decisions (contact_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisoes_deal ON public.ai_decisions (deal_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisoes_usuario ON public.ai_decisions (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_audio_contato ON public.ai_audio_notes (contact_id);
CREATE INDEX IF NOT EXISTS idx_ai_audio_deal ON public.ai_audio_notes (deal_id);
CREATE INDEX IF NOT EXISTS idx_ai_audio_atividade ON public.ai_audio_notes (activity_created_id);

CREATE INDEX IF NOT EXISTS idx_audit_org ON public.audit_logs (organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON public.audit_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_deal_items_org ON public.deal_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_deal_items_produto ON public.deal_items (product_id);
