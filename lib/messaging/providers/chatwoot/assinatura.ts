/**
 * Conferencia da assinatura dos eventos do Chatwoot.
 *
 * O Chatwoot manda `X-Chatwoot-Signature: sha256=<hmac hex>`. O QUE entra no
 * calculo varia com a versao da instalacao: umas assinam
 * "<timestamp>.<corpo cru>", com o horario num cabecalho a parte, e outras
 * assinam so o corpo. A documentacao descreve a primeira; a instalacao real
 * pode ser a segunda.
 *
 * Isto nao e detalhe academico: exigir um formato so, na pratica, derrubou o
 * espelhamento inteiro. Com a conferencia ligada, mensagem de cliente parava de
 * chegar em silencio -- pior do que nao ter conferencia nenhuma, porque a falha
 * nao aparece em lugar nenhum.
 *
 * Entao aceitamos qualquer um dos formatos conhecidos. Isso nao afrouxa a
 * seguranca: todos exigem conhecer o segredo, que e o ponto. O que muda e so
 * onde o horario entra.
 *
 * Protecao contra reenvio: quando vem timestamp, ele e conferido contra uma
 * janela curta, entao um evento capturado nao serve para sempre. Quando a
 * instalacao nao manda timestamp, nao ha o que conferir -- e isso fica dito
 * aqui em voz alta em vez de parecer que a protecao existe.
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

  const bruto = cabecalhoTimestamp.trim();
  const timestamp = Number(bruto);
  const temTimestamp = bruto !== '' && Number.isFinite(timestamp);

  // Só dá para recusar evento velho quando existe um horário para comparar.
  if (temTimestamp) {
    const idadeSegundos = Math.abs(agoraEmSegundos - timestamp);
    if (idadeSegundos > JANELA_DE_ACEITE_SEGUNDOS) {
      return { ok: false, motivo: `evento fora da janela (${Math.round(idadeSegundos)}s)` };
    }
  }

  const candidatos = temTimestamp
    ? [`${bruto}.${corpo}`, corpo, `${bruto}${corpo}`]
    : [corpo];

  for (const mensagem of candidatos) {
    const esperada = await hmacHex(segredo, mensagem);
    if (comparaEmTempoConstante(esperada, recebida)) return { ok: true };
  }

  return { ok: false, motivo: 'assinatura não confere' };
}

/**
 * Compara sem deixar o tempo de resposta contar quantos caracteres bateram.
 * Comparar com === permite descobrir a assinatura correta tentativa a tentativa.
 */
function comparaEmTempoConstante(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;

  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= x[i] ^ y[i];
  return diferenca === 0;
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
