'use client';

/**
 * Conexão com o Google Ads.
 *
 * Diferente da Meta, aqui não existe token para colar: a autorização é por
 * OAuth, e a conta de anúncios é escolhida depois, entre as que a autorização
 * alcança. Pedir número de conta antes de autorizar levaria a errar o número e
 * não saber por quê.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Unlink,
  Link2,
  BarChart3,
  Save,
} from 'lucide-react';
import { ModoDemoAds } from './ModoDemoAds';

interface Estado {
  disponivel: boolean;
  autorizado: boolean;
  contaEscolhida: boolean;
  ehAdmin: boolean;
  contas?: Array<{ id: string }>;
  painel?: { conta: { id: string; nome: string | null; moeda: string | null } };
  error?: string | null;
}

export function GoogleAdsSection() {
  const [carregando, setCarregando] = useState(true);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [conta, setConta] = useState('');
  const [gerenciadora, setGerenciadora] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/ads/google?periodo=hoje');
      const d = (await r.json()) as Estado;
      setEstado(d);
      if (d.painel?.conta.id) setConta(d.painel.conta.id);
      else if (d.contas?.length === 1) setConta(d.contas[0].id);
    } catch {
      setAviso({ tipo: 'erro', texto: 'Não consegui carregar a conexão.' });
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();

    // A volta do OAuth traz o resultado na URL. Lê, mostra e limpa.
    const p = new URLSearchParams(window.location.search);
    const conectado = p.get('conectado');
    const erro = p.get('erro');
    if (conectado) setAviso({ tipo: 'ok', texto: conectado });
    if (erro) setAviso({ tipo: 'erro', texto: erro });
    if (conectado || erro) {
      const limpa = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', limpa);
    }
  }, [carregar]);

  const salvarConta = async () => {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await fetch('/api/ads/google', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: conta, loginCustomerId: gerenciadora }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        setAviso({ tipo: 'erro', texto: d.error || 'Não foi possível salvar.' });
        return;
      }
      setAviso({ tipo: 'ok', texto: 'Conta salva.' });
      await carregar();
    } finally {
      setSalvando(false);
    }
  };

  const desconectar = async () => {
    setSalvando(true);
    try {
      await fetch('/api/ads/google', { method: 'DELETE' });
      setConta('');
      setGerenciadora('');
      setAviso({ tipo: 'ok', texto: 'Conexão removida e acesso revogado no Google.' });
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
          <BarChart3 size={18} className="text-slate-400" /> Google Ads
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Traz investimento, conversões e desempenho por campanha para a aba Ads.
        </p>
      </div>

      <ModoDemoAds aoMudar={carregar} />

      {aviso && (
        <p
          className={`flex items-start gap-2 text-sm ${
            aviso.tipo === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {aviso.tipo === 'ok' ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          )}
          <span>{aviso.texto}</span>
        </p>
      )}

      {/* Instalação sem as credenciais do aplicativo: dizer, em vez de oferecer
          um botão que só pode falhar. */}
      {estado && !estado.disponivel && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-slate-600 dark:text-slate-300 space-y-2">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            Falta configurar esta instalação
          </p>
          <p>
            O Google Ads exige um <b>developer token</b>, que é emitido pelo próprio Google Ads
            (não pelo Google Cloud) e leva alguns dias de aprovação.
          </p>
          <p>
            Com ele em mãos, adicione <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> nas variáveis de
            ambiente. O <code>GOOGLE_CLIENT_ID</code> e o <code>GOOGLE_CLIENT_SECRET</code> já
            estão configurados — são os mesmos do Google Calendar.
          </p>
        </div>
      )}

      {estado?.disponivel && !estado.autorizado && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Autorize com a conta Google que tem acesso ao Gerenciador de Anúncios.
          </p>
          <button
            type="button"
            onClick={() => {
              // Navegação de página inteira: o OAuth exige sair do app e voltar.
              window.location.href = '/api/ads/google/conectar';
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
              bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <Link2 size={15} /> Autorizar o Google Ads
          </button>
        </div>
      )}

      {estado?.autorizado && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={15} /> Autorizado
            {estado.painel?.conta.nome && ` · ${estado.painel.conta.nome}`}
          </div>

          {estado.error && (
            <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{estado.error}</span>
            </p>
          )}

          <div>
            <label
              htmlFor="gads-conta"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Conta de anúncios
            </label>

            {estado.contas && estado.contas.length > 1 ? (
              <select
                id="gads-conta"
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
                  border border-slate-300 dark:border-white/15 text-slate-900 dark:text-white"
              >
                <option value="">Selecione a conta</option>
                {estado.contas.map((c) => (
                  <option key={c.id} value={c.id}>{c.id}</option>
                ))}
              </select>
            ) : (
              <input
                id="gads-conta"
                type="text"
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                placeholder="6938206019"
                className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
                  border border-slate-300 dark:border-white/15
                  text-slate-900 dark:text-white placeholder:text-slate-400
                  focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            )}
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Só os dígitos. A interface do Google mostra com hífen (693-820-6019), mas a API
              não aceita — o CRM tira sozinho.
            </p>
          </div>

          <div>
            <label
              htmlFor="gads-mcc"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Conta gerenciadora{' '}
              <span className="font-normal text-slate-400">(só se for gerida por agência)</span>
            </label>
            <input
              id="gads-mcc"
              type="text"
              value={gerenciadora}
              onChange={(e) => setGerenciadora(e.target.value)}
              placeholder="deixe vazio se a conta é sua"
              className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
                border border-slate-300 dark:border-white/15
                text-slate-900 dark:text-white placeholder:text-slate-400
                focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Quando a conta é gerida por um MCC e este campo fica vazio, o Google recusa dizendo
              que falta permissão — e a mensagem não sugere nada sobre isso.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={salvarConta}
              disabled={salvando || !conta.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                bg-primary-600 text-white hover:bg-primary-700
                disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Salvar conta
            </button>

            <button
              onClick={desconectar}
              disabled={salvando}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10
                transition-colors"
            >
              <Unlink size={15} /> Desconectar
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Permissão pedida: <code>adwords</code>. O CRM só lê — não cria, não pausa e não altera
        lance de campanha.
      </p>
    </div>
  );
}
