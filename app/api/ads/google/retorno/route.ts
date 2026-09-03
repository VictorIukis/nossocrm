/**
 * Volta do Google depois da autorização do Google Ads.
 *
 * Guarda o refresh token e, quando a autorização alcança uma única conta,
 * já a seleciona: é o caso da maioria, e poupar essa escolha evita a tela
 * "conectado mas não mostra nada", que parece defeito.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { credenciaisApp, trocarCodigoPorToken, listarContas } from '@/lib/ads/google';
import { enderecoPublico } from '@/lib/calendar/google';
import { COOKIE_ESTADO_ADS } from '../conectar/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

function voltar(mensagem: string, ok = false) {
  const url = new URL(`${enderecoPublico()}/settings/integracoes`);
  url.hash = 'google-ads';
  url.searchParams.set(ok ? 'conectado' : 'erro', mensagem);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const codigo = url.searchParams.get('code');
  const estadoRecebido = url.searchParams.get('state');
  const recusado = url.searchParams.get('error');

  if (recusado) {
    return voltar(
      recusado === 'access_denied'
        ? 'Você cancelou a autorização no Google.'
        : `O Google recusou: ${recusado}`
    );
  }
  if (!codigo) return voltar('O Google não devolveu o código de autorização.');

  const cookieEstado = req.headers
    .get('cookie')
    ?.split('; ')
    .find((c) => c.startsWith(`${COOKIE_ESTADO_ADS}=`))
    ?.split('=')[1];

  if (!cookieEstado || cookieEstado !== estadoRecebido) {
    return voltar('A autorização não confere com esta sessão. Tente conectar de novo.');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return voltar('Sua sessão expirou durante a autorização.');

  const { data: perfil } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single();

  if (!perfil?.organization_id) return voltar('Seu usuário não está ligado a uma organização.');
  if (perfil.role !== 'admin') return voltar('Só um administrador pode conectar a conta.');

  const cred = credenciaisApp();
  if (!cred) return voltar('Google Ads não está configurado nesta instalação.');

  const tokens = await trocarCodigoPorToken(cred, codigo);
  if (!tokens.access_token || !tokens.refresh_token) {
    return voltar(
      tokens.error_description ||
        tokens.error ||
        'O Google não devolveu autorização de longo prazo. Tente conectar de novo.'
    );
  }

  const admin = createStaticAdminClient();

  await admin
    .from('organization_settings')
    .update({
      google_ads_refresh_token: tokens.refresh_token,
      google_ads_access_token: tokens.access_token,
      google_ads_token_expires_at: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000
      ).toISOString(),
      google_ads_last_error: null,
    })
    .eq('organization_id', perfil.organization_id);

  // Descobre as contas que a autorização alcança.
  try {
    const contas = await listarContas(tokens.refresh_token, perfil.organization_id);

    if (contas.length === 1) {
      await admin
        .from('organization_settings')
        .update({ google_ads_customer_id: contas[0].id })
        .eq('organization_id', perfil.organization_id);
      return voltar(`Conectado à conta ${contas[0].id}`, true);
    }

    if (contas.length === 0) {
      return voltar(
        'Autorizado, mas esta conta Google não acessa nenhuma conta de anúncios.'
      );
    }

    return voltar(
      `Autorizado. Encontrei ${contas.length} contas — escolha qual usar.`,
      true
    );
  } catch (e) {
    // A autorização em si deu certo; só a descoberta falhou. Dizer isso é
    // melhor que apagar tudo e mandar começar de novo.
    return voltar(
      `Autorizado, mas não consegui listar as contas: ${
        e instanceof Error ? e.message : 'erro desconhecido'
      }`,
      true
    );
  }
}
