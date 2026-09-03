/**
 * Painel de mídia erra em silêncio: o número aparece, parece plausível, e
 * ninguém confere. Estes testes cobrem a parte que decide o que é "resultado",
 * que é a mais fácil de errar e a mais cara quando erra -- ela vira o custo por
 * aquisição que orienta onde colocar dinheiro.
 */
import { describe, it, expect } from 'vitest';
import { periodoValido, PERIODOS } from '@/lib/ads/meta';

describe('período pedido', () => {
  it('aceita os períodos que a tela oferece', () => {
    for (const p of Object.keys(PERIODOS)) {
      expect(periodoValido(p)).toBe(p);
    }
  });

  // Valor inventado na URL não pode virar chamada malformada à Meta.
  it('cai em 30 dias quando vem coisa inválida', () => {
    expect(periodoValido('ano_passado_todo')).toBe('30dias');
    expect(periodoValido('')).toBe('30dias');
    expect(periodoValido(null)).toBe('30dias');
    expect(periodoValido(undefined)).toBe('30dias');
  });

  it('traduz para o nome que a Meta entende', () => {
    expect(PERIODOS['7dias']).toBe('last_7d');
    expect(PERIODOS.mes).toBe('this_month');
    expect(PERIODOS.mes_passado).toBe('last_month');
  });
});

// ---------------------------------------------------------------------------

import { extrairResultado, type LinhaMeta } from '@/lib/ads/meta';

describe('o que conta como "resultado"', () => {
  // A Meta devolve dezenas de tipos de ação na mesma resposta. Contar
  // engajamento como resultado infla o número e faz o custo por aquisição
  // parecer ótimo numa campanha que não vendeu nada.
  it('ignora engajamento, que não é resultado de negócio', () => {
    const linha: LinhaMeta = {
      actions: [
        { action_type: 'post_engagement', value: '4200' },
        { action_type: 'page_engagement', value: '3900' },
        { action_type: 'video_view', value: '2100' },
      ],
    };
    const r = extrairResultado(linha);
    expect(r.resultados).toBe(0);
    expect(r.tipo).toBeNull();
  });

  it('prefere compra a cadastro quando a conta tem os dois', () => {
    const linha: LinhaMeta = {
      actions: [
        { action_type: 'lead', value: '80' },
        { action_type: 'purchase', value: '12' },
        { action_type: 'post_engagement', value: '5000' },
      ],
      cost_per_action_type: [
        { action_type: 'purchase', value: '145.90' },
        { action_type: 'lead', value: '21.90' },
      ],
    };
    const r = extrairResultado(linha);
    expect(r.resultados).toBe(12);
    expect(r.tipo).toBe('compras');
    expect(r.custo).toBeCloseTo(145.9);
  });

  it('conta conversa iniciada em conta de captação por WhatsApp', () => {
    const linha: LinhaMeta = {
      actions: [
        { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '37' },
        { action_type: 'link_click', value: '410' },
      ],
    };
    const r = extrairResultado(linha);
    expect(r.resultados).toBe(37);
    expect(r.tipo).toBe('conversas iniciadas');
  });

  it('cai para cliques no link quando não há conversão nenhuma', () => {
    const r = extrairResultado({ actions: [{ action_type: 'link_click', value: '410' }] });
    expect(r.resultados).toBe(410);
    expect(r.tipo).toBe('cliques no link');
  });

  // Campanha recém-criada volta sem `actions`. Isso não pode quebrar a tela.
  it('aguenta linha sem ações', () => {
    expect(extrairResultado({}).resultados).toBe(0);
    expect(extrairResultado({ actions: [] }).resultados).toBe(0);
  });

  it('devolve custo nulo quando a Meta não informa, em vez de zero', () => {
    // Zero significaria "de graça", que é uma afirmação falsa e perigosa num
    // painel de investimento.
    const r = extrairResultado({ actions: [{ action_type: 'lead', value: '5' }] });
    expect(r.custo).toBeNull();
  });
});
