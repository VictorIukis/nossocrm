/**
 * O painel de Ads está em demonstração?
 *
 * Num arquivo só, e consultado no começo das duas rotas, porque a garantia que
 * importa é negativa: com o modo ligado, o CRM não chama a Meta nem o Google.
 * Se cada rota decidisse isso do seu jeito, uma delas acabaria puxando dado de
 * cliente real numa demonstração -- exatamente o que não pode acontecer.
 *
 * @module lib/ads/modoDemo
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export async function modoDemoLigado(organizationId: string): Promise<boolean> {
  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('organization_settings')
    .select('ads_modo_demo')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    // Na dúvida, NÃO é demonstração: assim o erro aparece como painel sem
    // dados, e não como número inventado passando por verdadeiro.
    console.error('[ads/modoDemo]', error);
    return false;
  }

  return Boolean((data as { ads_modo_demo?: boolean } | null)?.ads_modo_demo);
}
