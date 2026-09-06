'use client';

/**
 * Diagnóstico: a tela que responde "está funcionando?".
 *
 * O problema que ela resolve não era falta de informação, era ela estar em sete
 * telas e no banco. Toda integração já registrava seu último erro; ninguém
 * tinha onde ver os sete ao mesmo tempo.
 *
 * A cor é o conteúdo. Por isso são cinco estados e não dois: "desligado" e
 * "nunca funcionou" pedem ações diferentes de "quebrou", e tratar os três como
 * vermelho faz a tela gritar por nada. Uma tela que grita por nada deixa de ser
 * lida em uma semana, e aí ela é pior do que não existir.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle, PowerOff } from 'lucide-react';

type Estado = 'ok' | 'atencao' | 'parado' | 'sem_sinal' | 'desligado';

interface Item {
  nome: string;
  estado: Estado;
  resumo: string;
  detalhe?: string;
  numeros?: Array<{ rotulo: string; valor: string | number }>;
}

interface Resposta {
  verificadoEm: string;
  resumo: Estado;
  integracoes: Item[];
  rotinas: Item[];
  error?: string;
}

const APARENCIA: Record<Estado, { rotulo: string; classe: string; Icone: typeof CheckCircle2 }> = {
  ok: {
    rotulo: 'No ar',
    classe: 'text-emerald-600 dark:text-emerald-400',
    Icone: CheckCircle2,
  },
  atencao: {
    rotulo: 'Atenção',
    classe: 'text-amber-600 dark:text-amber-400',
    Icone: AlertTriangle,
  },
  parado: {
    rotulo: 'Parado',
    classe: 'text-red-600 dark:text-red-400',
    Icone: XCircle,
  },
  sem_sinal: {
    rotulo: 'Sem sinal',
    classe: 'text-slate-500 dark:text-slate-400',
    Icone: MinusCircle,
  },
  desligado: {
    rotulo: 'Desligado',
    classe: 'text-slate-400 dark:text-slate-500',
    Icone: PowerOff,
  },
};

const FRASE_DO_RESUMO: Record<Estado, string> = {
  // "Tudo funcionando" e não "tudo ligado": há integração desligada de
  // propósito, e desligado não é defeito. O resumo fala de problema.
  ok: 'Nada quebrado.',
  atencao: 'Alguma coisa pede atenção.',
  parado: 'Alguma coisa parou.',
  sem_sinal: 'Há integração que nunca funcionou.',
  desligado: 'Nada ligado por aqui.',
};

function Linha({ item }: { item: Item }) {
  const { classe, Icone, rotulo } = APARENCIA[item.estado] ?? APARENCIA.sem_sinal;

  return (
    <li className="flex items-start gap-3 py-3 border-b border-slate-100 dark:border-white/5 last:border-0">
      <Icone size={16} className={`mt-0.5 shrink-0 ${classe}`} aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {item.nome}
          {item.detalhe && (
            <span className="ml-2 font-normal text-xs text-slate-400 dark:text-slate-500">
              {item.detalhe}
            </span>
          )}
        </p>
        <p className={`text-xs mt-0.5 ${classe}`}>
          <span className="sr-only">{rotulo}: </span>
          {item.resumo}
        </p>

        {item.numeros && item.numeros.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
            {item.numeros.map((n) => (
              <span key={n.rotulo} className="text-xs text-slate-500 dark:text-slate-400">
                <strong className="text-slate-700 dark:text-slate-200 tabular-nums">{n.valor}</strong>{' '}
                {n.rotulo}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function DiagnosticoClient() {
  const [d, setD] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch('/api/diagnostico', { cache: 'no-store' });
      const dados = (await r.json()) as Resposta;
      if (!r.ok) {
        setErro(dados.error || 'Não consegui verificar.');
        return;
      }
      setD(dados);
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    // Uma vez por minuto: é a cadência da rotina mais rápida, então é o
    // intervalo em que faz diferença olhar de novo.
    const t = setInterval(() => void carregar(), 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-8">
        <Loader2 size={15} className="animate-spin" /> Verificando…
      </div>
    );
  }

  if (erro) {
    return (
      <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 py-6">
        <XCircle size={15} className="mt-0.5 shrink-0" /> {erro}
      </p>
    );
  }

  const geral = APARENCIA[d?.resumo ?? 'sem_sinal'] ?? APARENCIA.sem_sinal;

  return (
    <div className="max-w-3xl space-y-5 pb-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <geral.Icone size={18} className={geral.classe} />
            {FRASE_DO_RESUMO[d?.resumo ?? 'sem_sinal']}
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            Verificado às{' '}
            {d?.verificadoEm
              ? new Date(d.verificadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : '--'}
            , e de novo a cada minuto.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void carregar()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm shrink-0
            border border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-300
            hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
        >
          <RefreshCw size={14} /> Verificar agora
        </button>
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Integrações</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          O que fala com o mundo lá fora.
        </p>
        <ul>
          {(d?.integracoes ?? []).map((i) => <Linha key={i.nome} item={i} />)}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Rotinas automáticas</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          O que roda sozinho, sem ninguém abrir a tela. Para estas, o banco conta se rodou e o CRM
          conta se aceitou: uma chamada pode sair e ser recusada do outro lado.
        </p>
        <ul>
          {(d?.rotinas ?? []).map((i) => <Linha key={i.nome} item={i} />)}
        </ul>
      </section>
    </div>
  );
}
