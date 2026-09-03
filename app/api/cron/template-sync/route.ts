import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { MetaCloudWhatsAppProvider } from '@/lib/messaging/providers/whatsapp/meta-cloud.provider';
import type { DbMessagingTemplate } from '@/lib/messaging/types';

export const maxDuration = 60;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * GET /api/cron/template-sync
 *
 * Scheduled cron job (daily at 06:00 UTC) that syncs WhatsApp templates
 * from Meta Cloud API for every active meta-cloud channel across all organizations.
 *
 * Protected by CRON_SECRET bearer token — only callable by Vercel Cron.
 */
// Rotina agendada não tem usuário logado: o cliente com sessão cai no RLS e não
// vê linha nenhuma. Duas rotinas devolviam 500 por isso, e uma devolvia 200 com
// zero -- que é pior, porque parece que simplesmente não havia trabalho a fazer.
//
// Aqui a credencial de serviço é a certa, e não um atalho: a rotina varre TODAS
// as organizações de propósito. Por isso cada consulta continua carregando o
// organization_id da linha para frente, em vez de confiar no filtro do banco.
export async function GET(req: Request) {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createStaticAdminClient();

  // Fetch all active meta-cloud channels that have a wabaId configured
  const { data: channels, error: channelsError } = await supabase
    .from('messaging_channels')
    .select('id, organization_id, external_identifier, credentials, settings')
    .eq('provider', 'meta-cloud')
    // Não existe coluna `is_active` nesta tabela: o estado do canal fica em
    // `status`. O filtro errado derrubava a rotina inteira com 500.
    .eq('status', 'connected')
    .is('deleted_at', null);

  if (channelsError) {
    console.error('[Cron:template-sync] Failed to fetch channels:', channelsError);
    return json({ error: 'Failed to fetch channels' }, 500);
  }

  // Filter channels that have a wabaId in credentials
  const eligibleChannels = (channels ?? []).filter((ch) => {
    const creds = ch.credentials as Record<string, string> | null;
    return creds?.wabaId;
  });

  let synced = 0;
  let errors = 0;

  await Promise.allSettled(
    eligibleChannels.map(async (channel) => {
      try {
        const credentials = channel.credentials as Record<string, string>;

        const provider = new MetaCloudWhatsAppProvider();
        await provider.initialize({
          channelId: channel.id,
          channelType: 'whatsapp',
          provider: 'meta-cloud',
          externalIdentifier: channel.external_identifier,
          credentials,
          settings: channel.settings as Record<string, unknown>,
        });

        const result = await provider.syncTemplates();

        if (!result.success) {
          throw new Error(result.error?.message ?? 'syncTemplates returned failure');
        }

        const templates = result.templates ?? [];
        const now = new Date().toISOString();

        const upsertData: Partial<DbMessagingTemplate>[] = templates.map((t) => ({
          channel_id: channel.id,
          external_id: t.externalId,
          name: t.name,
          language: t.language,
          category: t.category,
          components: t.components,
          status: t.status,
          rejection_reason: t.rejectionReason ?? null,
          updated_at: now,
        }));

        await Promise.all(
          upsertData.map((template) =>
            supabase
              .from('messaging_templates')
              .upsert(template, { onConflict: 'channel_id,name,language' })
              .then(({ error }) => {
                if (error) {
                  console.error('[Cron:template-sync] Upsert error:', error, template.name);
                }
              })
          )
        );

        synced++;
        console.log(
          `[Cron:template-sync] Synced ${templates.length} templates for channel ${channel.id}`
        );
      } catch (err) {
        errors++;
        console.error(
          `[Cron:template-sync] Failed for channel ${channel.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  console.log(`[Cron:template-sync] Done — synced: ${synced}, errors: ${errors}`);
  return json({ synced, errors });
}
