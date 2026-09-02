/**
 * Estado da conexão do Google Calendar da pessoa logada, e desconexão.
 *
 * GET devolve apenas se está conectada e com qual conta. Token nunca sai daqui.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { credenciais, chamarGoogle, buscarConexao } from '@/lib/calendar/google';

export const runtime = 'nodejs';

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const conexao = await buscarConexao(user.id);

  return json({
    // Diz se a instalação sabe falar com o Google. Sem isso, a tela mostraria um
    // botão que só pode falhar.
    disponivel: Boolean(credenciais()),
    conectado: Boolean(conexao?.refresh_token || conexao?.access_token),
    contaEmail: conexao?.account_email ?? null,
    ultimaSincronizacao: (conexao as { last_synced_at?: string } | null)?.last_synced_at ?? null,
    ultimoErro: (conexao as { last_error?: string } | null)?.last_error ?? null,
  });
}

/** Desconecta: revoga no Google e apaga a conexão daqui. */
export async function DELETE(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const conexao = await buscarConexao(user.id);
  const admin = createStaticAdminClient();

  if (conexao) {
    // Fecha o canal de avisos antes de perder o token, senão o Google continua
    // batendo num endereço que já não tem como responder.
    if (conexao.channel_id && conexao.channel_resource_id) {
      try {
        await chamarGoogle(conexao, '/channels/stop', {
          method: 'POST',
          body: JSON.stringify({ id: conexao.channel_id, resourceId: conexao.channel_resource_id }),
        });
      } catch {
        // Canal já vencido não impede a desconexão.
      }
    }

    // Revoga de verdade no Google. Sem isto, o consentimento continua listado na
    // conta da pessoa como se o CRM ainda tivesse acesso.
    const token = conexao.refresh_token || conexao.access_token;
    if (token) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        });
      } catch {
        // Se o Google não responder, ainda assim removemos daqui.
      }
    }
  }

  await admin.from('user_calendar_connections').delete().eq('user_id', user.id);

  // As atividades ficam. Só perdem o vínculo com o evento lá, para que uma
  // reconexão futura não tente atualizar eventos de uma autorização morta.
  await admin
    .from('activities')
    .update({ google_event_id: null, google_etag: null, google_calendar_id: null })
    .eq('owner_id', user.id);

  return json({ ok: true, conectado: false });
}
