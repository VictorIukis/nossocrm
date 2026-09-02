'use client';

/**
 * Agenda: as atividades do CRM num calendário, e a conexão com o Google.
 *
 * A visão é de mês e de semana porque é assim que quem vende olha a agenda --
 * "o que tenho essa semana" e "como está o mês". Lista de compromissos ordenada
 * por data já existe na tela de Atividades; repetir isso aqui não ajudaria
 * ninguém.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  Link2,
  Unlink,
  AlertCircle,
  CheckCircle2,
  CalendarDays,
} from 'lucide-react';
import { useActivities } from '@/lib/query/hooks/useActivitiesQuery';

type Visao = 'mes' | 'semana';

interface EstadoConexao {
  disponivel: boolean;
  conectado: boolean;
  contaEmail: string | null;
  ultimaSincronizacao: string | null;
  ultimoErro: string | null;
}

// ── datas ────────────────────────────────────────────────────────────────────
// A semana começa no domingo, como no calendário brasileiro e no do Google.

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function inicioDoDia(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function inicioDaSemana(d: Date) {
  const x = inicioDoDia(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function gradeDoMes(referencia: Date): Date[] {
  const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  const inicio = inicioDaSemana(primeiro);
  // Seis semanas cobrem qualquer mês sem a grade mudar de altura ao navegar,
  // que é o que causa aquele "pulo" desagradável entre um mês e outro.
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
}

function mesmoDia(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mesAno = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const diaMes = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

// ── componente ───────────────────────────────────────────────────────────────

export function AgendaClient() {
  const [visao, setVisao] = useState<Visao>('mes');
  const [referencia, setReferencia] = useState(() => new Date());
  const [conexao, setConexao] = useState<EstadoConexao | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const { data: atividades = [], refetch } = useActivities();

  const carregarConexao = useCallback(async () => {
    try {
      const r = await fetch('/api/calendar/google');
      if (r.ok) setConexao((await r.json()) as EstadoConexao);
    } catch {
      // A agenda funciona sem o Google; falhar aqui não pode esconder os compromissos.
    }
  }, []);

  useEffect(() => {
    void carregarConexao();

    // A volta do Google traz o resultado na URL. Lê, mostra e limpa, para não
    // ficar repetindo o aviso a cada recarga.
    const p = new URLSearchParams(window.location.search);
    const conectado = p.get('conectado');
    const erro = p.get('erro');
    if (conectado) setAviso({ tipo: 'ok', texto: `Agenda conectada: ${conectado}` });
    if (erro) setAviso({ tipo: 'erro', texto: erro });
    if (conectado || erro) {
      window.history.replaceState({}, '', window.location.pathname);
      if (conectado) void sincronizarAgora();
    }
  }, [carregarConexao]);

  const sincronizarAgora = async () => {
    setSincronizando(true);
    setAviso(null);
    try {
      const r = await fetch('/api/calendar/google/sincronizar', { method: 'POST' });
      const d = (await r.json()) as {
        ok?: boolean;
        puxados?: number;
        enviados?: number;
        error?: string;
      };
      if (!r.ok) {
        setAviso({ tipo: 'erro', texto: d.error || 'Não consegui sincronizar.' });
      } else {
        setAviso({
          tipo: 'ok',
          texto:
            d.puxados || d.enviados
              ? `${d.puxados ?? 0} vindos do Google, ${d.enviados ?? 0} enviados.`
              : 'Tudo já estava em dia.',
        });
        await refetch();
      }
      await carregarConexao();
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não consegui falar com o servidor.' });
    } finally {
      setSincronizando(false);
    }
  };

  const desconectar = async () => {
    setSincronizando(true);
    try {
      await fetch('/api/calendar/google', { method: 'DELETE' });
      await carregarConexao();
      setAviso({ tipo: 'ok', texto: 'Agenda desconectada. Seus compromissos continuam aqui.' });
    } finally {
      setSincronizando(false);
    }
  };

  const dias = useMemo(
    () =>
      visao === 'mes'
        ? gradeDoMes(referencia)
        : Array.from({ length: 7 }, (_, i) => {
            const d = inicioDaSemana(referencia);
            d.setDate(d.getDate() + i);
            return d;
          }),
    [visao, referencia]
  );

  const porDia = useMemo(() => {
    const mapa = new Map<string, Array<{ id: string; title: string; date: string; completed?: boolean }>>();
    for (const a of atividades as Array<{ id: string; title: string; date: string; completed?: boolean }>) {
      if (!a.date) continue;
      const chave = inicioDoDia(new Date(a.date)).toISOString();
      const lista = mapa.get(chave) ?? [];
      lista.push(a);
      mapa.set(chave, lista);
    }
    for (const lista of mapa.values()) {
      lista.sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
    }
    return mapa;
  }, [atividades]);

  const navegar = (passo: number) => {
    const d = new Date(referencia);
    if (visao === 'mes') d.setMonth(d.getMonth() + passo);
    else d.setDate(d.getDate() + passo * 7);
    setReferencia(d);
  };

  const hoje = new Date();

  return (
    <div className="pb-10">
      {/* ── cabeçalho ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => navegar(-1)}
            aria-label={visao === 'mes' ? 'Mês anterior' : 'Semana anterior'}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => navegar(1)}
            aria-label={visao === 'mes' ? 'Próximo mês' : 'Próxima semana'}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <h2 className="text-lg font-semibold font-display text-slate-900 dark:text-white capitalize min-w-[12ch]">
          {visao === 'mes'
            ? mesAno.format(referencia)
            : `${diaMes.format(dias[0])} – ${diaMes.format(dias[6])}`}
        </h2>

        <button
          onClick={() => setReferencia(new Date())}
          className="px-3 py-1.5 rounded-lg text-sm border border-slate-300 dark:border-white/15
            hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
        >
          Hoje
        </button>

        <div className="flex rounded-lg border border-slate-300 dark:border-white/15 overflow-hidden">
          {(['mes', 'semana'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVisao(v)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                visao === v
                  ? 'bg-primary-600 text-white'
                  : 'hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              {v === 'mes' ? 'Mês' : 'Semana'}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <ConexaoGoogle
          estado={conexao}
          ocupado={sincronizando}
          aoSincronizar={sincronizarAgora}
          aoDesconectar={desconectar}
        />
      </div>

      {aviso && (
        <div
          className={`flex items-start gap-2 text-sm mb-4 px-3 py-2 rounded-lg ${
            aviso.tipo === 'ok'
              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
              : 'text-red-700 dark:text-red-300 bg-red-500/10'
          }`}
        >
          {aviso.tipo === 'ok' ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          )}
          <span>{aviso.texto}</span>
        </div>
      )}

      {/* ── grade ── */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-50 dark:bg-white/5">
          {DIAS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider
                text-slate-500 dark:text-slate-400"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {dias.map((dia) => {
            const doMes = dia.getMonth() === referencia.getMonth();
            const ehHoje = mesmoDia(dia, hoje);
            const lista = porDia.get(inicioDoDia(dia).toISOString()) ?? [];

            return (
              <div
                key={dia.toISOString()}
                className={`border-t border-r border-slate-200 dark:border-white/10 p-1.5
                  ${visao === 'mes' ? 'min-h-[104px]' : 'min-h-[220px]'}
                  ${!doMes && visao === 'mes' ? 'bg-slate-50/60 dark:bg-black/20' : ''}`}
              >
                <div className="flex justify-end mb-1">
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs
                      ${
                        ehHoje
                          ? 'bg-primary-600 text-white font-bold'
                          : doMes
                            ? 'text-slate-700 dark:text-slate-200'
                            : 'text-slate-400 dark:text-slate-600'
                      }`}
                  >
                    {dia.getDate()}
                  </span>
                </div>

                <div className="space-y-1">
                  {lista.slice(0, visao === 'mes' ? 3 : 12).map((a) => (
                    <div
                      key={a.id}
                      title={`${hora.format(new Date(a.date))} · ${a.title}`}
                      className={`text-[11px] leading-tight px-1.5 py-1 rounded truncate
                        ${
                          a.completed
                            ? 'bg-slate-200/70 dark:bg-white/5 text-slate-500 dark:text-slate-400 line-through'
                            : 'bg-primary-500/12 text-primary-700 dark:text-primary-300'
                        }`}
                    >
                      <span className="font-semibold tabular-nums">
                        {hora.format(new Date(a.date))}
                      </span>{' '}
                      {a.title}
                    </div>
                  ))}

                  {/* Contar o que não coube é melhor do que cortar em silêncio:
                      sem isso, um dia cheio parece um dia com três compromissos. */}
                  {lista.length > (visao === 'mes' ? 3 : 12) && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 px-1.5">
                      +{lista.length - (visao === 'mes' ? 3 : 12)} mais
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── conexão com o Google ─────────────────────────────────────────────────────

function ConexaoGoogle({
  estado,
  ocupado,
  aoSincronizar,
  aoDesconectar,
}: {
  estado: EstadoConexao | null;
  ocupado: boolean;
  aoSincronizar: () => void;
  aoDesconectar: () => void;
}) {
  if (!estado) return null;

  // Botão que só pode falhar é pior que botão nenhum: quando a instalação não
  // tem as credenciais do Google, dizemos isso em vez de oferecer a conexão.
  if (!estado.disponivel) {
    return (
      <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
        <CalendarDays size={14} /> Google Calendar não configurado nesta instalação
      </span>
    );
  }

  if (!estado.conectado) {
    return (
      <button
        type="button"
        // Navegação de página inteira de propósito: o OAuth do Google exige sair
        // do app e voltar. `Link` do Next faria navegação interna, que não sai.
        onClick={() => {
          window.location.href = '/api/calendar/google/conectar';
        }}
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold
          bg-primary-600 text-white hover:bg-primary-700 transition-colors"
      >
        <Link2 size={15} /> Conectar meu Google Calendar
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {estado.ultimoErro && (
        <span
          title={estado.ultimoErro}
          className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"
        >
          <AlertCircle size={13} /> reconecte
        </span>
      )}
      <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
        {estado.contaEmail}
      </span>
      <button
        onClick={aoSincronizar}
        disabled={ocupado}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
          border border-slate-300 dark:border-white/15
          hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-60 transition-colors"
      >
        {ocupado ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Sincronizar
      </button>
      <button
        onClick={aoDesconectar}
        disabled={ocupado}
        title="Desconectar do Google"
        aria-label="Desconectar do Google"
        className="p-2 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400
          hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-60 transition-colors"
      >
        <Unlink size={15} />
      </button>
    </div>
  );
}
