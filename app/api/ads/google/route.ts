/**
 * Painel do Google Ads, escolha da conta e desconexão.
 *
 * GET    → números do período, ou o estado da conexão quando falta escolher a conta.
 * PATCH  → grava qual conta ler (e a gerenciadora, quando houver).
 * DELETE → desconecta e revoga no Google.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  buscarPainel,
  credenciaisApp,
  listarContas,
  periodoValido,
  soDigitos,
  type ConexaoGoogleAds,
} from '@/lib/ads/google';

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

interface LinhaConfig {
  google_ads_refresh_token?: string | null;
  google_ads_access_token?: string | null;
  google_ads_token_expires_at?: string | null;
  google_ads_customer_id?: string | null;
  google_ads_login_customer_id?: string | null;
  google_ads_account_name?: string | null;
  google_ads_last_error?: string | null;
}

const CAMPOS =
  'google_ads_refresh_token, google_ads_access_token, google_ads_token_expires_at,' +
  ' google_ads_customer_id, google_ads_login_customer_id, google_ads_account_name,' +
  ' google_ads_last_error';

async function lerConfig(organizationId: string): Promise<LinhaConfig | null> {
  const sb = createStaticAdminClient();
  const { data } = await sb
    .from('organization_settings')
    .select(CAMPOS)
    .eq('organization_id', organizationId)
    .maybeSingle();
  return (data as LinhaConfig | null) ?? null;
}

export async function GET(req: Request) {
  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const disponivel = Boolean(credenciaisApp());
  const cfg = await lerConfig(ctx.organizationId);
  const autorizado = Boolean(cfg?.google_ads_refresh_token);

  if (!disponivel || !autorizado) {
    return json({
      disponivel,
      autorizado,
      contaEscolhida: false,
      ehAdmin: ctx.ehAdmin,
    });
  }

  // Autorizado mas sem conta escolhida: estado legítimo quando a autorização
  // alcança várias contas. A tela precisa oferecer a escolha, não um erro.
  if (!cfg?.google_ads_customer_id) {
    let contas: Array<{ id: string }> = [];
    let erroLista: string | null = null;
    try {
      contas = await listarContas(cfg!.google_ads_refresh_token!, ctx.organizationId);
    } catch (e) {
      erroLista = e instanceof Error ? e.message : 'Não consegui listar as contas.';
    }
    return json({
      disponivel: true,
      autorizado: true,
      contaEscolhida: false,
      ehAdmin: ctx.ehAdmin,
      contas,
      error: erroLista,
    });
  }

  const url = new URL(req.url);
  const periodo = periodoValido(url.searchParams.get('periodo'));
  const atualizar = url.searchParams.get('atualizar') === '1';

  const conexao: ConexaoGoogleAds = {
    organizationId: ctx.organizationId,
    refreshToken: cfg.google_ads_refresh_token!,
    accessToken: cfg.google_ads_access_token ?? null,
    expiraEm: cfg.google_ads_token_expires_at ?? null,
    customerId: cfg.google_ads_customer_id,
    loginCustomerId: cfg.google_ads_login_customer_id ?? null,
    accountName: cfg.google_ads_account_name ?? null,
  };

  const sb = createStaticAdminClient();

  try {
    const painel = await buscarPainel(conexao, periodo, atualizar);

    await sb
      .from('organization_settings')
      .update({
        google_ads_last_error: null,
        google_ads_account_name: painel.conta.nome,
      })
      .eq('organization_id', ctx.organizationId);

    return json({
      disponivel: true,
      autorizado: true,
      contaEscolhida: true,
      ehAdmin: ctx.ehAdmin,
      painel,
    });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'Falha ao falar com o Google Ads.';

    await sb
      .from('organization_settings')
      .update({ google_ads_last_error: motivo.slice(0, 500) })
      .eq('organization_id', ctx.organizationId);

    return json(
      {
        disponivel: true,
        autorizado: true,
        contaEscolhida: true,
        ehAdmin: ctx.ehAdmin,
        error: motivo,
      },
      502
    );
  }
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;
  if (!ctx.ehAdmin) return json({ error: 'Sem permissão' }, 403);

  const corpo = (await req.json().catch(() => null)) as
    | { customerId?: string; loginCustomerId?: string }
    | null;
  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  const conta = soDigitos(corpo.customerId || '');
  if (!conta) return json({ error: 'Informe o número da conta.' }, 400);

  const sb = createStaticAdminClient();
  const { error } = await sb
    .from('organization_settings')
    .update({
      google_ads_customer_id: conta,
      google_ads_login_customer_id: soDigitos(corpo.loginCustomerId || '') || null,
      google_ads_last_error: null,
    })
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[ads/google PATCH]', error);
    return json({ error: 'Não foi possível salvar.' }, 500);
  }

  // Cache pertence à conta anterior.
  await sb
    .from('ads_insights_cache')
    .delete()
    .eq('organization_id', ctx.organizationId)
    .eq('provedor', 'google');

  return json({ ok: true, customerId: conta });
}

export async function DELETE(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;
  if (!ctx.ehAdmin) return json({ error: 'Sem permissão' }, 403);

  const cfg = await lerConfig(ctx.organizationId);

  // Revoga de verdade no Google. Sem isto, o consentimento continua listado na
  // conta como se o CRM ainda tivesse acesso.
  const token = cfg?.google_ads_refresh_token || cfg?.google_ads_access_token;
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch {
      // Se o Google não responder, ainda removemos daqui.
    }
  }

  const sb = createStaticAdminClient();
  await sb
    .from('organization_settings')
    .update({
      google_ads_refresh_token: null,
      google_ads_access_token: null,
      google_ads_token_expires_at: null,
      google_ads_customer_id: null,
      google_ads_login_customer_id: null,
      google_ads_account_name: null,
      google_ads_last_error: null,
    })
    .eq('organization_id', ctx.organizationId);

  await sb
    .from('ads_insights_cache')
    .delete()
    .eq('organization_id', ctx.organizationId)
    .eq('provedor', 'google');

  return json({ ok: true, autorizado: false });
}
