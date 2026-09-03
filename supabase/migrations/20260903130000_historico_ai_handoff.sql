-- 'ai_handoff' faltava na lista de tipos do histórico.
--
-- Quando a IA entrega a conversa para uma pessoa, o código grava uma linha do
-- tipo 'ai_handoff' -- que a restrição não aceitava. A inserção falhava, e o
-- momento em que a IA passou o bastão não ficava registrado em lugar nenhum.
--
-- Aqui a restrição é que estava errada, não o código: 'ai_handoff' é um evento
-- distinto e vale ter nome próprio. Os outros dois casos parecidos eram erro de
-- digitação no código ('stage_change' sem o "d") e foram corrigidos lá.

ALTER TABLE public.deal_activities
  DROP CONSTRAINT IF EXISTS deal_activities_type_check;

ALTER TABLE public.deal_activities
  ADD CONSTRAINT deal_activities_type_check CHECK (
    type = ANY (ARRAY[
      'created', 'updated', 'contacted', 'qualified', 'proposal_sent',
      'negotiation', 'won', 'lost', 'note', 'assigned', 'unassigned',
      'stage_changed', 'ai_response', 'ai_stage_advanced', 'ai_handoff',
      'hitl_pending_created', 'hitl_pending_approved', 'hitl_pending_rejected',
      'hitl_alert'
    ])
  );
