/**
 * Padroes por provedor. Fonte unica de verdade.
 *
 * Servem de reserva quando o banco devolve null, por exemplo numa organizacao
 * recem-criada antes do primeiro salvamento.
 */
export const AI_DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  google: 'gemini-2.0-flash',
} as const;

/**
 * Anthropic e o padrao porque e o mesmo provedor que ja roda as IAs de
 * atendimento do grupo: uma conta, uma fatura, um lugar para controlar custo e
 * um unico terceiro a declarar em contrato de cliente.
 */
export const AI_DEFAULT_PROVIDER = 'anthropic' as const;

/**
 * De qual coluna de organization_settings sai a chave de cada provedor.
 * Existe para o resto do codigo nunca mais precisar saber esse detalhe.
 */
export const AI_COLUNA_DA_CHAVE = {
  anthropic: 'ai_anthropic_key',
  google: 'ai_google_key',
} as const;

/** Colunas de chave que qualquer consulta de configuracao de IA deve trazer. */
export const AI_COLUNAS_DE_CHAVE = Object.values(AI_COLUNA_DA_CHAVE).join(', ');

/**
 * Modelos aceitos por provedor.
 *
 * Vive aqui, e nao em config.ts, porque quem so precisa validar um nome de
 * modelo nao deveria ter que carregar o SDK de IA inteiro junto.
 */
export const AI_MODELOS_PERMITIDOS: Record<'anthropic' | 'google', readonly string[]> = {
  anthropic: [
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4-5-20251001',
  ],
  google: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ],
} as const;

/**
 * Devolve um modelo que existe no provedor pedido.
 *
 * Serve principalmente para o caso de troca de provedor: o modelo antigo fica
 * gravado no banco e, sem esta trava, o sistema pede um modelo do Google para a
 * Anthropic e recebe "modelo nao encontrado" como se a chave fosse ruim.
 */
export function normalizarModelo(provider: 'anthropic' | 'google', modelId?: string | null): string {
  const escolhido = (modelId || '').trim();
  return AI_MODELOS_PERMITIDOS[provider].includes(escolhido)
    ? escolhido
    : AI_DEFAULT_MODELS[provider];
}
