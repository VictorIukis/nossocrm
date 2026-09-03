'use client';

/**
 * Interruptor do modo demonstração do painel de Ads.
 *
 * Aparece nas duas seções (Meta e Google) porque é onde a pessoa vai procurar,
 * mas é UM interruptor só, e o texto diz isso -- senão alguém liga na tela da
 * Meta, abre o Google numa reunião e mostra dado de cliente real sem querer.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, FlaskConical } from 'lucide-react';

export function ModoDemoAds({ aoMudar }: { aoMudar?: () => void }) {
  const [ligado, setLigado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/ads-demo');
      const d = (await r.json()) as { ligado?: boolean };
      setLigado(Boolean(d.ligado));
    } catch {
      setErro('Não consegui ler o estado do modo demonstração.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const alternar = async () => {
    const novo = !ligado;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/settings/ads-demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ligado: novo }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        setErro(d.error || 'Não foi possível salvar.');
        return;
      }
      setLigado(novo);
      aoMudar?.();
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return null;

  return (
    <div
      className={`rounded-xl border p-4 ${
        ligado
          ? 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
          : 'border-slate-200 dark:border-white/10'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
            <FlaskConical size={15} className={ligado ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'} />
            Modo demonstração
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 max-w-md">
            Preenche os dois painéis, Meta e Google, com uma conta fictícia. Serve para mostrar a
            tela funcionando sem trazer dado de conta de cliente para dentro do CRM.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md">
            Enquanto está ligado, o CRM <strong>não chama</strong> a Meta nem o Google, mesmo que
            exista conexão salva. E o painel fica com um aviso de que o número é inventado.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label="Modo demonstração do painel de Ads"
          onClick={alternar}
          disabled={salvando}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${
            ligado ? 'bg-amber-500' : 'bg-slate-300 dark:bg-white/20'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              ligado ? 'translate-x-5' : ''
            }`}
          />
          {salvando && (
            <Loader2
              size={12}
              className="absolute inset-0 m-auto animate-spin text-slate-600"
            />
          )}
        </button>
      </div>

      {erro && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{erro}</p>}
    </div>
  );
}
