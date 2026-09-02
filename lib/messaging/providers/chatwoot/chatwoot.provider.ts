/**
 * @fileoverview Provedor Chatwoot.
 *
 * Diferente dos outros provedores, este NAO fala com a Meta nem com a Z-API.
 * Ele conversa com uma instalacao do Chatwoot, que continua sendo a dona do
 * numero de WhatsApp.
 *
 * Por que assim, e nao ligando o CRM direto na Meta: um numero da Cloud API
 * aponta seu webhook para UM endereco so. Se o CRM assumisse esse webhook, o
 * Chatwoot pararia de receber mensagem e as IAs de atendimento que rodam em
 * cima dele parariam junto. Mantendo o Chatwoot como dono do canal, nada do que
 * ja funciona quebra, e o CRM entra como espelho que tambem sabe responder.
 *
 * O caminho da resposta enviada pelo CRM e:
 *   CRM -> API do Chatwoot -> Meta -> WhatsApp do cliente
 *
 * @module lib/messaging/providers/chatwoot
 */

import { BaseChannelProvider } from '../base.provider';
import type {
  ChannelType,
  ProviderConfig,
  ValidationResult,
  ConnectionStatusResult,
  SendMessageParams,
  SendMessageResult,
  WebhookHandlerResult,
} from '../../types';

/** Credenciais de uma instalacao do Chatwoot. */
export interface ChatwootCredentials {
  /** Endereco da instalacao, ex.: https://central.timefactordigital.com.br */
  baseUrl: string;
  /** Numero da conta dentro do Chatwoot (normalmente 1). */
  accountId: string;
  /** Token de acesso de um agente ou do bot. */
  apiAccessToken: string;
  /** Caixa de entrada a espelhar. Vazio espelha todas. */
  inboxId?: string;
}

/** Recorte do que o Chatwoot manda no webhook. Ele envia bem mais campos. */
interface EventoChatwoot {
  event?: string;
  message_type?: 'incoming' | 'outgoing' | number;
  content?: string | null;
  id?: number;
  private?: boolean;
  conversation?: {
    id?: number;
    inbox_id?: number;
    meta?: { sender?: ContatoChatwoot };
  };
  sender?: ContatoChatwoot;
  inbox?: { id?: number; name?: string };
  created_at?: string | number;
}

interface ContatoChatwoot {
  id?: number;
  name?: string;
  phone_number?: string | null;
  email?: string | null;
  thumbnail?: string | null;
  identifier?: string | null;
}

export class ChatwootProvider extends BaseChannelProvider {
  readonly channelType: ChannelType = 'whatsapp';
  readonly providerName = 'chatwoot';

  private cred!: ChatwootCredentials;

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.cred = config.credentials as unknown as ChatwootCredentials;
  }

  /** Endereco base da API, ja com a conta. */
  private get api(): string {
    const raiz = (this.cred.baseUrl || '').replace(/\/+$/, '');
    return `${raiz}/api/v1/accounts/${this.cred.accountId}`;
  }

  private get cabecalhos(): Record<string, string> {
    return {
      api_access_token: this.cred.apiAccessToken,
      'Content-Type': 'application/json',
    };
  }

  validateConfig(config: ProviderConfig): ValidationResult {
    const c = config.credentials as unknown as ChatwootCredentials;
    const erros: { field: string; message: string; code: string }[] = [];

    if (!c?.baseUrl?.trim()) {
      erros.push({ field: 'baseUrl', code: 'OBRIGATORIO', message: 'Informe o endereço da instalação do Chatwoot.' });
    } else if (!/^https?:\/\//i.test(c.baseUrl)) {
      erros.push({ field: 'baseUrl', code: 'FORMATO', message: 'O endereço precisa começar com https://' });
    }
    if (!c?.accountId?.toString().trim()) {
      erros.push({ field: 'accountId', code: 'OBRIGATORIO', message: 'Informe o número da conta (normalmente 1).' });
    }
    if (!c?.apiAccessToken?.trim()) {
      erros.push({ field: 'apiAccessToken', code: 'OBRIGATORIO', message: 'Informe o token de acesso.' });
    }

    return { valid: erros.length === 0, errors: erros };
  }

  /**
   * Confere se as credenciais abrem a conta.
   *
   * Usa /conversations com limite 1 em vez de um endpoint de perfil: e a mesma
   * permissao que o envio precisa, entao um "conectado" aqui significa que
   * responder tambem vai funcionar.
   */
  async getStatus(): Promise<ConnectionStatusResult> {
    try {
      const r = await fetch(`${this.api}/conversations?page=1`, { headers: this.cabecalhos });

      if (r.status === 401 || r.status === 403) {
        return { status: 'error', message: 'Token recusado pelo Chatwoot.' };
      }
      if (!r.ok) {
        return { status: 'error', message: `Chatwoot respondeu ${r.status}.` };
      }
      return {
        status: 'connected',
        message: 'Conectado ao Chatwoot.',
        details: { businessName: `Conta ${this.cred.accountId}` },
      };
    } catch (e) {
      return {
        status: 'error',
        message: e instanceof Error ? e.message : 'Não foi possível alcançar o Chatwoot.',
      };
    }
  }

  /**
   * Envia mensagem pela conversa do Chatwoot.
   *
   * `params.to` carrega o id da conversa NO CHATWOOT, e nao o telefone: quem
   * entrega ao WhatsApp e o Chatwoot, que ja sabe para quem aquela conversa
   * pertence. Mandar telefone aqui criaria uma segunda conversa e partiria o
   * historico em dois.
   */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const conversaChatwoot = params.to;

    // Sem token nao ha o que tentar. Recusar aqui, com motivo, e melhor do que
    // deixar a chamada seguir e falhar la na frente de um jeito generico: o
    // caso real e o canal recem-criado, ainda esperando alguem colar o token.
    if (!this.cred?.apiAccessToken?.trim()) {
      return {
        success: false,
        error: {
          code: 'SEM_TOKEN',
          message:
            'O canal do Chatwoot ainda não tem token de acesso. Preencha em Configurações → Integrações para poder responder daqui.',
          retryable: false,
        },
      };
    }

    if (!/^\d+$/.test(conversaChatwoot)) {
      return {
        success: false,
        error: {
          code: 'CONVERSA_INVALIDA',
          message:
            'Esta conversa ainda não existe no Chatwoot. Só é possível responder a partir de uma conversa que já chegou.',
          retryable: false,
        },
      };
    }

    const texto =
      params.content.type === 'text'
        ? (params.content as { text: string }).text
        : JSON.stringify(params.content);

    try {
      const r = await fetch(`${this.api}/conversations/${conversaChatwoot}/messages`, {
        method: 'POST',
        headers: this.cabecalhos,
        body: JSON.stringify({ content: texto, message_type: 'outgoing' }),
      });

      const corpo = await r.json().catch(() => null);

      if (!r.ok) {
        return {
          success: false,
          error: {
            code: `HTTP_${r.status}`,
            message: (corpo as { error?: string })?.error || `Chatwoot recusou o envio (${r.status}).`,
            // 5xx e 429 vale tentar de novo; 4xx nao adianta.
            retryable: r.status >= 500 || r.status === 429,
          },
          raw: corpo,
        };
      }

      return {
        success: true,
        externalMessageId: String((corpo as { id?: number })?.id ?? ''),
        status: 'sent',
        raw: corpo,
      };
    } catch (e) {
      return {
        success: false,
        error: {
          code: 'REDE',
          message: e instanceof Error ? e.message : 'Falha de rede ao falar com o Chatwoot.',
          retryable: true,
        },
      };
    }
  }

  /**
   * Traduz o webhook do Chatwoot para o formato interno.
   *
   * Duas guardas que evitam sujeira no CRM:
   *  - nota privada nao vira mensagem, senao recado interno da equipe apareceria
   *    no historico do cliente
   *  - mensagem de saida tambem entra, porque e assim que a resposta das IAs de
   *    atendimento aparece aqui: elas respondem pelo Chatwoot, nao pelo CRM
   */
  async handleWebhook(payload: unknown): Promise<WebhookHandlerResult> {
    const e = payload as EventoChatwoot;
    const conversaId = e.conversation?.id;
    const remetente = e.conversation?.meta?.sender || e.sender;

    const ehEntrada = e.message_type === 'incoming' || e.message_type === 0;

    if (e.event !== 'message_created' || e.private || !conversaId) {
      return {
        type: 'status_update',
        externalId: e.id ? String(e.id) : undefined,
        data: { type: 'status_update' } as never,
        raw: payload,
      };
    }

    return {
      type: ehEntrada ? 'message_received' : 'message_sent',
      externalId: e.id ? String(e.id) : undefined,
      data: {
        type: ehEntrada ? 'message_received' : 'message_sent',
        // A conversa do Chatwoot e a chave, e nao o telefone: e ela que o envio
        // vai precisar de volta na hora de responder.
        from: String(conversaId),
        fromName: remetente?.name || undefined,
        fromAvatar: remetente?.thumbnail || undefined,
        content: { type: 'text', text: e.content || '' },
        externalMessageId: String(e.id ?? ''),
        timestamp: e.created_at ? new Date(e.created_at).toISOString() : new Date().toISOString(),
        // Guardado para casar com o contato do CRM pelo telefone.
        metadata: {
          chatwootConversationId: conversaId,
          chatwootInboxId: e.conversation?.inbox_id ?? e.inbox?.id,
          telefone: remetente?.phone_number || null,
          email: remetente?.email || null,
        },
      } as never,
      raw: payload,
    };
  }
}
