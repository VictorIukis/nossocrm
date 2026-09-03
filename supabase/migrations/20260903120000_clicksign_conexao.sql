-- Clicksign: avisa o CRM quando o contrato é assinado.
--
-- A dor que isto resolve: hoje alguém precisa entrar no Clicksign para ver se o
-- cliente assinou. O projeto só começa depois da assinatura, então essa
-- conferência manual é o gargalo -- e quando o cliente não assina, ninguém sabe
-- até alguém olhar.
--
-- O caminho é o mesmo do Chatwoot: o Clicksign bate num endereço do CRM, a
-- assinatura do aviso é conferida, e o negócio anda sozinho.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS clicksign_webhook_secret TEXT,
  -- Para onde o negócio vai quando o contrato é assinado. Sem isso configurado,
  -- o CRM ainda registra a assinatura no histórico: é melhor avisar sem mover do
  -- que não avisar.
  ADD COLUMN IF NOT EXISTS clicksign_stage_id UUID,
  ADD COLUMN IF NOT EXISTS clicksign_last_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicksign_last_error TEXT;

COMMENT ON COLUMN public.organization_settings.clicksign_webhook_secret IS
  'Segredo HMAC que o Clicksign gera ao cadastrar o webhook. Sem ele, qualquer um que descobrisse a URL poderia declarar um contrato assinado.';

-- Estado da assinatura no próprio negócio.
--
-- Fica no deal, e não numa tabela separada, porque é isso que se quer ver ao
-- abrir o negócio: assinou ou não, e quando.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS clicksign_document_key TEXT,
  ADD COLUMN IF NOT EXISTS clicksign_status TEXT,
  ADD COLUMN IF NOT EXISTS clicksign_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicksign_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.deals.clicksign_status IS
  'aguardando | assinado | recusado | cancelado. Vem do evento do Clicksign.';

-- Um documento do Clicksign pertence a um negócio só. Parcial porque negócio
-- sem contrato não tem chave, e NULL não conflita.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deals_clicksign_document
  ON public.deals (clicksign_document_key)
  WHERE clicksign_document_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_clicksign_status
  ON public.deals (organization_id, clicksign_status)
  WHERE clicksign_status IS NOT NULL;
