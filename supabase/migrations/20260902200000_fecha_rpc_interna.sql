-- =============================================================================
-- Fecha funcoes internas que estavam abertas na API pública
-- =============================================================================
--
-- O PostgREST expoe como endpoint REST toda funcao do schema `public` que o
-- papel `authenticated` possa executar. Isso incluia funcoes que nunca deveriam
-- ser chamadas de fora:
--
--  - gatilhos (handle_new_user, notify_deal_stage_changed, ...), que so fazem
--    sentido dentro de um INSERT/UPDATE;
--  - ajudantes de chave de API (_api_key_make_token, _api_key_sha256_hex);
--  - cleanup_rate_limits, que qualquer pessoa logada podia chamar para APAGAR o
--    estado de limitacao de uso -- ou seja, desligar a propria protecao contra
--    abuso;
--  - custom_access_token_hook, que monta as claims do token de sessao;
--  - update_message_status_if_newer, que so os webhooks deveriam tocar.
--
-- Todas sao SECURITY DEFINER, entao rodam com privilegio elevado.
--
-- O que NAO entra nesta lista, de proposito:
--  - get_user_org_id: aparece em 28 politicas de RLS. Revogar o EXECUTE dela
--    quebraria o acesso a praticamente todas as tabelas.
--  - is_instance_initialized: a tela de login precisa dela antes de haver login.
--  - validate_api_key: a API publica a chama com a chave anonima, de proposito.
--  - log_audit_event, mark_conversation_read, merge_contacts e as de leitura:
--    sao chamadas pelo proprio app.
--
-- REVOKE de PUBLIC primeiro: sem isso, o privilegio herdado por PUBLIC continua
-- valendo mesmo depois de revogar de anon e authenticated.

DO $$
DECLARE
  assinatura text;
BEGIN
  FOR assinatura IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         '_api_key_make_token',
         '_api_key_sha256_hex',
         'cleanup_rate_limits',
         'create_instance_flags_for_org',
         'custom_access_token_hook',
         'handle_new_organization',
         'handle_new_user',
         'handle_user_email_update',
         'notify_deal_stage_changed',
         'set_organization_id_from_profile',
         'trigger_hitl_alerts',
         'update_board_ai_config_updated_at',
         'update_conversation_on_message',
         'update_message_status_if_newer'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', assinatura);
    -- service_role continua podendo: e por ele que webhooks e rotinas rodam.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', assinatura);
  END LOOP;
END $$;

-- Fixa o search_path das funcoes SECURITY DEFINER.
--
-- Sem search_path fixo, quem controla o search_path da sessao pode fazer a
-- funcao chamar uma tabela ou funcao falsa de outro schema -- e ela roda com
-- privilegio de quem a criou.

DO $$
DECLARE
  assinatura text;
BEGIN
  FOR assinatura IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', assinatura);
  END LOOP;
END $$;
