import type { Metadata } from 'next';
import { ActivitiesPage } from '@/features/activities/ActivitiesPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Atividades') };

export default function Activities() {
    return <ActivitiesPage />
}
