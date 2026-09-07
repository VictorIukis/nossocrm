/**
 * Briefing do negócio.
 *
 *   GET  → devolve o que está guardado, dizendo se envelheceu. Não chama IA.
 *   POST → gera de novo e guarda.
 *
 * A separação é o ponto. Antes existia só o GET, e ele gerava: abrir a gaveta
 * duas vezes custava duas chamadas de IA e duas esperas pelo mesmo texto. Ler
 * virou grátis e instantâneo; gastar IA passou a ser um ato deliberado, de quem
 * clicou ou da rotina da madrugada.
 *
 * @module app/api/ai/briefing/[dealId]/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { gerarEGuardar, lerGuardado } from '@/lib/ai/briefing/guardado';

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confere quem pede e se o negócio é da organização dele. */
async function contexto(dealId: string) {
  if (!dealId || !UUID.test(dealId)) {
    return { erro: NextResponse.json({ error: 'dealId inválido' }, { status: 400 }) };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) };

  const { data: perfil } = await supabase
    .from('profiles').select('organization_id').eq('id', user.id).single();

  if (!perfil?.organization_id) {
    return { erro: NextResponse.json({ error: 'Perfil sem organização' }, { status: 404 }) };
  }

  const { data: negocio } = await supabase
    .from('deals')
    .select('id')
    .eq('id', dealId)
    .eq('organization_id', perfil.organization_id)
    .maybeSingle();

  if (!negocio) {
    return { erro: NextResponse.json({ error: 'Negócio não encontrado' }, { status: 404 }) };
  }

  return { organizationId: perfil.organization_id as string };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const ctx = await contexto(dealId);
  if ('erro' in ctx) return ctx.erro;

  // Credencial de serviço só para ler a tabela do briefing. A permissão de quem
  // pede já foi conferida acima, contra a organização do negócio.
  const guardado = await lerGuardado(createStaticAdminClient(), dealId);

  if (!guardado) {
    // 200 e não 404: "ainda não existe" é estado normal, e a tela precisa
    // distinguir isso de erro para oferecer o botão de gerar.
    return NextResponse.json({ existe: false });
  }

  return NextResponse.json({ existe: true, ...guardado });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'Origem não permitida' }, { status: 403 });
  }

  const { dealId } = await params;
  const ctx = await contexto(dealId);
  if ('erro' in ctx) return ctx.erro;

  try {
    const resultado = await gerarEGuardar(
      createStaticAdminClient(),
      dealId,
      ctx.organizationId,
      'pessoa'
    );

    return NextResponse.json({ existe: true, ...resultado });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : 'Falha ao gerar o briefing';

    // Falta de configuração de IA não é erro do servidor: é coisa para alguém
    // resolver nas configurações, e a tela precisa mostrar o motivo.
    const configuracao =
      mensagem.includes('not configured') ||
      mensagem.includes('disabled') ||
      mensagem.includes('API key');

    console.error('[briefing] falha ao gerar:', mensagem);
    return NextResponse.json({ error: mensagem }, { status: configuracao ? 400 : 500 });
  }
}
