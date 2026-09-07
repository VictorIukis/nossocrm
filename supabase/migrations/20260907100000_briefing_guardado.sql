-- Briefing do negócio guardado, com idade.
--
-- Ele era gerado e jogado fora: cada abertura da gaveta chamava a IA de novo,
-- pagava de novo e fazia a pessoa esperar de novo pelo mesmo texto. Foi por
-- isso que a rotina das 8h ficou desagendada entre 03 e 07/set -- adiantar não
-- adiantava, porque não havia onde guardar.
--
-- Um por negócio: briefing é retrato do estado atual, não histórico.

CREATE TABLE IF NOT EXISTS public.deal_briefings (
  deal_id          UUID PRIMARY KEY REFERENCES public.deals(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conteudo         JSONB NOT NULL,
  -- Até quando o briefing sabe das coisas. Comparado com o estado atual do
  -- negócio, é o que permite dizer "ficou para trás" em vez de apresentar
  -- texto velho como atual -- que é o jeito de um briefing guardado ficar pior
  -- do que nenhum.
  base_em          TIMESTAMPTZ NOT NULL,
  modelo           TEXT,
  tokens           INT,
  gerado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  gerado_por       TEXT NOT NULL DEFAULT 'pessoa'
);

CREATE INDEX IF NOT EXISTS idx_briefings_org ON public.deal_briefings (organization_id, gerado_em DESC);

ALTER TABLE public.deal_briefings ENABLE ROW LEVEL SECURITY;

-- Leitura pela organização (a gaveta lê pelo navegador). Escrita só pela
-- credencial de serviço: quem escreve é a rota que acabou de gastar IA, e
-- deixar o navegador escrever permitiria gravar briefing que a IA nunca fez.
DROP POLICY IF EXISTS briefings_org_select ON public.deal_briefings;
CREATE POLICY briefings_org_select ON public.deal_briefings
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

-- Até quando o negócio andou.
--
-- A conversa se liga ao negócio pelo CONTATO: messaging_conversations não tem
-- deal_id. Descobri escrevendo esta função com a coluna que eu imaginava.
CREATE OR REPLACE FUNCTION public.negocio_mexido_em(p_deal UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    COALESCE((SELECT d.updated_at FROM public.deals d WHERE d.id = p_deal), 'epoch'::timestamptz),
    COALESCE((SELECT max(c.last_message_at)
                FROM public.messaging_conversations c
                JOIN public.deals d2 ON d2.id = p_deal
               WHERE c.contact_id = d2.contact_id), 'epoch'::timestamptz),
    COALESCE((SELECT max(a.created_at) FROM public.deal_activities a
               WHERE a.deal_id = p_deal), 'epoch'::timestamptz),
    COALESCE((SELECT max(t.date) FROM public.activities t
               WHERE t.deal_id = p_deal AND t.deleted_at IS NULL), 'epoch'::timestamptz)
  );
$$;

REVOKE ALL ON FUNCTION public.negocio_mexido_em(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.negocio_mexido_em(UUID) TO service_role;
