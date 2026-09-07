/**
 * Histórico do negócio: o que aconteceu com ele, em ordem.
 *
 * Esta tabela era escrita e nunca lida. O CRM registrava "contrato assinado",
 * "primeiro contato enviado", "respostas do formulário", "etapa avançada pela
 * IA" -- e nenhuma tela mostrava. Quanto mais a máquina passou a fazer sozinha,
 * pior isso ficou: quem abre o negócio via o resultado sem ver o caminho, e a
 * única forma de saber por que ele estava naquela etapa era perguntar.
 *
 * Lê direto pelo cliente do navegador porque a tabela tem política de leitura
 * por organização; não precisa de rota no servidor para isso.
 *
 * @module lib/query/hooks/useDealHistoryQuery
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/queryKeys';

/** Os tipos que o banco aceita, com o nome que gente usa. */
export const NOME_DO_TIPO: Record<string, string> = {
  created: 'Negócio criado',
  updated: 'Negócio atualizado',
  contacted: 'Contato feito',
  qualified: 'Qualificado',
  proposal_sent: 'Proposta enviada',
  negotiation: 'Em negociação',
  won: 'Ganho',
  lost: 'Perdido',
  note: 'Anotação',
  assigned: 'Responsável definido',
  unassigned: 'Responsável removido',
  stage_changed: 'Mudou de etapa',
  ai_response: 'Resposta da IA',
  ai_stage_advanced: 'Etapa avançada pela IA',
  ai_handoff: 'IA passou para uma pessoa',
  hitl_pending_created: 'IA sugeriu avanço',
  hitl_pending_approved: 'Sugestão aprovada',
  hitl_pending_rejected: 'Sugestão recusada',
  hitl_alert: 'Alerta da IA',
};

export interface LinhaDoHistorico {
  id: string;
  type: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

async function buscarHistorico(dealId: string): Promise<LinhaDoHistorico[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('deal_activities')
    .select('id, type, description, metadata, created_at')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false })
    // Teto de propósito: negócio antigo com muita automação pode ter centenas
    // de linhas, e ninguém lê a de número 300 dentro de um modal.
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaDoHistorico[];
}

export function useDealHistoryQuery(dealId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.deals.historico(dealId ?? ''),
    queryFn: () => buscarHistorico(dealId as string),
    enabled: Boolean(dealId),
    staleTime: 30_000,
  });
}

/**
 * Escreve uma nota no histórico do negócio.
 *
 * A nota escrita por gente entra na MESMA lista do que a máquina faz, de
 * propósito: quem abre o negócio quer uma história só, não duas.
 *
 * Antes ela virava uma "tarefa concluída" na tabela de compromissos, o que
 * misturava o que falta fazer com o que já aconteceu. Nunca houve uma linha
 * dessas em produção, então trocar não deixa nada para trás.
 */
export function useAdicionarNota() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dealId,
      organizationId,
      texto,
    }: {
      dealId: string;
      organizationId: string;
      texto: string;
    }) => {
      if (!supabase) throw new Error('Supabase não configurado');

      const { error } = await supabase.from('deal_activities').insert({
        deal_id: dealId,
        organization_id: organizationId,
        type: 'note',
        description: texto.trim(),
        metadata: { origem: 'pessoa' },
      });

      if (error) throw new Error(error.message);
    },
    onSuccess: (_dados, { dealId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals.historico(dealId) });
    },
  });
}
