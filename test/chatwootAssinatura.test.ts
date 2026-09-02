/**
 * A rota do Chatwoot escreve no historico de conversa de clientes. Sem
 * conferencia de assinatura, quem descobrisse a URL poderia inserir mensagem
 * falsa. Estes testes existem para essa conferencia nao quebrar em silencio.
 */
import { describe, it, expect } from 'vitest';
import {
  assinaturaConfere,
  hmacHex,
  JANELA_DE_ACEITE_SEGUNDOS,
} from '@/lib/messaging/providers/chatwoot/assinatura';

const SEGREDO = 'segredo-do-webhook-123';
const CORPO = JSON.stringify({ event: 'message_created', id: 7, content: 'oi' });
const AGORA = 1_788_000_000;

async function assinar(corpo: string, ts: number, segredo = SEGREDO) {
  return `sha256=${await hmacHex(segredo, `${ts}.${corpo}`)}`;
}

describe('assinatura do webhook do Chatwoot', () => {
  it('aceita evento legítimo', async () => {
    const a = await assinar(CORPO, AGORA);
    expect(await assinaturaConfere(CORPO, SEGREDO, a, String(AGORA), AGORA)).toEqual({ ok: true });
  });

  it('aceita a assinatura sem o prefixo sha256=', async () => {
    const a = (await assinar(CORPO, AGORA)).replace('sha256=', '');
    expect(await assinaturaConfere(CORPO, SEGREDO, a, String(AGORA), AGORA)).toEqual({ ok: true });
  });

  it('recusa corpo adulterado depois de assinado', async () => {
    const a = await assinar(CORPO, AGORA);
    const adulterado = CORPO.replace('oi', 'me manda seu cartão');
    const r = await assinaturaConfere(adulterado, SEGREDO, a, String(AGORA), AGORA);
    expect(r.ok).toBe(false);
  });

  it('recusa assinatura feita com outro segredo', async () => {
    const a = await assinar(CORPO, AGORA, 'segredo-errado');
    const r = await assinaturaConfere(CORPO, SEGREDO, a, String(AGORA), AGORA);
    expect(r.ok).toBe(false);
  });

  it('recusa reenvio de evento antigo, mesmo com assinatura válida', async () => {
    const velho = AGORA - JANELA_DE_ACEITE_SEGUNDOS - 1;
    const a = await assinar(CORPO, velho);
    const r = await assinaturaConfere(CORPO, SEGREDO, a, String(velho), AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('fora da janela');
  });

  it('aceita evento dentro da janela', async () => {
    const quase = AGORA - JANELA_DE_ACEITE_SEGUNDOS + 5;
    const a = await assinar(CORPO, quase);
    expect(await assinaturaConfere(CORPO, SEGREDO, a, String(quase), AGORA)).toEqual({ ok: true });
  });

  it('recusa evento sem assinatura e sem timestamp', async () => {
    expect((await assinaturaConfere(CORPO, SEGREDO, '', String(AGORA), AGORA)).ok).toBe(false);
    const a = await assinar(CORPO, AGORA);
    const r = await assinaturaConfere(CORPO, SEGREDO, a, '', AGORA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('timestamp ausente');
  });

  it('recusa assinatura de tamanho diferente sem estourar', async () => {
    const r = await assinaturaConfere(CORPO, SEGREDO, 'sha256=abc', String(AGORA), AGORA);
    expect(r.ok).toBe(false);
  });
});
