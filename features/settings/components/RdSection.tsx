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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Save, CheckCircle2, AlertCircle, Copy, Check, Zap, Clock,
} from 'lucide-react';

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

interface Dados {
  config: {
    rd_primeiro_contato_ativo?: boolean;
    rd_atraso_minutos?: number;
    rd_modelo_nome?: string;
    rd_modelo_texto?: string;
    rd_modelo_variaveis?: string[];
    rd_canal_id?: string;
    rd_ultimo_erro?: string;
  };
  fontes: Fonte[];
  canais: Canal[];
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

  const [atraso, setAtraso] = useState(5);
  const [modeloNome, setModeloNome] = useState('');
  const [modeloTexto, setModeloTexto] = useState('');
  const [variaveis, setVariaveis] = useState<string[]>([]);
  const [canalId, setCanalId] = useState('');

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/rd');
      const dados = (await r.json()) as Dados & { error?: string };
      if (!r.ok) {
        setErro(dados.error || 'Não consegui carregar.');
        return;
      }
      setD(dados);
      setAtraso(dados.config.rd_atraso_minutos ?? 5);
      setModeloNome(dados.config.rd_modelo_nome ?? '');
      setModeloTexto(dados.config.rd_modelo_texto ?? '');
      setVariaveis(dados.config.rd_modelo_variaveis ?? []);
      setCanalId(dados.config.rd_canal_id ?? '');
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  // O número de variáveis vem do texto, não de um campo separado: assim a tela
  // não deixa você escolher três campos para um modelo que declara um.
  const esperadas = useMemo(() => quantasVariaveis(modeloTexto), [modeloTexto]);

  useEffect(() => {
    setVariaveis((atual) => {
      if (atual.length === esperadas) return atual;
      const novo = [...atual];
      while (novo.length < esperadas) novo.push('empresa');
      return novo.slice(0, esperadas);
    });
  }, [esperadas]);

  const previa = useMemo(() => {
    let t = modeloTexto;
    const exemplo: Record<string, string> = {
      nome: 'Fabricio',
      empresa: 'Backbone Studio',
      formulario: 'diagnostico-bright',
    };
    variaveis.forEach((campo, i) => {
      t = t.split(`{{${i + 1}}}`).join(exemplo[campo] ?? '…');
    });
    return t;
  }, [modeloTexto, variaveis]);

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
          atrasoMinutos: atraso,
          modeloNome,
          modeloTexto,
          modeloVariaveis: variaveis,
          canalId: canalId || null,
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

      {/* ── 2. mensagem ── */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-4">
        <div>
          <span className={ROTULO}>2. A mensagem de abertura</span>
          <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
            Fora da janela de 24 horas, o WhatsApp oficial só aceita modelo aprovado pela Meta.
            O texto aqui precisa ser <strong>igual</strong> ao aprovado lá: é ele que vai para o
            histórico do negócio.
          </p>
        </div>

        <div>
          <label htmlFor="rd-modelo-nome" className={ROTULO}>Nome do modelo na Meta</label>
          <input
            id="rd-modelo-nome"
            value={modeloNome}
            disabled={salvando}
            onChange={(e) => setModeloNome(e.target.value)}
            placeholder="bright_t0_apresentacao"
            className={CAMPO}
          />
        </div>

        <div>
          <label htmlFor="rd-modelo-texto" className={ROTULO}>Texto do modelo</label>
          <textarea
            id="rd-modelo-texto"
            rows={3}
            value={modeloTexto}
            disabled={salvando}
            onChange={(e) => setModeloTexto(e.target.value)}
            placeholder="Aqui é a Sofia, do time da Bright. Vi que você acabou de pedir o Diagnóstico de Receita para a {{1}}. Certo?"
            className={CAMPO}
          />
        </div>

        {esperadas > 0 && (
          <div className="space-y-2">
            <span className={ROTULO}>O que entra em cada variável</span>
            {Array.from({ length: esperadas }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <code className="text-xs font-mono text-slate-500 dark:text-slate-400 w-12">
                  {`{{${i + 1}}}`}
                </code>
                <select
                  value={variaveis[i] ?? 'empresa'}
                  disabled={salvando}
                  onChange={(e) => {
                    const novo = [...variaveis];
                    novo[i] = e.target.value;
                    setVariaveis(novo);
                  }}
                  className={CAMPO}
                  aria-label={`Campo da variável ${i + 1}`}
                >
                  {(d?.camposDeVariavel ?? []).map((c) => (
                    <option key={c} value={c}>{NOME_DO_CAMPO[c] ?? c}</option>
                  ))}
                </select>
              </div>
            ))}

            <div className="rounded-lg bg-slate-50 dark:bg-black/30 p-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">O lead vai receber:</p>
              <p className="text-sm text-slate-800 dark:text-slate-200">{previa}</p>
            </div>
          </div>
        )}

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
        </div>

        <div>
          <label htmlFor="rd-atraso" className={ROTULO}>
            <Clock size={13} className="inline mr-1 -mt-0.5" />
            Esperar quantos minutos depois do cadastro
          </label>
          <input
            id="rd-atraso"
            type="number"
            min={1}
            max={1440}
            value={atraso}
            disabled={salvando}
            onChange={(e) => setAtraso(Number(e.target.value))}
            className={`${CAMPO} max-w-[8rem]`}
          />
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

        <button
          onClick={() => void salvar()}
          disabled={salvando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors"
        >
          {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Salvar
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
              3. Disparo automático
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 max-w-md">
              {ativo
                ? `Ligado. Cada lead com WhatsApp recebe a mensagem ${atraso} minutos depois de se cadastrar.`
                : 'Desligado. Os leads continuam entrando no CRM normalmente, só não sai mensagem.'}
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
