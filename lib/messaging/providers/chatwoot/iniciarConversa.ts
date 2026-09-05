/**
 * Começar uma conversa no WhatsApp oficial, do zero.
 *
 * O provedor do Chatwoot só sabia responder dentro de conversa existente, o que
 * cobre o dia a dia (o cliente escreve, a gente responde). Para falar com quem
 * acabou de preencher um formulário, não serve: não existe conversa ainda.
 *
 * Duas regras da Meta moldam tudo aqui, e nenhuma é escolha nossa:
 *
 *  1. Fora da janela de 24 horas, mensagem iniciada pela empresa só sai como
 *     MODELO APROVADO. Texto livre é recusado. Por isso não há como a IA
 *     escrever a primeira mensagem: ela escreve da segunda em diante.
 *  2. O modelo tem texto fixo com variáveis numeradas. O que dá para
 *     personalizar é o conteúdo das variáveis -- nome e empresa, por exemplo.
 *
 * @module lib/messaging/providers/chatwoot/iniciarConversa
 */

export interface ContaChatwoot {
  baseUrl: string;
  accountId: string;
  inboxId: string;
  apiAccessToken: string;
}

export interface ModeloParaEnviar {
  /** Nome do modelo como aprovado na Meta. */
  nome: string;
  /** pt_BR, en_US… */
  idioma: string;
  categoria: string;
  /** Texto final, já com as variáveis trocadas: é o que fica no histórico. */
  textoFinal: string;
  /** Valores das variáveis, na ordem em que o modelo as declara. */
  variaveis: string[];
}

export type Resultado =
  | { ok: true; conversaId: string; mensagemId: string }
  | { ok: false; motivo: string; recuperavel: boolean };

function raiz(c: ContaChatwoot) {
  return `${c.baseUrl.replace(/\/+$/, '')}/api/v1/accounts/${c.accountId}`;
}

async function chamar(
  c: ContaChatwoot,
  caminho: string,
  init: RequestInit & { corpo?: unknown } = {}
): Promise<{ status: number; corpo: unknown }> {
  const { corpo, ...resto } = init;
  const r = await fetch(`${raiz(c)}${caminho}`, {
    ...resto,
    headers: {
      api_access_token: c.apiAccessToken,
      'content-type': 'application/json',
      ...(resto.headers || {}),
    },
    body: corpo === undefined ? resto.body : JSON.stringify(corpo),
    // Sem isto, uma instância lenta segura a função até o tempo limite da Vercel
    // e a fila trava atrás de um único envio.
    signal: AbortSignal.timeout(15_000),
  });

  return { status: r.status, corpo: await r.json().catch(() => null) };
}

/**
 * Acha o contato no Chatwoot pelo telefone, ou cria.
 *
 * O `source_id` que sai daqui é o que amarra o contato à caixa de entrada; sem
 * ele o Chatwoot não sabe por qual número falar.
 */
async function contatoNoChatwoot(
  c: ContaChatwoot,
  telefone: string,
  nome: string | null,
  email: string | null
): Promise<{ ok: true; contatoId: number; sourceId: string } | { ok: false; motivo: string }> {
  const comMais = telefone.startsWith('+') ? telefone : `+${telefone}`;

  // Procurar antes de criar: criar duplicado no Chatwoot separa o histórico da
  // mesma pessoa em duas fichas, e quem atende deixa de ver o que já foi falado.
  const busca = await chamar(c, `/contacts/search?q=${encodeURIComponent(comMais)}`, { method: 'GET' });
  const achados = ((busca.corpo as { payload?: Array<Record<string, unknown>> })?.payload) ?? [];

  const existente = achados.find((x) => {
    const t = String(x.phone_number ?? '').replace(/\D/g, '');
    return t === telefone.replace(/\D/g, '');
  });

  if (existente) {
    const inboxes = (existente.contact_inboxes ?? []) as Array<{
      source_id?: string;
      inbox?: { id?: number };
    }>;
    const daCaixa = inboxes.find((i) => String(i.inbox?.id) === String(c.inboxId));

    if (daCaixa?.source_id) {
      return { ok: true, contatoId: Number(existente.id), sourceId: daCaixa.source_id };
    }

    // Contato existe, mas nunca falou por este número: cria o vínculo.
    const vinculo = await chamar(c, `/contacts/${existente.id}/contact_inboxes`, {
      method: 'POST',
      corpo: { inbox_id: Number(c.inboxId), source_id: telefone },
    });

    const sid = (vinculo.corpo as { source_id?: string })?.source_id;
    if (sid) return { ok: true, contatoId: Number(existente.id), sourceId: sid };
    return { ok: true, contatoId: Number(existente.id), sourceId: telefone };
  }

  const criado = await chamar(c, '/contacts', {
    method: 'POST',
    corpo: {
      inbox_id: Number(c.inboxId),
      name: nome || comMais,
      phone_number: comMais,
      ...(email ? { email } : {}),
    },
  });

  const payload = (criado.corpo as { payload?: { contact?: Record<string, unknown> } })?.payload;
  const contato = payload?.contact;
  if (!contato?.id) {
    return {
      ok: false,
      motivo: `Chatwoot recusou criar o contato (${criado.status}).`,
    };
  }

  const inboxes = (contato.contact_inboxes ?? []) as Array<{ source_id?: string }>;
  return {
    ok: true,
    contatoId: Number(contato.id),
    sourceId: inboxes[0]?.source_id || telefone,
  };
}

/**
 * Abre a conversa e manda o modelo.
 *
 * A mensagem sai pela caixa da Sofia, então ela aparece no atendimento como
 * qualquer outra: quem responder cai na mesma conversa, com o histórico junto.
 */
export async function abrirConversaComModelo(
  c: ContaChatwoot,
  telefone: string,
  nome: string | null,
  email: string | null,
  modelo: ModeloParaEnviar
): Promise<Resultado> {
  if (!c.apiAccessToken?.trim()) {
    return { ok: false, motivo: 'O canal do Chatwoot está sem token de acesso.', recuperavel: false };
  }
  if (!c.inboxId) {
    return { ok: false, motivo: 'O canal não tem caixa de entrada definida.', recuperavel: false };
  }

  const contato = await contatoNoChatwoot(c, telefone, nome, email);
  if (!contato.ok) return { ok: false, motivo: contato.motivo, recuperavel: true };

  const conversa = await chamar(c, '/conversations', {
    method: 'POST',
    corpo: {
      source_id: contato.sourceId,
      inbox_id: Number(c.inboxId),
      contact_id: contato.contatoId,
    },
  });

  const conversaId = (conversa.corpo as { id?: number })?.id;
  if (!conversaId) {
    return {
      ok: false,
      motivo: `Chatwoot recusou abrir a conversa (${conversa.status}).`,
      recuperavel: conversa.status >= 500,
    };
  }

  // O modelo vai em `template_params`. O `content` é o texto já preenchido: é o
  // que fica no histórico e o que a equipe lê depois. Mandar só o content faria
  // a Meta recusar por não ser modelo aprovado.
  const envio = await chamar(c, `/conversations/${conversaId}/messages`, {
    method: 'POST',
    corpo: {
      content: modelo.textoFinal,
      message_type: 'outgoing',
      template_params: {
        name: modelo.nome,
        category: modelo.categoria,
        language: modelo.idioma,
        processed_params: Object.fromEntries(modelo.variaveis.map((v, i) => [String(i + 1), v])),
      },
    },
  });

  const mensagemId = (envio.corpo as { id?: number })?.id;
  if (!mensagemId) {
    const detalhe =
      (envio.corpo as { error?: string })?.error ||
      (envio.corpo as { message?: string })?.message ||
      `status ${envio.status}`;
    return {
      ok: false,
      motivo: `Conversa aberta, mas o modelo não saiu: ${detalhe}`,
      recuperavel: envio.status >= 500 || envio.status === 429,
    };
  }

  return { ok: true, conversaId: String(conversaId), mensagemId: String(mensagemId) };
}

/** Quantas variáveis o texto do modelo declara. */
export function quantasVariaveis(textoDoModelo: string): number {
  const achadas = new Set(
    [...String(textoDoModelo || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  );
  return achadas.size === 0 ? 0 : Math.max(...achadas);
}

/**
 * Troca as variáveis do modelo pelos valores.
 *
 * Três recusas, todas por motivo prático:
 *
 *  - quantidade diferente da que o modelo declara: a Meta rejeita o envio
 *    inteiro, e o erro dela não diz qual variável faltou;
 *  - valor em branco: também rejeitado, e "para a . Certo?" seria pior do que
 *    não mandar;
 *  - modelo sem variável nenhuma: aceito, mas então não há o que preencher.
 *
 * A conferência é aqui e não na hora do envio porque aqui dá para dizer o que
 * está errado.
 */
export function preencherModelo(
  textoDoModelo: string,
  valores: string[]
): { ok: true; texto: string } | { ok: false; motivo: string } {
  const esperadas = quantasVariaveis(textoDoModelo);

  if (valores.length !== esperadas) {
    return {
      ok: false,
      motivo: `O modelo declara ${esperadas} variável(is) e foram informados ${valores.length}.`,
    };
  }

  const vazia = valores.findIndex((v) => !v || !v.trim());
  if (vazia >= 0) {
    return { ok: false, motivo: `A variável ${vazia + 1} do modelo está vazia.` };
  }

  let texto = textoDoModelo;
  valores.forEach((v, i) => {
    texto = texto.split(`{{${i + 1}}}`).join(v.trim());
  });

  return { ok: true, texto };
}
