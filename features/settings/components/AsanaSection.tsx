'use client';

/**
 * Conexão com o Asana.
 *
 * Existia o painel de Tarefas lendo o token do banco, e a instrução "cole o
 * token em Configurações" -- mas a tela para colar nunca foi feita. Esta é ela.
 *
 * O token não volta ao navegador depois de salvo: a tela só sabe se existe.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle, Trash2, ExternalLink } from 'lucide-react';

interface Workspace {
  gid: string;
  name: string;
}

export function AsanaSection() {
  const [carregando, setCarregando] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [token, setToken] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/asana');
      const d = (await r.json()) as { conectado?: boolean; workspaceId?: string; error?: string };
      if (!r.ok) {
        setErro(d.error || 'Não consegui carregar a conexão.');
        return;
      }
      setConectado(Boolean(d.conectado));
      setWorkspaceId(d.workspaceId || '');
    } catch {
      setErro('Não consegui falar com o servidor.');
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
      const r = await fetch('/api/settings/asana', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, workspaceId }),
      });
      const d = (await r.json()) as {
        ok?: boolean;
        nomeDoUsuario?: string;
        workspaces?: Workspace[];
        workspaceId?: string;
        error?: string;
      };

      if (!r.ok) {
        setErro(d.error || 'Não foi possível salvar.');
        return;
      }

      setToken('');
      setConectado(true);
      setWorkspaces(d.workspaces || []);
      if (d.workspaceId) setWorkspaceId(d.workspaceId);
      setOk(
        d.nomeDoUsuario
          ? `Conectado como ${d.nomeDoUsuario}.`
          : 'Conectado ao Asana.'
      );
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
      await fetch('/api/settings/asana', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remover: true }),
      });
      setConectado(false);
      setWorkspaceId('');
      setWorkspaces([]);
      setOk('Conexão removida.');
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

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Asana</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Conecte o Asana para ver as tarefas da equipe dentro do CRM, na aba Tarefas.
        </p>
      </div>

      {conectado && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={15} /> Conectado
        </div>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 space-y-4">
        <div>
          <label htmlFor="asana-token" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Token de acesso pessoal
          </label>
          <input
            id="asana-token"
            type="password"
            autoComplete="off"
            value={token}
            disabled={salvando}
            onChange={(e) => setToken(e.target.value)}
            placeholder={conectado ? 'Já existe um token salvo. Deixe em branco para manter.' : 'cole aqui o token do Asana'}
            className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
              border border-slate-300 dark:border-white/15
              text-slate-900 dark:text-white placeholder:text-slate-400
              focus:outline-none focus:ring-2 focus:ring-primary-500/40"
          />
          <a
            href="https://app.asana.com/0/my-apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            Gerar um token no Asana <ExternalLink size={11} />
          </a>
        </div>

        {workspaces.length > 1 && (
          <div>
            <label htmlFor="asana-workspace" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Workspace
            </label>
            <select
              id="asana-workspace"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
                border border-slate-300 dark:border-white/15 text-slate-900 dark:text-white"
            >
              {workspaces.map((w) => (
                <option key={w.gid} value={w.gid}>{w.name}</option>
              ))}
            </select>
          </div>
        )}

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
            disabled={salvando || !token.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
              bg-primary-600 text-white hover:bg-primary-700
              disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {salvando ? 'Conferindo com o Asana…' : 'Salvar e testar conexão'}
          </button>

          {conectado && (
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

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Token pessoal fica vinculado a uma pessoa: se ela sair da empresa, a conexão para de
        funcionar. Para uso do time inteiro, o caminho é OAuth, que ainda não está implementado.
      </p>
    </div>
  );
}
