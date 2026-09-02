/**
 * Leitura e atualização de um canal de mensagem.
 *
 * Existia GET da lista e POST de criação, mas nada para editar um canal já
 * criado. Na prática isso significava que um canal com credencial faltando ou
 * trocada não tinha conserto pela tela: a única saída era apagar e refazer, e
 * apagar leva junto a ligação com as conversas.
 *
 * Sobre credenciais:
 *  - o GET devolve mascarado, porque a tela precisa mostrar que existe algo
 *    salvo sem entregar o segredo ao navegador de quem só está olhando;
 *  - o PATCH aceita valores parciais: campo em branco mantém o que já estava.
 *    Assim dá para trocar só o token sem redigitar o endereço e a conta.
 */

import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { ChannelProviderFactory } from '@/lib/messaging/channel-factory';
import '@/lib/messaging/providers';
import type { ChannelType } from '@/lib/messaging/types';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Mostra que existe valor sem revelar o valor. */
function mascarar(valor: unknown): string {
  const s = typeof valor === 'string' ? valor : '';
  if (!s) return '';
  if (s.length <= 8) return '•'.repeat(s.length);
  return `${s.slice(0, 4)}${'•'.repeat(8)}${s.slice(-4)}`;
}

/** Campos que são segredo. O resto (endereço, número da conta) aparece inteiro. */
const CAMPOS_SECRETOS = /token|secret|key|senha|password/i;

async function contexto(req: Request | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: json({ error: 'Unauthorized' }, 401) };

  const { data: perfil } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!perfil?.organization_id) return { erro: json({ error: 'Profile not found' }, 404) };
  if (perfil.role !== 'admin') {
    return { erro: json({ error: 'Forbidden - Admin access required' }, 403) };
  }
  if (req && !isAllowedOrigin(req)) return { erro: json({ error: 'Forbidden' }, 403) };

  return { supabase, organizationId: perfil.organization_id as string };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexto(null);
  if ('erro' in ctx) return ctx.erro;

  const { data: canal, error } = await ctx.supabase
    .from('messaging_channels')
    .select('*')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return json({ error: 'Internal server error' }, 500);
  if (!canal) return json({ error: 'Canal não encontrado' }, 404);

  const cred = (canal.credentials || {}) as Record<string, unknown>;
  const mascaradas: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(cred)) {
    mascaradas[chave] = CAMPOS_SECRETOS.test(chave) ? mascarar(valor) : String(valor ?? '');
  }

  return json({ channel: { ...canal, credentials: mascaradas } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexto(req);
  if ('erro' in ctx) return ctx.erro;

  const corpo = (await req.json().catch(() => null)) as {
    name?: string;
    credentials?: Record<string, string>;
  } | null;

  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  const { data: canal } = await ctx.supabase
    .from('messaging_channels')
    .select('id, channel_type, provider, external_identifier, credentials')
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!canal) return json({ error: 'Canal não encontrado' }, 404);

  const atuais = (canal.credentials || {}) as Record<string, string>;
  const enviadas = corpo.credentials || {};

  // Campo em branco mantém o valor guardado. Sem isto, abrir a tela e salvar
  // apagaria o token, porque o formulário nunca recebeu o valor real.
  const novas: Record<string, string> = { ...atuais };
  for (const [chave, valor] of Object.entries(enviadas)) {
    if (typeof valor === 'string' && valor.trim() !== '') novas[chave] = valor.trim();
  }

  // Confere com o próprio provedor antes de gravar: é ele quem sabe o que
  // precisa. Guardar credencial inválida só adia a descoberta do erro para a
  // hora em que alguém tenta responder um cliente.
  let statusMensagem: string | null = null;
  let status = 'pending';
  try {
    const provedor = ChannelProviderFactory.createProvider(
      canal.channel_type as ChannelType,
      canal.provider
    );
    const configuracao = {
      channelId: canal.id as string,
      channelType: canal.channel_type as ChannelType,
      provider: canal.provider as string,
      externalIdentifier: (canal.external_identifier as string) ?? '',
      credentials: novas,
    };

    const validacao = provedor.validateConfig(configuracao);
    if (!validacao.valid) {
      return json(
        {
          error: 'Credenciais incompletas',
          detalhes: validacao.errors?.map((e) => e.message) ?? [],
        },
        400
      );
    }

    await provedor.initialize(configuracao);
    const conexao = await provedor.getStatus();
    status = conexao.status === 'connected' ? 'connected' : 'error';
    statusMensagem = conexao.message ?? null;
  } catch (e) {
    status = 'error';
    statusMensagem = e instanceof Error ? e.message : 'Não foi possível conferir a conexão.';
  }

  const { error: erroUpdate } = await ctx.supabase
    .from('messaging_channels')
    .update({
      ...(corpo.name?.trim() ? { name: corpo.name.trim() } : {}),
      credentials: novas,
      status,
      status_message: statusMensagem,
      last_connected_at: status === 'connected' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId);

  if (erroUpdate) {
    console.error('[channels/PATCH]', erroUpdate);
    return json({ error: 'Não foi possível salvar' }, 500);
  }

  return json({ ok: true, status, statusMessage: statusMensagem });
}
