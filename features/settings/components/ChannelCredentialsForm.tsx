'use client';

/**
 * Formulário de credenciais de um canal de mensagem.
 *
 * A tela de editar canal era um aviso dizendo que a configuração "será
 * implementada no próximo passo". Na prática, um canal criado sem credencial
 * ficava sem conserto: não havia onde colar o token, e a única saída era apagar
 * o canal, o que leva junto o vínculo com as conversas.
 *
 * Os campos não são escritos aqui. Cada provedor já declara o que precisa em
 * `registerProvider({ configFields })`, e este formulário monta a partir dessa
 * declaração. Assim, provedor novo aparece aqui sozinho, e nunca fica de fora
 * por alguém ter esquecido de mexer nesta tela.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { ChannelProviderFactory } from '@/lib/messaging/channel-factory';
import '@/lib/messaging/providers';
import type { ChannelType } from '@/lib/messaging/types';

interface Props {
  channelId: string;
  channelType: ChannelType;
  provider: string;
  onSaved?: (status: string, mensagem: string | null) => void;
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'pronto' }
  | { fase: 'salvando' }
  | { fase: 'erro'; mensagem: string; detalhes?: string[] }
  | { fase: 'salvo'; status: string; mensagem: string | null };

export function ChannelCredentialsForm({ channelId, channelType, provider, onSaved }: Props) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardados, setGuardados] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  const campos = useMemo(() => {
    try {
      return ChannelProviderFactory.getProviderInfo(channelType, provider)?.configFields ?? [];
    } catch {
      return [];
    }
  }, [channelType, provider]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = await fetch(`/api/messaging/channels/${channelId}`);
        const dados = (await r.json()) as { channel?: { credentials?: Record<string, string> }; error?: string };
        if (!ativo) return;
        if (!r.ok) {
          setEstado({ fase: 'erro', mensagem: dados.error || 'Não consegui carregar o canal.' });
          return;
        }
        setGuardados(dados.channel?.credentials ?? {});
        setEstado({ fase: 'pronto' });
      } catch {
        if (ativo) setEstado({ fase: 'erro', mensagem: 'Não consegui falar com o servidor.' });
      }
    })();
    return () => {
      ativo = false;
    };
  }, [channelId]);

  const salvar = async () => {
    setEstado({ fase: 'salvando' });
    try {
      const r = await fetch(`/api/messaging/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credentials: valores }),
      });
      const dados = (await r.json()) as {
        ok?: boolean;
        status?: string;
        statusMessage?: string | null;
        error?: string;
        detalhes?: string[];
      };

      if (!r.ok) {
        setEstado({
          fase: 'erro',
          mensagem: dados.error || 'Não foi possível salvar.',
          detalhes: dados.detalhes,
        });
        return;
      }

      setValores({});
      setEstado({ fase: 'salvo', status: dados.status || 'pending', mensagem: dados.statusMessage ?? null });
      onSaved?.(dados.status || 'pending', dados.statusMessage ?? null);
    } catch {
      setEstado({ fase: 'erro', mensagem: 'Não consegui falar com o servidor.' });
    }
  };

  if (estado.fase === 'carregando') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-6">
        <Loader2 size={15} className="animate-spin" /> Carregando o canal…
      </div>
    );
  }

  if (campos.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
        Este provedor não pede credenciais por aqui.
      </p>
    );
  }

  const salvando = estado.fase === 'salvando';

  return (
    <div className="space-y-4">
      {campos.map((campo) => {
        const jaSalvo = (guardados[campo.key] || '').trim();
        const ehSegredo = campo.type === 'password';
        return (
          <div key={campo.key}>
            <label
              htmlFor={`cred-${campo.key}`}
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              {campo.label}
              {campo.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <input
              id={`cred-${campo.key}`}
              type={ehSegredo ? 'password' : 'text'}
              autoComplete="off"
              value={valores[campo.key] ?? ''}
              disabled={salvando}
              onChange={(e) => setValores((v) => ({ ...v, [campo.key]: e.target.value }))}
              placeholder={jaSalvo ? jaSalvo : campo.placeholder}
              className="w-full px-3 py-2 rounded-lg text-sm bg-white dark:bg-black/20
                border border-slate-300 dark:border-white/15
                text-slate-900 dark:text-white placeholder:text-slate-400
                focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            />
            {jaSalvo && (
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Já existe um valor salvo. Deixe em branco para manter.
              </p>
            )}
          </div>
        );
      })}

      {estado.fase === 'erro' && (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div>
            {estado.mensagem}
            {estado.detalhes && estado.detalhes.length > 0 && (
              <ul className="list-disc list-inside mt-1 opacity-90">
                {estado.detalhes.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {estado.fase === 'salvo' && (
        <div
          className={`flex items-start gap-2 text-sm ${
            estado.status === 'connected'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {estado.status === 'connected' ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          )}
          <span>
            {estado.status === 'connected'
              ? 'Salvo e conectado.'
              : `Salvo, mas a conexão não passou: ${estado.mensagem ?? 'motivo não informado'}`}
          </span>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={salvar}
          disabled={salvando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60
            disabled:cursor-not-allowed transition-colors"
        >
          {salvando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {salvando ? 'Conferindo com o provedor…' : 'Salvar e testar conexão'}
        </button>
      </div>
    </div>
  );
}
