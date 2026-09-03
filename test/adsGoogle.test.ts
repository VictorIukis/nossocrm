/**
 * O Google Ads devolve dinheiro em micros. Errar essa conversão não gera erro
 * nenhum: o painel mostra um número mil vezes maior e parece plausível o
 * suficiente para ninguém desconfiar na hora.
 */
import { describe, it, expect } from 'vitest';
import { deMicros, soDigitos, periodoValido, PERIODOS } from '@/lib/ads/google';

describe('conversão de micros', () => {
  it('4.280.000.000 micros são R$ 4.280', () => {
    expect(deMicros('4280000000')).toBe(4280);
  });

  it('preserva centavos', () => {
    expect(deMicros('1234560')).toBeCloseTo(1.23456);
    expect(deMicros('51400000')).toBeCloseTo(51.4);
  });

  it('trata ausente como zero em vez de NaN', () => {
    // NaN vaza para a tela como "R$ NaN", que é pior que zero.
    expect(deMicros(undefined)).toBe(0);
    expect(deMicros(null)).toBe(0);
    expect(deMicros('abc')).toBe(0);
  });
});

describe('número da conta', () => {
  // A interface do Google mostra com hífen; a API recusa.
  it('tira o hífen que a interface do Google mostra', () => {
    expect(soDigitos('693-820-6019')).toBe('6938206019');
  });

  it('tira espaço e qualquer outro enfeite', () => {
    expect(soDigitos(' 693 820 6019 ')).toBe('6938206019');
    expect(soDigitos('customers/6938206019')).toBe('6938206019');
  });

  it('aguenta vazio', () => {
    expect(soDigitos('')).toBe('');
  });
});

describe('período pedido', () => {
  it('traduz para o nome que o Google entende', () => {
    expect(PERIODOS['7dias']).toBe('LAST_7_DAYS');
    expect(PERIODOS.mes).toBe('THIS_MONTH');
  });

  // Valor inventado na URL não pode ser interpolado numa consulta GAQL.
  it('cai em 30 dias quando vem coisa inválida', () => {
    expect(periodoValido("' OR 1=1 --")).toBe('30dias');
    expect(periodoValido(null)).toBe('30dias');
  });
});
