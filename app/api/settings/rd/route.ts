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
import { quantasVariaveis } from '@/lib/messaging/providers/chatwoot/iniciarConversa';

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
      'rd_primeiro_contato_ativo, rd_atraso_minutos, rd_modelo_nome, rd_modelo_texto,' +
        ' rd_modelo_variaveis, rd_modelo_idioma, rd_modelo_categoria, rd_canal_id, rd_ultimo_erro'
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

  const { data: fila } = await sb
    .from('primeiro_contato_fila')
    .select('status')
    .eq('organization_id', ctx.organizationId);

  const contagem: Record<string, number> = {};
  for (const l of (fila ?? []) as Array<{ status: string }>) {
    contagem[l.status] = (contagem[l.status] ?? 0) + 1;
  }

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
    atrasoMinutos?: number;
    modeloNome?: string;
    modeloTexto?: string;
    modeloVariaveis?: string[];
    canalId?: string | null;
  } | null;

  if (!corpo) return json({ error: 'Corpo inválido' }, 400);

  const mudanca: Record<string, unknown> = { rd_ultimo_erro: null };

  if (typeof corpo.atrasoMinutos === 'number') {
    // Menos de um minuto não faz sentido (a fila roda de minuto em minuto) e
    // mais de um dia deixa de ser "logo depois do cadastro".
    if (corpo.atrasoMinutos < 1 || corpo.atrasoMinutos > 1440) {
      return json({ error: 'O atraso precisa ficar entre 1 e 1440 minutos.' }, 400);
    }
    mudanca.rd_atraso_minutos = Math.round(corpo.atrasoMinutos);
  }

  if (corpo.modeloNome !== undefined) mudanca.rd_modelo_nome = corpo.modeloNome.trim() || null;
  if (corpo.modeloTexto !== undefined) mudanca.rd_modelo_texto = corpo.modeloTexto.trim() || null;
  if (corpo.canalId !== undefined) mudanca.rd_canal_id = corpo.canalId || null;

  if (corpo.modeloVariaveis !== undefined) {
    const invalido = corpo.modeloVariaveis.find(
      (v) => !(CAMPOS_DE_VARIAVEL as readonly string[]).includes(v)
    );
    if (invalido) return json({ error: `Campo desconhecido: ${invalido}` }, 400);
    mudanca.rd_modelo_variaveis = corpo.modeloVariaveis;
  }

  const sbConfere = createStaticAdminClient();

  // Conferir antes de ligar, e não na hora de enviar.
  //
  // Quantidade errada faz a Meta recusar o envio inteiro, com um erro que não
  // diz qual variável faltou. Aqui ainda dá para explicar.
  if (corpo.ativo) {
    // Vale o que está sendo salvo agora, e o que já estava guardado para o que
    // não veio no pedido: ligar a chave sem mexer no texto é o caso comum, e
    // sem isto a tela recusaria dizendo que falta um texto que existe.
    const { data: atual } = await sbConfere
      .from('organization_settings')
      .select('rd_modelo_nome, rd_modelo_texto, rd_modelo_variaveis, rd_canal_id')
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    const a = (atual || {}) as Record<string, unknown>;

    const texto = ((mudanca.rd_modelo_texto ?? a.rd_modelo_texto) as string) ?? '';
    const variaveis = ((mudanca.rd_modelo_variaveis ?? a.rd_modelo_variaveis) as string[]) ?? [];
    const nome = ((mudanca.rd_modelo_nome ?? a.rd_modelo_nome) as string) ?? '';
    const canal = (mudanca.rd_canal_id ?? a.rd_canal_id) as string | null;

    if (!nome || !texto) {
      return json({ error: 'Para ligar, informe o nome e o texto do modelo aprovado.' }, 400);
    }
    if (!canal) {
      return json({ error: 'Para ligar, escolha o canal de WhatsApp que vai enviar.' }, 400);
    }
    const esperadas = quantasVariaveis(texto);
    if (esperadas !== variaveis.length) {
      return json(
        { error: `O texto declara ${esperadas} variável(is) e você escolheu ${variaveis.length}.` },
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
