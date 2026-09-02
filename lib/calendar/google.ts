/**
 * Google Calendar: credenciais, token e conversa com a API.
 *
 * Tudo aqui roda no servidor. O token de uma pessoa nunca chega ao navegador
 * dela nem ao de mais ninguem: quem fala com o Google e sempre este arquivo.
 *
 * @module lib/calendar/google
 */

import 'server-only';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

const AUTORIZACAO = 'https://accounts.google.com/o/oauth2/v2/auth';
const TROCA_DE_TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

/**
 * Permissões pedidas.
 *
 * `calendar.events` da acesso aos eventos, e nao a agenda inteira: nao podemos
 * apagar calendarios nem mexer em configuracao da conta. `email` serve so para
 * mostrar na tela QUAL conta foi conectada -- sem isso, quem tem duas contas
 * Google nunca sabe qual esta ligada.
 */
export const ESCOPOS = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export interface CredenciaisGoogle {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Le as credenciais do aplicativo Google.
 *
 * Ficam em variavel de ambiente, e nao no banco, porque sao do aplicativo (uma
 * por instalacao do CRM) e nao de cada organizacao. Trocar exige novo deploy, o
 * que e adequado: nao e configuracao de uso diario.
 */
export function credenciais(): CredenciaisGoogle | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

  if (!base) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: `${base}/api/calendar/google/retorno`,
  };
}

/** Monta o endereço para onde a pessoa é enviada para autorizar. */
export function urlDeAutorizacao(cred: CredenciaisGoogle, estado: string): string {
  const p = new URLSearchParams({
    client_id: cred.clientId,
    redirect_uri: cred.redirectUri,
    response_type: 'code',
    scope: ESCOPOS,
    // `offline` e o que faz o Google devolver refresh_token. Sem ele, a conexao
    // morre em uma hora e a pessoa teria que reconectar o dia inteiro.
    access_type: 'offline',
    // `consent` força a tela de permissão mesmo em reconexão. O Google só manda
    // refresh_token na PRIMEIRA autorização; sem isto, reconectar depois de um
    // erro devolveria uma conexão sem refresh_token, que quebra em uma hora.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: estado,
  });
  return `${AUTORIZACAO}?${p.toString()}`;
}

interface RespostaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function trocarCodigoPorToken(
  cred: CredenciaisGoogle,
  codigo: string
): Promise<RespostaToken> {
  const r = await fetch(TROCA_DE_TOKEN, {
    method: 'POST',
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

export interface Conexao {
  user_id: string;
  organization_id: string;
  account_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_id: string;
  sync_token: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expires_at: string | null;
}

/**
 * Devolve um token válido, renovando se necessário.
 *
 * Renova com 2 minutos de folga em vez de esperar vencer: uma requisicao que
 * comeca faltando 10 segundos chega ao Google ja expirada, e o erro apareceria
 * como "sincronizacao falhou" sem motivo aparente.
 */
export async function tokenValido(conexao: Conexao): Promise<string | null> {
  const cred = credenciais();
  if (!cred || !conexao.refresh_token) return conexao.access_token;

  const vence = conexao.token_expires_at ? new Date(conexao.token_expires_at).getTime() : 0;
  const folga = 2 * 60 * 1000;
  if (conexao.access_token && vence - folga > Date.now()) return conexao.access_token;

  const r = await fetch(TROCA_DE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: conexao.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const dados = (await r.json()) as RespostaToken;

  if (!r.ok || !dados.access_token) {
    // Token de renovacao invalido significa que a pessoa revogou o acesso na
    // conta Google, ou trocou a senha. Registrar o motivo e o que permite a tela
    // dizer "reconecte" em vez de ficar em silencio.
    const sb = createStaticAdminClient();
    await sb
      .from('user_calendar_connections')
      .update({
        last_error: dados.error_description || dados.error || 'Falha ao renovar o acesso.',
      })
      .eq('user_id', conexao.user_id);
    return null;
  }

  const expiraEm = new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString();
  const sb = createStaticAdminClient();
  await sb
    .from('user_calendar_connections')
    .update({
      access_token: dados.access_token,
      token_expires_at: expiraEm,
      last_error: null,
    })
    .eq('user_id', conexao.user_id);

  return dados.access_token;
}

/** Chamada à API do Google já com o token da pessoa. */
export async function chamarGoogle(
  conexao: Conexao,
  caminho: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await tokenValido(conexao);
  if (!token) throw new Error('SEM_ACESSO');

  return fetch(`${API}${caminho}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
}

export async function buscarConexao(userId: string): Promise<Conexao | null> {
  const sb = createStaticAdminClient();
  const { data } = await sb
    .from('user_calendar_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as Conexao | null) ?? null;
}

// ---------------------------------------------------------------------------
// Conversão entre atividade do CRM e evento do Google
// ---------------------------------------------------------------------------

export interface EventoGoogle {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
}

export interface AtividadeParaEvento {
  title: string;
  description?: string | null;
  location?: string | null;
  date: string;
  ends_at?: string | null;
  all_day?: boolean | null;
}

/** Duração assumida quando a atividade não tem hora de término. */
export const DURACAO_PADRAO_MINUTOS = 30;

export function atividadeParaEvento(a: AtividadeParaEvento): Record<string, unknown> {
  const inicio = new Date(a.date);
  const fim = a.ends_at
    ? new Date(a.ends_at)
    : new Date(inicio.getTime() + DURACAO_PADRAO_MINUTOS * 60_000);

  if (a.all_day) {
    // Dia inteiro no Google usa data pura e fim EXCLUSIVO: um compromisso de um
    // dia termina no dia seguinte. Mandar a mesma data nos dois cria um evento
    // de duracao zero, que some da agenda.
    const dia = (d: Date) => d.toISOString().slice(0, 10);
    const fimExclusivo = new Date(inicio);
    fimExclusivo.setUTCDate(fimExclusivo.getUTCDate() + 1);
    return {
      summary: a.title,
      description: a.description || undefined,
      location: a.location || undefined,
      start: { date: dia(inicio) },
      end: { date: dia(a.ends_at ? new Date(a.ends_at) : fimExclusivo) },
    };
  }

  return {
    summary: a.title,
    description: a.description || undefined,
    location: a.location || undefined,
    start: { dateTime: inicio.toISOString() },
    end: { dateTime: fim.toISOString() },
  };
}

export function eventoParaAtividade(e: EventoGoogle): {
  title: string;
  description: string | null;
  location: string | null;
  date: string;
  ends_at: string | null;
  all_day: boolean;
} | null {
  const inicioBruto = e.start?.dateTime || e.start?.date;
  if (!inicioBruto) return null;

  const diaInteiro = Boolean(e.start?.date && !e.start?.dateTime);
  const fimBruto = e.end?.dateTime || e.end?.date || null;

  return {
    // Evento sem titulo existe no Google e aparece como "(sem titulo)". Repetir
    // isso e melhor do que gravar vazio e a linha sumir na lista do CRM.
    title: e.summary?.trim() || '(sem título)',
    description: e.description ?? null,
    location: e.location ?? null,
    date: new Date(inicioBruto).toISOString(),
    ends_at: fimBruto ? new Date(fimBruto).toISOString() : null,
    all_day: diaInteiro,
  };
}
