'use client';

/**
 * Painel de mídia paga.
 *
 * A ordem da tela segue a ordem em que quem gerencia mídia olha: quanto saiu,
 * quanto voltou, e de onde. Investimento e resultado primeiro; impressão e
 * alcance depois, porque servem para explicar, não para decidir.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Megaphone,
  TrendingUp,
  MousePointerClick,
  Users,
  Link2,
} from 'lucide-react';
import { formatarDinheiro, formatarDinheiroComCentavos } from '@/lib/formato/dinheiro';
import { AvisoDemo } from './AvisoDemo';
import {
  Cartao,
  Barras,
  SeletorDePeriodo,
  capitalizar,
  doisDecimais,
  inteiro,
  type Periodo,
} from './pecas';


interface Metricas {
  investido: number;
  impressoes: number;
  cliques: number;
  alcance: number;
  cpm: number;
  cpc: number;
  ctr: number;
  resultados: number;
  custoPorResultado: number | null;
  tipoDeResultado: string | null;
}

interface Campanha extends Metricas {
  id: string;
  nome: string;
}

interface Painel {
  conta: { id: string; nome: string | null; moeda: string | null };
  total: Metricas;
  campanhas: Campanha[];
  porDia: Array<{ dia: string; investido: number; resultados: number }>;
  atualizadoEm: string;
  doCache: boolean;
}

interface Resposta {
  conectado: boolean;
  ehAdmin: boolean;
  /** Números fictícios. A tela precisa dizer isso em voz alta. */
  demo?: boolean;
  painel?: Painel;
  error?: string;
}


/**
 * Custo unitário mostra centavos; total mostra reais inteiros.
 *
 * CPC de R$ 1,45 aparecia como "R$ 1", e é sobre esse número que se decide
 * subir ou cortar verba: entre R$ 1,10 e R$ 1,99 a diferença é de 80%, e a tela
 * mostrava os dois iguais. No investimento total o centavo não muda decisão
 * nenhuma e só polui.
 */
const unitario = formatarDinheiroComCentavos;

export function PainelMeta() {
  const [periodo, setPeriodo] = useState<Periodo>('30dias');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(
    async (p: Periodo, forcar = false) => {
      forcar ? setAtualizando(true) : setCarregando(true);
      try {
        const r = await fetch(`/api/ads/meta?periodo=${p}${forcar ? '&atualizar=1' : ''}`);
        setDados((await r.json()) as Resposta);
      } catch {
        setDados({ conectado: true, ehAdmin: false, error: 'Não consegui falar com o servidor.' });
      } finally {
        setCarregando(false);
        setAtualizando(false);
      }
    },
    []
  );

  useEffect(() => {
    void carregar(periodo);
  }, [periodo, carregar]);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-12">
        <Loader2 size={16} className="animate-spin" /> Buscando os números na Meta…
      </div>
    );
  }

  if (dados && !dados.conectado) {
    return <SemConexao ehAdmin={dados.ehAdmin} />;
  }

  const painel = dados?.painel;

  return (
    <div className="pb-10">
      {dados?.demo && <AvisoDemo />}

      {/* ── controles ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SeletorDePeriodo valor={periodo} aoTrocar={setPeriodo} />

        <div className="flex-1" />

        {painel && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {painel.conta.nome || painel.conta.id}
            {painel.doCache && ' · número guardado'}
          </span>
        )}

        <button
          onClick={() => void carregar(periodo, true)}
          disabled={atualizando}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
            border border-slate-300 dark:border-white/15
            hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-60 transition-colors"
        >
          {atualizando ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Atualizar
        </button>
      </div>

      {dados?.error && (
        <div className="flex items-start gap-2 mb-5 px-3.5 py-2.5 rounded-lg bg-red-500/10 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div>
            <b>A Meta recusou a consulta.</b> {dados.error}
            <div className="opacity-80 mt-0.5">
              Token de anúncio expira. Se a mensagem falar de sessão ou permissão, gere outro em
              Configurações → Integrações → Meta Ads.
            </div>
          </div>
        </div>
      )}

      {painel && (
        <>
          {/* ── indicadores ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Cartao
              titulo="Investido"
              valor={formatarDinheiro(painel.total.investido)}
              icone={Megaphone}
              destaque
            />
            <Cartao
              titulo={painel.total.tipoDeResultado ? capitalizar(painel.total.tipoDeResultado) : 'Resultados'}
              valor={inteiro.format(painel.total.resultados)}
              rodape={
                painel.total.custoPorResultado
                  ? `${unitario(painel.total.custoPorResultado)} cada`
                  : undefined
              }
              icone={TrendingUp}
              destaque
            />
            <Cartao
              titulo="Cliques"
              valor={inteiro.format(painel.total.cliques)}
              rodape={`CPC ${unitario(painel.total.cpc)} · CTR ${doisDecimais.format(painel.total.ctr)}%`}
              icone={MousePointerClick}
            />
            <Cartao
              titulo="Alcance"
              valor={inteiro.format(painel.total.alcance)}
              rodape={`${inteiro.format(painel.total.impressoes)} impressões · CPM ${unitario(painel.total.cpm)}`}
              icone={Users}
            />
          </div>

          {painel.porDia.length > 1 && <Barras dados={painel.porDia} />}

          {/* ── campanhas ── */}
          <div className="mt-6 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Por campanha
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Maior investimento primeiro.
              </p>
            </div>

            {painel.campanhas.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
                Nenhuma campanha com veiculação neste período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-white/5">
                      <th className="px-4 py-2 font-semibold">Campanha</th>
                      <th className="px-3 py-2 font-semibold text-right">Investido</th>
                      <th className="px-3 py-2 font-semibold text-right">Result.</th>
                      <th className="px-3 py-2 font-semibold text-right">Custo/result.</th>
                      <th className="px-3 py-2 font-semibold text-right">CTR</th>
                      <th className="px-4 py-2 font-semibold text-right">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {painel.campanhas.map((c) => (
                      <tr
                        key={c.id}
                        className="border-t border-slate-200 dark:border-white/10"
                      >
                        <td className="px-4 py-2.5 text-slate-900 dark:text-white max-w-[26ch] truncate" title={c.nome}>
                          {c.nome}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">
                          {formatarDinheiro(c.investido)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {inteiro.format(c.resultados)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {c.custoPorResultado ? unitario(c.custoPorResultado) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {doisDecimais.format(c.ctr)}%
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {unitario(c.cpc)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Números da Meta, atualizados às{' '}
            {new Date(painel.atualizadoEm).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            . A própria Meta consolida em janelas, então o dia corrente pode subir depois.
          </p>
        </>
      )}
    </div>
  );
}

function SemConexao({ ehAdmin }: { ehAdmin: boolean }) {
  return (
    <div className="max-w-xl py-8">
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-primary-500/10 mb-4">
        <Megaphone className="w-5 h-5 text-primary-600 dark:text-primary-400" />
      </div>

      <h2 className="text-lg font-semibold font-display text-slate-900 dark:text-white mb-2">
        Conecte sua conta de anúncios
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
        Com a conta ligada, o investimento, o custo por resultado e o desempenho de cada campanha
        aparecem aqui, ao lado do pipeline.
      </p>

      {ehAdmin ? (
        <a
          href="/settings/integracoes#meta-ads"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          <Link2 size={15} /> Conectar o Meta Ads
        </a>
      ) : (
        // Dizer quem pode resolver é mais útil que esconder o botão: sem isso, a
        // pessoa fica esperando algo acontecer.
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Um administrador precisa conectar a conta em Configurações → Integrações.
        </p>
      )}
    </div>
  );
}
