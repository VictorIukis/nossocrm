-- =============================================================================
-- Google Calendar: conexão por pessoa e sincronização de mão dupla
-- =============================================================================
--
-- Cada pessoa conecta a PRÓPRIA agenda. Não existe uma conta de serviço da
-- empresa lendo o calendário de todo mundo: além de ser o que o Google
-- recomenda, é o que evita que a saída de uma pessoa derrube a agenda das
-- outras -- foi exatamente o que aconteceu com o token pessoal do Asana.

-- ── conexão de cada pessoa ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_calendar_connections (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  provider           TEXT NOT NULL DEFAULT 'google',
  account_email      TEXT,

  -- Guardados aqui porque o servidor precisa deles para agir em nome da pessoa
  -- mesmo com ela offline (um evento criado no Google as 3h da manhã tem que
  -- entrar no CRM). Nenhuma rota devolve estes campos ao navegador.
  access_token       TEXT,
  refresh_token      TEXT,
  token_expires_at   TIMESTAMPTZ,
  scope              TEXT,

  calendar_id        TEXT NOT NULL DEFAULT 'primary',

  -- Marcador de sincronização incremental do Google: com ele pedimos "o que
  -- mudou desde a última vez" em vez de reler a agenda inteira.
  sync_token         TEXT,

  -- Canal de aviso do Google (push). Ele expira, entao guardamos o vencimento
  -- para poder renovar antes de parar de receber.
  channel_id         TEXT,
  channel_resource_id TEXT,
  channel_expires_at TIMESTAMPTZ,
  -- Segredo que NOS definimos ao abrir o canal. O Google devolve em cada aviso;
  -- e assim que sabemos que o aviso veio dele, e nao de alguem fingindo ser ele.
  channel_token      TEXT,

  last_synced_at     TIMESTAMPTZ,
  last_error         TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_calendar_connections IS
  'Conexão do Google Calendar de cada pessoa. Os tokens nunca voltam ao navegador.';

CREATE INDEX IF NOT EXISTS idx_calendar_conn_org
  ON public.user_calendar_connections (organization_id);
CREATE INDEX IF NOT EXISTS idx_calendar_conn_channel
  ON public.user_calendar_connections (channel_id) WHERE channel_id IS NOT NULL;

ALTER TABLE public.user_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Ninguem le esta tabela pelo navegador, nem a propria linha: ela contem
-- tokens. Quem precisa dela e o servidor, com a credencial de servico, que
-- ignora RLS. O estado da conexao chega a tela por uma rota que devolve apenas
-- "conectado: sim/nao" e o e-mail da conta.
CREATE POLICY calendar_conn_sem_acesso_direto
  ON public.user_calendar_connections
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- ── atividades viram eventos ────────────────────────────────────────────────
--
-- `date` ja existia e passa a ser o INICIO. Faltava o fim: sem ele, todo evento
-- exportado para o Google viraria um compromisso de duracao arbitraria.
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS ends_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS all_day            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location           TEXT,
  ADD COLUMN IF NOT EXISTS google_event_id    TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
  -- Versao do evento no Google. Serve para nao devolver ao Google uma mudanca
  -- que veio dele: sem isso, cada lado reagiria ao outro em laco infinito.
  ADD COLUMN IF NOT EXISTS google_etag        TEXT,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.activities.google_etag IS
  'Versão do evento no Google na última vez que os dois lados concordaram. Quebra o laço de eco entre CRM e Google.';

-- Um evento do Google aparece uma vez so por agenda. O indice e parcial porque
-- atividade criada no CRM ainda nao tem id do Google, e NULL nao conflita.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_activities_google_event
  ON public.activities (google_calendar_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_owner_date
  ON public.activities (owner_id, date);

-- ── updated_at automatico ───────────────────────────────────────────────────
--
-- A resolucao de conflito compara quem mudou por ultimo. Sem esta marca, nao ha
-- como decidir entre uma edicao no CRM e uma no Google.
CREATE OR REPLACE FUNCTION public.marca_atualizacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.marca_atualizacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_activities_updated_at ON public.activities;
CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.marca_atualizacao();

DROP TRIGGER IF EXISTS trg_calendar_conn_updated_at ON public.user_calendar_connections;
CREATE TRIGGER trg_calendar_conn_updated_at
  BEFORE UPDATE ON public.user_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.marca_atualizacao();
