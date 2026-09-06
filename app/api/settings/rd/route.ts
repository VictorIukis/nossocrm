/**
 * Configuração da entrada de leads do RD Station e do primeiro contato.
 *
 * O endereço do webhook carrega o segredo, então esta rota é só de
 * administrador -- e é por aqui que o segredo chega a quem precisa colar no RD,
 * sem passar por conversa nem por histórico de terminal.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { enderecoPublico } from '@/lib/calendar/google';

export const runtime = 'nodejs';

/** O que cada variável do modelo pode receber. */
export const CAMPOS_DE_VARIAVEL = ['nome', 'empresa', 'formulario'] as const;

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

  return { organizationId: perfil.organization_id as string };
}

export async function GET() {
  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const sb = createStaticAdminClient();

  const { data: cfg } = await sb
    .from('organization_settings')
    .select(
      'rd_primeiro_contato_ativo, rd_canal_id, rd_ultimo_erro,' +
        ' rd_janela_inicio, rd_janela_fim, rd_limite_diario, timezone'
    )
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  const { data: fontes } = await sb
    .from('integration_inbound_sources')
    .select('id, name, secret, active, entry_board_id, entry_stage_id')
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: true });

  const base = enderecoPublico();

  const { data: canais } = await sb
    .from('messaging_channels')
    .select('id, name, provider, channel_type, status')
    .eq('organization_id', ctx.organizationId)
    .eq('channel_type', 'whatsapp')
    .is('deleted_at', null);

  // Números, não adjetivos: é o que responde "está funcionando?".
  const { count: leadsRecebidos } = await sb
    .from('rd_conversoes')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ctx.organizationId);

  const { data: enviadasHoje } = await sb.rpc('primeiros_contatos_de_hoje', {
    org: ctx.organizationId,
  });

  const { data: fila } = await sb
    .from('primeiro_contato_fila')
    .select('status')
    .eq('organization_id', ctx.organizationId);

  const contagem: Record<string, number> = {};
  for (const l of (fila ?? []) as Array<{ status: string }>) {
    contagem[l.status] = (contagem[l.status] ?? 0) + 1;
  }

  const { data: regras } = await sb
    .from('rd_regras')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .order('identificador', { ascending: true, nullsFirst: false });

  const { data: etapas } = await sb
    .from('board_stages')
    .select('id, name, board_id')
    .eq('organization_id', ctx.organizationId)
    .order('order', { ascending: true });

  const { data: funis } = await sb
    .from('boards')
    .select('id, name')
    .eq('organization_id', ctx.organizationId);

  const nomeDoFunil = new Map(
    ((funis ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name])
  );

  // Formulários que já mandaram lead: serve de sugestão na hora de criar a
  // regra, para ninguém digitar o identificador errado e a regra nunca casar.
  const { data: vistos } = await sb
    .from('rd_conversoes')
    .select('identificador')
    .eq('organization_id', ctx.organizationId)
    .not('identificador', 'is', null)
    .limit(500);

  const formulariosVistos = [
    ...new Set(((vistos ?? []) as Array<{ identificador: string }>).map((v) => v.identificador)),
  ];

  const { data: ultimos } = await sb
    .from('rd_conversoes')
    .select('email, telefone, identificador, criado_em')
    .eq('organization_id', ctx.organizationId)
    .order('criado_em', { ascending: false })
    .limit(5);

  return json({
    config: cfg ?? {},
    fontes: ((fontes ?? []) as Array<{ id: string; name: string; secret: string; active: boolean }>).map(
      (f) => ({
        id: f.id,
        nome: f.name,
        ativa: f.active,
        url: `${base}/api/rd/lead/${f.id}?segredo=${encodeURIComponent(f.secret)}`,
      })
    ),
    canais: canais ?? [],
    regras: regras ?? [],
    etapas: ((etapas ?? []) as Array<{ id: string; name: string; board_id: string }>).map((e) => ({
      ...e,
      funil: nomeDoFunil.get(e.board_id) ?? 'Funil',
    })),
    formulariosVistos,
    enviadasHoje: Number(enviadasHoje ?? 0),
    leadsRecebidos: leadsRecebidos ?? 0,
    fila: contagem,
    ultimos: ultimos ?? [],
    camposDeVariavel: CAMPOS_DE_VARIAVEL,
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const corpo = (await req.json().catch(() => null)) as {
    ativo?: boolean;
    canalId?: string | null;
    janelaInicio?: number;
    janelaFim?: number;
    limiteDiario?: number;
  } | null;

  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  const mudanca: Record<string, unknown> = { rd_ultimo_erro: null };

  if (corpo.canalId !== undefined) mudanca.rd_canal_id = corpo.canalId || null;

  for (const [campo, valor, min, max] of [
    ['rd_janela_inicio', corpo.janelaInicio, 0, 23],
    ['rd_janela_fim', corpo.janelaFim, 0, 23],
    ['rd_limite_diario', corpo.limiteDiario, 1, 10000],
  ] as Array<[string, number | undefined, number, number]>) {
    if (valor === undefined) continue;
    if (!Number.isFinite(valor) || valor < min || valor > max) {
      return json({ error: `Valor fora do permitido em ${campo}.` }, 400);
    }
    mudanca[campo] = Math.round(valor);
  }

  // Conferir antes de ligar, e não na hora de enviar.
  //
  // O que precisa existir mudou: o texto agora vive em cada regra, não aqui. A
  // chave geral só faz sentido se houver um número para enviar e ao menos uma
  // regra pronta -- ligar sem isso deixaria os leads na fila até dar erro na
  // hora do envio, longe de quem clicou.
  if (corpo.ativo) {
    const sbConfere = createStaticAdminClient();

    const { data: atual } = await sbConfere
      .from('organization_settings')
      .select('rd_canal_id')
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    const canal = (mudanca.rd_canal_id ?? (atual as { rd_canal_id?: string } | null)?.rd_canal_id) as
      | string
      | null;

    if (!canal) {
      return json({ error: 'Para ligar, escolha o número de WhatsApp que vai enviar.' }, 400);
    }

    const { data: prontas } = await sbConfere
      .from('rd_regras')
      .select('id, apelido, modelo_nome, modelo_texto')
      .eq('organization_id', ctx.organizationId)
      .eq('dispara', true);

    const validas = ((prontas ?? []) as Array<{ modelo_nome: string | null; modelo_texto: string | null }>)
      .filter((r) => r.modelo_nome && r.modelo_texto);

    if (validas.length === 0) {
      return json(
        { error: 'Nenhuma regra está pronta para disparar. Crie uma regra com modelo aprovado e marque "Disparar".' },
        400
      );
    }
  }

  if (corpo.ativo !== undefined) mudanca.rd_primeiro_contato_ativo = corpo.ativo;

  const { error } = await createStaticAdminClient()
    .from('organization_settings')
    .update(mudanca)
    .eq('organization_id', ctx.organizationId);

  if (error) {
    console.error('[settings/rd]', error);
    return json({ error: 'Não foi possível salvar.' }, 500);
  }

  return json({ ok: true });
}
