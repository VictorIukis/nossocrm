/**
 * Diagnóstico: tudo que responde "está funcionando?" num lugar só.
 *
 * Junta o que já existe espalhado (estado de cada canal, fila do primeiro
 * contato, rotinas do banco, último erro de cada integração) porque o problema
 * não era falta de informação, era ela estar em sete telas e no banco.
 *
 * Só administrador: mostra número de investimento, telefone de lead e o que
 * cada integração falhou.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { julgar, julgarRotina, type Veredito } from '@/lib/diagnostico/veredito';

export const runtime = 'nodejs';
export const maxDuration = 30;

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

interface Item extends Veredito {
  nome: string;
  detalhe?: string;
  numeros?: Array<{ rotulo: string; valor: string | number }>;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const { data: perfil } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single();

  if (!perfil?.organization_id) return json({ error: 'Perfil sem organização' }, 404);
  if (perfil.role !== 'admin') return json({ error: 'Sem permissão' }, 403);

  const org = perfil.organization_id as string;
  const sb = createStaticAdminClient();
  const agora = Date.now();

  // ---- rotinas do banco ---------------------------------------------------
  const { data: rotinasBrutas } = await sb.rpc('diagnostico_rotinas');

  const rotinas = ((rotinasBrutas ?? []) as Array<{
    nome: string;
    agendamento: string;
    ativa: boolean;
    ultima_execucao: string | null;
    ultimo_status: string | null;
    falhas_24h: number | null;
    ultimo_http: number | null;
  }>).map((r) => ({
    nome: r.nome,
    detalhe: r.agendamento,
    ...julgarRotina(r, agora),
  }));

  // ---- configuração e erros por integração --------------------------------
  const { data: cfgLinha } = await sb
    .from('organization_settings')
    .select(
      'clicksign_webhook_secret, clicksign_last_event_at, clicksign_last_error,' +
        ' rd_primeiro_contato_ativo, rd_ultimo_erro, rd_canal_id,' +
        ' rd_janela_inicio, rd_janela_fim, rd_limite_diario, timezone,' +
        ' meta_ads_token, meta_ads_last_error, google_ads_refresh_token, google_ads_last_error,' +
        ' ads_modo_demo'
    )
    .eq('organization_id', org)
    .maybeSingle();

  const cfg = (cfgLinha || {}) as Record<string, unknown>;

  const itens: Item[] = [];

  // ---- canais de mensagem -------------------------------------------------
  const { data: canais } = await sb
    .from('messaging_channels')
    .select('id, name, provider, status, status_message, last_connected_at')
    .eq('organization_id', org)
    .is('deleted_at', null);

  for (const c of ((canais ?? []) as Array<{
    name: string; provider: string; status: string; status_message: string | null; last_connected_at: string | null;
  }>)) {
    itens.push({
      nome: c.name,
      detalhe: c.provider,
      ...julgar(
        {
          ultimoSucesso: c.last_connected_at,
          ultimoErro: c.status === 'connected' ? null : c.status_message || `status: ${c.status}`,
        },
        agora
      ),
    });
  }

  // ---- RD Station ---------------------------------------------------------
  const { data: ultimaConversao } = await sb
    .from('rd_conversoes')
    .select('criado_em')
    .eq('organization_id', org)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: leads7d } = await sb
    .from('rd_conversoes')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org)
    .gte('criado_em', new Date(agora - 7 * 24 * 3_600_000).toISOString());

  itens.push({
    nome: 'RD Station (entrada de leads)',
    numeros: [{ rotulo: 'leads em 7 dias', valor: leads7d ?? 0 }],
    ...julgar(
      {
        ultimoSucesso: (ultimaConversao as { criado_em?: string } | null)?.criado_em ?? null,
        ultimoErro: (cfg.rd_ultimo_erro as string) || null,
      },
      agora
    ),
  });

  // ---- fila do primeiro contato -------------------------------------------
  const { data: fila } = await sb
    .from('primeiro_contato_fila')
    .select('status, enviar_em, ultimo_erro, enviado_em')
    .eq('organization_id', org);

  const linhas = (fila ?? []) as Array<{
    status: string; enviar_em: string; ultimo_erro: string | null; enviado_em: string | null;
  }>;

  const contagem: Record<string, number> = {};
  for (const l of linhas) contagem[l.status] = (contagem[l.status] ?? 0) + 1;

  // Atrasada é a que passou da hora e continua esperando. É o sintoma que
  // aparece quando a rotina para: a fila enche e ninguém recebe.
  const atrasadas = linhas.filter(
    (l) => l.status === 'aguardando' && new Date(l.enviar_em).getTime() < agora - 10 * 60_000
  ).length;

  const ultimoEnvio = linhas
    .filter((l) => l.enviado_em)
    .map((l) => l.enviado_em as string)
    .sort()
    .pop();

  const { data: enviadasHoje } = await sb.rpc('primeiros_contatos_de_hoje', { org });
  const limiteDiario = (cfg.rd_limite_diario as number) ?? 100;
  const saiuHoje = Number(enviadasHoje ?? 0);

  // Fila com hora futura é o comportamento normal fora do horário: a mensagem
  // foi remarcada, não perdida. Só conta como atrasada a que passou da hora e
  // continua parada, que é o sintoma de rotina morta.
  itens.push({
    nome: 'Primeiro contato no WhatsApp',
    detalhe: `${cfg.rd_janela_inicio ?? 9}h às ${cfg.rd_janela_fim ?? 20}h`,
    numeros: [
      { rotulo: `enviadas hoje (teto ${limiteDiario})`, valor: saiuHoje },
      { rotulo: 'na fila', valor: contagem.aguardando ?? 0 },
      { rotulo: 'atrasadas', valor: atrasadas },
      { rotulo: 'enviadas', valor: contagem.enviado ?? 0 },
      { rotulo: 'falharam', valor: contagem.falhou ?? 0 },
    ],
    ...julgar(
      {
        ligado: Boolean(cfg.rd_primeiro_contato_ativo),
        ultimoSucesso: ultimoEnvio ?? null,
        ultimoErro:
          atrasadas > 0
            ? `${atrasadas} mensagem(ns) passaram da hora e continuam na fila`
            : (linhas.find((l) => l.status === 'falhou')?.ultimo_erro ?? null),
      },
      agora
    ),
  });

  // Teto alcançado não é defeito: é o freio funcionando. Mas precisa aparecer,
  // porque significa fila esperando o dia seguinte.
  if (saiuHoje >= limiteDiario && (contagem.aguardando ?? 0) > 0) {
    const ultimo = itens[itens.length - 1];
    ultimo.estado = 'atencao';
    ultimo.resumo = `Teto de ${limiteDiario} por dia alcançado; ${contagem.aguardando} esperando amanhã`;
  }

  // ---- Clicksign ----------------------------------------------------------
  const { count: aguardandoAssinatura } = await sb
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org)
    .eq('clicksign_status', 'aguardando')
    .is('deleted_at', null);

  itens.push({
    nome: 'Clicksign',
    numeros: [{ rotulo: 'aguardando assinatura', valor: aguardandoAssinatura ?? 0 }],
    ...julgar(
      {
        ligado: Boolean(cfg.clicksign_webhook_secret),
        ultimoSucesso: (cfg.clicksign_last_event_at as string) || null,
        ultimoErro: (cfg.clicksign_last_error as string) || null,
      },
      agora
    ),
  });

  // ---- agenda do Google ---------------------------------------------------
  const { data: conexoes } = await sb
    .from('user_calendar_connections')
    .select('user_id, refresh_token, channel_expires_at, last_synced_at, last_error')
    .not('refresh_token', 'is', null);

  const { data: filaAgenda } = await sb
    .from('calendar_sync_queue')
    .select('criado_em, ultimo_erro');

  const { count: remocoesPendentes } = await sb
    .from('calendar_deletions')
    .select('id', { count: 'exact', head: true });

  const cx = (conexoes ?? []) as Array<{
    channel_expires_at: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  }>;

  // O que medir aqui NÃO é "quando puxamos do Google pela última vez".
  //
  // A leitura só acontece quando o Google avisa que algo mudou, ou quando
  // alguém abre a tela da agenda. Numa semana sem mexer no calendário, o
  // silêncio é o comportamento correto -- e cobrar prazo dele pintava de
  // amarelo uma integração saudável. Vi isso na própria tela, no primeiro dia:
  // "sem sinal há 3 dias" com o canal válido por mais um mês.
  //
  // O que de fato quebra em silêncio é outra coisa:
  //
  //  1. o canal de avisos expira, e o Google só para de bater, sem avisar;
  //  2. a fila de envio para de ser drenada, e o compromisso criado aqui nunca
  //     chega na agenda de ninguém.
  const canalVencido = cx.filter(
    (c) => !c.channel_expires_at || new Date(c.channel_expires_at).getTime() < agora
  ).length;

  const canalVencendo = cx.filter(
    (c) =>
      c.channel_expires_at &&
      new Date(c.channel_expires_at).getTime() >= agora &&
      new Date(c.channel_expires_at).getTime() < agora + 3 * 24 * 3_600_000
  ).length;

  const fa = (filaAgenda ?? []) as Array<{ criado_em: string; ultimo_erro: string | null }>;

  // Uma hora: a fila é drenada ao salvar e pela rotina diária. Item parado
  // além disso significa que os dois caminhos falharam.
  const paradasNaFila = fa.filter(
    (f) => new Date(f.criado_em).getTime() < agora - 3_600_000
  ).length;

  itens.push({
    nome: 'Agenda do Google',
    numeros: [
      { rotulo: 'pessoas conectadas', valor: cx.length },
      { rotulo: 'na fila de envio', valor: fa.length },
      { rotulo: 'remoções pendentes', valor: remocoesPendentes ?? 0 },
    ],
    ...julgar(
      {
        ligado: cx.length > 0,
        // O sucesso aqui é o canal estar de pé, não a última leitura.
        ultimoSucesso: canalVencido === 0 && cx.length > 0 ? new Date(agora).toISOString() : null,
        ultimoErro:
          cx.map((c) => c.last_error).find(Boolean) ??
          fa.map((f) => f.ultimo_erro).find(Boolean) ??
          (canalVencido > 0
            ? `${canalVencido} canal(is) de aviso venceram: o Google parou de avisar`
            : paradasNaFila > 0
              ? `${paradasNaFila} compromisso(s) presos na fila há mais de uma hora`
              : null),
      },
      agora
    ),
  });

  if (canalVencendo > 0 && canalVencido === 0) {
    // Aviso antes de virar problema: a renovação é diária, então três dias de
    // folga significam três tentativas antes de o Google emudecer.
    const ultimo = itens[itens.length - 1];
    if (ultimo.estado === 'ok') {
      ultimo.estado = 'atencao';
      ultimo.resumo = `${canalVencendo} canal(is) de aviso vencem em menos de 3 dias`;
    }
  }

  // ---- Ads ----------------------------------------------------------------
  itens.push({
    nome: 'Meta Ads',
    detalhe: cfg.ads_modo_demo ? 'modo demonstração' : undefined,
    ...julgar(
      {
        ligado: Boolean(cfg.meta_ads_token) || Boolean(cfg.ads_modo_demo),
        ultimoErro: (cfg.meta_ads_last_error as string) || null,
        ultimoSucesso: cfg.ads_modo_demo ? new Date(agora).toISOString() : null,
      },
      agora
    ),
  });

  itens.push({
    nome: 'Google Ads',
    detalhe: cfg.ads_modo_demo ? 'modo demonstração' : undefined,
    ...julgar(
      {
        ligado: Boolean(cfg.google_ads_refresh_token) || Boolean(cfg.ads_modo_demo),
        ultimoErro: (cfg.google_ads_last_error as string) || null,
        ultimoSucesso: cfg.ads_modo_demo ? new Date(agora).toISOString() : null,
      },
      agora
    ),
  });

  // ---- IA -----------------------------------------------------------------
  const { data: filaIA } = await sb
    .from('ai_pending_evaluations')
    .select('status')
    .eq('organization_id', org);

  const iaPendentes = ((filaIA ?? []) as Array<{ status: string }>).filter(
    (f) => f.status === 'pending'
  ).length;
  const iaFalhas = ((filaIA ?? []) as Array<{ status: string }>).filter(
    (f) => f.status === 'failed'
  ).length;

  const { data: ultimoUso } = await sb
    .from('ai_conversation_log')
    .select('created_at')
    .eq('organization_id', org)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fila vazia e sem falha é "nada a fazer", não "nunca funcionou".
  //
  // A tela dizia "nunca funcionou desde que foi configurado" porque a tabela de
  // registro está vazia, e isso é verdade sem ser informação: a fila só recebe
  // linha quando o agente sugere avanço de etapa. Quem lê iria caçar um defeito
  // que não existe.
  //
  // O que importa é fila presa: pendente que ninguém consumiu significa que a
  // rotina parou, e aí avanço de etapa deixa de acontecer sem ninguém notar.
  const iaSemNada = iaPendentes === 0 && iaFalhas === 0;

  itens.push({
    nome: 'IA (fila de avaliação)',
    numeros: [
      { rotulo: 'pendentes', valor: iaPendentes },
      { rotulo: 'falharam', valor: iaFalhas },
    ],
    ...(iaSemNada
      ? {
          estado: 'ok' as const,
          resumo: (ultimoUso as { created_at?: string } | null)?.created_at
            ? 'Nada pendente'
            : 'Nada pendente (a fila ainda não recebeu nenhuma avaliação)',
        }
      : julgar(
          {
            ultimoSucesso: (ultimoUso as { created_at?: string } | null)?.created_at ?? null,
            ultimoErro: iaFalhas > 0 ? `${iaFalhas} avaliação(ões) falharam` : null,
          },
          agora
        )),
  });

  const piorEstado = ['parado', 'atencao', 'sem_sinal', 'desligado', 'ok'].find((e) =>
    [...itens, ...rotinas].some((i) => i.estado === e)
  );

  return json({
    verificadoEm: new Date(agora).toISOString(),
    resumo: piorEstado ?? 'ok',
    integracoes: itens,
    rotinas,
  });
}
