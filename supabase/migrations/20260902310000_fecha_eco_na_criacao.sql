-- Fecha o laço que sobrou na CRIAÇÃO.
--
-- A trava contra eco só olhava UPDATE. Mas o evento que vem do Google entra
-- aqui como INSERT, já com google_event_id preenchido -- e caía direto na fila
-- de envio. Ou seja: tudo que era lido do Google era imediatamente devolvido
-- para ele.
--
-- Descoberto porque o Google recusou com "Attempt made to modify 'birthday'
-- event": aniversários de contatos foram importados e o CRM tentou reescrevê-los
-- lá. Sem essa recusa, o laço teria passado despercebido, gastando cota e
-- reescrevendo eventos sem necessidade.
--
-- Regra: linha que JÁ NASCE com id do Google veio de lá. Não há o que enviar.

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

  IF NOT EXISTS (
    SELECT 1 FROM public.user_calendar_connections c
     WHERE c.user_id = dono AND c.refresh_token IS NOT NULL
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Nasceu com id do Google: veio de lá, não volta para lá.
  IF TG_OP = 'INSERT' AND NEW.google_event_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Mudança cujo etag mudou é reflexo do Google, não edição de gente daqui.
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

-- Limpa o que entrou na fila por causa do laço: são eventos que já existem no
-- Google e não têm o que ser enviado.
DELETE FROM public.calendar_sync_queue q
 USING public.activities a
 WHERE a.id = q.activity_id
   AND a.google_event_id IS NOT NULL;
