import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { gerarEGuardar, lerGuardado } from '@/lib/ai/briefing/guardado';

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
 * Adianta o briefing das reuniões de hoje e amanhã, para a gaveta abrir pronta
 * em vez de fazer a pessoa esperar pela IA no minuto antes da conversa.
 *
 * Ela ficou desagendada de 03 a 07/set porque `generateMeetingBriefing`
 * devolvia o briefing sem guardar: gastava IA para jogar o resultado fora.
 * Agora existe `deal_briefings`, então adiantar de fato adianta.
 *
 * Só gera o que falta ou envelheceu. Reunião cujo briefing já está em dia não
 * paga IA de novo -- sem isso, uma reunião remarcada três vezes geraria três
 * briefings idênticos.
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

  let pulados = 0;

  // Em série, e não em paralelo, de propósito: são chamadas de IA, e disparar
  // dez ao mesmo tempo é o caminho mais rápido para bater no limite do provedor
  // e falhar em todas. Aqui ninguém está esperando na frente da tela.
  for (const activity of uniqueDeals) {
    try {
      const guardado = await lerGuardado(supabase, activity.deal_id);

      if (guardado && !guardado.desatualizado) {
        pulados++;
        continue;
      }

      await gerarEGuardar(supabase, activity.deal_id, activity.organization_id, 'rotina');
      processed++;
    } catch (err) {
      errors++;
      console.error(
        `[Cron:daily-briefing] falhou no negócio ${activity.deal_id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[Cron:daily-briefing] feito — gerados: ${processed}, já em dia: ${pulados}, falhas: ${errors}`
  );
  return json({ processed, pulados, errors });
}
