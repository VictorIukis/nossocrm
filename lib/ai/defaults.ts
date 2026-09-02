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
