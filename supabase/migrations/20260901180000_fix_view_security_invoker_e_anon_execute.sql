-- =============================================================================
-- Duas correcoes de isolamento entre organizacoes, apontadas pelo auditor do
-- Supabase depois de aplicar a cadeia inteira de migrations num banco novo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. vw_hitl_pending_by_age vazava entre organizacoes  (severidade: ERRO)
-- -----------------------------------------------------------------------------
-- A view foi criada sem security_invoker. No Postgres o padrao e executar com
-- o privilegio do DONO da view, e nao de quem consulta, entao o RLS de
-- ai_pending_stage_advances era ignorado: qualquer usuario autenticado veria a
-- contagem de pendencias de TODAS as organizacoes, agrupada por organization_id.
--
-- Num CRM multiempresa isso e vazamento entre clientes. security_invoker faz a
-- view respeitar o RLS de quem consulta, que era a intencao obvia.
ALTER VIEW public.vw_hitl_pending_by_age SET (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 2. Papel anon podia EXECUTAR as funcoes SECURITY DEFINER  (severidade: AVISO)
-- -----------------------------------------------------------------------------
-- O Postgres concede EXECUTE a PUBLIC por padrao, e anon herda de PUBLIC. Como
-- o PostgREST publica funcao do schema public como rota RPC, isso deixava
-- create_api_key, revoke_api_key, merge_contacts, mark_deal_won e companhia
-- alcancaveis da internet so com a chave publicavel.
--
-- Testado antes de mexer: hoje elas recusam com "Not authenticated", ou seja, a
-- checagem interna segura. Mas isso deixa a checagem interna como UNICA linha de
-- defesa, e qualquer funcao nova que esqueca a checagem nasce exposta. O revoke
-- e a segunda camada.
--
-- Feito por varredura, e nao por lista fixa, para nao envelhecer: funcao nova
-- que apareca depois tambem precisa passar por aqui.
DO $anon$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura,
           p.proname,
           p.prorettype = 'trigger'::regtype AS eh_trigger
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef                          -- so SECURITY DEFINER
  LOOP
    -- Tem que ser FROM PUBLIC. Revogar so de anon nao adianta nada: a concessao
    -- e para PUBLIC e anon herda dela, entao o REVOKE de anon e inocuo e a
    -- funcao continua respondendo 200 para quem nao fez login. Foi exatamente
    -- assim que a primeira versao desta migration passou despercebida, ate o
    -- teste de fora mostrar trigger_hitl_alerts devolvendo dados para anon.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.assinatura);

    -- Funcao de gatilho nao precisa de EXECUTE para ninguem: quem a chama e o
    -- proprio gatilho, no contexto do dono da tabela.
    IF NOT f.eh_trigger THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.assinatura);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.assinatura);
    END IF;

    -- Unica excecao: a tela de instalacao e a de login precisam perguntar isso
    -- ANTES de existir usuario, com a chave anonima. Sem isso o /install quebra.
    IF f.proname = 'is_instance_initialized' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', f.assinatura);
    END IF;
  END LOOP;
END
$anon$;
