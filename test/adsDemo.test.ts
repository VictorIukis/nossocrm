/**
 * O painel de demonstração existe para ser mostrado numa reunião. Duas coisas o
 * destruiriam: número que muda ao recarregar a página, e número que não fecha
 * com a soma das campanhas. Ambas são testadas aqui.
 */
import { describe, it, expect } from 'vitest';
import { painelDemoMeta, painelDemoGoogle, CONTA_DEMO_META } from '@/lib/ads/demo';
import { PERIODOS, type Periodo } from '@/lib/ads/meta';

const PERIODOS_TODOS = Object.keys(PERIODOS) as Periodo[];

describe('demonstração da Meta', () => {
  it('mostra sempre os mesmos números para o mesmo período', () => {
    const a = painelDemoMeta('30dias');
    const b = painelDemoMeta('30dias');
    expect(b.total).toEqual(a.total);
    expect(b.campanhas).toEqual(a.campanhas);
  });

  it('total é a soma das campanhas', () => {
    const p = painelDemoMeta('7dias');
    const somaInvestido = p.campanhas.reduce((t, c) => t + c.investido, 0);
    const somaCliques = p.campanhas.reduce((t, c) => t + c.cliques, 0);

    expect(p.total.investido).toBeCloseTo(somaInvestido, 2);
    expect(p.total.cliques).toBe(somaCliques);
  });

  it('CTR e CPC saem do total, não da média das campanhas', () => {
    const p = painelDemoMeta('30dias');
    expect(p.total.ctr).toBeCloseTo((p.total.cliques / p.total.impressoes) * 100, 1);
    expect(p.total.cpc).toBeCloseTo(p.total.investido / p.total.cliques, 1);
  });

  it('alcance nunca passa das impressões', () => {
    for (const periodo of PERIODOS_TODOS) {
      const p = painelDemoMeta(periodo);
      expect(p.total.alcance).toBeLessThanOrEqual(p.total.impressoes);
    }
  });

  it('período maior gasta mais que período menor', () => {
    expect(painelDemoMeta('30dias').total.investido)
      .toBeGreaterThan(painelDemoMeta('7dias').total.investido);
    expect(painelDemoMeta('7dias').total.investido)
      .toBeGreaterThan(painelDemoMeta('ontem').total.investido);
    // "hoje" é dia parcial: tem que ser menor que o dia inteiro de ontem.
    expect(painelDemoMeta('hoje').total.investido)
      .toBeLessThan(painelDemoMeta('ontem').total.investido);
  });

  it('o gráfico tem um ponto por dia do período', () => {
    expect(painelDemoMeta('7dias').porDia).toHaveLength(7);
    expect(painelDemoMeta('30dias').porDia).toHaveLength(30);
  });

  it('nada nos números se parece com conta real', () => {
    const p = painelDemoMeta('30dias');
    expect(CONTA_DEMO_META.id).toMatch(/^act_0+$/);
    expect(p.conta.nome).toContain('demonstração');
  });

  it('campanhas vêm da maior para a menor, como na tela', () => {
    const p = painelDemoMeta('30dias');
    const gastos = p.campanhas.map((c) => c.investido);
    expect([...gastos].sort((a, b) => b - a)).toEqual(gastos);
  });
});

describe('demonstração do Google', () => {
  it('mostra sempre os mesmos números para o mesmo período', () => {
    expect(painelDemoGoogle('30dias').total).toEqual(painelDemoGoogle('30dias').total);
  });

  it('total é a soma das campanhas', () => {
    const p = painelDemoGoogle('30dias');
    expect(p.total.investido).toBeCloseTo(
      p.campanhas.reduce((t, c) => t + c.investido, 0), 2
    );
    expect(p.total.cliques).toBe(p.campanhas.reduce((t, c) => t + c.cliques, 0));
  });

  it('custo por conversão é o investido dividido pelas conversões', () => {
    const p = painelDemoGoogle('30dias');
    expect(p.total.custoPorConversao).toBeCloseTo(p.total.investido / p.total.conversoes, 1);
  });

  it('a conta é a mesma dos dois painéis, para a demonstração ser coerente', () => {
    expect(painelDemoGoogle('30dias').conta.nome).toBe(painelDemoMeta('30dias').conta.nome);
  });
});
