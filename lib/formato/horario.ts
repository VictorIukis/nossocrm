/**
 * Converter "amanhã às 15h" em um instante correto.
 *
 * O problema real: a IA escreve "2026-09-04T15:00" sem fuso. O JavaScript
 * interpreta isso no fuso de quem está rodando -- e quem roda é um servidor em
 * UTC. O compromisso das 15h em São Paulo iria para o calendário às 12h, e
 * ninguém liga uma coisa à outra: a pessoa só descobre que perdeu a reunião.
 *
 * Erro de fuso não dá erro. Ele produz um horário plausível e errado, que é o
 * pior tipo de defeito num sistema de agenda.
 *
 * @module lib/formato/horario
 */

/** Onde o CRM vive, quando a organização não disse o contrário. */
export const FUSO_PADRAO = 'America/Sao_Paulo';

/** O texto já traz fuso? ("Z", "+00:00", "-03:00") */
export function temFuso(texto: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(texto.trim());
}

/**
 * Quantos minutos o fuso está à frente do UTC naquele instante.
 *
 * Calculado a partir do próprio instante, e não de uma tabela, porque horário
 * de verão muda o valor no meio do ano. O Brasil não tem mais, mas o CRM pode
 * ser usado em outro fuso, e uma constante ficaria errada sem avisar.
 */
function minutosDeDiferenca(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const p: Record<string, number> = {};
  for (const parte of partes) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  }

  // 'hour' vem como 24 à meia-noite em alguns ambientes.
  const hora = p.hour === 24 ? 0 : p.hour;

  const comoSeFosseUtc = Date.UTC(p.year, p.month - 1, p.day, hora, p.minute, p.second);
  return (comoSeFosseUtc - instante.getTime()) / 60_000;
}

/**
 * Texto de data/hora → instante (ISO em UTC).
 *
 * Com fuso no texto, respeita o que veio. Sem fuso, lê como hora local do fuso
 * informado. Devolve null quando não dá para entender a data, em vez de um
 * "Invalid Date" que só quebra mais tarde.
 */
export function paraInstante(texto: string, fuso: string = FUSO_PADRAO): string | null {
  const limpo = (texto || '').trim();
  if (!limpo) return null;

  if (temFuso(limpo)) {
    const d = new Date(limpo);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Só a data, sem hora: assume o começo do dia no fuso local.
  const comHora = /\d{2}:\d{2}/.test(limpo) ? limpo : `${limpo}T00:00:00`;

  const palpite = Date.parse(`${comHora.replace(' ', 'T')}Z`);
  if (Number.isNaN(palpite)) return null;

  // Duas passadas: a diferença depende do instante, e o instante depende da
  // diferença. A segunda passada acerta os casos de virada de horário de verão.
  const primeira = palpite - minutosDeDiferenca(new Date(palpite), fuso) * 60_000;
  const segunda = palpite - minutosDeDiferenca(new Date(primeira), fuso) * 60_000;

  return new Date(segunda).toISOString();
}

/**
 * Fim do compromisso.
 *
 * Sem fim informado, usa a duração. Se o fim cair antes do início, entende que
 * passou da meia-noite e joga para o dia seguinte -- é o mesmo tratamento da
 * tela de atividades, e evita compromisso com duração negativa.
 */
export function calcularFim(
  inicioIso: string,
  fim?: string | null,
  duracaoMinutos?: number | null,
  fuso: string = FUSO_PADRAO
): string {
  const inicio = new Date(inicioIso);

  if (fim) {
    // Fim só com hora ("15:30"): completa com a data do início, no fuso local.
    const soHora = /^\d{1,2}:\d{2}$/.test(fim.trim());
    const texto = soHora
      ? `${new Intl.DateTimeFormat('en-CA', {
          timeZone: fuso,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(inicio)}T${fim.trim().padStart(5, '0')}:00`
      : fim;

    const convertido = paraInstante(texto, fuso);
    if (convertido) {
      const d = new Date(convertido);
      if (d.getTime() > inicio.getTime()) return d.toISOString();
      // Passou da meia-noite.
      d.setDate(d.getDate() + 1);
      if (d.getTime() > inicio.getTime()) return d.toISOString();
    }
  }

  const minutos = duracaoMinutos && duracaoMinutos > 0 ? duracaoMinutos : 60;
  return new Date(inicio.getTime() + minutos * 60_000).toISOString();
}
