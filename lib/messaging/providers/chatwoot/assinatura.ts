/**
 * Conferencia da assinatura dos eventos do Chatwoot.
 *
 * Formato, conferido na documentacao e nao no chute:
 *   X-Chatwoot-Signature: sha256=<hmac hex>
 *   X-Chatwoot-Timestamp: <unix em segundos>
 * e o HMAC-SHA256 e calculado sobre a string "<timestamp>.<corpo cru>".
 *
 * O timestamp entra no calculo de proposito: sem ele, quem interceptasse um
 * evento valido poderia reenviar o mesmo par corpo+assinatura para sempre.
 * Por isso tambem recusamos evento velho.
 *
 * Vive num arquivo proprio, e nao dentro da rota, para poder ser testado: e o
 * tipo de codigo que, quando quebra, quebra em silencio.
 */

export const JANELA_DE_ACEITE_SEGUNDOS = 5 * 60;

export type VereditoAssinatura = { ok: true } | { ok: false; motivo: string };

export async function assinaturaConfere(
  corpo: string,
  segredo: string,
  cabecalhoAssinatura: string,
  cabecalhoTimestamp: string,
  agoraEmSegundos: number = Date.now() / 1000
): Promise<VereditoAssinatura> {
  const recebida = cabecalhoAssinatura.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!recebida) return { ok: false, motivo: 'assinatura vazia' };

  const timestamp = Number(cabecalhoTimestamp);
  if (!Number.isFinite(timestamp) || !cabecalhoTimestamp.trim()) {
    return { ok: false, motivo: 'timestamp ausente' };
  }

  const idadeSegundos = Math.abs(agoraEmSegundos - timestamp);
  if (idadeSegundos > JANELA_DE_ACEITE_SEGUNDOS) {
    return { ok: false, motivo: `evento fora da janela (${Math.round(idadeSegundos)}s)` };
  }

  const esperada = await hmacHex(segredo, `${cabecalhoTimestamp}.${corpo}`);

  // Comparacao em tempo constante: comparar com === vazaria, pelo tempo de
  // resposta, quantos caracteres iniciais estavam certos, e isso permite
  // descobrir a assinatura correta tentativa a tentativa.
  const a = new TextEncoder().encode(esperada);
  const b = new TextEncoder().encode(recebida);
  if (a.length !== b.length) return { ok: false, motivo: 'assinatura não confere' };

  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0 ? { ok: true } : { ok: false, motivo: 'assinatura não confere' };
}

/** Exportada para os testes poderem produzir uma assinatura legitima. */
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
