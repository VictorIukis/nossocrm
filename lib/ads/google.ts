/**
 * Google Ads: OAuth, consulta e tradução.
 *
 * Tudo no servidor. Reaproveita o aplicativo OAuth do Google Calendar, só
 * acrescentando a permissão de Ads: são duas integrações do mesmo Google, e
 * pedir para o cliente configurar dois aplicativos seria trabalho sem retorno.
 *
 * Três armadilhas do Google Ads que este arquivo existe para resolver:
 *
 * 1. **Custo vem em micros.** `cost_micros: 4280000000` são R$ 4.280, não
 *    4,28 bilhões. Dividir por um milhão em cada lugar que usa é como o painel
 *    ganha um erro de mil vezes.
 *
 * 2. **Conta gerenciada exige a gerenciadora.** Sem o cabeçalho
 *    `login-customer-id`, o Google recusa com "user doesn't have permission" --
 *    mensagem que não sugere nada sobre o que falta.
 *
 * 3. **O id da conta não pode ter hífen.** A interface mostra `693-820-6019`; a
 *    API só aceita `6938206019`.
 *
 * @module lib/ads/google
 */

import 'server-only';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { enderecoPublico } from '@/lib/calendar/google';

const AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const TROCA_DE_TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://googleads.googleapis.com/v18';
const TEMPO_LIMITE_MS = 25_000;

/** Vale o mesmo raciocínio da Meta: dado de mídia não muda de minuto em minuto. */
export const VALIDADE_DO_CACHE_MS = 10 * 60 * 1000;

export const ESCOPO_ADS = 'https://www.googleapis.com/auth/adwords';

export interface CredenciaisApp {
  clientId: string;
  clientSecret: string;
  developerToken: string;
  redirectUri: string;
}

/**
 * Credenciais do aplicativo.
 *
 * O developer token é a peça que costuma faltar: ele é emitido pelo Google Ads
 * (não pelo Google Cloud) e leva dias de aprovação. Sem ele, nada funciona --
 * então a tela precisa dizer isso em vez de oferecer um botão que só falha.
 */
export function credenciaisApp(): CredenciaisApp | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret || !developerToken) return null;

  const base = enderecoPublico();
  if (!base) return null;

  return {
    clientId,
    clientSecret,
    developerToken,
    redirectUri: `${base}/api/ads/google/retorno`,
  };
}

export function urlDeAutorizacao(cred: CredenciaisApp, estado: string): string {
  const p = new URLSearchParams({
    client_id: cred.clientId,
    redirect_uri: cred.redirectUri,
    response_type: 'code',
    scope: ESCOPO_ADS,
    access_type: 'offline',
    // O Google só devolve refresh_token na primeira autorização. Forçar a tela
    // garante que uma reconexão depois de erro não traga uma conexão que morre
    // em uma hora.
    prompt: 'consent',
    state: estado,
  });
  return `${AUTORIZACAO}?${p.toString()}`;
}

interface RespostaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function trocarCodigoPorToken(
  cred: CredenciaisApp,
  codigo: string
): Promise<RespostaToken> {
  const r = await fetch(TROCA_DE_TOKEN, {
    method: 'POST',
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      redirect_uri: cred.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  return (await r.json()) as RespostaToken;
}

export interface ConexaoGoogleAds {
  organizationId: string;
  refreshToken: string;
  accessToken: string | null;
  expiraEm: string | null;
  customerId: string;
  loginCustomerId: string | null;
  accountName: string | null;
}

/** Tira hífen e espaço: a interface mostra 693-820-6019, a API quer 6938206019. */
export function soDigitos(id: string): string {
  return (id || '').replace(/\D/g, '');
}

async function tokenValido(
  cred: CredenciaisApp,
  conexao: ConexaoGoogleAds
): Promise<string> {
  const vence = conexao.expiraEm ? new Date(conexao.expiraEm).getTime() : 0;
  const folga = 2 * 60 * 1000;
  if (conexao.accessToken && vence - folga > Date.now()) return conexao.accessToken;

  const r = await fetch(TROCA_DE_TOKEN, {
    method: 'POST',
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: conexao.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const d = (await r.json()) as RespostaToken;
  if (!r.ok || !d.access_token) {
    throw new Error(
      d.error_description || d.error || 'O Google não renovou o acesso. Reconecte a conta.'
    );
  }

  const sb = createStaticAdminClient();
  await sb
    .from('organization_settings')
    .update({
      google_ads_access_token: d.access_token,
      google_ads_token_expires_at: new Date(
        Date.now() + (d.expires_in ?? 3600) * 1000
      ).toISOString(),
    })
    .eq('organization_id', conexao.organizationId);

  return d.access_token;
}

// ---------------------------------------------------------------------------
// consulta
// ---------------------------------------------------------------------------

export const PERIODOS = {
  hoje: 'TODAY',
  ontem: 'YESTERDAY',
  '7dias': 'LAST_7_DAYS',
  '30dias': 'LAST_30_DAYS',
  mes: 'THIS_MONTH',
  mes_passado: 'LAST_MONTH',
} as const;

export type Periodo = keyof typeof PERIODOS;

export function periodoValido(v: string | null | undefined): Periodo {
  return v && v in PERIODOS ? (v as Periodo) : '30dias';
}

/**
 * Converte micros para a moeda.
 *
 * O Google devolve valor monetário multiplicado por um milhão. Errar aqui não
 * dá erro nenhum: o painel simplesmente mostra um número mil vezes maior, e
 * parece plausível o suficiente para ninguém desconfiar na hora.
 */
export function deMicros(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export interface MetricasGoogle {
  investido: number;
  impressoes: number;
  cliques: number;
  ctr: number;
  cpc: number;
  conversoes: number;
  custoPorConversao: number | null;
}

export interface CampanhaGoogle extends MetricasGoogle {
  id: string;
  nome: string;
  status: string | null;
}

export interface PainelGoogle {
  conta: { id: string; nome: string | null; moeda: string | null };
  periodo: Periodo;
  total: MetricasGoogle;
  campanhas: CampanhaGoogle[];
  atualizadoEm: string;
  doCache: boolean;
}

interface LinhaGoogle {
  campaign?: { id?: string; name?: string; status?: string };
  customer?: { descriptiveName?: string; currencyCode?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    ctr?: number;
    averageCpc?: string;
    conversions?: number;
    costPerConversion?: string;
  };
}

function traduzir(m: LinhaGoogle['metrics']): MetricasGoogle {
  const conversoes = num(m?.conversions);
  return {
    investido: deMicros(m?.costMicros),
    impressoes: num(m?.impressions),
    cliques: num(m?.clicks),
    // O Google devolve CTR como fração (0.0412). A tela mostra porcentagem.
    ctr: num(m?.ctr) * 100,
    cpc: deMicros(m?.averageCpc),
    conversoes,
    // Custo por conversão sem conversão nenhuma não é zero: é indefinido.
    // Mostrar zero afirmaria "conversão de graça", que é falso e perigoso.
    custoPorConversao: conversoes > 0 ? deMicros(m?.costPerConversion) : null,
  };
}

async function consultar(
  cred: CredenciaisApp,
  conexao: ConexaoGoogleAds,
  gaql: string
): Promise<LinhaGoogle[]> {
  const token = await tokenValido(cred, conexao);
  const conta = soDigitos(conexao.customerId);

  const cabecalhos: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': cred.developerToken,
    'content-type': 'application/json',
  };

  // Só manda quando existe: enviar vazio é pior que não enviar.
  const gerenciadora = soDigitos(conexao.loginCustomerId || '');
  if (gerenciadora) cabecalhos['login-customer-id'] = gerenciadora;

  const r = await fetch(`${API}/customers/${conta}/googleAds:search`, {
    method: 'POST',
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    headers: cabecalhos,
    body: JSON.stringify({ query: gaql, pageSize: 200 }),
  });

  const corpo = (await r.json().catch(() => null)) as
    | { results?: LinhaGoogle[]; error?: { message?: string; details?: unknown } }
    | null;

  if (!r.ok || corpo?.error) {
    const bruto = corpo?.error?.message || `HTTP ${r.status}`;
    throw new Error(explicar(bruto, Boolean(gerenciadora)));
  }

  return corpo?.results ?? [];
}

/**
 * Traduz a mensagem do Google para algo acionável.
 *
 * As mensagens do Google Ads são precisas mas não dizem o que fazer. "User
 * doesn't have permission" na verdade quer dizer, quase sempre, que falta a
 * conta gerenciadora -- e quem lê isso vai procurar problema de permissão pelo
 * resto da tarde.
 */
function explicar(bruto: string, temGerenciadora: boolean): string {
  const b = bruto.toLowerCase();

  if (b.includes("user doesn't have permission") || b.includes('user permission denied')) {
    return temGerenciadora
      ? `${bruto} — confira se a conta gerenciadora informada realmente administra esta conta.`
      : `${bruto} — se esta conta é gerida por uma agência ou MCC, informe a conta gerenciadora na configuração.`;
  }
  if (b.includes('developer token') && b.includes('not approved')) {
    return `${bruto} — o developer token está em acesso de teste, que só lê contas de teste. Peça acesso básico no Google Ads.`;
  }
  if (b.includes('customer not found') || b.includes('invalid customer id')) {
    return `${bruto} — confira o número da conta, sem hífen.`;
  }
  return bruto;
}

export async function buscarPainel(
  conexao: ConexaoGoogleAds,
  periodo: Periodo,
  ignorarCache = false
): Promise<PainelGoogle> {
  const cred = credenciaisApp();
  if (!cred) throw new Error('Google Ads não configurado nesta instalação.');

  const sb = createStaticAdminClient();
  const chave = `painel:${periodo}`;

  if (!ignorarCache) {
    const { data } = await sb
      .from('ads_insights_cache')
      .select('dados, buscado_em')
      .eq('organization_id', conexao.organizationId)
      .eq('provedor', 'google')
      .eq('chave', chave)
      .maybeSingle();

    const linha = data as { dados: PainelGoogle; buscado_em: string } | null;
    if (linha && Date.now() - new Date(linha.buscado_em).getTime() < VALIDADE_DO_CACHE_MS) {
      return { ...linha.dados, doCache: true };
    }
  }

  const janela = PERIODOS[periodo];

  const linhas = await consultar(
    cred,
    conexao,
    `SELECT campaign.id, campaign.name, campaign.status,
            customer.descriptive_name, customer.currency_code,
            metrics.cost_micros, metrics.impressions, metrics.clicks,
            metrics.ctr, metrics.average_cpc,
            metrics.conversions, metrics.cost_per_conversion
     FROM campaign
     WHERE segments.date DURING ${janela}
     ORDER BY metrics.cost_micros DESC`
  );

  const campanhas: CampanhaGoogle[] = linhas.map((l) => ({
    id: l.campaign?.id ?? '',
    nome: l.campaign?.name ?? '(sem nome)',
    status: l.campaign?.status ?? null,
    ...traduzir(l.metrics),
  }));

  // O total é somado aqui, e não pedido ao Google numa segunda consulta: uma
  // chamada a menos, e o número fecha com a lista que está na tela -- se
  // viessem de consultas separadas, poderiam divergir e ninguém entenderia.
  const total: MetricasGoogle = campanhas.reduce<MetricasGoogle>(
    (acc, c) => ({
      investido: acc.investido + c.investido,
      impressoes: acc.impressoes + c.impressoes,
      cliques: acc.cliques + c.cliques,
      ctr: 0,
      cpc: 0,
      conversoes: acc.conversoes + c.conversoes,
      custoPorConversao: null,
    }),
    {
      investido: 0, impressoes: 0, cliques: 0, ctr: 0, cpc: 0,
      conversoes: 0, custoPorConversao: null,
    }
  );

  // CTR e CPC do conjunto se calculam do total, nunca pela média das médias --
  // média de médias dá peso igual a uma campanha de R$ 10 e a uma de R$ 10.000.
  total.ctr = total.impressoes > 0 ? (total.cliques / total.impressoes) * 100 : 0;
  total.cpc = total.cliques > 0 ? total.investido / total.cliques : 0;
  total.custoPorConversao =
    total.conversoes > 0 ? total.investido / total.conversoes : null;

  const painel: PainelGoogle = {
    conta: {
      id: soDigitos(conexao.customerId),
      nome: linhas[0]?.customer?.descriptiveName ?? conexao.accountName ?? null,
      moeda: linhas[0]?.customer?.currencyCode ?? null,
    },
    periodo,
    total,
    campanhas,
    atualizadoEm: new Date().toISOString(),
    doCache: false,
  };

  await sb.from('ads_insights_cache').upsert(
    {
      organization_id: conexao.organizationId,
      provedor: 'google',
      chave,
      dados: painel as unknown as Record<string, unknown>,
      buscado_em: new Date().toISOString(),
    },
    { onConflict: 'organization_id,provedor,chave' }
  );

  return painel;
}

/** Contas de anúncios que a autorização alcança, para a tela deixar escolher. */
export async function listarContas(
  refreshToken: string,
  organizationId: string
): Promise<Array<{ id: string }>> {
  const cred = credenciaisApp();
  if (!cred) throw new Error('Google Ads não configurado nesta instalação.');

  const token = await tokenValido(cred, {
    organizationId,
    refreshToken,
    accessToken: null,
    expiraEm: null,
    customerId: '',
    loginCustomerId: null,
    accountName: null,
  });

  const r = await fetch(`${API}/customers:listAccessibleCustomers`, {
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': cred.developerToken,
    },
  });

  const d = (await r.json().catch(() => null)) as
    | { resourceNames?: string[]; error?: { message?: string } }
    | null;

  if (!r.ok || d?.error) {
    throw new Error(explicar(d?.error?.message || `HTTP ${r.status}`, false));
  }

  // Vem como "customers/6938206019".
  return (d?.resourceNames ?? []).map((n) => ({ id: n.split('/').pop() ?? '' }));
}
