/**
 * Tradução do que o RD Station manda para o que o CRM entende.
 *
 * O formato do RD varia por landing page: os campos personalizados entram com
 * o nome que a pessoa deu ao campo (`cf_faturamento_mensal`, `cf_duvida_trafego`),
 * e o telefone pode chegar em três lugares diferentes. Por isso a leitura é
 * tolerante e o corpo original fica guardado: quando um lead entrar torto, dá
 * para ver exatamente o que chegou em vez de pedir ao cliente que preencha de novo.
 *
 * @module lib/rd/payload
 */

export interface LeadDoRD {
  /** Identificador da conversão no RD, quando vem. Serve contra duplicata. */
  conversaoId: string | null;
  nome: string | null;
  primeiroNome: string | null;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  cargo: string | null;
  /** Qual formulário/landing page originou. */
  identificador: string | null;
  /** Tudo que a pessoa respondeu, já sem os campos de controle do RD. */
  respostas: Record<string, string>;
}

/** Campos do RD que são controle, e não resposta de ninguém. */
const CONTROLE = new Set([
  'identificador', 'email', 'name', 'nome', 'company', 'empresa', 'job_title', 'cargo',
  'personal_phone', 'mobile_phone', 'phone', 'telefone', 'celular', 'whatsapp',
  'traffic_source', 'traffic_medium', 'traffic_campaign', 'traffic_value',
  'conversion_domain', 'conversion_url', 'internal_source', 'client_tracking_id',
  'c_utmz', 'privacy_data', 'available_for_mailing', 'created_at', 'id',
]);

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * Telefone em formato que o WhatsApp aceita.
 *
 * Devolve só dígitos com país. Número brasileiro sem o 55 é o caso comum (o
 * formulário pede "(41) 99999-9999"), e mandar sem o país faz a Meta recusar
 * ou, pior, entregar para outra pessoa em outro país.
 */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  let d = String(bruto).replace(/\D/g, '');
  if (!d) return null;

  // Tira zeros de discagem nacional ("041...").
  d = d.replace(/^0+/, '');

  // Já tem país.
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;

  // DDD + número, sem país.
  if (d.length === 10 || d.length === 11) return `55${d}`;

  // Outro país, já com código: aceita como veio, dentro do que a Meta permite.
  if (d.length >= 11 && d.length <= 15) return d;

  return null;
}

/** O primeiro nome, que é como se chama alguém numa mensagem. */
export function primeiroNome(nome: string | null): string | null {
  if (!nome) return null;
  const parte = nome.trim().split(/\s+/)[0];
  if (!parte) return null;
  // "JOÃO" vira "João": nome em caixa alta numa mensagem parece cobrança.
  return parte.length > 2 && parte === parte.toUpperCase()
    ? parte[0] + parte.slice(1).toLowerCase()
    : parte;
}

interface CorpoRD {
  leads?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/**
 * Lê o corpo do webhook do RD.
 *
 * O RD manda `leads: [...]` mesmo quando é um só. Aceita também o objeto solto,
 * porque o botão "Verificar" da tela do RD manda um formato reduzido.
 */
export function lerLeadDoRD(corpo: unknown): LeadDoRD | null {
  const c = (corpo || {}) as CorpoRD;
  const lead = (Array.isArray(c.leads) && c.leads.length > 0 ? c.leads[0] : c) as Record<string, unknown>;
  if (!lead || typeof lead !== 'object') return null;

  const conversao = (lead.last_conversion || {}) as Record<string, unknown>;
  const conteudo = (conversao.content || {}) as Record<string, unknown>;
  const personalizados = (lead.custom_fields || {}) as Record<string, unknown>;

  // A ordem importa: o que a pessoa acabou de responder vale mais que o
  // cadastro antigo do RD, que pode estar desatualizado.
  const de = (...chaves: string[]): string | null => {
    for (const k of chaves) {
      const v = texto(conteudo[k]) ?? texto(personalizados[k]) ?? texto(lead[k]);
      if (v) return v;
    }
    return null;
  };

  const nome = de('name', 'nome', 'nome_completo');

  const respostas: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...personalizados, ...conteudo })) {
    if (CONTROLE.has(k)) continue;
    const s = texto(v);
    if (s) respostas[k] = s;
  }

  return {
    conversaoId:
      texto(conversao.id) ??
      texto((conteudo as { conversion_id?: unknown }).conversion_id) ??
      null,
    nome,
    primeiroNome: primeiroNome(nome),
    email: de('email'),
    telefone: normalizarTelefone(
      de('mobile_phone', 'personal_phone', 'phone', 'telefone', 'celular', 'whatsapp')
    ),
    empresa: de('company', 'empresa', 'company_name'),
    cargo: de('job_title', 'cargo'),
    identificador: de('identificador', 'conversion_identifier') ?? texto(conversao.source),
    respostas,
  };
}

/**
 * As respostas em texto corrido, para virar contexto de conversa.
 *
 * Nome do campo vira frase legível: `cf_faturamento_mensal` → "faturamento
 * mensal". É o que a IA vai ler antes de falar com a pessoa.
 */
export function respostasEmTexto(respostas: Record<string, string>): string {
  return Object.entries(respostas)
    .map(([k, v]) => {
      const rotulo = k
        .replace(/^cf_/, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      return `${rotulo}: ${v}`;
    })
    .join('\n');
}
