/**
 * O CRM é brasileiro e mostrava valores como dólar. Estes testes existem para
 * o cifrão não voltar sem alguém perceber.
 */
import { describe, it, expect } from 'vitest';
import {
  formatarDinheiro,
  formatarDinheiroComCentavos,
  formatarDinheiroCurto,
} from '@/lib/formato/dinheiro';

// O Intl usa espaço não separável depois de "R$"; normaliza para comparar.
const n = (s: string) => s.replace(/ /g, ' ');

describe('formatação de dinheiro', () => {
  it('escreve valor cheio em real, sem centavos', () => {
    expect(n(formatarDinheiro(131000))).toBe('R$ 131.000');
    expect(n(formatarDinheiro(0))).toBe('R$ 0');
  });

  it('trata nulo e indefinido como zero, em vez de quebrar a tela', () => {
    expect(n(formatarDinheiro(null))).toBe('R$ 0');
    expect(n(formatarDinheiro(undefined))).toBe('R$ 0');
  });

  it('mostra centavos quando eles importam', () => {
    expect(n(formatarDinheiroComCentavos(1250.9))).toBe('R$ 1.250,90');
  });

  it('encurta com "mil" e "mi", não com "k" e "M"', () => {
    expect(n(formatarDinheiroCurto(131000))).toBe('R$ 131 mil');
    expect(n(formatarDinheiroCurto(1200000))).toBe('R$ 1,2 mi');
    expect(n(formatarDinheiroCurto(2000000))).toBe('R$ 2 mi');
  });

  it('abaixo de mil, mostra o valor inteiro', () => {
    expect(n(formatarDinheiroCurto(940))).toBe('R$ 940');
  });

  it('preserva o sinal de negativo', () => {
    expect(n(formatarDinheiroCurto(-45000))).toBe('-R$ 45 mil');
  });
});
