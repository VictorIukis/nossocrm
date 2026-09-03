/**
 * Começa a autorização do Google Ads para a organização.
 *
 * Diferente do Calendar, que é de cada pessoa, a conta de anúncios é da
 * empresa: quem conecta é administrador, e a conexão vale para o time inteiro.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { credenciaisApp, urlDeAutorizacao } from '@/lib/ads/google';
import { enderecoPublico } from '@/lib/calendar/google';

export const runtime = 'nodejs';

export const COOKIE_ESTADO_ADS = 'crm_gads_state';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', enderecoPublico() || 'http://localhost:3000'));
  }

  const { data: perfil } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();

  if (perfil?.role !== 'admin') {
    return NextResponse.json(
      { error: 'Só um administrador pode conectar a conta de anúncios.' },
      { status: 403 }
    );
  }

  const cred = credenciaisApp();
  if (!cred) {
    return NextResponse.json(
      {
        error:
          'Google Ads ainda não foi configurado nesta instalação. Faltam ' +
          'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_ADS_DEVELOPER_TOKEN.',
      },
      { status: 503 }
    );
  }

  const estado = crypto.randomUUID();
  const resposta = NextResponse.redirect(urlDeAutorizacao(cred, estado));

  resposta.cookies.set(COOKIE_ESTADO_ADS, estado, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // precisa sobreviver à volta do Google
    path: '/',
    maxAge: 10 * 60,
  });

  return resposta;
}
