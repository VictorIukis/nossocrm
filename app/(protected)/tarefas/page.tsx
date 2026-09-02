import type { Metadata } from 'next';
import { tituloDaPagina } from '@/lib/marca';
import { TarefasClient } from '@/features/tarefas/TarefasClient';

export const metadata: Metadata = { title: tituloDaPagina('Tarefas') };

export default function TarefasPage() {
  return <TarefasClient />;
}
