/**
 * A que horas a máquina pode falar com alguém.
 *
 * O primeiro contato sai por conta própria, minutos depois do cadastro. Sem
 * janela, um lead que preenche o formulário às 3 da manhã recebe mensagem às 3
 * da manhã: acorda a pessoa, e o motivo pelo qual ela lembra da Bright passa a
 * ser esse. No WhatsApp oficial isso ainda tem preço técnico, porque bloqueio
 * e "marcar como spam" derrubam a qualidade do número, e número com qualidade
 * baixa perde alcance para todo mundo, inclusive para quem estava esperando
 * resposta.
 *
 * Não há regra de fim de semana de propósito. Quem preencheu um formulário de
 * diagnóstico há cinco minutos está quente no domingo também, e esperar até
 * segunda esfria o lead. O que a janela evita é horário de dormir, não dia de
 * semana.
 *
 * @module lib/rd/janela
 */

import { paraInstante, FUSO_PADRAO } from '@/lib/formato/horario';

export interface Janela {
  /** Primeira hora em que pode enviar. 9 = a partir das 9h. */
  inicio: number;
  /** Primeira hora em que NÃO pode mais. 20 = manda até 19h59. */
  fim: number;
  fuso?: string;
}

/** A hora do dia naquele fuso, 0 a 23. */
export function horaLocal(quando: Date, fuso: string = FUSO_PADRAO): number {
  const texto = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    hour: '2-digit',
  }).format(quando);

  const h = Number(texto);
  return h === 24 ? 0 : h;
}

/** A data naquele fuso, como AAAA-MM-DD. */
function diaLocal(quando: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(quando);
}

/**
 * Janela aberta agora?
 *
 * Janela invertida (22 às 6, atravessando a meia-noite) é aceita: alguém pode
 * querer isso para outro público, e recusar em silêncio seria pior.
 */
export function janelaAberta(agora: Date, j: Janela): boolean {
  const fuso = j.fuso || FUSO_PADRAO;
  const h = horaLocal(agora, fuso);

  if (j.inicio === j.fim) return true; // 24 horas
  if (j.inicio < j.fim) return h >= j.inicio && h < j.fim;
  return h >= j.inicio || h < j.fim; // atravessa a meia-noite
}

/**
 * Quando a janela abre de novo.
 *
 * Devolve o instante exato, para a fila ser remarcada e não ficar sendo
 * consultada de minuto em minuto até amanhecer.
 */
export function proximaAbertura(agora: Date, j: Janela): Date {
  const fuso = j.fuso || FUSO_PADRAO;
  const h = horaLocal(agora, fuso);
  const hoje = diaLocal(agora, fuso);

  const hora = String(j.inicio).padStart(2, '0');

  // Ainda vai abrir hoje.
  const abreHoje = j.inicio < j.fim ? h < j.inicio : h < j.fim ? false : h < j.inicio;

  if (abreHoje) {
    const iso = paraInstante(`${hoje}T${hora}:00`, fuso);
    if (iso) return new Date(iso);
  }

  // Amanhã, no fuso de lá (e não somando 24 horas em UTC, que erra na virada
  // de horário de verão).
  const amanha = new Date(agora.getTime() + 24 * 3_600_000);
  const iso = paraInstante(`${diaLocal(amanha, fuso)}T${hora}:00`, fuso);
  return iso ? new Date(iso) : new Date(agora.getTime() + 3_600_000);
}

/**
 * Quando esta mensagem deve sair, respeitando a janela.
 *
 * Dentro da janela: agora. Fora: na próxima abertura.
 */
export function quandoPodeEnviar(agora: Date, j: Janela): Date {
  return janelaAberta(agora, j) ? agora : proximaAbertura(agora, j);
}
