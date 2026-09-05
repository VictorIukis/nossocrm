/**
 * Lead vindo do RD Station.
 *
 *   POST /api/rd/lead/<fonteId>
 *
 * O RD chama isto quando alguém converte numa landing page. O que acontece
 * aqui é só receber e guardar: contato, negócio, respostas do formulário, e uma
 * linha na fila para falar com a pessoa daqui a alguns minutos.
 *
 * Nada de WhatsApp neste caminho, de propósito. Receber é barato e não pode
 * falhar; falar é o que quebra, repete e chega na hora errada. Se o disparo
 * estiver fora do ar, o lead continua entrando no CRM -- que é o que ninguém
 * pode perder.
 *
 * Responde 200 mesmo quando não processa: o RD reenvia em erro, e uma falha
 * persistente viraria tempestade de retentativa.
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { lerLeadDoRD, respostasEmTexto } from '@/lib/rd/payload';

export const runtime = 'nodejs';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Comparação em tempo constante: segredo curto vaza pelo tempo de resposta. */
function segredoConfere(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function POST(req: Request, ctx: { params: Promise<{ fonteId: string }> }) {
  const { fonteId } = await ctx.params;

  const corpoBruto = await req.text();
  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoBruto);
  } catch {
    return json(400, { error: 'corpo inválido' });
  }

  const sb = createStaticAdminClient();

  const { data: fonte } = await sb
    .from('integration_inbound_sources')
    .select('id, organization_id, entry_board_id, entry_stage_id, secret, active')
    .eq('id', fonteId)
    .maybeSingle();

  const f = fonte as {
    id: string;
    organization_id: string;
    entry_board_id: string;
    entry_stage_id: string;
    secret: string;
    active: boolean;
  } | null;

  if (!f) return json(404, { error: 'fonte não encontrada' });
  if (!f.active) return json(200, { ok: true, ignorado: 'fonte desativada' });

  // O RD não assina o corpo. O segredo vai na URL do webhook, como parâmetro:
  // é o que o RD permite, e é por isso que o id da fonte sozinho não basta.
  const url = new URL(req.url);
  const segredo =
    url.searchParams.get('segredo') ||
    req.headers.get('x-webhook-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  if (!segredo || !segredoConfere(segredo, f.secret)) {
    return json(401, { error: 'segredo inválido' });
  }

  const lead = lerLeadDoRD(corpo);
  if (!lead || (!lead.email && !lead.telefone)) {
    // Sem e-mail nem telefone não há a quem responder, e criar contato vazio só
    // suja a base.
    return json(200, { ok: true, ignorado: 'lead sem e-mail e sem telefone' });
  }

  // Duplicata: o RD reenvia em erro, e o botão "Verificar" da tela dele dispara
  // de novo. Sem isto, o mesmo lead viraria dois negócios e duas abordagens.
  if (lead.conversaoId) {
    const { data: jaTem } = await sb
      .from('rd_conversoes')
      .select('id, contact_id, deal_id')
      .eq('organization_id', f.organization_id)
      .eq('conversao_id', lead.conversaoId)
      .maybeSingle();

    if (jaTem) {
      return json(200, { ok: true, repetido: true, conversao: (jaTem as { id: number }).id });
    }
  }

  // ---- contato -------------------------------------------------------------
  //
  // Procura por e-mail e por telefone: a mesma pessoa pode ter convertido antes
  // com um e-mail e agora deixado o WhatsApp.
  let contatoId: string | null = null;

  if (lead.email) {
    const { data } = await sb
      .from('contacts')
      .select('id')
      .eq('organization_id', f.organization_id)
      .ilike('email', lead.email)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    contatoId = (data as { id: string } | null)?.id ?? null;
  }

  if (!contatoId && lead.telefone) {
    const { data } = await sb
      .from('contacts')
      .select('id')
      .eq('organization_id', f.organization_id)
      .eq('phone', lead.telefone)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    contatoId = (data as { id: string } | null)?.id ?? null;
  }

  const camposDoContato = {
    name: lead.nome || lead.email || lead.telefone,
    email: lead.email,
    phone: lead.telefone,
    company_name: lead.empresa,
    // A coluna do cargo chama-se `role` nesta tabela.
    role: lead.cargo,
    source: 'rd_station',
  };

  if (contatoId) {
    // Só preenche buraco: se o contato já tem telefone, o do formulário novo não
    // apaga o que já estava lá.
    const { data: atual } = await sb
      .from('contacts')
      .select('name, email, phone, company_name, role, source')
      .eq('id', contatoId)
      .maybeSingle();

    const a = (atual || {}) as Record<string, string | null>;
    const mudanca: Record<string, string> = {};
    for (const [k, v] of Object.entries(camposDoContato)) {
      if (v && !a[k]) mudanca[k] = v;
    }
    if (Object.keys(mudanca).length > 0) {
      await sb.from('contacts').update(mudanca).eq('id', contatoId);
    }
  } else {
    const { data: novo, error } = await sb
      .from('contacts')
      .insert({ organization_id: f.organization_id, ...camposDoContato })
      .select('id')
      .single();

    if (error) {
      console.error('[rd] falha ao criar contato:', error);
      return json(200, { ok: false, erro: error.message });
    }
    contatoId = (novo as { id: string }).id;
  }

  // ---- negócio -------------------------------------------------------------
  const contexto = respostasEmTexto(lead.respostas);

  const { data: negocio, error: erroNegocio } = await sb
    .from('deals')
    .insert({
      organization_id: f.organization_id,
      title: lead.empresa || lead.nome || 'Lead do RD Station',
      contact_id: contatoId,
      board_id: f.entry_board_id,
      stage_id: f.entry_stage_id,
      status: f.entry_stage_id,
      value: 0,
      // As respostas ficam no negócio para quem abrir ver sem procurar.
      custom_fields: {
        origem: 'rd_station',
        formulario: lead.identificador,
        ...lead.respostas,
      },
    })
    .select('id')
    .single();

  if (erroNegocio) {
    console.error('[rd] falha ao criar negócio:', erroNegocio);
  }

  const negocioId = (negocio as { id: string } | null)?.id ?? null;

  // ---- registro do que chegou ---------------------------------------------
  const { data: conversao } = await sb
    .from('rd_conversoes')
    .insert({
      organization_id: f.organization_id,
      fonte_id: f.id,
      conversao_id: lead.conversaoId,
      email: lead.email,
      telefone: lead.telefone,
      identificador: lead.identificador,
      corpo: corpo as object,
      contact_id: contatoId,
      deal_id: negocioId,
    })
    .select('id')
    .single();

  const conversaoLinha = (conversao as { id: number } | null)?.id ?? null;

  if (negocioId && contexto) {
    await sb.from('deal_activities').insert({
      deal_id: negocioId,
      organization_id: f.organization_id,
      type: 'note',
      description: `Respostas do formulário (${lead.identificador || 'RD Station'}):\n${contexto}`,
      metadata: { origem: 'rd_station', respostas: lead.respostas },
    });
  }

  // ---- fila do primeiro contato -------------------------------------------
  const { data: cfg } = await sb
    .from('organization_settings')
    .select('rd_primeiro_contato_ativo, rd_atraso_minutos')
    .eq('organization_id', f.organization_id)
    .maybeSingle();

  const c = (cfg || {}) as { rd_primeiro_contato_ativo?: boolean; rd_atraso_minutos?: number };

  let filaId: number | null = null;
  let motivoSemFila: string | null = null;

  if (!lead.telefone) {
    motivoSemFila = 'lead sem telefone';
  } else if (!c.rd_primeiro_contato_ativo) {
    // A fila é montada mesmo desligado? Não: linha aguardando que nunca sai
    // vira mensagem atrasada no dia em que alguém ligar a chave.
    motivoSemFila = 'primeiro contato desligado nas configurações';
  } else {
    const minutos = c.rd_atraso_minutos ?? 5;
    const { data: naFila, error: erroFila } = await sb
      .from('primeiro_contato_fila')
      .insert({
        organization_id: f.organization_id,
        contact_id: contatoId,
        deal_id: negocioId,
        conversao_id: conversaoLinha,
        telefone: lead.telefone,
        variaveis: {
          nome: lead.primeiroNome || lead.nome || '',
          empresa: lead.empresa || '',
          formulario: lead.identificador || '',
          contexto,
        },
        enviar_em: new Date(Date.now() + minutos * 60_000).toISOString(),
      })
      .select('id')
      .single();

    if (erroFila) {
      // Índice único por contato: já existe um primeiro contato a caminho. É o
      // caso de quem converte duas vezes seguidas, e não é erro.
      motivoSemFila = erroFila.code === '23505' ? 'já existe primeiro contato a caminho' : erroFila.message;
    } else {
      filaId = (naFila as { id: number }).id;
    }
  }

  return json(200, {
    ok: true,
    contato: contatoId,
    negocio: negocioId,
    fila: filaId,
    semFila: motivoSemFila,
  });
}
