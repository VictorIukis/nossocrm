'use client';

/**
 * O que aconteceu com este negócio.
 *
 * Diferente da lista de tarefas logo acima, que é o que FALTA fazer. Aqui é o
 * que já foi feito, e boa parte foi feita pela máquina: contrato assinado no
 * Clicksign, primeiro contato enviado no WhatsApp, respostas do formulário do
 * RD, etapa avançada pela IA.
 *
 * Isso era registrado desde sempre e nunca foi mostrado. Quanto mais o CRM
 * passou a fazer sozinho, pior ficou: quem abria o negócio via o resultado sem
 * ver o caminho, e a única forma de saber por que ele estava naquela etapa era
 * perguntar para alguém.
 */

import {
  Bot, FileSignature, MessageSquare, ArrowRight, StickyNote,
  Trophy, XCircle, UserCheck, AlertTriangle, Loader2,
} from 'lucide-react';
import { useDealHistoryQuery, NOME_DO_TIPO, type LinhaDoHistorico } from '@/lib/query/hooks/useDealHistoryQuery';

const ICONE: Record<string, typeof Bot> = {
  note: StickyNote,
  contacted: MessageSquare,
  stage_changed: ArrowRight,
  won: Trophy,
  lost: XCircle,
  assigned: UserCheck,
  unassigned: UserCheck,
  ai_response: Bot,
  ai_stage_advanced: Bot,
  ai_handoff: Bot,
  hitl_pending_created: Bot,
  hitl_pending_approved: Bot,
  hitl_pending_rejected: Bot,
  hitl_alert: AlertTriangle,
};

/** De onde veio, quando a linha diz. É o que separa máquina de gente. */
const ORIGEM: Record<string, { rotulo: string; Icone: typeof Bot }> = {
  clicksign: { rotulo: 'Clicksign', Icone: FileSignature },
  rd_station: { rotulo: 'RD Station', Icone: ArrowRight },
  primeiro_contato: { rotulo: 'WhatsApp automático', Icone: MessageSquare },
};

function quandoFoi(iso: string): string {
  const minutos = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${Math.round(minutos)} min`;
  if (minutos < 60 * 48) return `há ${Math.round(minutos / 60)} h`;
  return `há ${Math.round(minutos / 1440)} dias`;
}

function Linha({ linha }: { linha: LinhaDoHistorico }) {
  const Icone = ICONE[linha.type] ?? StickyNote;
  const origem = ORIGEM[String(linha.metadata?.origem ?? '')];
  const daMaquina = Boolean(origem) || linha.type.startsWith('ai_') || linha.type.startsWith('hitl_');

  return (
    <li className="flex gap-3">
      <div
        className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          daMaquina
            ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
            : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300'
        }`}
      >
        <Icone size={14} />
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-900 dark:text-white">
            {NOME_DO_TIPO[linha.type] ?? linha.type}
          </span>
          {origem && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500
              dark:bg-white/10 dark:text-slate-400">
              {origem.rotulo}
            </span>
          )}
          <time
            className="text-xs text-slate-400 dark:text-slate-500"
            dateTime={linha.created_at}
            title={new Date(linha.created_at).toLocaleString('pt-BR')}
          >
            {quandoFoi(linha.created_at)}
          </time>
        </div>

        {linha.description && (
          // Quebra de linha preservada: as respostas do formulário chegam uma
          // por linha, e num parágrafo só viram um bloco ilegível.
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-line break-words">
            {linha.description}
          </p>
        )}
      </div>
    </li>
  );
}

export function HistoricoDoNegocio({ dealId }: { dealId: string }) {
  const { data: linhas = [], isLoading, error } = useDealHistoryQuery(dealId);

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Carregando o histórico…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Não consegui carregar o histórico deste negócio.
      </p>
    );
  }

  if (linhas.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 italic">
        Nada registrado ainda. Aqui aparece o que acontece sozinho: lead entrando pelo RD, contrato
        assinado, primeiro contato enviado, etapa avançada pela IA.
      </p>
    );
  }

  return (
    <ul>
      {linhas.map((l) => <Linha key={l.id} linha={l} />)}
    </ul>
  );
}
