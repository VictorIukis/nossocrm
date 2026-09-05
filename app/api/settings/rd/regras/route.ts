/**
 * Regras por formulário do RD.
 *
 * Uma regra diz, para um formulário: em que funil o negócio entra, o que a
 * mensagem fala e quando sai. É o que separa quem se inscreveu num evento ao
 * vivo de quem pediu um diagnóstico -- os dois chegam pelo mesmo webhook.
 */

import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { quantasVariaveis } from '@/lib/messaging/providers/chatwoot/iniciarConversa';
import { CAMPOS_DE_VARIAVEL } from '../route';

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

  return { organizationId: perfil.organization_id as string };
}

interface CorpoDaRegra {
  id?: string;
  apelido?: string;
  identificador?: string | null;
  boardId?: string | null;
  stageId?: string | null;
  modeloNome?: string | null;
  modeloTexto?: string | null;
  modeloVariaveis?: string[];
  atrasoMinutos?: number;
  dispara?: boolean;
  remover?: boolean;
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Origem não permitida' }, 403);

  const ctx = await contexto();
  if ('erro' in ctx) return ctx.erro;

  const c = (await req.json().catch(() => null)) as CorpoDaRegra | null;
  if (!c) return json({ error: 'Corpo inválido' }, 400);

  const sb = createStaticAdminClient();

  if (c.remover) {
    if (!c.id) return json({ error: 'Informe a regra a remover.' }, 400);
    await sb.from('rd_regras').delete().eq('id', c.id).eq('organization_id', ctx.organizationId);
    return json({ ok: true });
  }

  if (!c.apelido?.trim()) return json({ error: 'Dê um nome à regra.' }, 400);

  if (c.atrasoMinutos !== undefined && (c.atrasoMinutos < 1 || c.atrasoMinutos > 1440)) {
    return json({ error: 'O atraso precisa ficar entre 1 e 1440 minutos.' }, 400);
  }

  const variaveis = c.modeloVariaveis ?? [];
  const invalido = variaveis.find((v) => !(CAMPOS_DE_VARIAVEL as readonly string[]).includes(v));
  if (invalido) return json({ error: `Campo desconhecido: ${invalido}` }, 400);

  // Conferir antes de ligar, e não na hora de enviar: quantidade errada faz a
  // Meta recusar o envio inteiro, com um erro que não diz qual variável faltou.
  if (c.dispara) {
    if (!c.modeloNome?.trim() || !c.modeloTexto?.trim()) {
      return json({ error: 'Para ligar a regra, informe o nome e o texto do modelo aprovado.' }, 400);
    }
    const esperadas = quantasVariaveis(c.modeloTexto);
    if (esperadas !== variaveis.length) {
      return json(
        { error: `O texto declara ${esperadas} variável(is) e você escolheu ${variaveis.length}.` },
        400
      );
    }
  }

  // A etapa precisa ser desta organização: etapa de outra empresa deixaria o
  // negócio invisível no quadro onde as pessoas olham.
  if (c.stageId) {
    const { data: etapa } = await sb
      .from('board_stages')
      .select('id, board_id')
      .eq('id', c.stageId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    if (!etapa) return json({ error: 'Etapa não encontrada nesta organização.' }, 400);
    c.boardId = (etapa as { board_id: string }).board_id;
  }

  const linha = {
    organization_id: ctx.organizationId,
    apelido: c.apelido.trim(),
    identificador: c.identificador?.trim() || null,
    board_id: c.boardId || null,
    stage_id: c.stageId || null,
    modelo_nome: c.modeloNome?.trim() || null,
    modelo_texto: c.modeloTexto?.trim() || null,
    modelo_variaveis: variaveis,
    atraso_minutos: c.atrasoMinutos ?? 5,
    dispara: Boolean(c.dispara),
    atualizado_em: new Date().toISOString(),
  };

  const { error } = c.id
    ? await sb.from('rd_regras').update(linha).eq('id', c.id).eq('organization_id', ctx.organizationId)
    : await sb.from('rd_regras').insert(linha);

  if (error) {
    // Índice único: já existe regra para esse formulário. Dizer isso é melhor
    // do que devolver o erro cru do banco.
    if (error.code === '23505') {
      return json(
        { error: c.identificador
            ? `Já existe uma regra para o formulário "${c.identificador}".`
            : 'Já existe uma regra padrão. Edite a que existe.' },
        400
      );
    }
    console.error('[settings/rd/regras]', error);
    return json({ error: 'Não foi possível salvar a regra.' }, 500);
  }

  return json({ ok: true });
}
