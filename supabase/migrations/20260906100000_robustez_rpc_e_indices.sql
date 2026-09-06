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

-- ---------------------------------------------------------------------------
-- 3. O que o banco sabe sobre as próprias rotinas
-- ---------------------------------------------------------------------------
--
-- As tabelas do pg_cron ficam no schema `cron`, que a credencial do servidor
-- não lê. Sem isto, a tela de diagnóstico não responde a pergunta mais básica:
-- "a rotina que manda as mensagens rodou?".
--
-- Devolve resumo e não histórico: quem olha quer saber se rodou, quando, e se
-- falhou nas últimas 24 horas. O código HTTP entra junto porque, para o
-- pg_cron, "succeeded" significa que a chamada saiu -- não que o outro lado
-- aceitou. Cem execuções bem-sucedidas devolvendo 500 continuam sendo cem
-- mensagens que não saíram.

CREATE OR REPLACE FUNCTION public.diagnostico_rotinas()
RETURNS TABLE (
  nome TEXT, agendamento TEXT, ativa BOOLEAN,
  ultima_execucao TIMESTAMPTZ, ultimo_status TEXT, falhas_24h BIGINT,
  ultimo_http INT, ultimo_http_em TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, cron, net, pg_temp
AS $$
  SELECT
    j.jobname::TEXT, j.schedule::TEXT, j.active,
    (SELECT max(d.end_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid),
    (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid
      ORDER BY d.end_time DESC NULLS LAST LIMIT 1)::TEXT,
    (SELECT count(*) FROM cron.job_run_details d
      WHERE d.jobid = j.jobid AND d.status <> 'succeeded'
        AND d.end_time > now() - interval '24 hours'),
    CASE WHEN j.command LIKE '%net.http%' THEN
      (SELECT r.status_code FROM net._http_response r ORDER BY r.created DESC LIMIT 1) END,
    CASE WHEN j.command LIKE '%net.http%' THEN
      (SELECT r.created FROM net._http_response r ORDER BY r.created DESC LIMIT 1) END
  FROM cron.job j
  ORDER BY j.jobname;
$$;

REVOKE ALL ON FUNCTION public.diagnostico_rotinas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.diagnostico_rotinas() TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Freios do disparo automático: horário e teto diário
-- ---------------------------------------------------------------------------
--
-- O primeiro contato sai por conta própria, minutos depois do cadastro.
-- Faltavam dois freios, os dois com consequência real:
--
--  1. HORÁRIO. Sem janela, quem preenche o formulário às 3 da manhã é acordado
--     às 3 da manhã. No WhatsApp oficial isso custa alcance: bloqueio e
--     "marcar como spam" derrubam a qualidade do número, e número com
--     qualidade baixa entrega menos para todo mundo, inclusive para quem está
--     esperando resposta.
--
--  2. TETO DIÁRIO. Enxurrada de leads, ou o endereço do webhook vazando, vira
--     enxurrada de mensagem de modelo saindo do número da empresa. Volume
--     anormal é sinal ruim para a Meta, e o número pode ser limitado.
--
-- Padrões conservadores: 9h às 20h e 100 por dia. Lead fora do horário não
-- perde a mensagem, ela é remarcada para a abertura seguinte.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS rd_janela_inicio INT NOT NULL DEFAULT 9
    CHECK (rd_janela_inicio BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS rd_janela_fim INT NOT NULL DEFAULT 20
    CHECK (rd_janela_fim BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS rd_limite_diario INT NOT NULL DEFAULT 100
    CHECK (rd_limite_diario BETWEEN 1 AND 10000);

-- Quantos já saíram hoje, no fuso da organização.
--
-- A conta fica no banco porque a virada do dia depende do fuso, e porque a
-- rotina roda a cada minuto: fazer isso em memória exigiria carregar a fila
-- inteira toda vez.
CREATE OR REPLACE FUNCTION public.primeiros_contatos_de_hoje(org UUID)
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)
    FROM public.primeiro_contato_fila f
   WHERE f.organization_id = org
     AND f.status = 'enviado'
     AND f.enviado_em >= date_trunc(
           'day',
           now() AT TIME ZONE COALESCE(
             (SELECT s.timezone FROM public.organization_settings s
               WHERE s.organization_id = org), 'America/Sao_Paulo')
         ) AT TIME ZONE COALESCE(
             (SELECT s.timezone FROM public.organization_settings s
               WHERE s.organization_id = org), 'America/Sao_Paulo');
$$;

REVOKE ALL ON FUNCTION public.primeiros_contatos_de_hoje(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.primeiros_contatos_de_hoje(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Freio de vazão nos endereços públicos
-- ---------------------------------------------------------------------------
--
-- O webhook do RD e o do Clicksign são públicos por natureza. O segredo impede
-- que um estranho invente eventos, mas não impede volume -- e o endereço do RD
-- carrega o segredo na própria URL, porque é o que o RD permite. Endereço
-- vazado num print, num log de proxy ou colado no lugar errado significa
-- contato e negócio criados sem limite, e agora também mensagem saindo do
-- WhatsApp oficial.
--
-- A tabela `rate_limits` existia desde o início e nenhuma rota usava.

CREATE INDEX IF NOT EXISTS idx_rate_limits_janela
  ON public.rate_limits (endpoint, identifier, created_at DESC);

CREATE OR REPLACE FUNCTION public.consumir_limite(
  p_endpoint TEXT, p_identificador TEXT, p_teto INT, p_janela_segundos INT
)
RETURNS TABLE (permitido BOOLEAN, usados INT, espera_segundos INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_desde TIMESTAMPTZ := now() - make_interval(secs => p_janela_segundos);
  v_usados INT;
  v_mais_antiga TIMESTAMPTZ;
BEGIN
  SELECT count(*), min(r.created_at) INTO v_usados, v_mais_antiga
    FROM public.rate_limits r
   WHERE r.endpoint = p_endpoint AND r.identifier = p_identificador
     AND r.created_at > v_desde;

  IF v_usados >= p_teto THEN
    -- Devolve quanto falta, para a rota responder 429 com Retry-After: é o que
    -- faz um cliente bem comportado parar em vez de insistir.
    RETURN QUERY SELECT false, v_usados,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM
        (v_mais_antiga + make_interval(secs => p_janela_segundos)) - now()))::INT);
    RETURN;
  END IF;

  INSERT INTO public.rate_limits (identifier, endpoint) VALUES (p_identificador, p_endpoint);

  -- Faxina oportunista: sem isso a tabela cresce para sempre. Uma em cada cem
  -- chamadas paga a limpeza, o que evita mais uma rotina agendada.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE created_at < now() - interval '1 day';
  END IF;

  RETURN QUERY SELECT true, v_usados + 1, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consumir_limite(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumir_limite(TEXT, TEXT, INT, INT) TO service_role;
