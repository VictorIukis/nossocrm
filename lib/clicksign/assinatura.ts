/**
 * Conferência da assinatura dos avisos do Clicksign.
 *
 * O Clicksign manda `x-clicksign-signature` com o HMAC-SHA256 do corpo, usando
 * o segredo gerado ao cadastrar o webhook.
 *
 * Sem conferir isso, qualquer pessoa que descobrisse o endereço poderia
 * declarar um contrato assinado -- e no fluxo do Renato isso faria o projeto
 * começar antes de existir contrato. É a integração desta lista em que um aviso
 * falso causa mais estrago.
 *
 * Vive num arquivo próprio para poder ser testado: é código que, quando quebra,
 * quebra em silêncio.
 *
 * @module lib/clicksign/assinatura
 */

export type Veredito = { ok: true } | { ok: false; motivo: string };

export async function assinaturaConfere(
  corpo: string,
  segredo: string,
  cabecalho: string
): Promise<Veredito> {
  // O Clicksign envia hex puro; aceitar o prefixo `sha256=` não custa nada e
  // evita quebrar se um dia ele mudar de formato.
  const recebida = cabecalho.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!recebida) return { ok: false, motivo: 'aviso sem assinatura' };

  const esperada = await hmacHex(segredo, corpo);

  // Comparação em tempo constante: comparar com === vaza, pelo tempo de
  // resposta, quantos caracteres iniciais estavam certos, e isso permite
  // descobrir a assinatura tentativa a tentativa.
  const a = new TextEncoder().encode(esperada);
  const b = new TextEncoder().encode(recebida);
  if (a.length !== b.length) return { ok: false, motivo: 'assinatura não confere' };

  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0 ? { ok: true } : { ok: false, motivo: 'assinatura não confere' };
}

/** Exportada para os testes poderem produzir uma assinatura legítima. */
export async function hmacHex(segredo: string, mensagem: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(mensagem));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// eventos
// ---------------------------------------------------------------------------

/**
 * O que cada evento do Clicksign significa para o negócio.
 *
 * `sign` é uma assinatura individual: num contrato com duas partes, ele chega
 * duas vezes e o contrato ainda não está fechado. Quem fecha é `auto_close` ou
 * `close`. Tratar `sign` como conclusão faria o projeto começar com o contrato
 * assinado por um lado só -- exatamente o erro que a integração existe para
 * evitar.
 */
export const SIGNIFICADO: Record<string, 'assinado' | 'aguardando' | 'recusado' | 'cancelado'> = {
  auto_close: 'assinado',
  close: 'assinado',
  sign: 'aguardando',
  upload: 'aguardando',
  add_signer: 'aguardando',
  remove_signer: 'aguardando',
  deadline: 'cancelado',
  cancel: 'cancelado',
  refusal: 'recusado',
};

export function significadoDoEvento(
  nome: string | undefined
): 'assinado' | 'aguardando' | 'recusado' | 'cancelado' | null {
  if (!nome) return null;
  return SIGNIFICADO[nome] ?? null;
}
