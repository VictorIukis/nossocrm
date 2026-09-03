-- Conexão com o Meta Ads, por organização.
--
-- Fica em organization_settings, e não numa tabela nova, porque é configuração
-- da conta e não dado de operação -- é uma linha por organização, igual à chave
-- de IA e ao token do Asana.
--
-- O token nunca volta ao navegador: quem fala com a Meta é o servidor.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS meta_ads_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_ads_account_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_ads_account_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_ads_last_error TEXT;

COMMENT ON COLUMN public.organization_settings.meta_ads_token IS
  'Token de acesso da Meta. Preferir token de usuário de sistema: token pessoal expira e derruba o painel sem avisar.';
COMMENT ON COLUMN public.organization_settings.meta_ads_account_id IS
  'Conta de anúncios no formato act_XXXXXXXXXX.';

-- Cache das métricas.
--
-- A API da Meta tem limite de chamadas por hora e responde em segundos. Sem
-- cache, cada pessoa que abrisse a tela gastaria uma chamada, e num dia de
-- reunião o painel simplesmente pararia de responder -- com erro de cota, que
-- não se parece com o problema que é.
CREATE TABLE IF NOT EXISTS public.ads_insights_cache (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provedor         TEXT NOT NULL DEFAULT 'meta',
  -- Qual recorte: o periodo pedido e o nivel (conta ou campanha).
  chave            TEXT NOT NULL,
  dados            JSONB NOT NULL,
  buscado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provedor, chave)
);

CREATE INDEX IF NOT EXISTS idx_ads_cache_org
  ON public.ads_insights_cache (organization_id, provedor, buscado_em DESC);

ALTER TABLE public.ads_insights_cache ENABLE ROW LEVEL SECURITY;

-- A tela le pela rota do servidor, que aplica o filtro de organizacao. Aqui
-- ninguem le direto: o cache guarda numero de investimento, que nao precisa
-- estar exposto no PostgREST.
DROP POLICY IF EXISTS ads_cache_sem_acesso ON public.ads_insights_cache;
CREATE POLICY ads_cache_sem_acesso
  ON public.ads_insights_cache
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
