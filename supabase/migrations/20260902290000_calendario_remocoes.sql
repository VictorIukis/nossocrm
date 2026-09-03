-- Fila de remoção no Google.
--
-- Apagar atividade no CRM remove a linha de vez (não é arquivamento). Quando
-- isso acontece, o id do evento no Google vai embora junto -- e o compromisso
-- ficaria na agenda da pessoa para sempre, apitando um lembrete de uma reunião
-- que não existe mais.
--
-- Um gatilho ANTES da remoção guarda o que é preciso para apagar lá.

CREATE TABLE IF NOT EXISTS public.calendar_deletions (
  id                 BIGSERIAL PRIMARY KEY,
  owner_id           UUID NOT NULL,
  google_event_id    TEXT NOT NULL,
  google_calendar_id TEXT NOT NULL,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  tentativas         INT NOT NULL DEFAULT 0,
  ultimo_erro        TEXT
);

CREATE INDEX IF NOT EXISTS idx_remocoes_dono ON public.calendar_deletions (owner_id, criado_em);

ALTER TABLE public.calendar_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remocoes_sem_acesso ON public.calendar_deletions;
CREATE POLICY remocoes_sem_acesso
  ON public.calendar_deletions
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.registrar_remocao_no_google()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.google_event_id IS NOT NULL
     AND OLD.google_calendar_id IS NOT NULL
     AND OLD.owner_id IS NOT NULL THEN
    INSERT INTO public.calendar_deletions (owner_id, google_event_id, google_calendar_id)
    VALUES (OLD.owner_id, OLD.google_event_id, OLD.google_calendar_id);
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_remocao_no_google() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_remocao_no_google() FROM anon;
REVOKE ALL ON FUNCTION public.registrar_remocao_no_google() FROM authenticated;

DROP TRIGGER IF EXISTS trg_activities_remocao_google ON public.activities;
CREATE TRIGGER trg_activities_remocao_google
  BEFORE DELETE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.registrar_remocao_no_google();
