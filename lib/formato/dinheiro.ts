/**
 * Como o dinheiro aparece no produto. Fonte unica.
 *
 * Antes disto, cada tela formatava do seu jeito e todas escreviam cifrao na
 * mao. O CRM e brasileiro, roda para clientes brasileiros, e mostrava os
 * valores como se fossem dolares -- um negocio de R$ 131.000 aparecia como
 * $131.000 no painel. Alem de errado, e o tipo de detalhe que faz um cliente
 * duvidar do resto dos numeros.
 *
 * Se um dia o produto precisar de outra moeda, muda aqui e muda em todo lugar,
 * em vez de caçar cifrao espalhado por seis arquivos.
 */

export const MOEDA = 'BRL';
export const LOCALIDADE = 'pt-BR';

const COMPLETO = new Intl.NumberFormat(LOCALIDADE, {
  style: 'currency',
  currency: MOEDA,
  maximumFractionDigits: 0,
});

const COM_CENTAVOS = new Intl.NumberFormat(LOCALIDADE, {
  style: 'currency',
  currency: MOEDA,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** R$ 131.000 — para valor cheio, sem centavos. */
export function formatarDinheiro(valor: number | null | undefined): string {
  return COMPLETO.format(Number(valor) || 0);
}

/** R$ 1.250,90 — quando o centavo importa, como em preco de produto. */
export function formatarDinheiroComCentavos(valor: number | null | undefined): string {
  return COM_CENTAVOS.format(Number(valor) || 0);
}

/**
 * R$ 131 mil / R$ 1,2 mi — para cartao de indicador e eixo de grafico, onde o
 * numero inteiro nao cabe.
 *
 * Usa "mil" e "mi" em vez de "k" e "M": o painel e lido por gente de vendas, e
 * nao por quem escreve codigo.
 */
export function formatarDinheiroCurto(valor: number | null | undefined): string {
  const n = Number(valor) || 0;
  const sinal = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  if (abs >= 1_000_000) {
    const mi = abs / 1_000_000;
    // Uma casa so quando ela diz alguma coisa: "R$ 2 mi" e melhor que "R$ 2,0 mi".
    const texto = mi % 1 === 0 ? String(mi) : mi.toFixed(1).replace('.', ',');
    return `${sinal}R$ ${texto} mi`;
  }

  if (abs >= 1_000) {
    return `${sinal}R$ ${Math.round(abs / 1_000).toLocaleString(LOCALIDADE)} mil`;
  }

  return formatarDinheiro(n);
}
