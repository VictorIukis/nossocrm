-- Fila de envio para o Google.
--
-- As atividades sao gravadas por varios caminhos: a tela (direto do navegador),
-- o agente de IA, a API publica. Pendurar o envio em um deles deixaria os outros
-- de fora, e o sintoma seria "meu compromisso as vezes vai para a agenda e as
-- vezes nao" -- o pior tipo de bug para diagnosticar.
--
-- Um gatilho na tabela pega TODOS os caminhos, porque o que ele observa e a
-- gravacao em si.
--
-- A fila so recebe atividade de quem tem agenda conectada. Sem esse filtro, ela
-- cresceria com o trabalho de todo mundo que nunca ligou o Google.

CREATE TABLE IF NOT EXISTS public.calendar_sync_queue (
  id           BIGSERIAL PRIMARY KEY,
  activity_id  UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tentativas   INT NOT NULL DEFAULT 0,
  ultimo_erro  TEXT,
  -- Uma atividade pendente aparece uma vez so: se ela mudar tres vezes antes de
  -- ser enviada, o que interessa e o estado final, nao os tres passos.
  UNIQUE (activity_id)
);

CREATE INDEX IF NOT EXISTS idx_fila_calendario_dono
  ON public.calendar_sync_queue (owner_id, criado_em);

ALTER TABLE public.calendar_sync_queue ENABLE ROW LEVEL SECURITY;

-- Fila e assunto de servidor. Nenhuma tela le nem escreve nela.
DROP POLICY IF EXISTS fila_calendario_sem_acesso ON public.calendar_sync_queue;
CREATE POLICY fila_calendario_sem_acesso
  ON public.calendar_sync_queue
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.enfileirar_para_google()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  dono UUID;
BEGIN
  dono := COALESCE(NEW.owner_id, OLD.owner_id);
  IF dono IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Só entra na fila quem tem agenda ligada.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_calendar_connections c
     WHERE c.user_id = dono AND c.refresh_token IS NOT NULL
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Mudança que veio do próprio Google não volta para ele.
  --
  -- Quando aplicamos um evento vindo de lá, gravamos o etag na mesma operação.
  -- Se o etag mudou nesta gravação, ela é reflexo do Google e reenviar criaria
  -- o laço que a sincronização inteira existe para evitar.
  IF TG_OP = 'UPDATE'
     AND NEW.google_etag IS DISTINCT FROM OLD.google_etag
     AND NEW.google_etag IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.calendar_sync_queue (activity_id, owner_id)
  VALUES (COALESCE(NEW.id, OLD.id), dono)
  ON CONFLICT (activity_id) DO UPDATE
    SET criado_em = now(), tentativas = 0, ultimo_erro = NULL;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.enfileirar_para_google() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enfileirar_para_google() FROM anon;
REVOKE ALL ON FUNCTION public.enfileirar_para_google() FROM authenticated;

DROP TRIGGER IF EXISTS trg_activities_para_google ON public.activities;
CREATE TRIGGER trg_activities_para_google
  AFTER INSERT OR UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.enfileirar_para_google();
