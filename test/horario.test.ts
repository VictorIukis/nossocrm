/**
 * Fuso errado não dá erro: produz um horário plausível e errado. Num sistema de
 * agenda, isso é a pessoa perder a reunião sem entender por quê. Daí os testes.
 */
import { describe, it, expect } from 'vitest';
import { paraInstante, calcularFim, temFuso, FUSO_PADRAO } from '@/lib/formato/horario';

describe('texto sem fuso', () => {
  // O caso que motiva o arquivo: a IA escreve "15:00" sem fuso, o servidor roda
  // em UTC, e sem tratamento o compromisso das 15h vira 12h em São Paulo.
  it('15h em São Paulo é 18h em UTC', () => {
    expect(paraInstante('2026-09-04T15:00')).toBe('2026-09-04T18:00:00.000Z');
  });

  it('funciona com espaço em vez de T', () => {
    expect(paraInstante('2026-09-04 15:00')).toBe('2026-09-04T18:00:00.000Z');
  });

  it('só a data assume o começo do dia local, não meia-noite UTC', () => {
    expect(paraInstante('2026-09-04')).toBe('2026-09-04T03:00:00.000Z');
  });

  it('outro fuso muda o resultado', () => {
    expect(paraInstante('2026-09-04T15:00', 'Europe/Lisbon')).toBe('2026-09-04T14:00:00.000Z');
  });
});

describe('texto com fuso', () => {
  it('respeita o que veio escrito', () => {
    expect(paraInstante('2026-09-04T15:00:00-03:00')).toBe('2026-09-04T18:00:00.000Z');
    expect(paraInstante('2026-09-04T18:00:00Z')).toBe('2026-09-04T18:00:00.000Z');
  });

  it('reconhece as formas de fuso', () => {
    expect(temFuso('2026-09-04T15:00:00Z')).toBe(true);
    expect(temFuso('2026-09-04T15:00:00-03:00')).toBe(true);
    expect(temFuso('2026-09-04T15:00:00-0300')).toBe(true);
    expect(temFuso('2026-09-04T15:00')).toBe(false);
  });
});

describe('entrada que não dá para entender', () => {
  // Devolver null, e não "Invalid Date": data inválida silenciosa vira
  // compromisso em 1970 ou erro três camadas depois.
  it('devolve null em vez de data inválida', () => {
    expect(paraInstante('semana que vem')).toBeNull();
    expect(paraInstante('')).toBeNull();
    expect(paraInstante('   ')).toBeNull();
  });
});

describe('fim do compromisso', () => {
  const inicio = '2026-09-04T18:00:00.000Z'; // 15h em São Paulo

  it('usa o fim informado', () => {
    expect(calcularFim(inicio, '2026-09-04T16:30')).toBe('2026-09-04T19:30:00.000Z');
  });

  it('aceita fim só com a hora, herdando o dia do início', () => {
    expect(calcularFim(inicio, '16:30')).toBe('2026-09-04T19:30:00.000Z');
  });

  it('sem fim, usa a duração', () => {
    expect(calcularFim(inicio, null, 30)).toBe('2026-09-04T18:30:00.000Z');
  });

  it('sem fim e sem duração, uma hora', () => {
    expect(calcularFim(inicio)).toBe('2026-09-04T19:00:00.000Z');
  });

  // Reunião 23h→00h30 é legítima. Sem isto, a duração ficaria negativa e o
  // Google recusaria o evento (ou pior, aceitaria torto).
  it('fim antes do início vira o dia seguinte', () => {
    const noite = paraInstante('2026-09-04T23:00')!;
    expect(calcularFim(noite, '00:30')).toBe('2026-09-05T03:30:00.000Z');
  });

  it('duração zero ou negativa cai no padrão de uma hora', () => {
    expect(calcularFim(inicio, null, 0)).toBe('2026-09-04T19:00:00.000Z');
    expect(calcularFim(inicio, null, -30)).toBe('2026-09-04T19:00:00.000Z');
  });
});

describe('fuso padrão', () => {
  it('é o do Brasil, onde o CRM é usado', () => {
    expect(FUSO_PADRAO).toBe('America/Sao_Paulo');
  });
});
