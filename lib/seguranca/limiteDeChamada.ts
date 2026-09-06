/**
 * Freio de vazão para endereços públicos.
 *
 * Webhook é público por natureza: quem tem o endereço, chama. O segredo impede
 * que um estranho invente eventos, mas não impede volume -- e o endereço do RD
 * carrega o segredo na própria URL, porque é o que o RD permite. Endereço
 * vazado num print, num log de proxy ou colado no lugar errado significa
 * contato e negócio criados sem limite, e agora também mensagem saindo do
 * WhatsApp oficial.
 *
 * O freio não protege contra ataque decidido: quem quiser derrubar tem caminhos
 * melhores. Ele protege contra o caso provável, que é laço mal escrito do outro
 * lado ou reenvio em massa.
 *
 * @module lib/seguranca/limiteDeChamada
 */

import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export interface Veredito {
  permitido: boolean;
  usados: number;
  /** Quantos segundos esperar antes de tentar de novo. */
  esperaSegundos: number;
}

/**
 * Consome uma vaga na janela.
 *
 * Em caso de erro no banco, LIBERA a chamada de propósito. O freio existe para
 * conter volume anormal; deixar de receber lead porque a contagem falhou seria
 * trocar um problema improvável por um certo.
 */
export async function consumirLimite(
  endpoint: string,
  identificador: string,
  teto: number,
  janelaSegundos: number
): Promise<Veredito> {
  const sb = createStaticAdminClient();

  const { data, error } = await sb.rpc('consumir_limite', {
    p_endpoint: endpoint,
    p_identificador: identificador,
    p_teto: teto,
    p_janela_segundos: janelaSegundos,
  });

  if (error) {
    console.error('[limite] falha ao contar; liberando a chamada:', error);
    return { permitido: true, usados: 0, esperaSegundos: 0 };
  }

  const linha = (Array.isArray(data) ? data[0] : data) as
    | { permitido: boolean; usados: number; espera_segundos: number }
    | null;

  if (!linha) return { permitido: true, usados: 0, esperaSegundos: 0 };

  return {
    permitido: Boolean(linha.permitido),
    usados: Number(linha.usados ?? 0),
    esperaSegundos: Number(linha.espera_segundos ?? 0),
  };
}

/**
 * Resposta padrão de recusa por volume.
 *
 * `Retry-After` não é enfeite: é o que faz um cliente bem comportado (o RD, o
 * Clicksign) parar e voltar depois, em vez de insistir e piorar.
 */
export function respostaDeLimite(esperaSegundos: number): Response {
  return new Response(
    JSON.stringify({
      error: 'Muitas chamadas em pouco tempo',
      tenteEmSegundos: esperaSegundos,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(Math.max(1, esperaSegundos)),
      },
    }
  );
}
