import type { Metadata } from 'next';
import { DecisionQueuePage } from '@/features/decisions/DecisionQueuePage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Decisões') };

export default function Decisions() {
    return <DecisionQueuePage />
}
