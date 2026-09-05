-- Leads do RD Station + primeiro contato automático no WhatsApp.
--
-- Estado no banco (as três migrations foram aplicadas pelo painel e estão
-- resumidas aqui para o repositório conseguir recriar o banco):
--
--   rd_conversoes            o que o RD mandou, cru, antes de interpretar
--   primeiro_contato_fila    quem falar, com o quê e a partir de que hora
--   segredos_internos        segredo que o pg_cron usa para chamar o CRM
--   reservar_primeiro_contato(limite, max_tentativas)
--   cron job 'fila-primeiro-contato' de minuto em minuto
--
-- O desenho separa RECEBER de FALAR: receber é barato e não pode falhar; falar
-- é o que quebra, repete e chega na hora errada.

CREATE TABLE IF NOT EXISTS public.rd_conversoes (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fonte_id         UUID REFERENCES public.integration_inbound_sources(id) ON DELETE SET NULL,
  conversao_id     TEXT,
  email            TEXT,
  telefone         TEXT,
  identificador    TEXT,
  corpo            JSONB NOT NULL,
  contact_id       UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id          UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_rd_conversao
  ON public.rd_conversoes (organization_id, conversao_id)
  WHERE conversao_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rd_conversoes_org ON public.rd_conversoes (organization_id, criado_em DESC);

ALTER TABLE public.rd_conversoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rd_conversoes_sem_acesso ON public.rd_conversoes;
CREATE POLICY rd_conversoes_sem_acesso ON public.rd_conversoes
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.primeiro_contato_fila (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id           UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  conversao_id      BIGINT REFERENCES public.rd_conversoes(id) ON DELETE CASCADE,
  telefone          TEXT NOT NULL,
  variaveis         JSONB NOT NULL DEFAULT '{}'::jsonb,
  enviar_em         TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'aguardando'
                      CHECK (status IN ('aguardando','enviando','enviado','falhou','cancelado')),
  tentativas        INT NOT NULL DEFAULT 0,
  ultimo_erro       TEXT,
  enviado_em        TIMESTAMPTZ,
  conversa_chatwoot TEXT,
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fila_a_enviar
  ON public.primeiro_contato_fila (enviar_em) WHERE status = 'aguardando';

-- Um contato só recebe uma abertura. Quem converte duas vezes seguidas não pode
-- receber duas mensagens.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fila_por_contato
  ON public.primeiro_contato_fila (organization_id, contact_id)
  WHERE status IN ('aguardando','enviando');

ALTER TABLE public.primeiro_contato_fila ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fila_sem_acesso ON public.primeiro_contato_fila;
CREATE POLICY fila_sem_acesso ON public.primeiro_contato_fila
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS rd_primeiro_contato_ativo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rd_atraso_minutos INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS rd_modelo_nome TEXT,
  ADD COLUMN IF NOT EXISTS rd_modelo_texto TEXT,
  ADD COLUMN IF NOT EXISTS rd_modelo_idioma TEXT NOT NULL DEFAULT 'pt_BR',
  ADD COLUMN IF NOT EXISTS rd_modelo_categoria TEXT NOT NULL DEFAULT 'marketing',
  ADD COLUMN IF NOT EXISTS rd_canal_id UUID REFERENCES public.messaging_channels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rd_ultimo_erro TEXT;

CREATE TABLE IF NOT EXISTS public.segredos_internos (
  nome       TEXT PRIMARY KEY,
  valor      TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.segredos_internos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS segredos_sem_acesso ON public.segredos_internos;
CREATE POLICY segredos_sem_acesso ON public.segredos_internos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.segredos_internos FROM anon, authenticated;

INSERT INTO public.segredos_internos (nome, valor)
VALUES ('fila_primeiro_contato', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (nome) DO NOTHING;

-- Reserva o lote sem que duas execuções peguem a mesma linha.
CREATE OR REPLACE FUNCTION public.reservar_primeiro_contato(
  limite INT DEFAULT 10,
  max_tentativas INT DEFAULT 3
)
RETURNS TABLE (
  id BIGINT, organization_id UUID, contact_id UUID, deal_id UUID,
  telefone TEXT, variaveis JSONB, tentativas INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.primeiro_contato_fila f
     SET status = 'enviando', tentativas = COALESCE(f.tentativas, 0) + 1
   WHERE f.id IN (
     SELECT p.id FROM public.primeiro_contato_fila p
      WHERE p.status = 'aguardando'
        AND p.enviar_em <= now()
        AND COALESCE(p.tentativas, 0) < max_tentativas
      ORDER BY p.enviar_em
      FOR UPDATE SKIP LOCKED
      LIMIT limite
   )
  RETURNING f.id, f.organization_id, f.contact_id, f.deal_id, f.telefone, f.variaveis, f.tentativas;
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_primeiro_contato(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_primeiro_contato(INT, INT) TO service_role;

-- De minuto em minuto: o agendador da Vercel não serve, no plano atual roda
-- uma vez por dia.
SELECT cron.unschedule('fila-primeiro-contato')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fila-primeiro-contato');

SELECT cron.schedule(
  'fila-primeiro-contato',
  '* * * * *',
  $cron$
  SELECT net.http_get(
    url := 'https://nossocrm-bn4u.vercel.app/api/cron/primeiro-contato',
    headers := jsonb_build_object(
      'authorization',
      'Bearer ' || (SELECT valor FROM public.segredos_internos WHERE nome = 'fila_primeiro_contato')
    ),
    timeout_milliseconds := 55000
  );
  $cron$
);
