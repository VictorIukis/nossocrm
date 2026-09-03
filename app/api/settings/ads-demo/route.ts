/**
 * Liga e desliga o modo demonstração do painel de Ads.
 *
 * Rota própria porque o interruptor vale para os dois painéis: colocar dentro da
 * rota da Meta ou do Google daria a entender que é configuração de um provedor
 * só, e alguém acabaria ligando um e mostrando o outro com dado real.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const runtime = 'nodejs';

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function contexto() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: json({ error: 'Não autenticado' }, 401) };

  const { data: perfil } = await supabase
    .from('profiles').select('role, organization_id').eq('id', user.id).single();

  if (!perfil?.organization_id) return { erro: json({ error: 'Perfil sem organização' }, 404) };

  return {
    organizationId: perfil.organization_id as string,
    ehAdmin: perfil.role === 'admin',
  };
}

export async function GET() {
  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const sb = createStaticAdminClient();
  const { data } = await sb
    .from('organization_settings')
    .select('ads_modo_demo')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  return json({
    ligado: Boolean((data as { ads_modo_demo?: boolean } | null)?.ads_modo_demo),
    ehAdmin: ctx.ehAdmin,
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;
  if (!ctx.ehAdmin) return json({ error: 'Sem permissão' }, 403);

  const corpo = (await req.json().catch(() => null)) as { ligado?: boolean } | null;
  if (typeof corpo?.ligado !== 'boolean') return json({ error: 'Corpo inválido' }, 400);

  const sb = createStaticAdminClient();
  const { error } = await sb
    .from('organization_settings')
    .update({ ads_modo_demo: corpo.ligado })
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[settings/ads-demo]', error);
    return json({ error: 'Não foi possível salvar.' }, 500);
  }

  return json({ ok: true, ligado: corpo.ligado });
}
