-- Pegar um lote da fila de avaliação, sem que duas execuções peguem o mesmo.
--
-- A rotina tentava fazer isso com UPDATE + ORDER BY + LIMIT pela API. O
-- Postgres não aceita ORDER BY em UPDATE, e o erro que chegava era enganoso:
-- "column ai_pending_evaluations.created_at does not exist" -- uma coluna que
-- existe. Ficou meia hora parecendo problema de schema.
--
-- Aqui é o jeito certo para fila de trabalho: FOR UPDATE SKIP LOCKED. Quem
-- chega depois pula as linhas já reservadas em vez de esperar ou repetir
-- trabalho.

CREATE OR REPLACE FUNCTION public.reivindicar_avaliacoes_pendentes(
  limite INT DEFAULT 10,
  max_tentativas INT DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  conversation_id UUID,
  deal_id UUID,
  message_id UUID,
  message_text TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_pending_evaluations a
     SET status = 'processing',
         attempts = COALESCE(a.attempts, 0) + 1
   WHERE a.id IN (
     SELECT p.id
       FROM public.ai_pending_evaluations p
      WHERE p.status = 'pending'
        AND COALESCE(p.attempts, 0) < max_tentativas
      ORDER BY p.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT limite
   )
  RETURNING a.id, a.organization_id, a.conversation_id, a.deal_id, a.message_id, a.message_text;
END;
$$;

-- Só o servidor chama isto, pela rotina agendada. Ninguém do navegador precisa.
REVOKE ALL ON FUNCTION public.reivindicar_avaliacoes_pendentes(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reivindicar_avaliacoes_pendentes(INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.reivindicar_avaliacoes_pendentes(INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reivindicar_avaliacoes_pendentes(INT, INT) TO service_role;
