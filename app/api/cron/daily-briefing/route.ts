import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { generateMeetingBriefing } from '@/lib/ai/briefing/briefing.service';

export const maxDuration = 120;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * GET /api/cron/daily-briefing
 *
 * DESAGENDADA de propósito (saiu de vercel.json em 03/set/2026).
 *
 * A ideia era adiantar o briefing das reuniões do dia. Só que
 * `generateMeetingBriefing` devolve o briefing e não guarda: o único cache é o
 * do navegador, por 5 minutos, na sessão de quem abriu a gaveta. Rodando às 8h,
 * ela gastava IA para jogar o resultado fora -- ninguém tinha como ler aquilo.
 * Rodei em produção antes de decidir: respondeu 200 e "processed: 2", e não
 * sobrou nada no banco.
 *
 * A rota continua aqui, funcionando, porque a rotina passa a valer no dia em
 * que o briefing for guardado (tabela própria + a gaveta lendo de lá). Aí ela
 * volta para o agendamento e a gaveta abre pronta em dia de reunião.
 *
 * Scheduled cron job (weekdays at 08:00 UTC) that pre-generates meeting briefings
 * for all deals with a meeting scheduled today or tomorrow.
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

  // Build date range: today and tomorrow (ISO dates)
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(now);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
  tomorrowEnd.setHours(23, 59, 59, 999);

  // Compromissos de hoje e amanhã.
  //
  // A consulta lia `deal_activities`, que é a tabela de HISTÓRICO do negócio:
  // não tem `scheduled_at` nem `completed_at`, e o Postgres recusava a consulta
  // inteira. Ou seja, este cron devolvia 500 todo dia útil desde que existe, e
  // nenhum briefing foi gerado.
  //
  // Compromisso está em `activities`, com `date`, `completed` e `deleted_at`.
  //
  // `ilike` porque a base tem 'MEETING' e 'meeting' -- vieram de caminhos
  // diferentes (tela e importação da agenda), e comparar exato perderia parte.
  const { data: activities, error: activitiesError } = await supabase
    .from('activities')
    .select('deal_id, organization_id')
    .ilike('type', 'meeting')
    .gte('date', todayStart.toISOString())
    .lte('date', tomorrowEnd.toISOString())
    .or('completed.is.null,completed.eq.false')
    .is('deleted_at', null)
    // Compromisso pessoal não tem negócio, e briefing é sobre o negócio.
    .not('deal_id', 'is', null);

  if (activitiesError) {
    console.error('[Cron:daily-briefing] Failed to fetch activities:', activitiesError);
    return json({ error: 'Failed to fetch activities' }, 500);
  }

  // Deduplicate by deal_id (a deal may have multiple meetings in the window)
  const seen = new Set<string>();
  const uniqueDeals = (activities ?? []).filter((a) => {
    if (seen.has(a.deal_id)) return false;
    seen.add(a.deal_id);
    return true;
  });

  let processed = 0;
  let errors = 0;

  await Promise.allSettled(
    uniqueDeals.map(async (activity) => {
      try {
        await generateMeetingBriefing(activity.deal_id, supabase);
        processed++;
      } catch (err) {
        errors++;
        console.error(
          `[Cron:daily-briefing] Failed for deal ${activity.deal_id}:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  console.log(`[Cron:daily-briefing] Done — processed: ${processed}, errors: ${errors}`);
  return json({ processed, errors });
}
