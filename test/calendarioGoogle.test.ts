/**
 * Sincronizar agenda erra em silêncio: o compromisso simplesmente aparece na
 * hora errada, ou não aparece. Estes testes cobrem as conversões e as regras de
 * borda que decidem isso.
 */
import { describe, it, expect } from 'vitest';
import {
  atividadeParaEvento,
  eventoParaAtividade,
  DURACAO_PADRAO_MINUTOS,
} from '@/lib/calendar/google';

describe('atividade do CRM → evento do Google', () => {
  it('leva título, descrição e local', () => {
    const e = atividadeParaEvento({
      title: 'Reunião com a Bright',
      description: 'Levar a proposta',
      location: 'Curitiba',
      date: '2026-09-10T14:00:00.000Z',
      ends_at: '2026-09-10T15:00:00.000Z',
    }) as Record<string, unknown>;

    expect(e.summary).toBe('Reunião com a Bright');
    expect(e.description).toBe('Levar a proposta');
    expect(e.location).toBe('Curitiba');
  });

  it('sem hora de término, assume a duração padrão em vez de deixar sem fim', () => {
    const e = atividadeParaEvento({
      title: 'Ligar para o cliente',
      date: '2026-09-10T14:00:00.000Z',
    }) as { start: { dateTime: string }; end: { dateTime: string } };

    const minutos =
      (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 60000;
    expect(minutos).toBe(DURACAO_PADRAO_MINUTOS);
  });

  // O Google trata o fim de evento de dia inteiro como EXCLUSIVO. Mandar a mesma
  // data nos dois cria um evento de duração zero, que some da agenda.
  it('dia inteiro termina no dia seguinte, não no mesmo dia', () => {
    const e = atividadeParaEvento({
      title: 'Feriado',
      date: '2026-09-07T00:00:00.000Z',
      all_day: true,
    }) as { start: { date: string }; end: { date: string } };

    expect(e.start.date).toBe('2026-09-07');
    expect(e.end.date).toBe('2026-09-08');
  });

  it('campo vazio não vira string vazia no Google', () => {
    const e = atividadeParaEvento({
      title: 'Sem detalhes',
      description: null,
      location: null,
      date: '2026-09-10T14:00:00.000Z',
    }) as Record<string, unknown>;

    expect(e.description).toBeUndefined();
    expect(e.location).toBeUndefined();
  });
});

describe('evento do Google → atividade do CRM', () => {
  it('lê um evento com hora', () => {
    const a = eventoParaAtividade({
      id: 'abc',
      summary: 'Call de alinhamento',
      start: { dateTime: '2026-09-10T14:00:00Z' },
      end: { dateTime: '2026-09-10T14:30:00Z' },
    });

    expect(a?.title).toBe('Call de alinhamento');
    expect(a?.all_day).toBe(false);
    expect(a?.date).toBe('2026-09-10T14:00:00.000Z');
  });

  it('reconhece evento de dia inteiro', () => {
    const a = eventoParaAtividade({
      id: 'abc',
      summary: 'Férias',
      start: { date: '2026-09-10' },
      end: { date: '2026-09-11' },
    });

    expect(a?.all_day).toBe(true);
  });

  // Evento sem título existe no Google. Gravar vazio faria a linha sumir da
  // lista do CRM, e a pessoa acharia que a sincronização perdeu o compromisso.
  it('evento sem título vira "(sem título)" em vez de vazio', () => {
    const a = eventoParaAtividade({
      id: 'abc',
      start: { dateTime: '2026-09-10T14:00:00Z' },
    });

    expect(a?.title).toBe('(sem título)');
  });

  it('evento sem início é descartado, não gravado com data inválida', () => {
    expect(eventoParaAtividade({ id: 'abc', summary: 'Solto' })).toBeNull();
  });
});

describe('ida e volta', () => {
  it('um compromisso com hora sobrevive à viagem completa', () => {
    const original = {
      title: 'Diagnóstico com o Renato',
      description: 'Apresentar o CRM',
      location: null,
      date: '2026-09-15T13:00:00.000Z',
      ends_at: '2026-09-15T14:00:00.000Z',
      all_day: false,
    };

    const evento = atividadeParaEvento(original) as {
      summary: string;
      start: { dateTime: string };
      end: { dateTime: string };
    };

    const devolta = eventoParaAtividade({
      id: 'x',
      summary: evento.summary,
      start: evento.start,
      end: evento.end,
    });

    expect(devolta?.title).toBe(original.title);
    expect(devolta?.date).toBe(original.date);
    expect(devolta?.ends_at).toBe(original.ends_at);
    expect(devolta?.all_day).toBe(false);
  });
});
