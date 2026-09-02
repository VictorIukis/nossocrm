/**
 * Numa tela de atendimento, mensagem que some ao apertar Enter e defeito caro:
 * quem atende acredita que respondeu o cliente.
 */
import { describe, it, expect } from 'vitest';
import { deveEnviarComEnter } from '@/features/messaging/components/enviarComEnter';

describe('Enter no campo de mensagem', () => {
  it('envia com Enter simples', () => {
    expect(deveEnviarComEnter({ key: 'Enter', shiftKey: false })).toBe(true);
  });

  it('não envia com Shift+Enter, que é quebra de linha', () => {
    expect(deveEnviarComEnter({ key: 'Enter', shiftKey: true })).toBe(false);
  });

  it('não envia durante composição de acento (ã, ç em português)', () => {
    expect(deveEnviarComEnter({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
  });

  it('não envia com keyCode 229, a composição dos navegadores antigos', () => {
    expect(deveEnviarComEnter({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false);
  });

  it('ignora outras teclas', () => {
    expect(deveEnviarComEnter({ key: 'a', shiftKey: false })).toBe(false);
    expect(deveEnviarComEnter({ key: 'Escape', shiftKey: false })).toBe(false);
  });
});
