/**
 * A janela de horário do disparo automático.
 *
 * Sem ela, quem preenche o formulário às 3 da manhã é acordado às 3 da manhã.
 * No WhatsApp oficial isso também custa alcance: bloqueio e "marcar como spam"
 * derrubam a qualidade do número, e número com qualidade baixa entrega menos
 * para todo mundo, inclusive para quem estava esperando resposta.
 *
 * Tudo aqui é conta de fuso, que é onde o erro não aparece: ele produz um
 * horário plausível e errado.
 */
import { describe, it, expect } from 'vitest';
import { janelaAberta, proximaAbertura, quandoPodeEnviar, horaLocal } from '@/lib/rd/janela';

const SP = 'America/Sao_Paulo';
const COMERCIAL = { inicio: 9, fim: 20, fuso: SP };

/** Um instante, escrito na hora de São Paulo. */
const emSP = (texto: string) => new Date(`${texto}-03:00`);

describe('a hora local, e não a do servidor', () => {
  // O servidor roda em UTC. 23h em UTC é 20h em São Paulo: a diferença decide
  // se a mensagem sai ou não.
  it('meia-noite em UTC é 21h do dia anterior em São Paulo', () => {
    expect(horaLocal(new Date('2026-09-07T00:00:00Z'), SP)).toBe(21);
  });

  it('meio-dia em UTC é 9h em São Paulo', () => {
    expect(horaLocal(new Date('2026-09-07T12:00:00Z'), SP)).toBe(9);
  });
});

describe('janela comercial (9h às 20h)', () => {
  it('9h em ponto já pode', () => {
    expect(janelaAberta(emSP('2026-09-07T09:00:00'), COMERCIAL)).toBe(true);
  });

  it('19h59 ainda pode', () => {
    expect(janelaAberta(emSP('2026-09-07T19:59:00'), COMERCIAL)).toBe(true);
  });

  it('20h em ponto não pode mais', () => {
    expect(janelaAberta(emSP('2026-09-07T20:00:00'), COMERCIAL)).toBe(false);
  });

  it('3 da manhã não pode', () => {
    expect(janelaAberta(emSP('2026-09-07T03:00:00'), COMERCIAL)).toBe(false);
  });

  // Domingo dentro da janela pode, de propósito: quem preencheu o formulário há
  // cinco minutos está quente no domingo também.
  it('domingo de manhã pode', () => {
    const domingo = emSP('2026-09-06T10:00:00');
    expect(domingo.getUTCDay()).toBe(0);
    expect(janelaAberta(domingo, COMERCIAL)).toBe(true);
  });
});

describe('quando a janela abre de novo', () => {
  it('de madrugada, abre no mesmo dia às 9h', () => {
    const abre = proximaAbertura(emSP('2026-09-07T03:00:00'), COMERCIAL);
    expect(horaLocal(abre, SP)).toBe(9);
    expect(abre.toISOString()).toBe('2026-09-07T12:00:00.000Z');
  });

  it('depois de fechar, abre às 9h do dia seguinte', () => {
    const abre = proximaAbertura(emSP('2026-09-07T21:30:00'), COMERCIAL);
    expect(abre.toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });

  it('23h de um dia abre às 9h do dia seguinte, não do mesmo', () => {
    const abre = proximaAbertura(emSP('2026-09-07T23:00:00'), COMERCIAL);
    expect(abre.toISOString()).toBe('2026-09-08T12:00:00.000Z');
  });
});

describe('quando esta mensagem sai', () => {
  it('dentro da janela, sai agora', () => {
    const agora = emSP('2026-09-07T14:00:00');
    expect(quandoPodeEnviar(agora, COMERCIAL).getTime()).toBe(agora.getTime());
  });

  it('fora da janela, sai na abertura', () => {
    const agora = emSP('2026-09-07T05:00:00');
    const quando = quandoPodeEnviar(agora, COMERCIAL);
    expect(quando.getTime()).toBeGreaterThan(agora.getTime());
    expect(horaLocal(quando, SP)).toBe(9);
  });
});

describe('configurações fora do comum', () => {
  it('início igual ao fim significa 24 horas', () => {
    expect(janelaAberta(emSP('2026-09-07T03:00:00'), { inicio: 0, fim: 0, fuso: SP })).toBe(true);
  });

  // Janela invertida é aceita porque alguém pode querer isso para outro
  // público, e recusar em silêncio seria pior que obedecer.
  it('janela que atravessa a meia-noite (22h às 6h)', () => {
    const j = { inicio: 22, fim: 6, fuso: SP };
    expect(janelaAberta(emSP('2026-09-07T23:00:00'), j)).toBe(true);
    expect(janelaAberta(emSP('2026-09-07T03:00:00'), j)).toBe(true);
    expect(janelaAberta(emSP('2026-09-07T12:00:00'), j)).toBe(false);
  });

  it('outro fuso muda a resposta', () => {
    // 9h em São Paulo é 13h em Lisboa: janela comercial de Lisboa está aberta.
    const agora = emSP('2026-09-07T09:00:00');
    expect(janelaAberta(agora, { inicio: 9, fim: 20, fuso: 'Europe/Lisbon' })).toBe(true);
    // 23h em São Paulo é 3h em Lisboa: fechada.
    expect(janelaAberta(emSP('2026-09-07T23:00:00'), { inicio: 9, fim: 20, fuso: 'Europe/Lisbon' })).toBe(false);
  });
});
