/**
 * Configuração do Clicksign: segredo do webhook e etapa de destino.
 *
 * O segredo nunca volta ao navegador — a tela só sabe se existe.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { enderecoPublico } from '@/lib/calendar/google';

export const runtime = 'nodejs';

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function contexto() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: json({ error: 'Não autenticado' }, 401) };

  const { data: perfil } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single();

  if (!perfil?.organization_id) return { erro: json({ error: 'Perfil sem organização' }, 404) };

  return {
    supabase,
    organizationId: perfil.organization_id as string,
    ehAdmin: perfil.role === 'admin',
  };
}

export async function GET() {
  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  // A aba de Integrações já é só de admin na tela. Repetir aqui porque a rota
  // devolve a lista de contratos pendentes, que é informação comercial.
  if (!ctx.ehAdmin) return json({ error: 'Sem permissão' }, 403);

  const sb = createStaticAdminClient();

  const { data } = await sb
    .from('organization_settings')
    .select('clicksign_webhook_secret, clicksign_stage_id, clicksign_last_event_at, clicksign_last_error')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const cfg = data as {
    clicksign_webhook_secret?: string;
    clicksign_stage_id?: string;
    clicksign_last_event_at?: string;
    clicksign_last_error?: string;
  } | null;

  // Etapas de todos os funis, para a pessoa escolher onde o negócio deve cair
  // quando o contrato é assinado.
  const { data: etapas } = await ctx.supabase
    .from('board_stages')
    .select('id, name, board_id, boards(name)')
    .order('order', { ascending: true });

  // Quantos contratos estão pendurados agora: é o número que responde à dor
  // original -- "quem ainda não assinou?".
  const { data: pendentes } = await sb
    .from('deals')
    .select('id, title, clicksign_status, clicksign_sent_at')
    .eq('organization_id', ctx.organizationId)
    .eq('clicksign_status', 'aguardando')
    .is('deleted_at', null)
    .or('is_lost.is.null,is_lost.eq.false')
    .order('clicksign_sent_at', { ascending: true, nullsFirst: false })
    .limit(20);

  return json({
    ehAdmin: ctx.ehAdmin,
    configurado: Boolean(cfg?.clicksign_webhook_secret),
    etapaDestino: cfg?.clicksign_stage_id ?? null,
    ultimoEvento: cfg?.clicksign_last_event_at ?? null,
    ultimoErro: cfg?.clicksign_last_error ?? null,
    urlDoWebhook: `${enderecoPublico()}/api/clicksign/aviso`,
    etapas: (etapas ?? []) as Array<{
      id: string;
      name: string;
      board_id: string;
      boards?: { name?: string } | null;
    }>,
    aguardandoAssinatura: (pendentes ?? []) as Array<{
      id: string;
      title: string;
      clicksign_sent_at: string | null;
    }>,
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;
  if (!ctx.ehAdmin) return json({ error: 'Sem permissão' }, 403);

  const corpo = (await req.json().catch(() => null)) as
    | { segredo?: string; etapaDestino?: string | null; remover?: boolean }
    | null;
  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  const sb = createStaticAdminClient();

  if (corpo.remover) {
    await sb
      .from('organization_settings')
      .update({
        clicksign_webhook_secret: null,
        clicksign_stage_id: null,
        clicksign_last_error: null,
      })
      .eq('organization_id', ctx.organizationId);
    return json({ ok: true, configurado: false });
  }

  const mudanca: Record<string, unknown> = { clicksign_last_error: null };

  // Segredo em branco mantém o guardado: assim dá para trocar só a etapa sem
  // redigitar o segredo.
  const segredo = (corpo.segredo || '').trim();
  if (segredo) mudanca.clicksign_webhook_secret = segredo;

  // `etapaDestino` vazia é escolha legítima: "registre a assinatura, mas não
  // mova o negócio". Por isso o campo aceita null explicitamente.
  if (corpo.etapaDestino !== undefined) {
    const alvo = corpo.etapaDestino || null;

    // Confere que a etapa é desta organização. A tela só oferece as próprias,
    // mas quem chama a API direto poderia apontar para a etapa de outra empresa,
    // e aí o negócio sairia do quadro onde as pessoas olham.
    if (alvo) {
      const { data: etapa } = await sb
        .from('board_stages')
        .select('id')
        .eq('id', alvo)
        .eq('organization_id', ctx.organizationId)
        .maybeSingle();
      if (!etapa) return json({ error: 'Etapa não encontrada nesta organização.' }, 400);
    }

    mudanca.clicksign_stage_id = alvo;
  }

  const { error } = await sb
    .from('organization_settings')
    .update(mudanca)
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[settings/clicksign]', error);
    return json({ error: 'Não foi possível salvar.' }, 500);
  }

  return json({ ok: true });
}
