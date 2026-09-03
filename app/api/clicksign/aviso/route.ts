/**
 * Aviso do Clicksign: alguma coisa aconteceu com um contrato.
 *
 *   POST /api/clicksign/aviso
 *
 * Resolve a dor do Renato: hoje alguém precisa entrar no Clicksign para saber
 * se o cliente assinou, porque o projeto só começa depois disso. Com este
 * caminho, o negócio anda sozinho e a assinatura fica registrada no histórico.
 *
 * Como o CRM descobre de qual negócio é o contrato, em ordem:
 *
 *  1. Pela chave do documento, se o negócio já foi ligado antes.
 *  2. Pelo e-mail de quem assina: acha o contato e, dele, o negócio aberto mais
 *     recente. É o caminho que funciona sem ninguém configurar nada.
 *
 * Quando não encontra, registra e para. Adivinhar o negócio seria pior do que
 * não achar: mover o negócio errado de etapa faz alguém começar um projeto que
 * não foi vendido.
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { assinaturaConfere, significadoDoEvento } from '@/lib/clicksign/assinatura';

export const runtime = 'nodejs';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface EventoClicksign {
  event?: {
    name?: string;
    occurred_at?: string;
    data?: { user?: { email?: string; name?: string } };
  };
  document?: {
    key?: string;
    filename?: string;
    status?: string;
    signers?: Array<{ email?: string; name?: string; signed_at?: string | null }>;
  };
}

export async function POST(req: Request) {
  // Lê como texto: a assinatura é do corpo exato que chegou. Reserializar o
  // JSON mudaria espaços e ordem de chaves, e a conferência falharia sempre.
  const corpoBruto = await req.text();

  let evento: EventoClicksign;
  try {
    evento = JSON.parse(corpoBruto) as EventoClicksign;
  } catch {
    return json(400, { error: 'corpo inválido' });
  }

  const chaveDoDocumento = evento.document?.key;
  const nomeDoEvento = evento.event?.name;

  if (!chaveDoDocumento) return json(200, { ok: true, ignorado: 'aviso sem documento' });

  const sb = createStaticAdminClient();

  // Descobre de qual organização é o aviso.
  //
  // O Clicksign não diz. Duas formas: o documento já estar ligado a um negócio,
  // ou -- na primeira vez -- o e-mail de quem assina bater com um contato.
  const emailAssinante =
    evento.event?.data?.user?.email ||
    evento.document?.signers?.find((s) => s.email)?.email ||
    null;

  const { data: negocioLigado } = await sb
    .from('deals')
    .select('id, organization_id, title, board_id, contact_id')
    .eq('clicksign_document_key', chaveDoDocumento)
    .maybeSingle();

  let negocio = negocioLigado as {
    id: string;
    organization_id: string;
    title: string;
    board_id: string | null;
    contact_id: string | null;
  } | null;

  if (!negocio && emailAssinante) {
    const { data: contato } = await sb
      .from('contacts')
      .select('id, organization_id')
      .ilike('email', emailAssinante)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    const c = contato as { id: string; organization_id: string } | null;

    if (c) {
      // O negócio mais recente do contato, ignorando os perdidos: negócio
      // perdido não recebe contrato, e mexer nele reabriria história encerrada.
      // Ganho continua elegível -- renovação chega como contrato novo no mesmo
      // negócio.
      const { data: candidato } = await sb
        .from('deals')
        .select('id, organization_id, title, board_id, contact_id')
        .eq('contact_id', c.id)
        .eq('organization_id', c.organization_id)
        .is('deleted_at', null)
        .or('is_lost.is.null,is_lost.eq.false')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      negocio = candidato as typeof negocio;
    }
  }

  if (!negocio) {
    console.warn(
      '[clicksign] aviso sem negócio correspondente:',
      chaveDoDocumento,
      emailAssinante ?? 'sem e-mail'
    );
    // 200 de propósito: o Clicksign reenvia em erro, e não achar o negócio é
    // situação legítima (contrato de algo que não passou pelo CRM).
    return json(200, { ok: true, ignorado: 'nenhum negócio corresponde' });
  }

  // Só agora, sabendo a organização, dá para conferir a assinatura com o
  // segredo certo.
  const { data: cfg } = await sb
    .from('organization_settings')
    .select('clicksign_webhook_secret, clicksign_stage_id')
    .eq('organization_id', negocio.organization_id)
    .maybeSingle();

  const config = cfg as {
    clicksign_webhook_secret?: string;
    clicksign_stage_id?: string;
  } | null;

  if (config?.clicksign_webhook_secret) {
    const cabecalho = req.headers.get('x-clicksign-signature') || '';
    const veredito = await assinaturaConfere(
      corpoBruto,
      config.clicksign_webhook_secret,
      cabecalho
    );

    if (!veredito.ok) {
      const aviso = `Aviso do Clicksign recusado: ${veredito.motivo}. Confira o segredo do webhook.`;
      console.warn('[clicksign]', aviso);

      await sb
        .from('organization_settings')
        .update({ clicksign_last_error: aviso })
        .eq('organization_id', negocio.organization_id)
        .neq('clicksign_last_error', aviso)
        .then(undefined, () => {});

      return json(401, { error: aviso });
    }
  } else {
    // Sem segredo salvo, qualquer um que descubra o endereço pode declarar um
    // contrato assinado. Aceitar é o que permite ligar a integração antes de
    // colar o segredo, mas isso não pode ficar invisível: a tela de
    // Configurações mostra este aviso.
    await sb
      .from('organization_settings')
      .update({
        clicksign_last_error:
          'Avisos do Clicksign estão sendo aceitos sem conferir a assinatura. Salve o segredo do webhook para fechar isso.',
      })
      .eq('organization_id', negocio.organization_id);
  }

  const significado = significadoDoEvento(nomeDoEvento);
  if (!significado) {
    return json(200, { ok: true, ignorado: `evento ${nomeDoEvento ?? 'sem nome'}` });
  }

  const agora = new Date().toISOString();
  const quando = evento.event?.occurred_at || agora;

  const mudanca: Record<string, unknown> = {
    clicksign_document_key: chaveDoDocumento,
    clicksign_status: significado,
  };
  if (significado === 'assinado') mudanca.clicksign_signed_at = quando;

  // `upload` é a criação do documento: é o momento em que o contrato saiu para
  // assinatura, e é a data que a lista "aguardando assinatura" mostra. Não vale
  // marcar em `sign`, senão a data pularia para a última assinatura parcial e a
  // lista deixaria de mostrar há quanto tempo o contrato está pendurado.
  if (nomeDoEvento === 'upload') mudanca.clicksign_sent_at = quando;

  // Move de etapa só quando o contrato FECHA e quando há etapa configurada.
  // Sem etapa configurada, ainda registra: avisar sem mover é melhor que não
  // avisar.
  let moveu = false;
  if (significado === 'assinado' && config?.clicksign_stage_id) {
    const { data: etapa } = await sb
      .from('board_stages')
      .select('id, board_id')
      .eq('id', config.clicksign_stage_id)
      .eq('organization_id', negocio.organization_id)
      .maybeSingle();

    const e = etapa as { id: string; board_id: string } | null;

    // A etapa tem que pertencer ao funil do negócio. Mover para etapa de outro
    // funil deixaria o negócio invisível no quadro onde as pessoas olham.
    if (e && (!negocio.board_id || e.board_id === negocio.board_id)) {
      mudanca.stage_id = e.id;
      mudanca.status = e.id; // o CRM mantém os dois iguais
      moveu = true;
    } else if (e) {
      console.warn('[clicksign] etapa configurada é de outro funil; não movi o negócio');
    }
  }

  const { error: erroUpdate } = await sb.from('deals').update(mudanca).eq('id', negocio.id);

  if (erroUpdate) {
    console.error('[clicksign] falha ao atualizar negócio:', erroUpdate);
    return json(200, { ok: false, erro: erroUpdate.message });
  }

  // Registra no histórico do negócio. É o que responde "quando ele assinou?"
  // sem ninguém abrir o Clicksign.
  // O texto sai do EVENTO, não só do significado: 'upload' e 'sign' são os dois
  // "aguardando", mas um é o contrato saindo e o outro é uma parte assinando. Dar
  // o mesmo texto aos dois fazia o envio aparecer no histórico como se alguém já
  // tivesse assinado.
  const porEvento: Record<string, string> = {
    upload: 'Contrato enviado para assinatura',
    sign: emailAssinante ? `Assinatura registrada: ${emailAssinante}` : 'Uma das partes assinou',
    add_signer: 'Signatário adicionado ao contrato',
    remove_signer: 'Signatário removido do contrato',
  };

  const texto: Record<typeof significado, string> = {
    assinado: 'Contrato assinado por todas as partes',
    aguardando: porEvento[nomeDoEvento ?? ''] ?? 'Contrato aguardando assinatura',
    recusado: emailAssinante ? `Assinatura recusada por ${emailAssinante}` : 'Assinatura recusada',
    cancelado:
      nomeDoEvento === 'deadline'
        ? 'Prazo de assinatura do contrato venceu'
        : 'Contrato cancelado',
  };

  // A tabela tem `type` (não `activity_type`) e não tem `title`: o texto todo vai
  // em `description`. Os valores de `type` são fechados por CHECK -- 'note' é o
  // que cabe aqui.
  const { error: erroHistorico } = await sb.from('deal_activities').insert({
    deal_id: negocio.id,
    organization_id: negocio.organization_id,
    type: 'note',
    description:
      `${texto[significado]} · ${evento.document?.filename || 'Documento'} · Clicksign` +
      (moveu ? ' · negócio movido de etapa automaticamente' : ''),
    metadata: {
      origem: 'clicksign',
      evento: nomeDoEvento,
      documento: chaveDoDocumento,
      assinante: emailAssinante,
    },
  });

  // O negócio já foi atualizado; falhar aqui não desfaz aquilo. Registra e segue,
  // senão o Clicksign reenviaria o aviso e o histórico ganharia linha repetida.
  if (erroHistorico) console.error('[clicksign] falha ao registrar histórico:', erroHistorico);

  await sb
    .from('organization_settings')
    .update({
      clicksign_last_event_at: agora,
      // Não limpa o erro quando o aviso entrou sem conferência: aquele aviso
      // ainda vale, e limpar aqui o apagaria no mesmo pedido que o escreveu.
      ...(config?.clicksign_webhook_secret ? { clicksign_last_error: null } : {}),
    })
    .eq('organization_id', negocio.organization_id);

  return json(200, {
    ok: true,
    negocio: negocio.id,
    status: significado,
    moveuDeEtapa: moveu,
  });
}
