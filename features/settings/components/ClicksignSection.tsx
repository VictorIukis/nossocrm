'use client';

/**
 * Conexão com o Clicksign.
 *
 * Hoje alguém precisa entrar no Clicksign para saber se o cliente assinou,
 * porque o projeto só começa depois disso. Com o webhook ligado, o negócio
 * registra a assinatura sozinho e -- se houver etapa escolhida -- anda de etapa.
 *
 * O segredo não volta ao navegador depois de salvo: a tela só sabe se existe.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Clock,
} from 'lucide-react';

interface Etapa {
  id: string;
  name: string;
  board_id: string;
  funil: string;
}

interface Pendente {
  id: string;
  title: string;
  clicksign_sent_at: string | null;
}

interface Dados {
  configurado: boolean;
  etapaDestino: string | null;
  ultimoEvento: string | null;
  ultimoErro: string | null;
  urlDoWebhook: string;
  etapas: Etapa[];
  aguardandoAssinatura: Pendente[];
}

const CAMPO =
  'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20 ' +
  'border border-slate-300 dark:border-white/15 ' +
  'text-slate-900 dark:text-white placeholder:text-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500/40';

const ROTULO = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

export function ClicksignSection() {
  const [carregando, setCarregando] = useState(true);
  const [dados, setDados] = useState<Dados | null>(null);
  const [segredo, setSegredo] = useState('');
  const [etapaDestino, setEtapaDestino] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [copiou, setCopiou] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/clicksign');
      const d = (await r.json()) as Dados & { error?: string };
      if (!r.ok) {
        setErro(d.error || 'Não consegui carregar a conexão.');
        return;
      }
      setDados(d);
      setEtapaDestino(d.etapaDestino || '');
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const copiarUrl = async () => {
    if (!dados) return;
    try {
      await navigator.clipboard.writeText(dados.urlDoWebhook);
      setCopiou(true);
      setTimeout(() => setCopiou(false), 2000);
    } catch {
      setErro('Não consegui copiar. Selecione o endereço e copie na mão.');
    }
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const r = await fetch('/api/settings/clicksign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ segredo, etapaDestino }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        setErro(d.error || 'Não foi possível salvar.');
        return;
      }
      setSegredo('');
      setOk('Configuração salva.');
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
    setOk(null);
    try {
      await fetch('/api/settings/clicksign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remover: true }),
      });
      setSegredo('');
      setEtapaDestino('');
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

  const etapasPorFunil = new Map<string, Etapa[]>();
  for (const e of dados?.etapas ?? []) {
    const funil = e.funil || 'Funil';
    const lista = etapasPorFunil.get(funil) ?? [];
    lista.push(e);
    etapasPorFunil.set(funil, lista);
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Clicksign</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          O CRM passa a saber quando o contrato foi assinado, sem ninguém precisar abrir o
          Clicksign para conferir.
        </p>
      </div>

      {dados?.configurado && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={15} /> Webhook configurado
          {dados.ultimoEvento && (
            <span className="text-slate-500 dark:text-slate-400 font-normal">
              · último aviso {new Date(dados.ultimoEvento).toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      )}

      {dados?.ultimoErro && (
        <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 rounded-lg
          bg-amber-50 dark:bg-amber-500/10 p-3">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {dados.ultimoErro}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-4">
        <div>
          <span className={ROTULO}>1. Endereço para colar no Clicksign</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg text-xs font-mono
              bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10
              text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-nowrap">
              {dados?.urlDoWebhook}
            </code>
            <button
              type="button"
              onClick={copiarUrl}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm shrink-0
                border border-slate-300 dark:border-white/15
                text-slate-700 dark:text-slate-300
                hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              {copiou ? <Check size={14} /> : <Copy size={14} />}
              {copiou ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <a
            href="https://app.clicksign.com/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            Cadastrar o webhook no Clicksign <ExternalLink size={11} />
          </a>
        </div>

        <div>
          <label htmlFor="clicksign-segredo" className={ROTULO}>
            2. Segredo do webhook (HMAC)
          </label>
          <input
            id="clicksign-segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            disabled={salvando}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder={
              dados?.configurado
                ? 'Já existe um segredo salvo. Deixe em branco para manter.'
                : 'cole o segredo que o Clicksign mostrou'
            }
            className={CAMPO}
          />
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            O Clicksign mostra este segredo uma única vez, quando o webhook é criado. Ele é o que
            impede alguém de fingir uma assinatura: sem segredo salvo, o CRM aceita qualquer aviso
            que chegue nesse endereço.
          </p>
        </div>

        <div>
          <label htmlFor="clicksign-etapa" className={ROTULO}>
            3. Quando o contrato for assinado, mover o negócio para
          </label>
          <select
            id="clicksign-etapa"
            value={etapaDestino}
            disabled={salvando}
            onChange={(e) => setEtapaDestino(e.target.value)}
            className={CAMPO}
          >
            <option value="">Não mover · só registrar a assinatura</option>
            {[...etapasPorFunil.entries()].map(([funil, etapas]) => (
              <optgroup key={funil} label={funil}>
                {etapas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Só move quando todas as partes assinam. Assinatura de um lado só fica registrada no
            histórico, sem mexer no negócio.
          </p>
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
            disabled={salvando}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
              bg-primary-600 text-white hover:bg-primary-700
              disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>

          {dados?.configurado && (
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

      {(dados?.aguardandoAssinatura?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white mb-3">
            <Clock size={15} className="text-amber-500" />
            Aguardando assinatura
          </h4>
          <ul className="space-y-2">
            {dados!.aguardandoAssinatura.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 text-sm">
                {/* `/deals/<id>` não existe: negócio abre pelo quadro, com ?deal= */}
                <a
                  href={`/boards?deal=${n.id}`}
                  className="text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 truncate"
                >
                  {n.title}
                </a>
                {n.clicksign_sent_at && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                    enviado {new Date(n.clicksign_sent_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        O CRM liga o contrato ao negócio pelo e-mail de quem assina: acha o contato e, dele, o
        negócio mais recente que não está perdido. Quando não encontra ninguém, o aviso é ignorado em vez de
        adivinhado, porque mover o negócio errado faria alguém começar um projeto que não foi
        vendido.
      </p>
    </div>
  );
}
