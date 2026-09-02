/**
 * Webhook do Chatwoot.
 *
 *   POST /api/messaging/chatwoot/<channel_id>
 *
 * Recebe os eventos de uma instalacao do Chatwoot e espelha as conversas dentro
 * do CRM, coladas no contato e no negocio.
 *
 * Por que uma rota do Next e nao uma Edge Function como os outros provedores:
 * as Edge Functions dependem de um passo de publicacao separado no Supabase.
 * Uma rota do proprio app sobe junto com o deploy, entao o caminho fica com uma
 * peca a menos para dar errado. O Chatwoot e infraestrutura da propria casa, e
 * nao um terceiro com formato imprevisivel, entao nao ha ganho em isolar.
 *
 * Duas guardas importantes:
 *  - nota privada nao vira mensagem, senao recado interno da equipe apareceria
 *    no historico do cliente
 *  - mensagem de SAIDA tambem e gravada: e assim que a resposta das IAs de
 *    atendimento aparece aqui, porque elas respondem pelo Chatwoot
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { assinaturaConfere } from '@/lib/messaging/providers/chatwoot/assinatura';

export const runtime = 'nodejs';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Normaliza telefone para o mesmo formato que o resto do CRM usa. */
function normalizarTelefone(bruto?: string | null): string | null {
  if (!bruto) return null;
  const digitos = String(bruto).replace(/\D/g, '');
  return digitos.length >= 10 ? digitos : null;
}

interface EventoChatwoot {
  event?: string;
  id?: number;
  content?: string | null;
  message_type?: 'incoming' | 'outgoing' | number;
  private?: boolean;
  created_at?: string | number;
  conversation?: {
    id?: number;
    inbox_id?: number;
    meta?: { sender?: RemetenteChatwoot };
  };
  sender?: RemetenteChatwoot;
}

interface RemetenteChatwoot {
  id?: number;
  name?: string;
  phone_number?: string | null;
  email?: string | null;
  thumbnail?: string | null;
}

/**
 * Descreve um erro de forma util.
 *
 * O erro do Supabase nao e um Error do JavaScript: e um objeto com message,
 * code, details e hint. Com `e instanceof Error` ele caia em "desconhecido",
 * ou seja, justamente a falha mais provavel nesta rota era a que nao dizia
 * nada. Custou uma investigacao inteira para descobrir que o problema era um
 * indice incompativel com o ON CONFLICT.
 */
function descreverErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as { message?: string; code?: string; details?: string; hint?: string };
    const partes = [o.message, o.code && `(${o.code})`, o.details, o.hint].filter(Boolean);
    if (partes.length) return partes.join(' ');
    return JSON.stringify(e).slice(0, 300);
  }
  return String(e);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;
  if (!channelId) return json(404, { error: 'channel_id ausente na URL' });

  // Le como texto, e nao com req.json(), porque a assinatura e calculada sobre
  // os bytes exatos que chegaram. Reserializar o objeto mudaria espacos e ordem
  // de chaves, e a conferencia falharia sempre.
  const corpoBruto = await req.text();
  let evento: EventoChatwoot | null = null;
  try {
    evento = JSON.parse(corpoBruto) as EventoChatwoot;
  } catch {
    return json(400, { error: 'corpo inválido' });
  }
  if (!evento) return json(400, { error: 'corpo inválido' });

  const supabase = createStaticAdminClient();

  const { data: canal, error: erroCanal } = await supabase
    .from('messaging_channels')
    .select('id, organization_id, business_unit_id, credentials, status')
    .eq('id', channelId)
    .maybeSingle();

  if (erroCanal) return json(500, { error: 'erro ao buscar canal' });
  if (!canal) return json(404, { error: 'canal não encontrado' });

  // Conferencia de assinatura.
  //
  // Eu tinha escrito aqui que o Chatwoot nao assina o corpo. Ele assina: ao
  // criar o webhook, a propria tela entrega um segredo e passa a mandar o HMAC
  // do corpo em cada evento. Sem conferir isso, qualquer pessoa que descobrisse
  // esta URL poderia inserir mensagem falsa no historico de um cliente.
  const cred = (canal.credentials || {}) as { webhookSecret?: string };
  if (cred.webhookSecret) {
    const assinatura = req.headers.get('x-chatwoot-signature') || '';
    if (!assinatura) {
      return json(401, { error: 'evento sem assinatura' });
    }

    const veredito = await assinaturaConfere(
      corpoBruto,
      cred.webhookSecret,
      assinatura,
      req.headers.get('x-chatwoot-timestamp') || ''
    );

    if (!veredito.ok) {
      // O motivo vai para o log porque existe uma versao do Chatwoot em que o
      // segredo mostrado na tela nao e o mesmo usado para assinar. Se isso
      // acontecer aqui, a mensagem para de chegar e sem esta linha nao haveria
      // como distinguir "segredo errado" de "webhook nao configurado".
      console.warn('[chatwoot] evento recusado:', veredito.motivo);
      return json(401, { error: `assinatura inválida: ${veredito.motivo}` });
    }
  }

  // Só mensagem interessa. Os demais eventos sao aceitos e ignorados, para o
  // Chatwoot nao marcar o webhook como quebrado e parar de entregar.
  if (evento.event !== 'message_created' || evento.private) {
    return json(200, { ok: true, ignorado: evento.event || 'sem evento' });
  }

  const conversaChatwoot = evento.conversation?.id;
  if (!conversaChatwoot) return json(200, { ok: true, ignorado: 'sem conversa' });

  // Duas identidades diferentes, que estavam sendo confundidas:
  //  - `remetente` e sempre o CLIENTE, dono da conversa. E dele que saem o
  //    telefone, o contato e o nome da conversa.
  //  - o AUTOR da mensagem muda: na entrada e o cliente, na saida e quem
  //    respondeu (a Sofia, outra IA de atendimento, ou uma pessoa do time).
  // Usar o remetente como autor fazia a resposta da Sofia aparecer assinada com
  // o nome do proprio cliente.
  const remetente = evento.conversation?.meta?.sender || evento.sender;
  const telefone = normalizarTelefone(remetente?.phone_number);
  const entrada = evento.message_type === 'incoming' || evento.message_type === 0;
  const quando = evento.created_at ? new Date(evento.created_at) : new Date();
  const chaveExterna = String(conversaChatwoot);

  try {
    // ---- conversa -----------------------------------------------------------
    const { data: existente } = await supabase
      .from('messaging_conversations')
      .select('id, contact_id, unread_count, message_count')
      .eq('channel_id', canal.id)
      .eq('external_contact_id', chaveExterna)
      .maybeSingle();

    let conversaId: string;
    let contatoId: string | null = existente?.contact_id ?? null;

    if (existente) {
      conversaId = existente.id;
    } else {
      // Casa com contato que ja exista pelo telefone, antes de criar outro.
      // Sem isto, o mesmo cliente viraria dois registros no CRM.
      if (telefone) {
        const { data: achado } = await supabase
          .from('contacts')
          .select('id')
          .eq('organization_id', canal.organization_id)
          .ilike('phone', `%${telefone.slice(-8)}%`)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        contatoId = achado?.id ?? null;
      }

      if (!contatoId) {
        const { data: novo } = await supabase
          .from('contacts')
          .insert({
            organization_id: canal.organization_id,
            name: remetente?.name || telefone || 'Contato do WhatsApp',
            phone: telefone ? `+${telefone}` : null,
            email: remetente?.email || null,
            source: 'chatwoot',
            stage: 'LEAD',
            status: 'ACTIVE',
            last_interaction: quando.toISOString(),
          })
          .select('id')
          .single();
        contatoId = novo?.id ?? null;
      }

      const { data: nova, error: erroNova } = await supabase
        .from('messaging_conversations')
        .insert({
          organization_id: canal.organization_id,
          channel_id: canal.id,
          business_unit_id: canal.business_unit_id,
          external_contact_id: chaveExterna,
          external_contact_name: remetente?.name || telefone || 'Contato',
          external_contact_avatar: remetente?.thumbnail || null,
          contact_id: contatoId,
          status: 'open',
          priority: 'normal',
          metadata: { origem: 'chatwoot', chatwoot_conversation_id: conversaChatwoot },
        })
        .select('id')
        .single();

      if (erroNova) throw erroNova;
      conversaId = nova.id;
    }

    // ---- mensagem -----------------------------------------------------------
    // O id da mensagem no Chatwoot e a chave de deduplicacao: o Chatwoot
    // reenvia o evento quando nao recebe 200 rapido, e sem isto a mesma
    // mensagem apareceria duas vezes na tela.
    const { error: erroMsg } = await supabase
      .from('messaging_messages')
      .upsert(
        {
          conversation_id: conversaId,
          // NULL, nunca string vazia: '' colidiria com a proxima mensagem
          // sem id externo no indice de deduplicacao.
          external_id: evento.id != null ? String(evento.id) : null,
          direction: entrada ? 'inbound' : 'outbound',
          content_type: 'text',
          content: { type: 'text', text: evento.content || '' },
          status: entrada ? 'delivered' : 'sent',
          delivered_at: quando.toISOString(),
          sender_name: (entrada ? remetente?.name : evento.sender?.name) || null,
          // 'contact' quando quem falou foi o cliente; 'agent' para o que saiu
          // do Chatwoot, seja uma pessoa do time ou uma das IAs de atendimento.
          // O CRM nao tem como distinguir as duas daqui, e fingir que tem seria
          // pior do que nao dizer.
          sender_type: entrada ? 'contact' : 'agent',
          metadata: { chatwoot_message_id: evento.id, chatwoot_conversation_id: conversaChatwoot },
        },
        { onConflict: 'conversation_id,external_id' }
      );

    if (erroMsg) throw erroMsg;

    // ---- resumo da conversa -------------------------------------------------
    await supabase
      .from('messaging_conversations')
      .update({
        last_message_at: quando.toISOString(),
        last_message_preview: (evento.content || '').slice(0, 160),
        last_message_direction: entrada ? 'inbound' : 'outbound',
        message_count: (existente?.message_count ?? 0) + 1,
        unread_count: entrada ? (existente?.unread_count ?? 0) + 1 : existente?.unread_count ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversaId);

    if (contatoId) {
      await supabase
        .from('contacts')
        .update({ last_interaction: quando.toISOString() })
        .eq('id', contatoId);
    }

    return json(200, { ok: true, conversa: conversaId });
  } catch (e) {
    // Devolve 200 mesmo em falha de processamento, de proposito: o Chatwoot
    // reenvia em erro e uma falha persistente viraria tempestade de retentativa.
    // O erro fica no log, que e onde se investiga.
    console.error('[chatwoot] falha ao processar evento:', e);
    return json(200, { ok: false, erro: descreverErro(e) });
  }
}
