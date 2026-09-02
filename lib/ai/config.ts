/**
 * @fileoverview Configuração de provedores de IA para o CRM.
 * 
 * Este módulo abstrai a criação de clientes de diferentes provedores de IA
 * (Google Gemini, OpenAI, Anthropic Claude), permitindo trocar entre eles
 * de forma transparente.
 * 
 * @module services/ai/config
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_DEFAULT_MODELS, AI_DEFAULT_PROVIDER, AI_COLUNA_DA_CHAVE } from './defaults';

export type AIProvider = 'anthropic' | 'google';

/**
 * Modelos aceitos por provedor.
 *
 * A lista existe como trava: sem ela, um valor errado gravado no banco vira uma
 * chamada a um modelo inexistente e o erro so aparece em producao. Modelo fora
 * da lista cai no padrao do provedor em vez de quebrar.
 */
const MODELOS_PERMITIDOS: Record<AIProvider, Set<string>> = {
  anthropic: new Set([
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-haiku-4-5-20251001',
  ]),
  google: new Set([
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ]),
};

/**
 * Descobre qual provedor e qual chave usar, a partir de uma linha de
 * organization_settings.
 *
 * Antes disto, oito lugares liam `ai_google_key` na mao. Trocar de provedor
 * significava caçar todos eles, e esquecer um significa uma parte do sistema
 * continuar chamando o provedor antigo em silencio.
 */
export function resolverProvedor(config: {
  ai_provider?: string | null;
  ai_anthropic_key?: string | null;
  ai_google_key?: string | null;
} | null | undefined): { provider: AIProvider; apiKey: string } {
  const bruto = (config?.ai_provider || '').trim().toLowerCase();
  const provider: AIProvider =
    bruto === 'anthropic' || bruto === 'google' ? bruto : AI_DEFAULT_PROVIDER;

  const coluna = AI_COLUNA_DA_CHAVE[provider];
  const apiKey = (config?.[coluna as keyof typeof config] as string | null) || '';

  return { provider, apiKey };
}

/**
 * Cria e retorna uma instância do modelo de IA configurada.
 * 
 * Suporta múltiplos provedores com modelos padrão:
 * - Google: gemini-3-flash-preview
 * - OpenAI: gpt-4o
 * - Anthropic: claude-3-5-sonnet-20240620
 * 
 * @param provider - Provedor de IA a ser utilizado.
 * @param apiKey - Chave de API do provedor.
 * @param modelId - ID do modelo específico (opcional, usa padrão se não informado).
 * @returns Instância configurada do modelo de IA.
 * @throws Error se a API key não for fornecida ou provedor não for suportado.
 * 
 * @example
 * ```typescript
 * // Usando Google Gemini
 * const model = getModel('google', 'sua-api-key', 'gemini-3-pro-preview');
 * 
 * // Usando OpenAI com modelo padrão
 * const model = getModel('openai', 'sua-api-key', '');
 * ```
 */
export const getModel = (provider: AIProvider, apiKey: string, modelId: string) => {
    if (!apiKey) {
        throw new Error('API Key is missing');
    }

    const escolhido = modelId && MODELOS_PERMITIDOS[provider]?.has(modelId)
        ? modelId
        : AI_DEFAULT_MODELS[provider];

    if (provider === 'anthropic') {
        const anthropic = createAnthropic({ apiKey });
        return anthropic(escolhido);
    }

    const google = createGoogleGenerativeAI({ apiKey });
    return google(escolhido);
};

/**
 * Configuração de modelo para uso com env vars.
 */
export interface ModelConfig {
    provider?: AIProvider;
    model?: string;
}

/**
 * Retorna um modelo de IA usando variáveis de ambiente.
 *
 * Usa as seguintes env vars:
 * - GOOGLE_GENERATIVE_AI_API_KEY
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 *
 * @param config - Configuração opcional (provider e model)
 * @returns Instância configurada do modelo de IA
 *
 * @example
 * ```typescript
 * // Usa provider padrão (google) com model padrão
 * const model = getModelFromEnv();
 *
 * // Especifica provider e model
 * const model = getModelFromEnv({ provider: 'openai', model: 'gpt-4o-mini' });
 * ```
 */
export const getModelFromEnv = (config?: ModelConfig) => {
    const provider = config?.provider || AI_DEFAULT_PROVIDER;
    const model = config?.model || '';

    const apiKey = provider === 'anthropic'
        ? process.env.ANTHROPIC_API_KEY
        : process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!apiKey) {
        const nome = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY';
        throw new Error(`API Key for ${provider} not found in environment (${nome})`);
    }

    return getModel(provider, apiKey, model);
};
