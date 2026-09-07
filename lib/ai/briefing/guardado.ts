/**
 * Briefing guardado, e como saber se ele envelheceu.
 *
 * Antes, cada abertura da gaveta gerava um briefing novo: pagava IA de novo e
 * fazia a pessoa esperar de novo pelo mesmo texto. Guardar resolve isso, mas
 * cria um problema pior se feito sem cuidado -- texto velho apresentado como
 * atual. Uma pessoa entra na reunião confiando num resumo que não sabe da
 * conversa de ontem, e isso é pior do que não ter resumo nenhum.
 *
 * Daí o `base_em`: o briefing carrega até quando ele sabe das coisas, e a
 * comparação com o estado atual do negócio diz se está velho. A tela mostra a
 * diferença; ninguém precisa adivinhar.
 *
 * @module lib/ai/briefing/guardado
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateMeetingBriefing } from './briefing.service';
import type { BriefingResponse } from './schemas';

export interface BriefingGuardado {
  conteudo: BriefingResponse;
  geradoEm: string;
  geradoPor: string;
  baseEm: string;
  /** O negócio andou depois de o briefing ser feito. */
  desatualizado: boolean;
  /** Instante do que o negócio tem de mais recente agora. */
  mexidoEm: string | null;
}

/** Até quando o negócio andou: negócio, mensagens do contato, histórico, tarefas. */
export async function negocioMexidoEm(
  sb: SupabaseClient,
  dealId: string
): Promise<string | null> {
  const { data, error } = await sb.rpc('negocio_mexido_em', { p_deal: dealId });
  if (error) {
    console.error('[briefing] não consegui saber se o negócio andou:', error);
    return null;
  }
  return (data as string) ?? null;
}

/** O que está guardado, já dizendo se envelheceu. */
export async function lerGuardado(
  sb: SupabaseClient,
  dealId: string
): Promise<BriefingGuardado | null> {
  const { data } = await sb
    .from('deal_briefings')
    .select('conteudo, base_em, gerado_em, gerado_por')
    .eq('deal_id', dealId)
    .maybeSingle();

  const linha = data as {
    conteudo: BriefingResponse;
    base_em: string;
    gerado_em: string;
    gerado_por: string;
  } | null;

  if (!linha) return null;

  const mexidoEm = await negocioMexidoEm(sb, dealId);

  return {
    conteudo: linha.conteudo,
    geradoEm: linha.gerado_em,
    geradoPor: linha.gerado_por,
    baseEm: linha.base_em,
    mexidoEm,
    // Na dúvida (não consegui calcular), NÃO marca como desatualizado: alarme
    // falso aqui manda a pessoa gastar IA de novo sem motivo.
    desatualizado: Boolean(mexidoEm && new Date(mexidoEm) > new Date(linha.base_em)),
  };
}

/**
 * Gera e guarda.
 *
 * O `base_em` é medido ANTES de chamar a IA, de propósito. Se uma mensagem
 * chegar durante a geração (que leva segundos), o briefing não sabe dela -- e
 * marcar como se soubesse esconderia justamente a informação nova.
 */
export async function gerarEGuardar(
  sb: SupabaseClient,
  dealId: string,
  organizationId: string,
  geradoPor: 'pessoa' | 'rotina'
): Promise<BriefingGuardado> {
  const baseEm = (await negocioMexidoEm(sb, dealId)) ?? new Date().toISOString();

  const conteudo = await generateMeetingBriefing(dealId, sb);

  const { error } = await sb.from('deal_briefings').upsert(
    {
      deal_id: dealId,
      organization_id: organizationId,
      conteudo: conteudo as unknown as Record<string, unknown>,
      base_em: baseEm,
      gerado_em: new Date().toISOString(),
      gerado_por: geradoPor,
    },
    { onConflict: 'deal_id' }
  );

  if (error) {
    // Não derruba a resposta: a pessoa já esperou pela IA, e devolver o texto
    // que ela pediu é melhor do que perder tudo por falha de escrita.
    console.error('[briefing] gerei mas não consegui guardar:', error);
  }

  return {
    conteudo,
    geradoEm: new Date().toISOString(),
    geradoPor,
    baseEm,
    mexidoEm: baseEm,
    desatualizado: false,
  };
}
