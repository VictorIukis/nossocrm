/**
 * Tarefas do Asana atribuidas a quem esta logado.
 *
 * O token fica em organization_settings e nunca sai do servidor: a pagina chama
 * esta rota, e e ela que fala com o Asana. Se o token viajasse ate o navegador,
 * qualquer pessoa com o painel aberto teria acesso ao Asana inteiro da empresa.
 *
 * Sobre o MCP do Asana, que existe e e oficial: ele e feito para cliente de IA
 * conversando por OAuth, e nao para servidor falando com servidor. Para uma tela
 * dentro do CRM o caminho e a API REST, que e o que esta aqui.
 */

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ASANA = 'https://app.asana.com/api/1.0';

export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const { data: perfil } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!perfil?.organization_id) return json({ error: 'Perfil sem organização' }, 404);

  const { data: cfg } = await supabase
    .from('organization_settings')
    .select('asana_token, asana_workspace_id')
    .eq('organization_id', perfil.organization_id)
    .maybeSingle();

  const token = (cfg as { asana_token?: string } | null)?.asana_token;
  if (!token) {
    // Estado esperado, nao erro: a tela usa isto para mostrar o passo a passo
    // de conexao em vez de uma mensagem de falha.
    return json({ conectado: false, tarefas: [] });
  }

  const cabecalho = { Authorization: `Bearer ${token}` };

  try {
    // Quem sou eu no Asana. Serve para descobrir o workspace quando ele nao
    // estiver configurado, e para saber de quem sao as tarefas.
    const eu = await fetch(`${ASANA}/users/me`, { headers: cabecalho });
    if (eu.status === 401) {
      return json({ conectado: false, erro: 'Token do Asana recusado. Gere outro.' });
    }
    if (!eu.ok) return json({ conectado: false, erro: `Asana respondeu ${eu.status}.` });

    const dadosEu = await eu.json();
    const workspace =
      (cfg as { asana_workspace_id?: string } | null)?.asana_workspace_id ||
      dadosEu?.data?.workspaces?.[0]?.gid;

    if (!workspace) {
      return json({ conectado: true, tarefas: [], erro: 'Nenhum workspace encontrado no Asana.' });
    }

    // `completed_since=now` traz so o que esta em aberto. Sem isso a lista vem
    // com todo o historico concluido e fica inutil.
    const params = new URLSearchParams({
      assignee: dadosEu.data.gid,
      workspace,
      completed_since: 'now',
      opt_fields: 'name,due_on,completed,projects.name,permalink_url',
      limit: '50',
    });

    const r = await fetch(`${ASANA}/tasks?${params}`, { headers: cabecalho });

    if (r.status === 429) {
      // O Asana limita a 150 req/min no plano gratuito e devolve por quanto
      // tempo esperar. Repassar isso deixa a tela avisar em vez de sumir.
      const esperar = r.headers.get('Retry-After');
      return json({ conectado: true, tarefas: [], erro: `Limite do Asana atingido. Tente em ${esperar || '60'}s.` });
    }
    if (!r.ok) return json({ conectado: true, tarefas: [], erro: `Asana respondeu ${r.status}.` });

    const lista = await r.json();

    const tarefas = (lista?.data || []).map((t: {
      gid: string; name?: string; due_on?: string | null; completed?: boolean;
      projects?: { name?: string }[]; permalink_url?: string;
    }) => ({
      id: t.gid,
      titulo: t.name || '(sem título)',
      prazo: t.due_on || null,
      concluida: Boolean(t.completed),
      projeto: t.projects?.[0]?.name || null,
      link: t.permalink_url || null,
    }));

    return json({ conectado: true, usuario: dadosEu?.data?.name || null, tarefas });
  } catch (e) {
    return json({ conectado: true, tarefas: [], erro: e instanceof Error ? e.message : 'Falha ao falar com o Asana.' });
  }
}
