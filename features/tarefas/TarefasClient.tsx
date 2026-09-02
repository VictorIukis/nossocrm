'use client';

/**
 * Painel de tarefas do Asana.
 *
 * Enquanto o Asana nao esta conectado, a tela mostra o passo a passo em vez de
 * um erro: token ausente e estado esperado numa instalacao nova, e nao falha.
 */

import { useEffect, useState } from 'react';
import { ListTodo, ExternalLink, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

interface Tarefa {
  id: string;
  titulo: string;
  prazo: string | null;
  concluida: boolean;
  projeto: string | null;
  link: string | null;
}

interface Resposta {
  conectado: boolean;
  usuario?: string | null;
  tarefas: Tarefa[];
  erro?: string;
}

function formatarPrazo(prazo: string | null): { texto: string; atrasada: boolean } {
  if (!prazo) return { texto: 'sem prazo', atrasada: false };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d = new Date(prazo + 'T00:00:00');
  const dias = Math.round((d.getTime() - hoje.getTime()) / 86400000);

  if (dias < 0) return { texto: `${Math.abs(dias)} d atrás`, atrasada: true };
  if (dias === 0) return { texto: 'hoje', atrasada: false };
  if (dias === 1) return { texto: 'amanhã', atrasada: false };
  return { texto: d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }), atrasada: false };
}

export function TarefasClient() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch('/api/asana/tarefas')
      .then((r) => r.json())
      .then(setDados)
      .catch(() => setDados({ conectado: false, tarefas: [], erro: 'Falha ao carregar.' }))
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Carregando tarefas…
      </div>
    );
  }

  if (!dados?.conectado) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold font-display mb-1">Tarefas</h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8">
          Conecte o Asana para ver aqui o que está em aberto, sem trocar de aba.
        </p>

        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-6 bg-white dark:bg-dark-card">
          <div className="flex items-center gap-2 mb-4 text-slate-900 dark:text-white font-semibold">
            <ListTodo size={18} /> Asana ainda não conectado
          </div>
          <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-decimal pl-5">
            <li>
              Gere um token pessoal em{' '}
              <a
                href="https://app.asana.com/0/my-apps"
                target="_blank"
                rel="noreferrer"
                className="text-primary-600 dark:text-primary-300 underline underline-offset-2"
              >
                app.asana.com/0/my-apps
              </a>
            </li>
            <li>Cole o token em Configurações, na seção Integrações</li>
            <li>Recarregue esta página</li>
          </ol>

          {dados?.erro && (
            <div className="mt-4 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {dados.erro}
            </div>
          )}

          <p className="mt-5 text-xs text-slate-500 dark:text-slate-500 leading-relaxed">
            Token pessoal fica vinculado a uma pessoa: se ela sair da empresa, a conexão
            para de funcionar. Para uso do time inteiro, o caminho é OAuth, que dá mais
            trabalho para configurar e não depende de ninguém em particular.
          </p>
        </div>
      </div>
    );
  }

  const abertas = dados.tarefas.filter((t) => !t.concluida);
  const atrasadas = abertas.filter((t) => formatarPrazo(t.prazo).atrasada);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold font-display mb-1">Tarefas</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6">
        {dados.usuario ? `Atribuídas a ${dados.usuario}` : 'Suas tarefas'} no Asana
        {atrasadas.length > 0 && (
          <span className="ml-2 text-amber-600 dark:text-amber-400">
            · {atrasadas.length} atrasada{atrasadas.length > 1 ? 's' : ''}
          </span>
        )}
      </p>

      {dados.erro && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {dados.erro}
        </div>
      )}

      {abertas.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-10 text-center text-slate-500">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={28} />
          Nada em aberto no Asana.
        </div>
      ) : (
        <ul className="space-y-2">
          {abertas.map((t) => {
            const prazo = formatarPrazo(t.prazo);
            return (
              <li
                key={t.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {t.titulo}
                  </div>
                  {t.projeto && (
                    <div className="text-xs text-slate-500 truncate">{t.projeto}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs font-mono ${
                      prazo.atrasada
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {prazo.texto}
                  </span>
                  {t.link && (
                    <a
                      href={t.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-300"
                      title="Abrir no Asana"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
