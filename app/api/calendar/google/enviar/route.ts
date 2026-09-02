/**
 * Envia agora o que está na fila da pessoa logada.
 *
 * A tela chama isto logo depois de criar ou editar uma atividade. Existe porque
 * a rotina diária sozinha não atende à promessa: quem marca uma reunião no CRM
 * espera vê-la no celular em segundos, não no dia seguinte.
 *
 * O gatilho no banco é quem garante que nada se perde; esta rota só antecipa.
 */

import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buscarConexao } from '@/lib/calendar/google';
import { drenarFila } from '@/lib/calendar/sincronizar';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
  // Sem agenda conectada não é erro: é a situação da maioria das pessoas.
  if (!conexao) return json({ ok: true, conectado: false, enviados: 0 });

  try {
    const r = await drenarFila(conexao);
    return json({ ok: true, conectado: true, ...r });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'Falha ao enviar.';
    if (motivo === 'SEM_ACESSO') {
      return json({ ok: false, conectado: false, error: 'Reconecte sua agenda do Google.' });
    }
    console.error('[calendar/enviar]', motivo);
    return json({ ok: false, error: motivo }, 500);
  }
}
