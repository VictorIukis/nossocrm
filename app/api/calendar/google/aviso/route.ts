/**
 * Aviso do Google: alguma coisa mudou na agenda de alguém.
 *
 * O Google não conta O QUE mudou. Ele só bate aqui dizendo "olha de novo", e
 * quem descobre a diferença é a sincronização incremental.
 *
 * Autenticação: o Google não assina esses avisos. O que temos é o cabeçalho
 * `X-Goog-Channel-Token`, um segredo que NÓS definimos ao abrir o canal e que
 * ele devolve em cada aviso. É o que impede alguém de bater aqui fingindo ser
 * o Google para nos fazer varrer agendas alheias.
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { type Conexao } from '@/lib/calendar/google';
import { puxarDoGoogle } from '@/lib/calendar/sincronizar';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const canal = req.headers.get('x-goog-channel-id');
  const estado = req.headers.get('x-goog-resource-state');
  const segredo = req.headers.get('x-goog-channel-token');

  // Sempre 200. O Google desliga o canal depois de algumas respostas de erro, e
  // aí a agenda para de atualizar em silêncio -- pior que qualquer falha.
  const ok = () => new Response(null, { status: 200 });

  if (!canal) return ok();

  // `sync` é o aperto de mão que o Google manda ao abrir o canal, antes de
  // qualquer mudança real. Não há nada para buscar.
  if (estado === 'sync') return ok();

  const sb = createStaticAdminClient();
  const { data } = await sb
    .from('user_calendar_connections')
    .select('*')
    .eq('channel_id', canal)
    .maybeSingle();

  const conexao = data as (Conexao & { channel_token?: string }) | null;
  if (!conexao) return ok();

  if (conexao.channel_token && segredo !== conexao.channel_token) {
    console.warn('[calendar/aviso] token do canal não confere');
    return ok();
  }

  try {
    await puxarDoGoogle(conexao);
  } catch (e) {
    console.error('[calendar/aviso]', e instanceof Error ? e.message : e);
  }

  return ok();
}
