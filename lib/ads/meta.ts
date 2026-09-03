/**
 * Meta Ads: conversa com a API de marketing e traduz o resultado.
 *
 * Tudo no servidor. O token de anúncios dá acesso ao investimento da empresa e
 * nunca chega ao navegador.
 *
 * Duas decisões que moldam o resto:
 *
 * 1. **Cache obrigatório.** A API da Meta limita chamadas por hora e responde
 *    em segundos. Sem cache, cada pessoa que abrisse a tela gastaria uma
 *    chamada, e num dia de reunião o painel pararia com erro de cota -- que não
 *    se parece nada com o problema que é.
 *
 * 2. **Nome de métrica em português, uma vez só.** A Meta devolve `spend`,
 *    `cpm`, `actions`, `action_type`. Traduzir espalhado pela tela é como o
 *    cifrão do dólar apareceu em sete arquivos: a próxima tela repete o erro.
 *
 * @module lib/ads/meta
 */

import 'server-only';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

const API = 'https://graph.facebook.com/v21.0';

/** A Meta aborta sozinha em consultas longas; 20s é folga suficiente. */
const TEMPO_LIMITE_MS = 20_000;

/**
 * Por quanto tempo o número serve.
 *
 * Dez minutos é o equilíbrio: dado de anúncio não muda de minuto em minuto (a
 * própria Meta atualiza em janelas), e ninguém repara na diferença. Já a
 * economia de chamadas é grande quando o time abre a tela ao mesmo tempo.
 */
export const VALIDADE_DO_CACHE_MS = 10 * 60 * 1000;

export interface ConexaoMeta {
  token: string;
  accountId: string;
  accountName: string | null;
}

/** Períodos que a tela oferece, com o nome que a Meta entende. */
export const PERIODOS = {
  hoje: 'today',
  ontem: 'yesterday',
  '7dias': 'last_7d',
  '30dias': 'last_30d',
  mes: 'this_month',
  mes_passado: 'last_month',
} as const;

export type Periodo = keyof typeof PERIODOS;

export function periodoValido(v: string | null | undefined): Periodo {
  return v && v in PERIODOS ? (v as Periodo) : '30dias';
}

export interface Metricas {
  investido: number;
  impressoes: number;
  cliques: number;
  alcance: number;
  cpm: number;
  cpc: number;
  ctr: number;
  /** Conversas iniciadas, cadastros, compras: o que a conta estiver otimizando. */
  resultados: number;
  custoPorResultado: number | null;
  /** Qual ação foi contada como resultado. Sem isso, o número não se explica. */
  tipoDeResultado: string | null;
}

export interface Campanha extends Metricas {
  id: string;
  nome: string;
  status: string | null;
}

export interface PainelMeta {
  conta: { id: string; nome: string | null; moeda: string | null };
  periodo: Periodo;
  total: Metricas;
  campanhas: Campanha[];
  porDia: Array<{ dia: string; investido: number; resultados: number }>;
  atualizadoEm: string;
  doCache: boolean;
}

// ---------------------------------------------------------------------------
// tradução
// ---------------------------------------------------------------------------

export interface LinhaMeta {
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Escolhe qual ação vale como "resultado".
 *
 * A Meta devolve dezenas de tipos de ação na mesma resposta, incluindo
 * `post_engagement` e `page_engagement`, que inflam qualquer número e não
 * significam venda. A ordem abaixo vai do mais valioso ao menos, e para na
 * primeira que a conta realmente tiver -- é o que faz o painel mostrar
 * "compras" numa conta de e-commerce e "conversas iniciadas" numa de captação,
 * sem configuração.
 */
const PRIORIDADE_DE_RESULTADO = [
  'purchase',
  'omni_purchase',
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'complete_registration',
  'offsite_conversion.fb_pixel_complete_registration',
  'link_click',
] as const;

const NOME_DO_RESULTADO: Record<string, string> = {
  purchase: 'compras',
  omni_purchase: 'compras',
  lead: 'cadastros',
  'onsite_conversion.lead_grouped': 'cadastros',
  'offsite_conversion.fb_pixel_lead': 'cadastros',
  'onsite_conversion.messaging_conversation_started_7d': 'conversas iniciadas',
  complete_registration: 'registros',
  'offsite_conversion.fb_pixel_complete_registration': 'registros',
  link_click: 'cliques no link',
};

export function extrairResultado(linha: LinhaMeta): {
  resultados: number;
  custo: number | null;
  tipo: string | null;
} {
  for (const tipo of PRIORIDADE_DE_RESULTADO) {
    const acao = linha.actions?.find((a) => a.action_type === tipo);
    if (!acao) continue;

    const custoBruto = linha.cost_per_action_type?.find((c) => c.action_type === tipo);
    return {
      resultados: num(acao.value),
      custo: custoBruto ? num(custoBruto.value) : null,
      tipo: NOME_DO_RESULTADO[tipo] ?? tipo,
    };
  }
  return { resultados: 0, custo: null, tipo: null };
}

function traduzir(linha: LinhaMeta): Metricas {
  const r = extrairResultado(linha);
  return {
    investido: num(linha.spend),
    impressoes: num(linha.impressions),
    cliques: num(linha.clicks),
    alcance: num(linha.reach),
    cpm: num(linha.cpm),
    cpc: num(linha.cpc),
    ctr: num(linha.ctr),
    resultados: r.resultados,
    custoPorResultado: r.custo,
    tipoDeResultado: r.tipo,
  };
}

// ---------------------------------------------------------------------------
// chamadas
// ---------------------------------------------------------------------------

const CAMPOS =
  'spend,impressions,clicks,reach,cpm,cpc,ctr,actions,cost_per_action_type';

async function chamar(caminho: string, token: string): Promise<unknown> {
  const url = `${API}${caminho}${caminho.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });

  const corpo = (await r.json().catch(() => null)) as
    | { error?: { message?: string; code?: number; error_user_msg?: string } }
    | null;

  if (!r.ok || corpo?.error) {
    // A mensagem da Meta é específica e útil ("token expirado", "conta sem
    // permissão", "limite de chamadas"). Guardar só o status transformaria cada
    // uma dessas em "erro 400" -- foi exatamente o que me custou tempo no
    // Google Calendar hoje.
    const e = corpo?.error;
    const detalhe = e?.error_user_msg || e?.message || `HTTP ${r.status}`;
    throw new Error(detalhe);
  }

  return corpo;
}

export async function buscarPainel(
  organizationId: string,
  conexao: ConexaoMeta,
  periodo: Periodo,
  ignorarCache = false
): Promise<PainelMeta> {
  const sb = createStaticAdminClient();
  const chave = `painel:${periodo}`;

  if (!ignorarCache) {
    const { data } = await sb
      .from('ads_insights_cache')
      .select('dados, buscado_em')
      .eq('organization_id', organizationId)
      .eq('provedor', 'meta')
      .eq('chave', chave)
      .maybeSingle();

    const linha = data as { dados: PainelMeta; buscado_em: string } | null;
    if (linha && Date.now() - new Date(linha.buscado_em).getTime() < VALIDADE_DO_CACHE_MS) {
      return { ...linha.dados, doCache: true };
    }
  }

  const conta = conexao.accountId.startsWith('act_')
    ? conexao.accountId
    : `act_${conexao.accountId}`;
  const janela = PERIODOS[periodo];

  // Três chamadas em paralelo. Em série, a tela levaria o triplo do tempo para
  // mostrar a primeira coisa.
  const [dadosConta, totalBruto, porCampanha, porDiaBruto] = await Promise.all([
    chamar(`/${conta}?fields=name,currency`, conexao.token) as Promise<{
      name?: string;
      currency?: string;
    }>,
    chamar(
      `/${conta}/insights?date_preset=${janela}&fields=${CAMPOS}`,
      conexao.token
    ) as Promise<{ data?: LinhaMeta[] }>,
    chamar(
      `/${conta}/insights?date_preset=${janela}&level=campaign&limit=50` +
        `&fields=${CAMPOS},campaign_id,campaign_name`,
      conexao.token
    ) as Promise<{ data?: LinhaMeta[] }>,
    chamar(
      `/${conta}/insights?date_preset=${janela}&time_increment=1&fields=spend,actions`,
      conexao.token
    ) as Promise<{ data?: LinhaMeta[] }>,
  ]);

  const linhaTotal = totalBruto.data?.[0] ?? {};

  const painel: PainelMeta = {
    conta: {
      id: conta,
      nome: dadosConta.name ?? conexao.accountName ?? null,
      moeda: dadosConta.currency ?? null,
    },
    periodo,
    total: traduzir(linhaTotal),
    campanhas: (porCampanha.data ?? [])
      .map((l) => ({
        id: l.campaign_id ?? '',
        nome: l.campaign_name ?? '(sem nome)',
        status: null,
        ...traduzir(l),
      }))
      // Maior investimento primeiro: é a ordem em que se olha um painel de mídia.
      .sort((a, b) => b.investido - a.investido),
    porDia: (porDiaBruto.data ?? []).map((l) => ({
      dia: l.date_start ?? '',
      investido: num(l.spend),
      resultados: extrairResultado(l).resultados,
    })),
    atualizadoEm: new Date().toISOString(),
    doCache: false,
  };

  await sb.from('ads_insights_cache').upsert(
    {
      organization_id: organizationId,
      provedor: 'meta',
      chave,
      dados: painel as unknown as Record<string, unknown>,
      buscado_em: new Date().toISOString(),
    },
    { onConflict: 'organization_id,provedor,chave' }
  );

  return painel;
}

/** Confere o token e descobre o nome da conta, para a tela mostrar qual é. */
export async function conferirConexao(
  token: string,
  accountId: string
): Promise<{ ok: true; nome: string | null; moeda: string | null } | { ok: false; motivo: string }> {
  const conta = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  try {
    const d = (await chamar(`/${conta}?fields=name,currency`, token)) as {
      name?: string;
      currency?: string;
    };
    return { ok: true, nome: d.name ?? null, moeda: d.currency ?? null };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : 'Falha ao falar com a Meta.' };
  }
}
