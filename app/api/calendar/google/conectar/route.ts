/**
 * Começa a conexão do Google Calendar da pessoa que está logada.
 *
 * Redireciona para o Google. O `state` carrega um valor aleatório guardado em
 * cookie: na volta, os dois têm que bater. Sem isso, alguém poderia induzir a
 * pessoa a concluir uma autorização de OUTRA conta Google, e o CRM passaria a
 * sincronizar com a agenda do atacante.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { credenciais, urlDeAutorizacao } from '@/lib/calendar/google';

export const runtime = 'nodejs';

export const COOKIE_ESTADO = 'crm_gcal_state';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'));
  }

  const cred = credenciais();
  if (!cred) {
    return NextResponse.json(
      {
        error:
          'A conexão com o Google ainda não foi configurada nesta instalação. ' +
          'Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.',
      },
      { status: 503 }
    );
  }

  const estado = crypto.randomUUID();
  const resposta = NextResponse.redirect(urlDeAutorizacao(cred, estado));

  resposta.cookies.set(COOKIE_ESTADO, estado, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // 'lax' e nao 'strict': o cookie precisa sobreviver a volta do Google.
    path: '/',
    maxAge: 10 * 60,
  });

  return resposta;
}
