/**
 * Painel do Meta Ads, e a conexão da organização com a conta de anúncios.
 *
 * GET  → devolve os números do período pedido.
 * POST → guarda ou remove a conexão (só administrador).
 *
 * O token de anúncios nunca volta ao navegador: ele dá acesso ao investimento
 * da empresa, e a tela só precisa saber se existe conexão e qual conta é.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  buscarPainel,
  conferirConexao,
  periodoValido,
  type ConexaoMeta,
} from '@/lib/ads/meta';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
    organizationId: perfil.organization_id as string,
    ehAdmin: perfil.role === 'admin',
  };
}

async function lerConexao(organizationId: string): Promise<ConexaoMeta | null> {
  const sb = createStaticAdminClient();
  const { data } = await sb
    .from('organization_settings')
    .select('meta_ads_token, meta_ads_account_id, meta_ads_account_name')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const c = data as {
    meta_ads_token?: string;
    meta_ads_account_id?: string;
    meta_ads_account_name?: string;
  } | null;

  if (!c?.meta_ads_token?.trim() || !c?.meta_ads_account_id?.trim()) return null;

  return {
    token: c.meta_ads_token,
    accountId: c.meta_ads_account_id,
    accountName: c.meta_ads_account_name ?? null,
  };
}

export async function GET(req: Request) {
  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const url = new URL(req.url);
  const periodo = periodoValido(url.searchParams.get('periodo'));
  const atualizar = url.searchParams.get('atualizar') === '1';

  const conexao = await lerConexao(ctx.organizationId);
  if (!conexao) {
    // Não é erro: é a situação de quem ainda não conectou. A tela precisa
    // distinguir isso de uma falha, senão mostra vermelho para quem só não
    // configurou ainda.
    return json({ conectado: false, ehAdmin: ctx.ehAdmin });
  }

  try {
    const painel = await buscarPainel(ctx.organizationId, conexao, periodo, atualizar);

    const sb = createStaticAdminClient();
    await sb
      .from('organization_settings')
      .update({ meta_ads_last_error: null })
      .eq('organization_id', ctx.organizationId);

    return json({ conectado: true, ehAdmin: ctx.ehAdmin, painel });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'Falha ao falar com a Meta.';

    // Guardar o motivo, e não só falhar. Token de anúncio expira em silêncio, e
    // sem registro o sintoma seria um painel vazio sem explicação.
    const sb = createStaticAdminClient();
    await sb
      .from('organization_settings')
      .update({ meta_ads_last_error: motivo.slice(0, 400) })
      .eq('organization_id', ctx.organizationId);

    return json({ conectado: true, ehAdmin: ctx.ehAdmin, error: motivo }, 502);
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;
  if (!ctx.ehAdmin) return json({ error: 'Sem permissão' }, 403);

  const corpo = (await req.json().catch(() => null)) as
    | { token?: string; accountId?: string; remover?: boolean }
    | null;
  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  const sb = createStaticAdminClient();

  if (corpo.remover) {
    await sb
      .from('organization_settings')
      .update({
        meta_ads_token: null,
        meta_ads_account_id: null,
        meta_ads_account_name: null,
        meta_ads_last_error: null,
      })
      .eq('organization_id', ctx.organizationId);

    await sb
      .from('ads_insights_cache')
      .delete()
      .eq('organization_id', ctx.organizationId)
      .eq('provedor', 'meta');

    return json({ ok: true, conectado: false });
  }

  const accountId = (corpo.accountId || '').trim();
  if (!accountId) return json({ error: 'Informe a conta de anúncios.' }, 400);

  // Token em branco mantém o guardado: assim dá para trocar só a conta sem
  // redigitar o token, que é longo e ninguém decora.
  let token = (corpo.token || '').trim();
  if (!token) {
    const atual = await lerConexao(ctx.organizationId);
    if (!atual) return json({ error: 'Informe o token de acesso.' }, 400);
    token = atual.token;
  }

  const conferido = await conferirConexao(token, accountId);
  if (!conferido.ok) {
    // Conferir antes de guardar. Token inválido salvo em silêncio vira um
    // painel vazio, e ninguém liga uma coisa à outra.
    return json({ error: conferido.motivo }, 400);
  }

  const { error } = await sb
    .from('organization_settings')
    .update({
      meta_ads_token: token,
      meta_ads_account_id: accountId.startsWith('act_') ? accountId : `act_${accountId}`,
      meta_ads_account_name: conferido.nome,
      meta_ads_last_error: null,
    })
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[ads/meta]', error);
    return json({ error: 'Não foi possível salvar.' }, 500);
  }

  // Cache antigo pertence à conta antiga.
  await sb
    .from('ads_insights_cache')
    .delete()
    .eq('organization_id', ctx.organizationId)
    .eq('provedor', 'meta');

  return json({ ok: true, conectado: true, nome: conferido.nome, moeda: conferido.moeda });
}
