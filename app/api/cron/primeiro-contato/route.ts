/**
 * Drena a fila do primeiro contato.
 *
 * Chamada de minuto em minuto pelo `pg_cron` do próprio Supabase, e não pelo
 * agendador da Vercel: no plano atual ele roda uma vez por dia, o que não serve
 * para "cinco minutos depois". Como o gatilho vem de dentro do banco, ele
 * continua funcionando mesmo que nada esteja aberto na tela.
 *
 * Reserva antes de enviar, com FOR UPDATE SKIP LOCKED: duas execuções
 * sobrepostas não podem mandar a mesma mensagem duas vezes para a mesma pessoa.
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import {
  abrirConversaComModelo,
  preencherModelo,
  type ContaChatwoot,
} from '@/lib/messaging/providers/chatwoot/iniciarConversa';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Quantos por rodada. Um minuto de função não comporta muito mais. */
const LOTE = 10;
const MAX_TENTATIVAS = 3;

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface LinhaDaFila {
  id: number;
  organization_id: string;
  contact_id: string | null;
  deal_id: string | null;
  telefone: string;
  variaveis: Record<string, string>;
  tentativas: number;
  regra_id: string | null;
}

interface Regra {
  id: string;
  apelido: string;
  modelo_nome: string | null;
  modelo_texto: string | null;
  modelo_variaveis: string[] | null;
  modelo_idioma: string;
  modelo_categoria: string;
  dispara: boolean;
}

export async function GET(req: Request) {
  const sb = createStaticAdminClient();

  // O segredo vive no banco, não em variável de ambiente.
  //
  // Quem chama esta rota é o próprio Postgres, de minuto em minuto. Se o valor
  // tivesse de existir nos dois lugares, alguém teria de copiá-lo de um ao
  // outro -- e segredo que passa por uma tela ou por um histórico de terminal
  // deixa de ser segredo. Assim ele é gerado dentro do banco e lido aqui pela
  // credencial de serviço que o servidor já tem.
  const { data: segredoLinha } = await sb
    .from('segredos_internos')
    .select('valor')
    .eq('nome', 'fila_primeiro_contato')
    .maybeSingle();

  const segredo = (segredoLinha as { valor?: string } | null)?.valor;
  const cabecalho = req.headers.get('authorization');

  if (!segredo || cabecalho !== `Bearer ${segredo}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { data: reservadas, error: erroReserva } = await sb.rpc('reservar_primeiro_contato', {
    limite: LOTE,
    max_tentativas: MAX_TENTATIVAS,
  });

  if (erroReserva) {
    console.error('[primeiro-contato] falha ao reservar:', erroReserva);
    return json({ error: 'Falha ao reservar a fila' }, 500);
  }

  const lote = (reservadas ?? []) as LinhaDaFila[];
  if (lote.length === 0) return json({ enviados: 0, falhas: 0 });

  let enviados = 0;
  let falhas = 0;

  // Configuração por organização (chave mestra e canal) e regra por formulário
  // (o que dizer). Buscadas uma vez por rodada.
  const orgs = [...new Set(lote.map((l) => l.organization_id))];
  const config = new Map<string, Record<string, unknown>>();

  for (const org of orgs) {
    const { data } = await sb
      .from('organization_settings')
      .select('rd_primeiro_contato_ativo, rd_canal_id')
      .eq('organization_id', org)
      .maybeSingle();
    config.set(org, (data || {}) as Record<string, unknown>);
  }

  const idsDeRegra = [...new Set(lote.map((l) => l.regra_id).filter(Boolean))] as string[];
  const regras = new Map<string, Regra>();

  if (idsDeRegra.length > 0) {
    const { data } = await sb
      .from('rd_regras')
      .select('id, apelido, modelo_nome, modelo_texto, modelo_variaveis, modelo_idioma, modelo_categoria, dispara')
      .in('id', idsDeRegra);

    for (const r of ((data ?? []) as Regra[])) regras.set(r.id, r);
  }

  for (const linha of lote) {
    const cfg = config.get(linha.organization_id) || {};

    const encerrar = async (status: string, erro: string | null, conversa?: string) => {
      await sb
        .from('primeiro_contato_fila')
        .update({
          status,
          ultimo_erro: erro,
          enviado_em: status === 'enviado' ? new Date().toISOString() : null,
          conversa_chatwoot: conversa ?? null,
        })
        .eq('id', linha.id);
    };

    // Chave desligada entre a entrada do lead e a hora do envio: não manda.
    if (!cfg.rd_primeiro_contato_ativo) {
      await encerrar('cancelado', 'primeiro contato desligado nas configurações');
      continue;
    }

    const regra = linha.regra_id ? regras.get(linha.regra_id) : undefined;
    if (!regra) {
      // A regra sumiu entre a entrada do lead e o envio (alguém apagou).
      // Cancelar é mais honesto do que escolher outra por conta própria.
      await encerrar('cancelado', 'a regra deste lead não existe mais');
      continue;
    }

    if (!regra.dispara) {
      await encerrar('cancelado', `a regra "${regra.apelido}" foi desligada`);
      continue;
    }

    const nomeDoModelo = regra.modelo_nome || '';
    const textoDoModelo = regra.modelo_texto || '';
    if (!nomeDoModelo || !textoDoModelo) {
      await encerrar('falhou', `a regra "${regra.apelido}" está sem modelo aprovado`);
      falhas++;
      continue;
    }

    const { data: canal } = await sb
      .from('messaging_channels')
      .select('id, credentials')
      .eq('id', (cfg.rd_canal_id as string) || '')
      .maybeSingle();

    const cred = ((canal as { credentials?: Record<string, string> } | null)?.credentials || {}) as
      Record<string, string>;

    if (!cred.baseUrl || !cred.accountId) {
      await encerrar('falhou', 'canal do WhatsApp não configurado para o primeiro contato');
      falhas++;
      continue;
    }

    const conta: ContaChatwoot = {
      baseUrl: cred.baseUrl,
      accountId: cred.accountId,
      inboxId: cred.inboxId,
      apiAccessToken: cred.apiAccessToken,
    };

    // A ordem das variáveis é configuração, não convenção: um modelo aprovado
    // pode ter só a empresa em {{1}}, e mandar o nome ali não dá erro nenhum --
    // manda "para a Fabricio" e a pessoa lê.
    const campos = regra.modelo_variaveis ?? ['empresa'];
    const valores = campos.map((campo) => linha.variaveis?.[campo] ?? '');
    const preenchido = preencherModelo(textoDoModelo, valores);
    if (!preenchido.ok) {
      await encerrar('falhou', preenchido.motivo);
      falhas++;
      continue;
    }

    const r = await abrirConversaComModelo(
      conta,
      linha.telefone,
      linha.variaveis?.nome || null,
      null,
      {
        nome: nomeDoModelo,
        idioma: regra.modelo_idioma || 'pt_BR',
        categoria: regra.modelo_categoria || 'marketing',
        textoFinal: preenchido.texto,
        variaveis: valores,
      }
    );

    if (r.ok) {
      await encerrar('enviado', null, r.conversaId);
      enviados++;

      if (linha.deal_id) {
        await sb.from('deal_activities').insert({
          deal_id: linha.deal_id,
          organization_id: linha.organization_id,
          type: 'contacted',
          description: `Primeiro contato enviado no WhatsApp (regra "${regra.apelido}"): ${preenchido.texto}`,
          metadata: {
            origem: 'primeiro_contato',
            regra: regra.apelido,
            conversa_chatwoot: r.conversaId,
          },
        });
      }
    } else {
      falhas++;
      // Recuperável volta para a fila; o resto morre aqui com o motivo à vista.
      const voltaParaFila = r.recuperavel && linha.tentativas < MAX_TENTATIVAS;
      await sb
        .from('primeiro_contato_fila')
        .update({
          status: voltaParaFila ? 'aguardando' : 'falhou',
          ultimo_erro: r.motivo,
          // Espera crescente: a instância pode estar reiniciando.
          enviar_em: voltaParaFila
            ? new Date(Date.now() + linha.tentativas * 5 * 60_000).toISOString()
            : undefined,
        })
        .eq('id', linha.id);

      await sb
        .from('organization_settings')
        .update({ rd_ultimo_erro: r.motivo.slice(0, 400) })
        .eq('organization_id', linha.organization_id);
    }
  }

  return json({ enviados, falhas, lote: lote.length });
}
