/**
 * Rotina diária da agenda: renova os canais de aviso e drena a fila.
 *
 * É rede de segurança, não o caminho principal. O dia a dia é coberto pelo
 * aviso do Google (Google → CRM) e pela chamada da tela ao salvar (CRM →
 * Google). Esta rotina existe para os casos em que um dos dois falhou: canal
 * vencido, item que ficou para trás, alguém que passou o dia offline.
 *
 * Renovar o canal é o item crítico. Ele expira e o Google não avisa: apenas
 * para de bater. Sem esta rotina, a sincronização morreria em silêncio depois
 * de um mês.
 */

import { NextResponse } from 'next/server';
import { drenarFilaDeTodos, renovarCanaisQueVencem } from '@/lib/calendar/sincronizar';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canais = await renovarCanaisQueVencem();
  const fila = await drenarFilaDeTodos();

  return NextResponse.json({
    ok: true,
    canaisRenovados: canais.renovados,
    canaisComFalha: canais.falhas,
    atividadesEnviadas: fila.enviados,
    enviosComFalha: fila.falhas,
  });
}
