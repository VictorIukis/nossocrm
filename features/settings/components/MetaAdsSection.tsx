'use client';

/**
 * Conexão com o Meta Ads.
 *
 * O token de anúncios dá acesso ao investimento da empresa, então ele entra
 * aqui e não volta: a tela só sabe se existe conexão e qual conta é.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ExternalLink,
  Megaphone,
} from 'lucide-react';
import { ModoDemoAds } from './ModoDemoAds';

interface Estado {
  conectado: boolean;
  ehAdmin: boolean;
  painel?: { conta: { id: string; nome: string | null; moeda: string | null } };
  error?: string;
}

export function MetaAdsSection() {
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [token, setToken] = useState('');
  const [conta, setConta] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/ads/meta?periodo=hoje');
      const d = (await r.json()) as Estado;
      setEstado(d);
      if (d.painel?.conta.id) setConta(d.painel.conta.id);
    } catch {
      setErro('Não consegui carregar a conexão.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const r = await fetch('/api/ads/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, accountId: conta }),
      });
      const d = (await r.json()) as { ok?: boolean; nome?: string; moeda?: string; error?: string };

      if (!r.ok) {
        setErro(d.error || 'Não foi possível salvar.');
        return;
      }

      setToken('');
      setOk(
        d.nome
          ? `Conectado à conta ${d.nome}${d.moeda ? ` (${d.moeda})` : ''}.`
          : 'Conectado ao Meta Ads.'
      );
      await carregar();
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await fetch('/api/ads/meta', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remover: true }),
      });
      setConta('');
      setOk('Conexão removida.');
      await carregar();
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-8">
        <Loader2 size={15} className="animate-spin" /> Carregando…
      </div>
    );
  }

  if (estado && !estado.ehAdmin) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-6">
        Só um administrador pode conectar a conta de anúncios.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Megaphone size={18} className="text-slate-400" /> Meta Ads
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Traz investimento, custo por resultado e desempenho por campanha para a aba Ads.
        </p>
      </div>

      <ModoDemoAds aoMudar={carregar} />

      {estado?.conectado && !estado.error && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={15} /> Conectado
          {estado.painel?.conta.nome && ` · ${estado.painel.conta.nome}`}
        </div>
      )}

      {estado?.conectado && estado.error && (
        <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>
            Conectado, mas a última consulta falhou: {estado.error}
          </span>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-4">
        <div>
          <label
            htmlFor="meta-conta"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Conta de anúncios
          </label>
          <input
            id="meta-conta"
            type="text"
            value={conta}
            disabled={salvando}
            onChange={(e) => setConta(e.target.value)}
            placeholder="act_303942454668588"
            className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
              border border-slate-300 dark:border-white/15
              text-slate-900 dark:text-white placeholder:text-slate-400
              focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          />
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Está no Gerenciador de Anúncios, no topo, começando com <code>act_</code>.
          </p>
        </div>

        <div>
          <label
            htmlFor="meta-token"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Token de acesso
          </label>
          <input
            id="meta-token"
            type="password"
            autoComplete="off"
            value={token}
            disabled={salvando}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              estado?.conectado
                ? 'Já existe um token salvo. Deixe em branco para manter.'
                : 'cole o token da Meta'
            }
            className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
              border border-slate-300 dark:border-white/15
              text-slate-900 dark:text-white placeholder:text-slate-400
              focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          />
          <a
            href="https://business.facebook.com/settings/system-users"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            Gerar token na Business Manager <ExternalLink size={11} />
          </a>
        </div>

        {erro && (
          <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {erro}
          </p>
        )}
        {ok && (
          <p className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {ok}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={salvar}
            disabled={salvando || !conta.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
              bg-primary-600 text-white hover:bg-primary-700
              disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {salvando ? 'Conferindo com a Meta…' : 'Salvar e testar conexão'}
          </button>

          {estado?.conectado && (
            <button
              onClick={remover}
              disabled={salvando}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10
                transition-colors"
            >
              <Trash2 size={15} /> Remover
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-400 dark:text-slate-500 space-y-1.5">
        <p>
          <b className="text-slate-500 dark:text-slate-400">Prefira token de usuário de sistema.</b>{' '}
          Token pessoal expira em semanas e derruba o painel sem avisar; o de sistema não expira e
          não morre se alguém sair da empresa.
        </p>
        <p>
          A permissão necessária é <code>ads_read</code>. Só leitura: o CRM não cria nem pausa
          anúncio.
        </p>
      </div>
    </div>
  );
}
