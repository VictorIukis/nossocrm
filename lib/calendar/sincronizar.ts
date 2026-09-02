/**
 * Sincronização de mão dupla entre as atividades do CRM e o Google Calendar.
 *
 * As duas regras que sustentam o resto:
 *
 * 1. **Nada volta pela porta que entrou.** Quando aplicamos no CRM uma mudança
 *    vinda do Google, guardamos a versão (`etag`) do evento. Ao enviar para o
 *    Google, guardamos a versão que ele devolve. Antes de agir, comparamos: se
 *    a versão é a mesma que já conhecemos, o lado de lá não mudou nada de novo
 *    e paramos ali. Sem isso, cada lado reagiria ao outro para sempre.
 *
 * 2. **Quem mudou por último vence.** Comparamos `updated_at` da atividade com
 *    `updated` do evento. Não é perfeito -- dois relógios, duas edições
 *    simultâneas -- mas é previsível e explicável, que é o que importa quando
 *    alguém pergunta "por que meu horário voltou ao que era?".
 *
 * @module lib/calendar/sincronizar
 */

import 'server-only';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import {
  chamarGoogle,
  atividadeParaEvento,
  eventoParaAtividade,
  type Conexao,
  type EventoGoogle,
} from './google';


export interface Resultado {
  puxados: number;
  enviados: number;
  apagados: number;
  erros: string[];
}

interface AtividadeDoBanco {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  date: string;
  ends_at: string | null;
  all_day: boolean | null;
  completed: boolean | null;
  deleted_at: string | null;
  owner_id: string | null;
  organization_id: string | null;
  google_event_id: string | null;
  google_calendar_id: string | null;
  google_etag: string | null;
  updated_at: string;
}

const CAMPOS =
  'id, title, description, location, date, ends_at, all_day, completed, deleted_at,' +
  ' owner_id, organization_id, google_event_id, google_calendar_id, google_etag, updated_at';

// ---------------------------------------------------------------------------
// Google → CRM
// ---------------------------------------------------------------------------

/**
 * Traz do Google o que mudou desde a última vez.
 *
 * Usa o `syncToken`, que faz o Google devolver só as diferenças. Quando ele
 * expira (o Google devolve 410), refazemos uma leitura completa da janela de
 * interesse -- não da agenda inteira desde 2010, que seria lenta e traria
 * compromisso antigo que ninguém quer ver no CRM.
 */
export async function puxarDoGoogle(conexao: Conexao): Promise<Resultado> {
  const r: Resultado = { puxados: 0, enviados: 0, apagados: 0, erros: [] };
  const sb = createStaticAdminClient();
  const agenda = encodeURIComponent(conexao.calendar_id || 'primary');

  let pagina: string | null = null;
  let novoSyncToken: string | null = null;
  let usarSyncToken = Boolean(conexao.sync_token);

  for (let volta = 0; volta < 25; volta++) {
    const p = new URLSearchParams({ maxResults: '250', showDeleted: 'true' });

    if (usarSyncToken && conexao.sync_token && !pagina) {
      p.set('syncToken', conexao.sync_token);
    } else if (!pagina) {
      // Primeira sincronização, ou token expirado: 30 dias para trás dá contexto
      // do que acabou de acontecer sem arrastar o histórico inteiro.
      const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      p.set('timeMin', desde);
      p.set('singleEvents', 'true');
    }
    if (pagina) p.set('pageToken', pagina);

    const resposta = await chamarGoogle(conexao, `/calendars/${agenda}/events?${p}`);

    if (resposta.status === 410 && usarSyncToken) {
      // Marcador vencido. Recomeça sem ele, uma vez só.
      usarSyncToken = false;
      pagina = null;
      continue;
    }

    if (!resposta.ok) {
      r.erros.push(`Google respondeu ${resposta.status} ao listar eventos.`);
      break;
    }

    const dados = (await resposta.json()) as {
      items?: EventoGoogle[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const evento of dados.items ?? []) {
      try {
        await aplicarEvento(sb, conexao, evento, r);
      } catch (e) {
        r.erros.push(e instanceof Error ? e.message : 'Falha ao aplicar um evento.');
      }
    }

    if (dados.nextPageToken) {
      pagina = dados.nextPageToken;
      continue;
    }
    novoSyncToken = dados.nextSyncToken ?? null;
    break;
  }

  await sb
    .from('user_calendar_connections')
    .update({
      sync_token: novoSyncToken ?? conexao.sync_token,
      last_synced_at: new Date().toISOString(),
      last_error: r.erros.length ? r.erros[0].slice(0, 400) : null,
    })
    .eq('user_id', conexao.user_id);

  return r;
}

type Cliente = ReturnType<typeof createStaticAdminClient>;

async function aplicarEvento(
  sb: Cliente,
  conexao: Conexao,
  evento: EventoGoogle,
  r: Resultado
): Promise<void> {
  if (!evento.id) return;

  const { data: existente } = await sb
    .from('activities')
    .select(CAMPOS)
    .eq('google_calendar_id', conexao.calendar_id)
    .eq('google_event_id', evento.id)
    .maybeSingle();

  const atual = existente as AtividadeDoBanco | null;

  // Cancelado no Google vira arquivado aqui, e não apagado: o histórico do
  // negócio some junto se removermos a linha, e ninguém entende por quê.
  if (evento.status === 'cancelled') {
    if (atual && !atual.deleted_at) {
      await sb
        .from('activities')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', atual.id);
      r.apagados++;
    }
    return;
  }

  const convertido = eventoParaAtividade(evento);
  if (!convertido) return;

  // Regra 1: se a versão é a que já conhecemos, isto é o eco do que nós mesmos
  // enviamos. Ignora.
  if (atual && evento.etag && atual.google_etag === evento.etag) return;

  if (!atual) {
    await sb.from('activities').insert({
      ...convertido,
      type: 'meeting',
      completed: false,
      owner_id: conexao.user_id,
      organization_id: conexao.organization_id,
      google_event_id: evento.id,
      google_calendar_id: conexao.calendar_id,
      google_etag: evento.etag ?? null,
    });
    r.puxados++;
    return;
  }

  // Regra 2: quem mudou por último vence.
  const mudouNoGoogle = evento.updated ? new Date(evento.updated).getTime() : 0;
  const mudouNoCrm = new Date(atual.updated_at).getTime();

  if (mudouNoCrm > mudouNoGoogle) {
    // O CRM está mais novo. Não sobrescreve; o envio cuida de levar a versão
    // daqui para lá.
    return;
  }

  await sb
    .from('activities')
    .update({
      ...convertido,
      google_etag: evento.etag ?? null,
      deleted_at: null,
    })
    .eq('id', atual.id);
  r.puxados++;
}

// ---------------------------------------------------------------------------
// CRM → Google
// ---------------------------------------------------------------------------

/**
 * Envia uma atividade para a agenda do dono dela.
 *
 * Silencioso de proposito quando nao ha conexao: a maior parte das atividades
 * do CRM e de gente que nunca ligou o Google, e transformar isso em erro
 * encheria a tela de aviso inutil.
 */
export async function enviarAtividade(
  atividadeId: string,
  conexao: Conexao
): Promise<{ ok: boolean; motivo?: string }> {
  const sb = createStaticAdminClient();

  const { data } = await sb.from('activities').select(CAMPOS).eq('id', atividadeId).maybeSingle();
  const a = data as AtividadeDoBanco | null;
  if (!a) return { ok: false, motivo: 'Atividade não encontrada.' };

  const agenda = encodeURIComponent(conexao.calendar_id || 'primary');

  // Arquivada no CRM some da agenda.
  if (a.deleted_at) {
    if (!a.google_event_id) return { ok: true };
    const resposta = await chamarGoogle(
      conexao,
      `/calendars/${agenda}/events/${encodeURIComponent(a.google_event_id)}`,
      { method: 'DELETE' }
    );
    // 410 significa "ja nao existe la", que e o estado desejado.
    if (!resposta.ok && resposta.status !== 410 && resposta.status !== 404) {
      return { ok: false, motivo: `Google respondeu ${resposta.status} ao apagar.` };
    }
    await sb
      .from('activities')
      .update({ google_event_id: null, google_etag: null })
      .eq('id', a.id);
    return { ok: true };
  }

  const corpo = atividadeParaEvento(a);

  const resposta = a.google_event_id
    ? await chamarGoogle(
        conexao,
        `/calendars/${agenda}/events/${encodeURIComponent(a.google_event_id)}`,
        { method: 'PATCH', body: JSON.stringify(corpo) }
      )
    : await chamarGoogle(conexao, `/calendars/${agenda}/events`, {
        method: 'POST',
        body: JSON.stringify(corpo),
      });

  if (!resposta.ok) {
    // 404 num evento que achamos existir: alguem apagou direto no Google.
    // Limpar a ligacao faz a proxima gravacao criar de novo, em vez de tentar
    // atualizar para sempre um evento que nao existe.
    if (resposta.status === 404 && a.google_event_id) {
      await sb
        .from('activities')
        .update({ google_event_id: null, google_etag: null })
        .eq('id', a.id);
      return { ok: false, motivo: 'O evento não existe mais no Google; será recriado.' };
    }
    return { ok: false, motivo: `Google respondeu ${resposta.status}.` };
  }

  const evento = (await resposta.json()) as EventoGoogle;

  // Guarda a versão que o Google acabou de gerar. É o que faz o aviso de volta
  // dessa mesma alteração ser reconhecido como eco e ignorado.
  await sb
    .from('activities')
    .update({
      google_event_id: evento.id ?? a.google_event_id,
      google_calendar_id: conexao.calendar_id,
      google_etag: evento.etag ?? null,
    })
    .eq('id', a.id);

  return { ok: true };
}

/** Envia tudo que ainda não foi para a agenda, de uma pessoa só. */
export async function enviarPendentes(conexao: Conexao, limite = 100): Promise<number> {
  const sb = createStaticAdminClient();

  const { data } = await sb
    .from('activities')
    .select('id')
    .eq('owner_id', conexao.user_id)
    .is('deleted_at', null)
    .is('google_event_id', null)
    // Compromisso do ano passado nao precisa ir para a agenda de ninguem.
    .gte('date', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .order('date', { ascending: true })
    .limit(limite);

  let enviados = 0;
  for (const linha of (data ?? []) as Array<{ id: string }>) {
    const r = await enviarAtividade(linha.id, conexao);
    if (r.ok) enviados++;
  }
  return enviados;
}

/** Uma rodada completa nos dois sentidos. */
export async function sincronizar(conexao: Conexao): Promise<Resultado> {
  const r = await puxarDoGoogle(conexao);
  r.enviados = await enviarPendentes(conexao);
  return r;
}

// ---------------------------------------------------------------------------
// Canal de avisos do Google
// ---------------------------------------------------------------------------

/**
 * Abre (ou renova) o canal pelo qual o Google avisa que a agenda mudou.
 *
 * Sem ele, a agenda do CRM só atualizaria quando alguém clicasse em
 * "sincronizar" -- ou seja, a metade "Google → CRM" da promessa não existiria
 * na prática.
 *
 * O canal expira, e o Google não avisa que expirou: ele simplesmente para de
 * bater. Por isso guardamos o vencimento e renovamos antes.
 */
export async function abrirCanalDeAvisos(
  conexao: Conexao & { channel_token?: string | null }
): Promise<{ ok: boolean; motivo?: string }> {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');

  // O Google exige endereço público em HTTPS com domínio verificado. Em
  // desenvolvimento isso não existe, e falhar aqui não pode impedir o resto de
  // funcionar: o "sincronizar agora" continua dando conta.
  if (!base || !base.startsWith('https://')) {
    return { ok: false, motivo: 'Avisos automáticos exigem um endereço público em HTTPS.' };
  }

  const sb = createStaticAdminClient();

  // Fecha o canal anterior antes de abrir outro. Sem isso, cada renovação
  // deixaria um canal órfão batendo aqui, e a mesma mudança chegaria várias
  // vezes.
  if (conexao.channel_id && conexao.channel_resource_id) {
    try {
      await chamarGoogle(conexao, '/channels/stop', {
        method: 'POST',
        body: JSON.stringify({
          id: conexao.channel_id,
          resourceId: conexao.channel_resource_id,
        }),
      });
    } catch {
      // Canal já vencido devolve erro; seguir em frente é o certo.
    }
  }

  const id = crypto.randomUUID();
  const segredo = crypto.randomUUID();
  const agenda = encodeURIComponent(conexao.calendar_id || 'primary');

  const resposta = await chamarGoogle(conexao, `/calendars/${agenda}/events/watch`, {
    method: 'POST',
    body: JSON.stringify({
      id,
      type: 'web_hook',
      address: `${base}/api/calendar/google/aviso`,
      token: segredo,
      // Máximo que o Google aceita para agenda. Renovamos antes de vencer.
      params: { ttl: '2592000' },
    }),
  });

  if (!resposta.ok) {
    const texto = await resposta.text();
    const motivo = `Google recusou abrir o canal (${resposta.status}).`;
    await sb
      .from('user_calendar_connections')
      .update({ last_error: `${motivo} ${texto.slice(0, 200)}` })
      .eq('user_id', conexao.user_id);
    return { ok: false, motivo };
  }

  const dados = (await resposta.json()) as { resourceId?: string; expiration?: string };

  await sb
    .from('user_calendar_connections')
    .update({
      channel_id: id,
      channel_token: segredo,
      channel_resource_id: dados.resourceId ?? null,
      channel_expires_at: dados.expiration
        ? new Date(Number(dados.expiration)).toISOString()
        : null,
      last_error: null,
    })
    .eq('user_id', conexao.user_id);

  return { ok: true };
}

/**
 * Renova os canais que estão perto de vencer.
 *
 * Chamado pela rotina diária. A folga de dois dias existe porque a rotina roda
 * uma vez por dia: sem ela, um canal que vencesse no meio do dia deixaria a
 * agenda muda até o dia seguinte.
 */
export async function renovarCanaisQueVencem(): Promise<{ renovados: number; falhas: number }> {
  const sb = createStaticAdminClient();
  const limite = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();

  const { data } = await sb
    .from('user_calendar_connections')
    .select('*')
    .or(`channel_expires_at.is.null,channel_expires_at.lt.${limite}`);

  let renovados = 0;
  let falhas = 0;

  for (const linha of (data ?? []) as Conexao[]) {
    try {
      const r = await abrirCanalDeAvisos(linha);
      r.ok ? renovados++ : falhas++;
    } catch {
      falhas++;
    }
  }

  return { renovados, falhas };
}

// ---------------------------------------------------------------------------
// Fila de envio
// ---------------------------------------------------------------------------

/**
 * Envia o que está na fila de uma pessoa.
 *
 * A fila é alimentada por um gatilho no banco, então pega toda gravação de
 * atividade -- da tela, do agente de IA ou da API pública. Drenar aqui é o que
 * transforma "foi gravado no CRM" em "está na agenda dela".
 */
export async function drenarFila(
  conexao: Conexao,
  limite = 50
): Promise<{ enviados: number; falhas: number }> {
  const sb = createStaticAdminClient();

  const { data } = await sb
    .from('calendar_sync_queue')
    .select('id, activity_id, tentativas')
    .eq('owner_id', conexao.user_id)
    // Desiste depois de cinco tentativas: item que falha sempre travaria a fila
    // e faria a mesma chamada ao Google para sempre.
    .lt('tentativas', 5)
    .order('criado_em', { ascending: true })
    .limit(limite);

  let enviados = 0;
  let falhas = 0;

  for (const item of (data ?? []) as Array<{ id: number; activity_id: string; tentativas: number }>) {
    const r = await enviarAtividade(item.activity_id, conexao);

    if (r.ok) {
      await sb.from('calendar_sync_queue').delete().eq('id', item.id);
      enviados++;
    } else {
      await sb
        .from('calendar_sync_queue')
        .update({ tentativas: item.tentativas + 1, ultimo_erro: (r.motivo || '').slice(0, 300) })
        .eq('id', item.id);
      falhas++;
    }
  }

  const remocoes = await drenarRemocoes(conexao);
  falhas += remocoes.falhas;

  return { enviados, falhas };
}

/** Drena a fila de todo mundo. Usado pela rotina diária, como rede de segurança. */
export async function drenarFilaDeTodos(): Promise<{ enviados: number; falhas: number }> {
  const sb = createStaticAdminClient();

  const { data: donos } = await sb
    .from('calendar_sync_queue')
    .select('owner_id')
    .lt('tentativas', 5);

  const unicos = [...new Set(((donos ?? []) as Array<{ owner_id: string }>).map((d) => d.owner_id))];

  let enviados = 0;
  let falhas = 0;

  for (const userId of unicos) {
    const { data } = await sb
      .from('user_calendar_connections')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) continue;
    try {
      const r = await drenarFila(data as Conexao);
      enviados += r.enviados;
      falhas += r.falhas;
    } catch {
      falhas++;
    }
  }

  return { enviados, falhas };
}

/**
 * Apaga no Google os eventos de atividades que foram removidas do CRM.
 *
 * Apagar atividade remove a linha de vez, entao o id do evento so sobrevive
 * porque um gatilho o guarda antes. Sem esta drenagem, o compromisso cancelado
 * continuaria na agenda da pessoa, com lembrete e tudo.
 */
export async function drenarRemocoes(
  conexao: Conexao,
  limite = 50
): Promise<{ apagados: number; falhas: number }> {
  const sb = createStaticAdminClient();

  const { data } = await sb
    .from('calendar_deletions')
    .select('id, google_event_id, google_calendar_id, tentativas')
    .eq('owner_id', conexao.user_id)
    .lt('tentativas', 5)
    .order('criado_em', { ascending: true })
    .limit(limite);

  let apagados = 0;
  let falhas = 0;

  for (const item of (data ?? []) as Array<{
    id: number;
    google_event_id: string;
    google_calendar_id: string;
    tentativas: number;
  }>) {
    try {
      const agenda = encodeURIComponent(item.google_calendar_id || 'primary');
      const r = await chamarGoogle(
        conexao,
        `/calendars/${agenda}/events/${encodeURIComponent(item.google_event_id)}`,
        { method: 'DELETE' }
      );

      // 404 e 410 significam "ja nao esta la", que e exatamente o objetivo.
      if (r.ok || r.status === 404 || r.status === 410) {
        await sb.from('calendar_deletions').delete().eq('id', item.id);
        apagados++;
      } else {
        await sb
          .from('calendar_deletions')
          .update({ tentativas: item.tentativas + 1, ultimo_erro: `Google respondeu ${r.status}.` })
          .eq('id', item.id);
        falhas++;
      }
    } catch (e) {
      await sb
        .from('calendar_deletions')
        .update({
          tentativas: item.tentativas + 1,
          ultimo_erro: (e instanceof Error ? e.message : 'falha').slice(0, 300),
        })
        .eq('id', item.id);
      falhas++;
    }
  }

  return { apagados, falhas };
}
