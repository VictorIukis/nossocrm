/**
 * @fileoverview React Query hooks for Meeting Briefing
 *
 * Provides hooks for fetching and caching AI-generated meeting briefings.
 *
 * @module lib/query/hooks/useBriefingQuery
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import type { BriefingResponse } from '@/lib/ai/briefing/schemas';

// =============================================================================
// API Functions
// =============================================================================

/**
 * O que a rota devolve agora.
 *
 * `existe: false` é estado normal e não erro: o briefing só passa a existir
 * quando alguém pede. `desatualizado` diz que o negócio andou depois de ele ter
 * sido feito, o que a tela mostra em vez de apresentar texto velho como atual.
 */
export interface BriefingGuardado {
  existe: boolean;
  conteudo?: BriefingResponse;
  geradoEm?: string;
  geradoPor?: string;
  baseEm?: string;
  desatualizado?: boolean;
  mexidoEm?: string | null;
}

/** Leitura: não gasta IA, não espera. */
async function lerBriefing(dealId: string): Promise<BriefingGuardado> {
  const response = await fetch(`/api/ai/briefing/${dealId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Não consegui ler o briefing');
  }

  return response.json();
}

/** Geração: gasta IA, então é sempre POST e sempre deliberada. */
async function gerarBriefing(dealId: string): Promise<BriefingGuardado> {
  const response = await fetch(`/api/ai/briefing/${dealId}`, { method: 'POST' });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Não consegui gerar o briefing');
  }

  return response.json();
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Fetch a briefing for a deal.
 *
 * The briefing is cached for 5 minutes and garbage collected after 30 minutes.
 * Use this when you want to show a briefing but don't want to auto-generate.
 *
 * @param dealId - Deal ID to fetch briefing for
 * @param options - Additional options
 * @param options.enabled - Whether to enable the query (default: true when dealId is provided)
 */
export function useBriefingQuery(
  dealId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: queryKeys.ai.briefing(dealId!),
    queryFn: () => lerBriefing(dealId!),
    enabled: options?.enabled !== false && !!dealId,
    // Leitura ficou barata (não chama IA), então pode ser mais fresca: o
    // briefing pode ter sido gerado pela rotina da madrugada ou por outra
    // pessoa do time enquanto esta tela estava aberta.
    staleTime: 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

/**
 * Generate a briefing on-demand.
 *
 * Use this when you want to explicitly trigger briefing generation,
 * e.g., when user clicks "Prepare for Meeting" button.
 *
 * The generated briefing is automatically cached.
 */
export function useGenerateBriefing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: gerarBriefing,
    onSuccess: (data, dealId) => {
      // Cache the generated briefing
      queryClient.setQueryData(queryKeys.ai.briefing(dealId), data);
    },
    onSettled: (_data, _error, dealId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ai.briefing(dealId) });
    },
  });
}

/**
 * Invalidate a cached briefing.
 *
 * Use this when deal data has changed significantly and you want
 * to force a fresh briefing generation.
 */
export function useInvalidateBriefing() {
  const queryClient = useQueryClient();

  return (dealId: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.ai.briefing(dealId) });
  };
}
