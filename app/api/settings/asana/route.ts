/**
 * Conexão com o Asana: guarda e confere o token da organização.
 *
 * O painel de Tarefas ja lia `asana_token` do banco, mas nada nunca gravava
 * esse campo -- a tela mandava "cole o token em Configuracoes" e la nao existia
 * onde colar. Instrucao que aponta para lugar nenhum e pior do que instrucao
 * nenhuma.
 *
 * O token nunca volta ao navegador: o GET diz apenas se existe. Quem fala com o
 * Asana e sempre o servidor.
 */

import { createClient } from '@/lib/supabase/server';
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
  if (perfil.role !== 'admin') return { erro: json({ error: 'Sem permissão' }, 403) };

  return { supabase, organizationId: perfil.organization_id as string };
}

export async function GET() {
  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const { data } = await ctx.supabase
    .from('organization_settings')
    .select('asana_token, asana_workspace_id')
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  return json({
    conectado: Boolean((data?.asana_token || '').trim()),
    workspaceId: data?.asana_workspace_id || '',
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const corpo = (await req.json().catch(() => null)) as
    { token?: string; workspaceId?: string; remover?: boolean } | null;
  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  if (corpo.remover) {
    await ctx.supabase
      .from('organization_settings')
      .update({ asana_token: null, asana_workspace_id: null })
      .eq('organization_id', ctx.organizationId);
    return json({ ok: true, conectado: false });
  }

  const token = (corpo.token || '').trim();
  if (!token) return json({ error: 'Informe o token' }, 400);

  // Confere antes de guardar. Token invalido salvo em silencio vira um painel
  // de tarefas vazio sem explicacao, e ninguem liga uma coisa a outra.
  let nomeDoUsuario = '';
  let workspaces: Array<{ gid: string; name: string }> = [];
  try {
    const r = await fetch('https://app.asana.com/api/1.0/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (r.status === 401) return json({ error: 'O Asana recusou este token.' }, 400);
    if (!r.ok) return json({ error: `O Asana respondeu ${r.status}.` }, 400);

    const dados = (await r.json()) as {
      data?: { name?: string; workspaces?: Array<{ gid: string; name: string }> };
    };
    nomeDoUsuario = dados.data?.name || '';
    workspaces = dados.data?.workspaces || [];
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'Não foi possível falar com o Asana.' },
      400
    );
  }

  const workspaceEscolhido = (corpo.workspaceId || '').trim() || workspaces[0]?.gid || '';

  const { error } = await ctx.supabase
    .from('organization_settings')
    .update({ asana_token: token, asana_workspace_id: workspaceEscolhido || null })
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[settings/asana]', error);
    return json({ error: 'Não foi possível salvar.' }, 500);
  }

  return json({ ok: true, conectado: true, nomeDoUsuario, workspaces, workspaceId: workspaceEscolhido });
}
