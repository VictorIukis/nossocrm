/**
 * Sincroniza a agenda da pessoa logada, nos dois sentidos, agora.
 *
 * O aviso automático do Google cobre o dia a dia; esta rota existe para o
 * "sincronizar agora" da tela e para a primeira carga, logo depois de conectar.
 */

import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buscarConexao } from '@/lib/calendar/google';
import { sincronizar } from '@/lib/calendar/sincronizar';

export const runtime = 'nodejs';
// Agenda cheia com muitas páginas leva mais que o padrão da plataforma.
export const maxDuration = 60;

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const conexao = await buscarConexao(user.id);
  if (!conexao) return json({ error: 'Sua agenda do Google não está conectada.' }, 400);

  try {
    const r = await sincronizar(conexao);
    return json({
      ok: true,
      puxados: r.puxados,
      enviados: r.enviados,
      apagados: r.apagados,
      erros: r.erros,
    });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'Falha ao sincronizar.';
    // SEM_ACESSO é o caso de a pessoa ter revogado o CRM na conta Google.
    if (motivo === 'SEM_ACESSO') {
      return json(
        { error: 'O Google não aceita mais este acesso. Conecte a agenda de novo.' },
        400
      );
    }
    console.error('[calendar/sincronizar]', motivo);
    return json({ error: motivo }, 500);
  }
}
