/**
 * Volta do Google depois da autorização.
 *
 * Troca o código por tokens, guarda a conexão e manda a pessoa de volta para a
 * agenda. Erro aqui vira mensagem na tela, e não uma página em branco: quem
 * está conectando precisa saber se deu certo.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { credenciais, trocarCodigoPorToken } from '@/lib/calendar/google';
import { COOKIE_ESTADO } from '../conectar/route';

export const runtime = 'nodejs';

function voltar(mensagem: string, ok = false) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || '';
  const url = new URL(`${base}/agenda`);
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

  // Confere o state contra o cookie: os dois nasceram na mesma sessão.
  const cookieEstado = req.headers
    .get('cookie')
    ?.split('; ')
    .find((c) => c.startsWith(`${COOKIE_ESTADO}=`))
    ?.split('=')[1];

  if (!cookieEstado || cookieEstado !== estadoRecebido) {
    return voltar('A autorização não confere com esta sessão. Tente conectar de novo.');
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return voltar('Sua sessão expirou durante a autorização.');

  const { data: perfil } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!perfil?.organization_id) return voltar('Seu usuário não está ligado a uma organização.');

  const cred = credenciais();
  if (!cred) return voltar('A conexão com o Google não está configurada nesta instalação.');

  const tokens = await trocarCodigoPorToken(cred, codigo);

  if (!tokens.access_token) {
    return voltar(tokens.error_description || tokens.error || 'O Google não devolveu o acesso.');
  }

  // Descobre QUAL conta foi conectada. Sem isso, quem tem conta pessoal e
  // profissional no mesmo navegador nunca sabe qual ficou ligada -- e o sintoma
  // seria "minha agenda não aparece", com a agenda errada sincronizando.
  let email: string | null = null;
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (r.ok) email = ((await r.json()) as { email?: string }).email ?? null;
  } catch {
    // Não é motivo para falhar a conexão inteira.
  }

  const admin = createStaticAdminClient();

  // Reconexão não pode apagar o refresh_token: o Google só o envia quando
  // resolve enviar, e sobrescrever com null deixaria a conexão viva por uma
  // hora e morta depois, sem explicação.
  const registro: Record<string, unknown> = {
    user_id: user.id,
    organization_id: perfil.organization_id,
    provider: 'google',
    account_email: email,
    access_token: tokens.access_token,
    token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
    scope: tokens.scope ?? null,
    last_error: null,
  };
  if (tokens.refresh_token) registro.refresh_token = tokens.refresh_token;

  const { error } = await admin
    .from('user_calendar_connections')
    .upsert(registro, { onConflict: 'user_id' });

  if (error) {
    console.error('[calendar/retorno]', error);
    return voltar('Não consegui guardar a conexão.');
  }

  return voltar(email || 'Conta conectada', true);
}
