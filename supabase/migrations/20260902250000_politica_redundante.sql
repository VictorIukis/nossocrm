-- Remove uma politica de leitura que nao muda nada.
--
-- `deal_activities` tinha duas politicas de SELECT:
--   deal_activities_org_select   → organization_id = get_user_org_id()
--   Org members view hitl_alerts → type = 'hitl_alert' AND mesma organizacao
--
-- Politicas permissivas se somam. A segunda e um subconjunto estrito da
-- primeira: toda linha que ela libera, a outra ja liberava. Ou seja, ela nunca
-- deu acesso a nada de novo -- so fazia o banco avaliar duas condicoes em toda
-- consulta a essa tabela.
--
-- Removendo, ninguem perde acesso. Conferido comparando as duas condicoes.

DROP POLICY IF EXISTS "Org members view hitl_alerts" ON public.deal_activities;
