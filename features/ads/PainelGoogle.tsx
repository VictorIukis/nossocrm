'use client';

/**
 * Painel do Google Ads.
 *
 * Separado do da Meta de propósito: aqui o resultado é sempre "conversão", um
 * número que a própria conta define no Google. Na Meta o resultado muda de
 * conta para conta. Juntar os dois num formato só faria o painel afirmar
 * equivalência que não existe.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  BarChart3,
  Target,
  MousePointerClick,
  Eye,
  Link2,
} from 'lucide-react';
import { formatarDinheiro } from '@/lib/formato/dinheiro';
import { AvisoDemo } from './AvisoDemo';
import {
  Cartao,
  SeletorDePeriodo,
  doisDecimais,
  inteiro,
  type Periodo,
} from './pecas';

interface Metricas {
  investido: number;
  impressoes: number;
  cliques: number;
  ctr: number;
  cpc: number;
  conversoes: number;
  custoPorConversao: number | null;
}

interface Campanha extends Metricas {
  id: string;
  nome: string;
  status: string | null;
}

interface Painel {
  conta: { id: string; nome: string | null; moeda: string | null };
  total: Metricas;
  campanhas: Campanha[];
  atualizadoEm: string;
  doCache: boolean;
}

interface Resposta {
  disponivel: boolean;
  autorizado: boolean;
  contaEscolhida: boolean;
  ehAdmin: boolean;
  /** Números fictícios. A tela precisa dizer isso em voz alta. */
  demo?: boolean;
  painel?: Painel;
  error?: string | null;
}

const ROTULO_STATUS: Record<string, string> = {
  ENABLED: 'ativa',
  PAUSED: 'pausada',
  REMOVED: 'removida',
};

export function PainelGoogle() {
  const [periodo, setPeriodo] = useState<Periodo>('30dias');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async (p: Periodo, forcar = false) => {
    forcar ? setAtualizando(true) : setCarregando(true);
    try {
      const r = await fetch(`/api/ads/google?periodo=${p}${forcar ? '&atualizar=1' : ''}`);
      setDados((await r.json()) as Resposta);
    } catch {
      setDados({
        disponivel: true,
        autorizado: true,
        contaEscolhida: true,
        ehAdmin: false,
        error: 'Não consegui falar com o servidor.',
      });
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(periodo);
  }, [periodo, carregar]);

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-12">
        <Loader2 size={16} className="animate-spin" /> Buscando os números no Google…
      </div>
    );
  }

  // Estados de "ainda não pronto" são distintos entre si, e cada um pede uma
  // ação diferente. Tratar todos como "erro" mandaria a pessoa procurar defeito
  // onde só falta configuração.
  if (dados && (!dados.disponivel || !dados.autorizado || !dados.contaEscolhida)) {
    return <FaltaConfigurar estado={dados} />;
  }

  const painel = dados?.painel;

  return (
    <div>
      {dados?.demo && <AvisoDemo />}

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
          {atualizando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Atualizar
        </button>
      </div>

      {dados?.error && (
        <div className="flex items-start gap-2 mb-5 px-3.5 py-2.5 rounded-lg bg-red-500/10 text-sm text-red-700 dark:text-red-300">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div>
            <b>O Google recusou a consulta.</b> {dados.error}
          </div>
        </div>
      )}

      {painel && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Cartao
              titulo="Investido"
              valor={formatarDinheiro(painel.total.investido)}
              icone={BarChart3}
              destaque
            />
            <Cartao
              titulo="Conversões"
              valor={
                // O Google conta conversão com peso, então 12,4 é um número
                // legítimo. Arredondar esconderia isso.
                painel.total.conversoes % 1 === 0
                  ? inteiro.format(painel.total.conversoes)
                  : doisDecimais.format(painel.total.conversoes)
              }
              rodape={
                painel.total.custoPorConversao
                  ? `${formatarDinheiro(painel.total.custoPorConversao)} cada`
                  : 'sem conversão no período'
              }
              icone={Target}
              destaque
            />
            <Cartao
              titulo="Cliques"
              valor={inteiro.format(painel.total.cliques)}
              rodape={`CPC ${formatarDinheiro(painel.total.cpc)} · CTR ${doisDecimais.format(painel.total.ctr)}%`}
              icone={MousePointerClick}
            />
            <Cartao
              titulo="Impressões"
              valor={inteiro.format(painel.total.impressoes)}
              icone={Eye}
            />
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
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
                      <th className="px-3 py-2 font-semibold text-right">Conv.</th>
                      <th className="px-3 py-2 font-semibold text-right">Custo/conv.</th>
                      <th className="px-3 py-2 font-semibold text-right">CTR</th>
                      <th className="px-4 py-2 font-semibold text-right">CPC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {painel.campanhas.map((c) => (
                      <tr key={c.id} className="border-t border-slate-200 dark:border-white/10">
                        <td className="px-4 py-2.5 text-slate-900 dark:text-white max-w-[24ch]">
                          <span className="truncate block" title={c.nome}>{c.nome}</span>
                          {c.status && c.status !== 'ENABLED' && (
                            <span className="text-[11px] text-slate-400">
                              {ROTULO_STATUS[c.status] ?? c.status.toLowerCase()}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">
                          {formatarDinheiro(c.investido)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {c.conversoes % 1 === 0
                            ? inteiro.format(c.conversoes)
                            : doisDecimais.format(c.conversoes)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {c.custoPorConversao ? formatarDinheiro(c.custoPorConversao) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {doisDecimais.format(c.ctr)}%
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatarDinheiro(c.cpc)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Números do Google Ads, atualizados às{' '}
            {new Date(painel.atualizadoEm).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            .
          </p>
        </>
      )}
    </div>
  );
}

function FaltaConfigurar({ estado }: { estado: Resposta }) {
  if (!estado.disponivel) {
    return (
      <div className="max-w-xl py-8">
        <h2 className="text-lg font-semibold font-display text-slate-900 dark:text-white mb-2">
          Google Ads não configurado nesta instalação
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Falta o developer token, emitido pelo próprio Google Ads. Um administrador precisa
          adicioná-lo às variáveis de ambiente.
        </p>
      </div>
    );
  }

  if (!estado.autorizado) {
    return (
      <div className="max-w-xl py-8">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-primary-500/10 mb-4">
          <BarChart3 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
        <h2 className="text-lg font-semibold font-display text-slate-900 dark:text-white mb-2">
          Autorize sua conta do Google Ads
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
          Com a conta ligada, investimento, conversões e custo por conversão de cada campanha
          aparecem aqui.
        </p>
        {estado.ehAdmin ? (
          <a
            href="/settings/integracoes#google-ads"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
              bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <Link2 size={15} /> Conectar o Google Ads
          </a>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Um administrador precisa conectar a conta em Configurações → Integrações.
          </p>
        )}
      </div>
    );
  }

  // Autorizado, mas sem conta escolhida.
  return (
    <div className="max-w-xl py-8">
      <h2 className="text-lg font-semibold font-display text-slate-900 dark:text-white mb-2">
        Falta escolher a conta de anúncios
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        A autorização deu certo. Como ela alcança mais de uma conta, é preciso dizer qual delas o
        painel deve mostrar.
      </p>
      {estado.error && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">{estado.error}</p>
      )}
      {estado.ehAdmin && (
        <a
          href="/settings/integracoes#google-ads"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          Escolher a conta
        </a>
      )}
    </div>
  );
}
