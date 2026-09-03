/**
 * Dados fictícios para demonstrar o painel de Ads.
 *
 * Existe porque a Bright gerencia contas de clientes e não tem autorização para
 * puxar esses dados para dentro do CRM. Sem isto, a única forma de mostrar a
 * tela funcionando seria conectar uma conta real -- ou seja, usar dado de
 * cliente sem permissão.
 *
 * Três regras que este arquivo respeita, e que valem para qualquer dado
 * fabricado que apareça numa tela:
 *
 *  1. Nada aqui se parece com cliente real. A conta é "Aurora Casa & Jardim",
 *     uma empresa inventada, e o identificador é obviamente falso.
 *  2. Os números fecham entre si: total é a soma das campanhas, e CTR, CPC e
 *     CPM saem do total. Número que não fecha ensina a pessoa a desconfiar da
 *     tela, e depois ela desconfia do dado verdadeiro também.
 *  3. São estáveis. O mesmo período mostra sempre os mesmos números, sem
 *     `Math.random()`: numa demonstração, recarregar a página e ver outro
 *     resultado entrega o truque e destrói a conversa.
 *
 * Quem chama isto sempre devolve `demo: true` junto, e a tela carimba um aviso.
 * Dado fabricado sem aviso é o problema que este arquivo poderia criar.
 *
 * @module lib/ads/demo
 */

import type { PainelMeta, Periodo as PeriodoMeta } from './meta';
import type { PainelGoogle, Periodo as PeriodoGoogle } from './google';

export const CONTA_DEMO_META = {
  id: 'act_000000000000000',
  nome: 'Aurora Casa & Jardim (demonstração)',
  moeda: 'BRL',
};

export const CONTA_DEMO_GOOGLE = {
  id: '000-000-0000',
  nome: 'Aurora Casa & Jardim (demonstração)',
  moeda: 'BRL',
};

/**
 * Quantos dias cada período representa, e o quanto ele pesa.
 *
 * "hoje" mostra o dia parcial, então vale menos que um dia inteiro: é isso que
 * faz a comparação entre períodos parecer verdade.
 */
const DIAS: Record<string, { dias: number; fracao: number }> = {
  hoje: { dias: 1, fracao: 0.45 },
  ontem: { dias: 1, fracao: 1 },
  '7dias': { dias: 7, fracao: 1 },
  '30dias': { dias: 30, fracao: 1 },
  mes: { dias: 18, fracao: 1 },
  mes_passado: { dias: 30, fracao: 1 },
};

/**
 * Ruído estável a partir de um texto.
 *
 * Serve para variar os números entre campanhas e entre dias sem sortear nada:
 * a mesma entrada dá sempre a mesma saída, então a demonstração não muda a cada
 * recarga da página.
 */
function ruido(semente: string): number {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 0..1
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Varia um valor em ±amplitude, de forma estável. */
function varia(base: number, semente: string, amplitude = 0.25): number {
  return base * (1 + (ruido(semente) * 2 - 1) * amplitude);
}

const arredonda = (n: number, casas = 2): number =>
  Math.round(n * 10 ** casas) / 10 ** casas;

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/**
 * As campanhas fictícias.
 *
 * `porDia` é o investimento diário e `ctr`/`conversao` o comportamento de cada
 * uma. Os valores imitam o que se vê numa conta pequena de varejo: remarketing
 * converte mais e gasta menos, reconhecimento gasta mais e converte pouco.
 */
const CAMPANHAS_META = [
  { nome: 'Institucional · Reconhecimento', diaria: 42, ctr: 0.9, conversao: 0.004, status: 'ACTIVE' },
  { nome: 'Remarketing · Visitantes do site', diaria: 24, ctr: 2.6, conversao: 0.052, status: 'ACTIVE' },
  { nome: 'Cadastros · Formulário instantâneo', diaria: 58, ctr: 1.7, conversao: 0.031, status: 'ACTIVE' },
  { nome: 'Coleção de inverno · Catálogo', diaria: 31, ctr: 1.2, conversao: 0.018, status: 'PAUSED' },
] as const;

export function painelDemoMeta(periodo: PeriodoMeta): PainelMeta {
  const { dias, fracao } = DIAS[periodo] ?? DIAS['30dias'];

  const campanhas = CAMPANHAS_META.map((c, i) => {
    const investido = arredonda(varia(c.diaria * dias * fracao, `${periodo}|${c.nome}|gasto`, 0.18));
    // CPM entre R$ 12 e R$ 30: faixa comum em conta pequena no Brasil.
    const cpm = arredonda(varia(19, `${periodo}|${c.nome}|cpm`, 0.35));
    const impressoes = Math.round((investido / cpm) * 1000);
    const cliques = Math.round(impressoes * (varia(c.ctr, `${periodo}|${c.nome}|ctr`, 0.2) / 100));
    const resultados = Math.round(cliques * varia(c.conversao, `${periodo}|${c.nome}|cv`, 0.3));

    return {
      id: `demo-${i + 1}`,
      nome: c.nome,
      status: c.status,
      investido,
      impressoes,
      // Alcance é sempre menor que impressões: a mesma pessoa vê mais de uma vez.
      alcance: Math.round(impressoes / varia(1.9, `${periodo}|${c.nome}|freq`, 0.15)),
      cliques,
      cpm,
      cpc: cliques > 0 ? arredonda(investido / cliques) : 0,
      ctr: impressoes > 0 ? arredonda((cliques / impressoes) * 100) : 0,
      resultados,
      custoPorResultado: resultados > 0 ? arredonda(investido / resultados) : null,
      tipoDeResultado: 'cadastros',
    };
  });

  const soma = (f: (c: (typeof campanhas)[number]) => number) =>
    campanhas.reduce((t, c) => t + f(c), 0);

  const investido = arredonda(soma((c) => c.investido));
  const impressoes = soma((c) => c.impressoes);
  const cliques = soma((c) => c.cliques);
  const resultados = soma((c) => c.resultados);

  // Distribui o investimento pelos dias, com fim de semana mais fraco -- é o
  // desenho que faz o gráfico parecer uma conta de verdade.
  const hoje = new Date();
  const porDia = Array.from({ length: dias }, (_, k) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - (dias - 1 - k));
    const fds = d.getDay() === 0 || d.getDay() === 6 ? 0.72 : 1;
    const dia = d.toISOString().slice(0, 10);
    return {
      dia,
      investido: arredonda(varia((investido / dias) * fds, `${periodo}|${dia}|gasto`, 0.22)),
      resultados: Math.max(0, Math.round(varia((resultados / dias) * fds, `${periodo}|${dia}|cv`, 0.4))),
    };
  });

  return {
    conta: CONTA_DEMO_META,
    periodo,
    total: {
      investido,
      impressoes,
      cliques,
      alcance: soma((c) => c.alcance),
      cpm: impressoes > 0 ? arredonda((investido / impressoes) * 1000) : 0,
      // CPC e CTR do total, não média das campanhas: média de média mente
      // quando as campanhas têm tamanhos diferentes.
      cpc: cliques > 0 ? arredonda(investido / cliques) : 0,
      ctr: impressoes > 0 ? arredonda((cliques / impressoes) * 100) : 0,
      resultados,
      custoPorResultado: resultados > 0 ? arredonda(investido / resultados) : null,
      tipoDeResultado: 'cadastros',
    },
    campanhas: [...campanhas].sort((a, b) => b.investido - a.investido),
    porDia,
    atualizadoEm: new Date().toISOString(),
    doCache: false,
  };
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

const CAMPANHAS_GOOGLE = [
  { nome: 'Busca · Marca', diaria: 18, ctr: 11.4, conversao: 0.14, status: 'ENABLED' },
  { nome: 'Busca · Termos genéricos', diaria: 46, ctr: 4.8, conversao: 0.035, status: 'ENABLED' },
  { nome: 'Performance Max · Catálogo', diaria: 52, ctr: 1.6, conversao: 0.028, status: 'ENABLED' },
  { nome: 'Display · Remarketing', diaria: 15, ctr: 0.6, conversao: 0.009, status: 'PAUSED' },
] as const;

export function painelDemoGoogle(periodo: PeriodoGoogle): PainelGoogle {
  const { dias, fracao } = DIAS[periodo] ?? DIAS['30dias'];

  const campanhas = CAMPANHAS_GOOGLE.map((c, i) => {
    const investido = arredonda(varia(c.diaria * dias * fracao, `g|${periodo}|${c.nome}|gasto`, 0.18));
    const cpc = arredonda(varia(2.1, `g|${periodo}|${c.nome}|cpc`, 0.4));
    const cliques = Math.round(investido / cpc);
    const ctr = arredonda(varia(c.ctr, `g|${periodo}|${c.nome}|ctr`, 0.2));
    const impressoes = ctr > 0 ? Math.round(cliques / (ctr / 100)) : 0;
    const conversoes = arredonda(cliques * varia(c.conversao, `g|${periodo}|${c.nome}|cv`, 0.3), 1);

    return {
      id: `demo-${i + 1}`,
      nome: c.nome,
      status: c.status,
      investido,
      impressoes,
      cliques,
      ctr: impressoes > 0 ? arredonda((cliques / impressoes) * 100) : 0,
      cpc: cliques > 0 ? arredonda(investido / cliques) : 0,
      conversoes,
      custoPorConversao: conversoes > 0 ? arredonda(investido / conversoes) : null,
    };
  });

  const soma = (f: (c: (typeof campanhas)[number]) => number) =>
    campanhas.reduce((t, c) => t + f(c), 0);

  const investido = arredonda(soma((c) => c.investido));
  const impressoes = soma((c) => c.impressoes);
  const cliques = soma((c) => c.cliques);
  const conversoes = arredonda(soma((c) => c.conversoes), 1);

  return {
    conta: CONTA_DEMO_GOOGLE,
    periodo,
    total: {
      investido,
      impressoes,
      cliques,
      ctr: impressoes > 0 ? arredonda((cliques / impressoes) * 100) : 0,
      cpc: cliques > 0 ? arredonda(investido / cliques) : 0,
      conversoes,
      custoPorConversao: conversoes > 0 ? arredonda(investido / conversoes) : null,
    },
    campanhas: [...campanhas].sort((a, b) => b.investido - a.investido),
    atualizadoEm: new Date().toISOString(),
    doCache: false,
  };
}
