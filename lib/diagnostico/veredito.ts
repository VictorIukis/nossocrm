/**
 * Transformar sinais em veredito.
 *
 * A tela de diagnóstico só serve se a cor significar alguma coisa. Duas
 * maneiras de ela mentir, e as duas são fáceis de escrever sem perceber:
 *
 *  - pintar de vermelho o que está apenas parado. "Nenhum lead nos últimos
 *    sete dias" não é defeito quando não há anúncio no ar. Se a tela grita por
 *    isso, em uma semana ninguém olha mais para ela.
 *  - pintar de verde porque a última chamada "funcionou". O pg_cron considera
 *    sucesso ter conseguido fazer a chamada, mesmo que o outro lado tenha
 *    respondido 500.
 *
 * Daí a separação entre TRÊS estados e não dois: `ok`, `atencao` e `parado`
 * são coisas diferentes de `sem_sinal`, que é a ausência de informação.
 *
 * @module lib/diagnostico/veredito
 */

export type Estado = 'ok' | 'atencao' | 'parado' | 'sem_sinal' | 'desligado';

export interface Sinal {
  /** Última vez que a coisa comprovadamente funcionou. */
  ultimoSucesso?: string | null;
  /** Último erro registrado, se houver. */
  ultimoErro?: string | null;
  /** Está ligado? Desligado de propósito não é defeito. */
  ligado?: boolean;
  /** Depois de quantas horas sem sinal isso passa a ser suspeito. */
  silencioSuspeitoEmHoras?: number;
  /** Quantas falhas acumuladas nas últimas 24 horas. */
  falhas24h?: number;
}

export interface Veredito {
  estado: Estado;
  /** Uma frase, em português, que explica a cor. */
  resumo: string;
}

const HORA = 3_600_000;

function horasDesde(quando: string | null | undefined, agora: number): number | null {
  if (!quando) return null;
  const t = new Date(quando).getTime();
  if (Number.isNaN(t)) return null;
  return (agora - t) / HORA;
}

/** Quanto tempo faz, em português de gente. */
export function faz(quando: string | null | undefined, agora = Date.now()): string {
  const h = horasDesde(quando, agora);
  if (h == null) return 'nunca';
  if (h < 1 / 60) return 'agora';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * O veredito de um sinal.
 *
 * A ordem das perguntas é a regra: desligado vence tudo (não é defeito),
 * erro vence silêncio (erro é fato, silêncio é ausência), e silêncio só vira
 * problema quando passa do prazo que aquela coisa deveria respeitar.
 */
export function julgar(s: Sinal, agora = Date.now()): Veredito {
  if (s.ligado === false) {
    return { estado: 'desligado', resumo: 'Desligado nas configurações' };
  }

  if (s.ultimoErro) {
    return { estado: 'parado', resumo: s.ultimoErro };
  }

  if ((s.falhas24h ?? 0) > 0) {
    return {
      estado: 'atencao',
      resumo: `${s.falhas24h} falha(s) nas últimas 24 horas`,
    };
  }

  const h = horasDesde(s.ultimoSucesso, agora);

  if (h == null) {
    // Nunca funcionou. Não é o mesmo que estar quebrado: pode nunca ter sido
    // usado. Quem lê precisa saber a diferença para não sair caçando defeito.
    return { estado: 'sem_sinal', resumo: 'Nunca funcionou desde que foi configurado' };
  }

  const limite = s.silencioSuspeitoEmHoras;
  if (limite != null && h > limite) {
    return {
      estado: 'atencao',
      resumo: `Sem sinal há ${faz(s.ultimoSucesso, agora)}`,
    };
  }

  return { estado: 'ok', resumo: `Funcionou há ${faz(s.ultimoSucesso, agora)}` };
}

/**
 * O veredito de uma rotina agendada.
 *
 * Separado porque aqui há uma armadilha própria: para o pg_cron, "succeeded"
 * significa que a chamada saiu, não que o outro lado aceitou. Uma rotina pode
 * ter cem execuções bem-sucedidas devolvendo 500 em todas.
 */
export function julgarRotina(
  r: {
    ativa: boolean;
    agendamento: string;
    ultima_execucao?: string | null;
    ultimo_status?: string | null;
    falhas_24h?: number | null;
    ultimo_http?: number | null;
  },
  agora = Date.now()
): Veredito {
  if (!r.ativa) return { estado: 'desligado', resumo: 'Rotina desativada' };

  if (r.ultimo_http != null && r.ultimo_http >= 400) {
    return {
      estado: 'parado',
      resumo: `A chamada saiu, mas o CRM respondeu ${r.ultimo_http}`,
    };
  }

  if ((r.falhas_24h ?? 0) > 0) {
    return { estado: 'atencao', resumo: `${r.falhas_24h} execução(ões) com falha em 24 h` };
  }

  if (r.ultimo_status && r.ultimo_status !== 'succeeded') {
    return { estado: 'atencao', resumo: `Última execução: ${r.ultimo_status}` };
  }

  const h = horasDesde(r.ultima_execucao, agora);
  if (h == null) return { estado: 'sem_sinal', resumo: 'Nunca executou' };

  // O prazo sai do próprio agendamento: cobrar de uma rotina diária o mesmo
  // que de uma de minuto em minuto pintaria a diária de vermelho todo dia.
  const limite = prazoDoAgendamento(r.agendamento);
  if (h > limite) {
    return { estado: 'parado', resumo: `Devia rodar e não rodou há ${faz(r.ultima_execucao, agora)}` };
  }

  return { estado: 'ok', resumo: `Rodou há ${faz(r.ultima_execucao, agora)}` };
}

/**
 * Quantas horas de silêncio uma rotina pode ter antes de virar problema.
 *
 * Três vezes o intervalo dela: uma execução perdida acontece (reinício,
 * instância dormindo) e não vale acordar ninguém. Três seguidas, não.
 */
export function prazoDoAgendamento(agendamento: string): number {
  const partes = String(agendamento || '').trim().split(/\s+/);
  const minuto = partes[0] ?? '*';
  const hora = partes[1] ?? '*';

  if (minuto === '*') return 0.25; // de minuto em minuto
  if (hora === '*') return 3; // de hora em hora, ou dentro da hora
  if (hora.includes('*/')) {
    const passo = Number(hora.split('*/')[1]) || 1;
    return passo * 3;
  }
  return 72; // diária: três dias de silêncio é problema
}
