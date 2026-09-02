import type { Metadata } from 'next';
import { AgendaClient } from '@/features/agenda/AgendaClient';
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Agenda') };

export default function AgendaPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-slate-900 dark:text-white">Agenda</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Seus compromissos do CRM e da sua agenda do Google, no mesmo lugar.
        </p>
      </div>
      <AgendaClient />
    </div>
  );
}
