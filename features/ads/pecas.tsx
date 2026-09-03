'use client';

/**
 * Peças compartilhadas entre os painéis de mídia.
 *
 * Meta e Google medem coisas diferentes -- "resultados" variáveis lá,
 * "conversões" aqui --, então os painéis são separados de propósito: forçar um
 * formato único esconderia diferença real e faria o número mentir. O que dá
 * para compartilhar é a apresentação, e é o que está aqui.
 */

import { formatarDinheiro, formatarDinheiroCurto } from '@/lib/formato/dinheiro';

export const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const doisDecimais = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type Periodo = 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes' | 'mes_passado';

export const ROTULO_PERIODO: Record<Periodo, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7dias': '7 dias',
  '30dias': '30 dias',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
};

export function Cartao({
  titulo,
  valor,
  rodape,
  icone: Icone,
  destaque,
}: {
  titulo: string;
  valor: string;
  rodape?: string;
  icone: React.ComponentType<{ size?: number; className?: string }>;
  destaque?: boolean;
}) {
  return (
    <div
      className={`glass p-5 rounded-xl border shadow-sm ${
        destaque
          ? 'border-primary-500/25 dark:border-primary-500/20'
          : 'border-slate-200 dark:border-white/5'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">{titulo}</h3>
        <Icone size={16} className="text-slate-400 shrink-0" />
      </div>
      <div className="text-2xl font-bold font-display text-slate-900 dark:text-white tabular-nums">
        {valor}
      </div>
      {rodape && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{rodape}</p>}
    </div>
  );
}

/**
 * Barras de investimento por dia.
 *
 * Desenhadas com div, e não com biblioteca de gráfico: são dezenas de barras
 * simples, e trazer um gráfico inteiro para isso pesaria a tela sem devolver
 * nada. Se um dia precisar de eixo e tooltip, aí vale.
 */
export function Barras({
  dados,
}: {
  dados: Array<{ dia: string; investido: number; resultados: number }>;
}) {
  const maior = Math.max(...dados.map((d) => d.investido), 1);
  const total = dados.reduce((s, d) => s + d.investido, 0);
  const media = total / dados.length;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Investimento por dia
        </h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          média {formatarDinheiroCurto(media)}/dia
        </span>
      </div>

      <div className="flex items-end gap-[3px] h-28 overflow-x-auto">
        {dados.map((d) => (
          <div
            key={d.dia}
            title={`${new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
            })} · ${formatarDinheiro(d.investido)}${
              d.resultados ? ` · ${d.resultados} result.` : ''
            }`}
            className="flex-1 min-w-[6px] bg-primary-500/70 hover:bg-primary-500 rounded-t transition-colors"
            style={{ height: `${Math.max((d.investido / maior) * 100, 2)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SeletorDePeriodo({
  valor,
  aoTrocar,
}: {
  valor: Periodo;
  aoTrocar: (p: Periodo) => void;
}) {
  return (
    <div className="flex rounded-lg border border-slate-300 dark:border-white/15 overflow-hidden">
      {(Object.keys(ROTULO_PERIODO) as Periodo[]).map((p) => (
        <button
          key={p}
          onClick={() => aoTrocar(p)}
          className={`px-3 py-1.5 text-sm transition-colors ${
            valor === p ? 'bg-primary-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-white/5'
          }`}
        >
          {ROTULO_PERIODO[p]}
        </button>
      ))}
    </div>
  );
}

export function capitalizar(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
