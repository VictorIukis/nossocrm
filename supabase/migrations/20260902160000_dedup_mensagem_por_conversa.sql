-- Corrige a deduplicacao de mensagem por id externo.
--
-- A versao anterior criou um indice unico PARCIAL (com WHERE). O upsert da rota
-- do Chatwoot usa ON CONFLICT (external_id), e o Postgres nao consegue casar um
-- ON CONFLICT simples com um indice parcial: ele exige que a mesma condicao seja
-- repetida na clausula, coisa que o PostgREST nao sabe expressar.
--
-- Resultado medido em producao: a conversa e o contato eram criados e a mensagem
-- nao, silenciosamente. O evento voltava 200 com "erro: desconhecido".
--
-- Passa a ser (conversation_id, external_id), sem WHERE:
--  - sem WHERE, o ON CONFLICT do PostgREST funciona;
--  - com conversation_id junto, dois canais diferentes podem repetir o mesmo id
--    de mensagem do provedor sem colidir um com o outro;
--  - NULL nao conflita com NULL no Postgres, entao mensagem criada aqui dentro,
--    que ainda nao tem id externo, continua podendo ser inserida a vontade.
--    Por isso a rota grava NULL, e nunca string vazia.

DROP INDEX IF EXISTS public.uniq_messaging_messages_external_id;

-- String vazia nao e "sem id": ela colidiria com a proxima mensagem sem id.
UPDATE public.messaging_messages SET external_id = NULL WHERE external_id = '';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_messaging_messages_conversa_externo
  ON public.messaging_messages (conversation_id, external_id);
