'use client';

/**
 * Regras por formulário do RD.
 *
 * Uma regra responde três perguntas para um formulário: em que funil o negócio
 * entra, o que a mensagem diz e quando sai. É o que separa quem se inscreveu
 * num evento ao vivo de quem pediu um diagnóstico -- os dois chegam pelo mesmo
 * webhook, e só o identificador do formulário os distingue.
 *
 * A regra sem identificador é a reserva: vale para formulário que ainda não tem
 * regra própria. Sem ela, um anúncio novo entraria mudo.
 */

import { useMemo, useState } from 'react';
import { Loader2, Save, Trash2, Plus, AlertCircle, Zap } from 'lucide-react';

export interface Regra {
  id?: string;
  apelido: string;
  identificador: string | null;
  board_id: string | null;
  stage_id: string | null;
  modelo_nome: string | null;
  modelo_texto: string | null;
  modelo_variaveis: string[];
  atraso_minutos: number;
  dispara: boolean;
}

interface Etapa { id: string; name: string; funil: string }

const CAMPO =
  'w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20 ' +
  'border border-slate-300 dark:border-white/15 text-slate-900 dark:text-white ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40';

const ROTULO = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1';

const NOME_DO_CAMPO: Record<string, string> = {
  nome: 'Primeiro nome',
  empresa: 'Empresa',
  formulario: 'Identificador do formulário',
};

function quantasVariaveis(texto: string): number {
  const n = [...String(texto || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return n.length === 0 ? 0 : Math.max(...n);
}

const VAZIA: Regra = {
  apelido: '',
  identificador: '',
  board_id: null,
  stage_id: null,
  modelo_nome: '',
  modelo_texto: '',
  modelo_variaveis: [],
  atraso_minutos: 5,
  dispara: false,
};

export function RdRegras({
  regras,
  etapas,
  formulariosVistos,
  camposDeVariavel,
  aoMudar,
}: {
  regras: Regra[];
  etapas: Etapa[];
  formulariosVistos: string[];
  camposDeVariavel: string[];
  aoMudar: () => void;
}) {
  const [editando, setEditando] = useState<Regra | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (r: Regra, remover = false) => {
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch('/api/settings/rd/regras', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: r.id,
          remover,
          apelido: r.apelido,
          identificador: r.identificador,
          stageId: r.stage_id,
          modeloNome: r.modelo_nome,
          modeloTexto: r.modelo_texto,
          modeloVariaveis: r.modelo_variaveis,
          atrasoMinutos: r.atraso_minutos,
          dispara: r.dispara,
        }),
      });
      const d = (await resposta.json()) as { ok?: boolean; error?: string };
      if (!resposta.ok) {
        setErro(d.error || 'Não foi possível salvar.');
        return;
      }
      setEditando(null);
      aoMudar();
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
            Regras por formulário
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-lg">
            Cada anúncio manda para um formulário diferente no RD. A regra decide, para cada um,
            em que funil o negócio entra e o que a mensagem diz. Quem pediu diagnóstico quer marcar
            hora; quem se inscreveu num evento quer o link.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditando({ ...VAZIA })}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm shrink-0
            border border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-300
            hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
        >
          <Plus size={14} /> Nova regra
        </button>
      </div>

      {regras.length === 0 && !editando && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhuma regra ainda. Sem regra, o lead entra no CRM e não recebe mensagem.
        </p>
      )}

      <ul className="space-y-2">
        {regras.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border
              border-slate-200 dark:border-white/10 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Zap
                  size={13}
                  className={r.dispara ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'}
                />
                {r.apelido}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {r.identificador
                  ? `formulário: ${r.identificador}`
                  : 'padrão — vale para formulário sem regra própria'}
                {r.modelo_nome && ` · ${r.modelo_nome}`}
                {` · ${r.atraso_minutos} min`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditando({ ...r, identificador: r.identificador ?? '' })}
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline shrink-0"
            >
              Editar
            </button>
          </li>
        ))}
      </ul>

      {editando && (
        <FormularioDaRegra
          regra={editando}
          etapas={etapas}
          formulariosVistos={formulariosVistos}
          camposDeVariavel={camposDeVariavel}
          salvando={salvando}
          erro={erro}
          aoMudar={setEditando}
          aoSalvar={salvar}
          aoCancelar={() => { setEditando(null); setErro(null); }}
        />
      )}
    </div>
  );
}

function FormularioDaRegra({
  regra, etapas, formulariosVistos, camposDeVariavel, salvando, erro,
  aoMudar, aoSalvar, aoCancelar,
}: {
  regra: Regra;
  etapas: Etapa[];
  formulariosVistos: string[];
  camposDeVariavel: string[];
  salvando: boolean;
  erro: string | null;
  aoMudar: (r: Regra) => void;
  aoSalvar: (r: Regra, remover?: boolean) => void;
  aoCancelar: () => void;
}) {
  const esperadas = useMemo(
    () => quantasVariaveis(regra.modelo_texto ?? ''),
    [regra.modelo_texto]
  );

  const variaveis = useMemo(() => {
    const v = [...(regra.modelo_variaveis ?? [])];
    while (v.length < esperadas) v.push('empresa');
    return v.slice(0, esperadas);
  }, [regra.modelo_variaveis, esperadas]);

  const previa = useMemo(() => {
    let t = regra.modelo_texto ?? '';
    const exemplo: Record<string, string> = {
      nome: 'Fabricio',
      empresa: 'Backbone Studio',
      formulario: regra.identificador || 'formulario',
    };
    variaveis.forEach((campo, i) => {
      t = t.split(`{{${i + 1}}}`).join(exemplo[campo] ?? '…');
    });
    return t;
  }, [regra.modelo_texto, regra.identificador, variaveis]);

  const porFunil = new Map<string, Etapa[]>();
  for (const e of etapas) {
    const lista = porFunil.get(e.funil) ?? [];
    lista.push(e);
    porFunil.set(e.funil, lista);
  }

  return (
    <div className="rounded-lg border border-primary-300 dark:border-primary-500/30 p-4 space-y-3
      bg-primary-50/40 dark:bg-primary-500/5">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="regra-apelido" className={ROTULO}>Nome da regra</label>
          <input
            id="regra-apelido"
            value={regra.apelido}
            disabled={salvando}
            onChange={(e) => aoMudar({ ...regra, apelido: e.target.value })}
            placeholder="Diagnóstico de Receita"
            className={CAMPO}
          />
        </div>
        <div>
          <label htmlFor="regra-form" className={ROTULO}>
            Formulário no RD (em branco = regra padrão)
          </label>
          <input
            id="regra-form"
            list="formularios-vistos"
            value={regra.identificador ?? ''}
            disabled={salvando}
            onChange={(e) => aoMudar({ ...regra, identificador: e.target.value })}
            placeholder="diagnostico-bright"
            className={CAMPO}
          />
          <datalist id="formularios-vistos">
            {formulariosVistos.map((f) => <option key={f} value={f} />)}
          </datalist>
        </div>
      </div>

      <div>
        <label htmlFor="regra-etapa" className={ROTULO}>Onde o negócio entra</label>
        <select
          id="regra-etapa"
          value={regra.stage_id ?? ''}
          disabled={salvando}
          onChange={(e) => aoMudar({ ...regra, stage_id: e.target.value || null })}
          className={CAMPO}
        >
          <option value="">Usar o destino padrão da fonte</option>
          {[...porFunil.entries()].map(([funil, lista]) => (
            <optgroup key={funil} label={funil}>
              {lista.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="regra-modelo" className={ROTULO}>Modelo aprovado na Meta</label>
          <input
            id="regra-modelo"
            value={regra.modelo_nome ?? ''}
            disabled={salvando}
            onChange={(e) => aoMudar({ ...regra, modelo_nome: e.target.value })}
            placeholder="bright_t0_apresentacao"
            className={CAMPO}
          />
        </div>
        <div>
          <label htmlFor="regra-atraso" className={ROTULO}>Esperar (minutos)</label>
          <input
            id="regra-atraso"
            type="number"
            min={1}
            max={1440}
            value={regra.atraso_minutos}
            disabled={salvando}
            onChange={(e) => aoMudar({ ...regra, atraso_minutos: Number(e.target.value) })}
            className={CAMPO}
          />
        </div>
      </div>

      <div>
        <label htmlFor="regra-texto" className={ROTULO}>Texto do modelo</label>
        <textarea
          id="regra-texto"
          rows={3}
          value={regra.modelo_texto ?? ''}
          disabled={salvando}
          onChange={(e) => aoMudar({ ...regra, modelo_texto: e.target.value })}
          className={CAMPO}
        />
      </div>

      {esperadas > 0 && (
        <div className="space-y-2">
          {Array.from({ length: esperadas }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <code className="text-xs font-mono text-slate-500 dark:text-slate-400 w-12">
                {`{{${i + 1}}}`}
              </code>
              <select
                value={variaveis[i]}
                disabled={salvando}
                aria-label={`Campo da variável ${i + 1}`}
                onChange={(e) => {
                  const novo = [...variaveis];
                  novo[i] = e.target.value;
                  aoMudar({ ...regra, modelo_variaveis: novo });
                }}
                className={CAMPO}
              >
                {camposDeVariavel.map((c) => (
                  <option key={c} value={c}>{NOME_DO_CAMPO[c] ?? c}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="rounded-lg bg-white dark:bg-black/30 p-3">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">O lead vai receber:</p>
            <p className="text-sm text-slate-800 dark:text-slate-200">{previa}</p>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={regra.dispara}
          disabled={salvando}
          onChange={(e) => aoMudar({ ...regra, dispara: e.target.checked })}
          className="rounded"
        />
        Disparar mensagem para os leads deste formulário
      </label>

      {erro && (
        <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {erro}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => aoSalvar({ ...regra, modelo_variaveis: variaveis })}
          disabled={salvando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors"
        >
          {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Salvar regra
        </button>
        <button
          onClick={aoCancelar}
          disabled={salvando}
          className="px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300
            hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
        >
          Cancelar
        </button>
        {regra.id && (
          <button
            onClick={() => aoSalvar(regra, true)}
            disabled={salvando}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm
              text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={15} /> Remover
          </button>
        )}
      </div>
    </div>
  );
}
