/**
 * Um aviso falso do Clicksign faria o CRM declarar um contrato assinado, e no
 * fluxo real isso faz alguém começar um projeto que não foi fechado. É a
 * integração em que aviso forjado causa mais estrago -- daí os testes.
 */
import { describe, it, expect } from 'vitest';
import {
  assinaturaConfere,
  hmacHex,
  significadoDoEvento,
} from '@/lib/clicksign/assinatura';

const SEGREDO = 'segredo-do-webhook-clicksign';
const CORPO = JSON.stringify({
  event: { name: 'auto_close', occurred_at: '2026-09-03T12:00:00Z' },
  document: { key: 'abc-123', filename: 'Contrato.pdf' },
});

describe('assinatura do aviso', () => {
  it('aceita aviso legítimo', async () => {
    const a = await hmacHex(SEGREDO, CORPO);
    expect(await assinaturaConfere(CORPO, SEGREDO, a)).toEqual({ ok: true });
  });

  it('aceita com o prefixo sha256=, se um dia o Clicksign passar a mandar', async () => {
    const a = `sha256=${await hmacHex(SEGREDO, CORPO)}`;
    expect(await assinaturaConfere(CORPO, SEGREDO, a)).toEqual({ ok: true });
  });

  it('recusa corpo adulterado depois de assinado', async () => {
    const a = await hmacHex(SEGREDO, CORPO);
    const adulterado = CORPO.replace('abc-123', 'documento-de-outro-negocio');
    expect((await assinaturaConfere(adulterado, SEGREDO, a)).ok).toBe(false);
  });

  it('recusa assinatura feita com outro segredo', async () => {
    const a = await hmacHex('segredo-errado', CORPO);
    expect((await assinaturaConfere(CORPO, SEGREDO, a)).ok).toBe(false);
  });

  it('recusa aviso sem assinatura nenhuma', async () => {
    const r = await assinaturaConfere(CORPO, SEGREDO, '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('aviso sem assinatura');
  });

  it('recusa assinatura de tamanho diferente sem estourar', async () => {
    expect((await assinaturaConfere(CORPO, SEGREDO, 'abc')).ok).toBe(false);
  });
});

describe('o que cada evento significa', () => {
  // Este é o ponto mais fácil de errar. Num contrato com duas partes, `sign`
  // chega duas vezes e o contrato AINDA NÃO está fechado. Tratar `sign` como
  // conclusão faria o projeto começar assinado por um lado só.
  it('assinatura individual não fecha o contrato', () => {
    expect(significadoDoEvento('sign')).toBe('aguardando');
  });

  it('fechamento é auto_close ou close', () => {
    expect(significadoDoEvento('auto_close')).toBe('assinado');
    expect(significadoDoEvento('close')).toBe('assinado');
  });

  it('recusa e cancelamento não são assinatura', () => {
    expect(significadoDoEvento('refusal')).toBe('recusado');
    expect(significadoDoEvento('cancel')).toBe('cancelado');
    expect(significadoDoEvento('deadline')).toBe('cancelado');
  });

  // Evento novo do Clicksign não pode ser tratado como assinatura por descuido.
  it('evento desconhecido não vira nada', () => {
    expect(significadoDoEvento('evento_que_o_clicksign_inventar')).toBeNull();
    expect(significadoDoEvento(undefined)).toBeNull();
  });
});
