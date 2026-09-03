/**
 * O painel de Ads em formato de resposta para a IA.
 *
 * Separado da rota porque a IA precisa de outra coisa: a tela mostra tudo e
 * deixa a pessoa olhar; o modelo precisa de pouco e bem escolhido, senão gasta
 * contexto com número que não vai citar e ainda erra o que importa.
 *
 * O campo `demonstracao` existe para a IA poder avisar. Um relatório com número
 * inventado, dito com a mesma segurança de um número real, é pior do que não
 * ter relatório nenhum.
 *
 * @module lib/ads/paraIA
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { modoDemoLigado } from './modoDemo';
import { painelDemoMeta, painelDemoGoogle } from './demo';
import { buscarPainel as buscarMeta, periodoValido as periodoMeta } from './meta';
import { buscarPainel as buscarGoogle, periodoValido as periodoGoogle } from './google';

const AVISO_DEMO =
  'ATENÇÃO: estes números são fictícios (modo demonstração). Diga isso ao apresentar o relatório.';

export type Fonte = 'meta' | 'google' | 'ambos';

/** Poucos campos, escolhidos: é o que se cita numa conversa sobre mídia. */
function resumirMeta(p: ReturnType<typeof painelDemoMeta>) {
  return {
    conta: p.conta.nome,
    investido: p.total.investido,
    resultados: p.total.resultados,
    tipoDeResultado: p.total.tipoDeResultado,
    custoPorResultado: p.total.custoPorResultado,
    cliques: p.total.cliques,
    cpc: p.total.cpc,
    ctr: p.total.ctr,
    campanhas: p.campanhas.slice(0, 5).map((c) => ({
      nome: c.nome,
      investido: c.investido,
      resultados: c.resultados,
      custoPorResultado: c.custoPorResultado,
    })),
  };
}

function resumirGoogle(p: ReturnType<typeof painelDemoGoogle>) {
  return {
    conta: p.conta.nome,
    investido: p.total.investido,
    conversoes: p.total.conversoes,
    custoPorConversao: p.total.custoPorConversao,
    cliques: p.total.cliques,
    cpc: p.total.cpc,
    ctr: p.total.ctr,
    campanhas: p.campanhas.slice(0, 5).map((c) => ({
      nome: c.nome,
      investido: c.investido,
      conversoes: c.conversoes,
      custoPorConversao: c.custoPorConversao,
    })),
  };
}

export async function lerAdsParaIA(organizationId: string, periodo: string, fonte: Fonte) {
  const demo = await modoDemoLigado(organizationId);

  if (demo) {
    const r: Record<string, unknown> = { periodo, demonstracao: true, aviso: AVISO_DEMO };
    if (fonte !== 'google') r.meta = resumirMeta(painelDemoMeta(periodoMeta(periodo)));
    if (fonte !== 'meta') r.google = resumirGoogle(painelDemoGoogle(periodoGoogle(periodo)));
    return r;
  }

  const sb = createStaticAdminClient();
  const { data } = await sb
    .from('organization_settings')
    .select(
      'meta_ads_token, meta_ads_account_id, meta_ads_account_name,' +
        ' google_ads_refresh_token, google_ads_access_token, google_ads_token_expires_at,' +
        ' google_ads_customer_id, google_ads_login_customer_id, google_ads_account_name'
    )
    .eq('organization_id', organizationId)
    .maybeSingle();

  const cfg = (data || {}) as Record<string, string | null>;
  const resposta: Record<string, unknown> = { periodo, demonstracao: false };

  if (fonte !== 'google') {
    if (cfg.meta_ads_token && cfg.meta_ads_account_id) {
      try {
        const painel = await buscarMeta(
          organizationId,
          {
            token: cfg.meta_ads_token,
            accountId: cfg.meta_ads_account_id,
            accountName: cfg.meta_ads_account_name ?? null,
          },
          periodoMeta(periodo),
          false
        );
        resposta.meta = resumirMeta(painel);
      } catch (e) {
        // O motivo, e não só "falhou": token de anúncio expira em silêncio, e
        // sem a mensagem a pessoa fica sem saber o que consertar.
        resposta.meta = { erro: e instanceof Error ? e.message : 'Falha ao falar com a Meta.' };
      }
    } else {
      resposta.meta = { naoConectado: 'A conta do Meta Ads não está conectada em Configurações → Integrações.' };
    }
  }

  if (fonte !== 'meta') {
    if (cfg.google_ads_refresh_token && cfg.google_ads_customer_id) {
      try {
        const painel = await buscarGoogle(
          {
            organizationId,
            refreshToken: cfg.google_ads_refresh_token,
            accessToken: cfg.google_ads_access_token ?? null,
            expiraEm: cfg.google_ads_token_expires_at ?? null,
            customerId: cfg.google_ads_customer_id,
            loginCustomerId: cfg.google_ads_login_customer_id ?? null,
            accountName: cfg.google_ads_account_name ?? null,
          },
          periodoGoogle(periodo),
          false
        );
        resposta.google = resumirGoogle(painel);
      } catch (e) {
        resposta.google = { erro: e instanceof Error ? e.message : 'Falha ao falar com o Google Ads.' };
      }
    } else {
      resposta.google = { naoConectado: 'A conta do Google Ads não está conectada em Configurações → Integrações.' };
    }
  }

  return resposta;
}
