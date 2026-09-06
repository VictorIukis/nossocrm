/**
 * Um diagnóstico que mente é pior do que nenhum: se ele grita por nada, em uma
 * semana ninguém olha; se ele pinta de verde o que está quebrado, alguém
 * descobre pelo cliente.
 */
import { describe, it, expect } from 'vitest';
import { julgar, julgarRotina, prazoDoAgendamento, faz } from '@/lib/diagnostico/veredito';

const AGORA = new Date('2026-09-06T15:00:00Z').getTime();
const haHoras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();

describe('sinal de integração', () => {
  it('funcionou agora: ok', () => {
    const v = julgar({ ultimoSucesso: haHoras(0.2) }, AGORA);
    expect(v.estado).toBe('ok');
  });

  // O erro mais fácil de escrever: gritar por ausência de uso. Nenhum lead em
  // sete dias não é defeito quando não há anúncio no ar.
  it('silêncio sem prazo definido não é problema', () => {
    const v = julgar({ ultimoSucesso: haHoras(200) }, AGORA);
    expect(v.estado).toBe('ok');
  });

  it('silêncio passa a ser atenção só depois do prazo daquela coisa', () => {
    expect(julgar({ ultimoSucesso: haHoras(10), silencioSuspeitoEmHoras: 24 }, AGORA).estado).toBe('ok');
    expect(julgar({ ultimoSucesso: haHoras(30), silencioSuspeitoEmHoras: 24 }, AGORA).estado).toBe('atencao');
  });

  it('erro registrado vence silêncio, porque erro é fato', () => {
    const v = julgar({ ultimoSucesso: haHoras(0.1), ultimoErro: 'segredo não confere' }, AGORA);
    expect(v.estado).toBe('parado');
    expect(v.resumo).toBe('segredo não confere');
  });

  it('desligado de propósito não é defeito', () => {
    const v = julgar({ ligado: false, ultimoErro: 'erro antigo' }, AGORA);
    expect(v.estado).toBe('desligado');
  });

  // "Nunca funcionou" e "quebrou" exigem ações diferentes: uma é configurar, a
  // outra é consertar.
  it('nunca funcionou é sem sinal, não parado', () => {
    expect(julgar({ ultimoSucesso: null }, AGORA).estado).toBe('sem_sinal');
  });

  it('falha acumulada vira atenção mesmo tendo funcionado depois', () => {
    const v = julgar({ ultimoSucesso: haHoras(0.1), falhas24h: 3 }, AGORA);
    expect(v.estado).toBe('atencao');
    expect(v.resumo).toContain('3 falha');
  });
});

describe('rotina agendada', () => {
  const deMinuto = { ativa: true, agendamento: '* * * * *' };

  it('rodou no último minuto: ok', () => {
    expect(julgarRotina({ ...deMinuto, ultima_execucao: haHoras(0.01), ultimo_status: 'succeeded', ultimo_http: 200 }, AGORA).estado).toBe('ok');
  });

  // A armadilha do pg_cron: para ele, "succeeded" é ter conseguido fazer a
  // chamada. Cem execuções bem-sucedidas devolvendo 500 continuam sendo cem
  // mensagens que não saíram.
  it('chamada bem-sucedida com resposta 500 é parado, não ok', () => {
    const v = julgarRotina(
      { ...deMinuto, ultima_execucao: haHoras(0.01), ultimo_status: 'succeeded', ultimo_http: 500 },
      AGORA
    );
    expect(v.estado).toBe('parado');
    expect(v.resumo).toContain('500');
  });

  it('401 também é parado', () => {
    expect(julgarRotina({ ...deMinuto, ultima_execucao: haHoras(0.01), ultimo_status: 'succeeded', ultimo_http: 401 }, AGORA).estado).toBe('parado');
  });

  it('rotina de minuto parada há uma hora é parado', () => {
    expect(julgarRotina({ ...deMinuto, ultima_execucao: haHoras(1), ultimo_status: 'succeeded', ultimo_http: 200 }, AGORA).estado).toBe('parado');
  });

  // E o inverso: cobrar de uma rotina diária o mesmo prazo pintaria ela de
  // vermelho todo dia.
  it('rotina diária que rodou há 20 horas está ok', () => {
    expect(julgarRotina({ ativa: true, agendamento: '0 5 * * *', ultima_execucao: haHoras(20), ultimo_status: 'succeeded' }, AGORA).estado).toBe('ok');
  });

  it('rotina diária calada há quatro dias é parado', () => {
    expect(julgarRotina({ ativa: true, agendamento: '0 5 * * *', ultima_execucao: haHoras(96), ultimo_status: 'succeeded' }, AGORA).estado).toBe('parado');
  });

  it('desativada não é defeito', () => {
    expect(julgarRotina({ ativa: false, agendamento: '* * * * *' }, AGORA).estado).toBe('desligado');
  });

  it('nunca executou é sem sinal', () => {
    expect(julgarRotina({ ...deMinuto, ultima_execucao: null }, AGORA).estado).toBe('sem_sinal');
  });
});

describe('prazo tirado do agendamento', () => {
  it('de minuto em minuto tolera 15 minutos', () => {
    expect(prazoDoAgendamento('* * * * *')).toBe(0.25);
  });

  it('a cada 6 horas tolera 18', () => {
    expect(prazoDoAgendamento('0 */6 * * *')).toBe(18);
  });

  it('diária tolera três dias', () => {
    expect(prazoDoAgendamento('0 5 * * *')).toBe(72);
  });
});

describe('quanto tempo faz, em português', () => {
  it('escreve para gente ler', () => {
    expect(faz(haHoras(0.005), AGORA)).toBe('agora');
    expect(faz(haHoras(0.5), AGORA)).toBe('30 min');
    expect(faz(haHoras(5), AGORA)).toBe('5 h');
    expect(faz(haHoras(96), AGORA)).toBe('4 dias');
    expect(faz(null, AGORA)).toBe('nunca');
  });
});
