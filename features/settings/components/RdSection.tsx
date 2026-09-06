'use client';

/**
 * Entrada de leads do RD Station e o primeiro contato automático.
 *
 * O endereço do webhook carrega o segredo, então ele nasce aqui e é copiado
 * daqui: não precisa passar por conversa, e-mail ou histórico de terminal.
 *
 * A chave de ligar fica no fim e sozinha, de propósito: ligá-la faz sair
 * mensagem de WhatsApp para gente de verdade, minutos depois de cada cadastro.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Save, CheckCircle2, AlertCircle, Copy, Check, Zap,
} from 'lucide-react';
import { RdRegras, type Regra } from './RdRegras';

interface Fonte {
  id: string;
  nome: string;
  ativa: boolean;
  url: string;
}

interface Canal {
  id: string;
  name: string;
  provider: string;
  status: string;
}

interface Etapa { id: string; name: string; funil: string }

interface Dados {
  config: {
    rd_primeiro_contato_ativo?: boolean;
    rd_canal_id?: string;
    rd_ultimo_erro?: string;
    rd_janela_inicio?: number;
    rd_janela_fim?: number;
    rd_limite_diario?: number;
    timezone?: string;
  };
  enviadasHoje: number;
  fontes: Fonte[];
  canais: Canal[];
  regras: Regra[];
  etapas: Etapa[];
  formulariosVistos: string[];
  leadsRecebidos: number;
  fila: Record<string, number>;
  ultimos: Array<{ email: string | null; telefone: string | null; identificador: string | null; criado_em: string }>;
  camposDeVariavel: string[];
}

const CAMPO =
  'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20 ' +
  'border border-slate-300 dark:border-white/15 text-slate-900 dark:text-white ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40';

const ROTULO = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5';

const NOME_DO_CAMPO: Record<string, string> = {
  nome: 'Primeiro nome do lead',
  empresa: 'Nome da empresa',
  formulario: 'Identificador do formulário',
};

/** Quantas variáveis o texto declara. Mesma conta que o servidor faz. */
function quantasVariaveis(texto: string): number {
  const n = [...String(texto || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return n.length === 0 ? 0 : Math.max(...n);
}

export function RdSection() {
  const [carregando, setCarregando] = useState(true);
  const [d, setD] = useState<Dados | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<string | null>(null);

  const [canalId, setCanalId] = useState('');
  const [janelaInicio, setJanelaInicio] = useState(9);
  const [janelaFim, setJanelaFim] = useState(20);
  const [limiteDiario, setLimiteDiario] = useState(100);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/rd');
      const dados = (await r.json()) as Dados & { error?: string };
      if (!r.ok) {
        setErro(dados.error || 'Não consegui carregar.');
        return;
      }
      setD(dados);
      setCanalId(dados.config.rd_canal_id ?? '');
      setJanelaInicio(dados.config.rd_janela_inicio ?? 9);
      setJanelaFim(dados.config.rd_janela_fim ?? 20);
      setLimiteDiario(dados.config.rd_limite_diario ?? 100);
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const copiar = async (texto: string, qual: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiada(qual);
      setTimeout(() => setCopiada(null), 2000);
    } catch {
      setErro('Não consegui copiar. Selecione o endereço e copie na mão.');
    }
  };

  const salvar = async (ligar?: boolean) => {
    setSalvando(true);
    setErro(null);
    setOk(null);
    try {
      const r = await fetch('/api/settings/rd', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          canalId: canalId || null,
          janelaInicio,
          janelaFim,
          limiteDiario,
          ...(ligar === undefined ? {} : { ativo: ligar }),
        }),
      });
      const resposta = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) {
        setErro(resposta.error || 'Não foi possível salvar.');
        return;
      }
      setOk(ligar === true ? 'Ligado. Os próximos leads vão receber mensagem.' : 'Salvo.');
      await carregar();
    } catch {
      setErro('Não consegui falar com o servidor.');
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

  const ativo = Boolean(d?.config.rd_primeiro_contato_ativo);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">RD Station</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Cada conversão numa landing page vira contato e negócio no CRM, com as respostas do
          formulário. Se o lead deixar WhatsApp, a Sofia abre a conversa alguns minutos depois.
        </p>
      </div>

      {d?.config.rd_ultimo_erro && (
        <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 rounded-lg
          bg-amber-50 dark:bg-amber-500/10 p-3">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {d.config.rd_ultimo_erro}
        </p>
      )}

      {/* ── 1. endereço ── */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-3">
        <span className={ROTULO}>1. Endereço para colar no RD Station</span>
        <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
          No RD: Integrações → Criar Webhook, gatilho <strong>Conversão</strong>. Este endereço já
          inclui a senha, então trate como senha.
        </p>

        {(d?.fontes ?? []).map((f) => (
          <div key={f.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg text-xs font-mono
                bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10
                text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-nowrap">
                {f.url}
              </code>
              <button
                type="button"
                onClick={() => copiar(f.url, f.id)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm shrink-0
                  border border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-300
                  hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
              >
                {copiada === f.id ? <Check size={14} /> : <Copy size={14} />}
                {copiada === f.id ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">{f.nome}</p>
          </div>
        ))}

        {(d?.fontes?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nenhuma fonte cadastrada ainda.
          </p>
        )}
      </div>

      {/* ── 2. regras ── */}
      <RdRegras
        regras={d?.regras ?? []}
        etapas={d?.etapas ?? []}
        formulariosVistos={d?.formulariosVistos ?? []}
        camposDeVariavel={d?.camposDeVariavel ?? []}
        aoMudar={() => void carregar()}
      />

      {/* ── canal ── */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-3">
        <div>
          <label htmlFor="rd-canal" className={ROTULO}>Número que envia</label>
          <select
            id="rd-canal"
            value={canalId}
            disabled={salvando}
            onChange={(e) => setCanalId(e.target.value)}
            className={CAMPO}
          >
            <option value="">Escolha o canal…</option>
            {(d?.canais ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.status === 'connected' ? '' : `(${c.status})`}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Vale para todas as regras: é o número da Sofia que abre a conversa.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="rd-janela-inicio" className={ROTULO}>Só mandar a partir das</label>
            <select
              id="rd-janela-inicio"
              value={janelaInicio}
              disabled={salvando}
              onChange={(e) => setJanelaInicio(Number(e.target.value))}
              className={CAMPO}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rd-janela-fim" className={ROTULO}>e parar às</label>
            <select
              id="rd-janela-fim"
              value={janelaFim}
              disabled={salvando}
              onChange={(e) => setJanelaFim(Number(e.target.value))}
              className={CAMPO}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rd-limite" className={ROTULO}>No máximo por dia</label>
            <input
              id="rd-limite"
              type="number"
              min={1}
              max={10000}
              value={limiteDiario}
              disabled={salvando}
              onChange={(e) => setLimiteDiario(Number(e.target.value))}
              className={CAMPO}
            />
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Lead que chega fora do horário não perde a mensagem: ela é remarcada para a abertura do
          dia seguinte. O teto existe para proteger a qualidade do número: volume anormal de
          mensagem de modelo é sinal ruim para a Meta, e número com qualidade baixa entrega menos
          para todo mundo, inclusive para quem está esperando resposta.
          {typeof d?.enviadasHoje === 'number' && (
            <> Hoje saíram <strong>{d.enviadasHoje}</strong> de {limiteDiario}.</>
          )}
        </p>

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

        <button
          onClick={() => void salvar()}
          disabled={salvando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors"
        >
          {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Salvar canal
        </button>
      </div>

      {/* ── 3. a chave ── */}
      <div className={`rounded-xl border p-4 ${
        ativo
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : 'border-slate-200 dark:border-white/10'
      }`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
              <Zap size={15} className={ativo ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
              3. Chave geral do disparo
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 max-w-md">
              {ativo
                ? 'Ligado. As regras com disparo ativo mandam mensagem no tempo de cada uma.'
                : 'Desligado. Os leads continuam entrando no CRM normalmente, e nenhuma regra dispara.'}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={ativo}
            aria-label="Disparo automático do primeiro contato"
            onClick={() => void salvar(!ativo)}
            disabled={salvando}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${
              ativo ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              ativo ? 'translate-x-5' : ''
            }`} />
          </button>
        </div>
      </div>

      {/* ── o que já aconteceu ── */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Até agora</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          {[
            { rotulo: 'Leads recebidos', valor: d?.leadsRecebidos ?? 0 },
            { rotulo: 'Na fila', valor: d?.fila?.aguardando ?? 0 },
            { rotulo: 'Enviadas', valor: d?.fila?.enviado ?? 0 },
            { rotulo: 'Falharam', valor: d?.fila?.falhou ?? 0 },
          ].map((c) => (
            <div key={c.rotulo} className="rounded-lg bg-slate-50 dark:bg-black/30 p-3">
              <p className="text-xl font-semibold text-slate-900 dark:text-white tabular-nums">{c.valor}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{c.rotulo}</p>
            </div>
          ))}
        </div>

        {(d?.ultimos?.length ?? 0) > 0 && (
          <ul className="mt-4 space-y-1.5">
            {d!.ultimos.map((u, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 dark:text-slate-300 truncate">
                  {u.email || u.telefone || 'sem identificação'}
                  {u.identificador && <span className="text-slate-400"> · {u.identificador}</span>}
                </span>
                <span className="text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                  {new Date(u.criado_em).toLocaleString('pt-BR')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
