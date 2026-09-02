'use client';

/**
 * Tela de erro das rotas autenticadas.
 *
 * A versao anterior mostrava so "Algo deu errado" e um botao, sem estilo e sem
 * dizer o que houve. Quem via nao tinha como saber se a culpa era da rede, de
 * permissao ou de um defeito, e quem fosse investigar tambem nao.
 *
 * Agora ela diz o que aconteceu, oferece uma saida alem de tentar de novo, e
 * mantem a identidade do produto: uma falha nao deveria parecer que o sistema
 * inteiro caiu.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, LayoutDashboard } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[erro na tela]', error);
  }, [error]);

  // Falha de rede e a mais comum e tem conselho proprio, entao vale separar do
  // resto em vez de tratar tudo como defeito do sistema.
  const pareceRede =
    /fetch|network|timeout|503|502|504|Failed to fetch/i.test(error?.message || '');

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-5">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
        </div>

        <h2 className="text-2xl font-bold font-display text-slate-900 dark:text-white mb-2">
          {pareceRede ? 'Sem resposta do servidor' : 'Esta tela não carregou'}
        </h2>

        <p className="text-slate-500 dark:text-slate-400 mb-6">
          {pareceRede
            ? 'A conexão falhou no meio do caminho. Costuma ser passageiro.'
            : 'O resto do sistema continua funcionando. Você pode tentar de novo ou seguir por outro caminho.'}
        </p>

        {error?.message && (
          <p className="text-xs font-mono text-slate-400 dark:text-slate-500 mb-6 break-words">
            {error.message}
            {error.digest && <span className="block mt-1 opacity-60">ref {error.digest}</span>}
          </p>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors"
          >
            <RotateCcw size={15} /> Tentar de novo
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-white/15 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <LayoutDashboard size={15} /> Ir para a visão geral
          </Link>
        </div>
      </div>
    </div>
  );
}
