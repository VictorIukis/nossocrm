import type { Metadata } from 'next';
import ReportsPage from '@/features/reports/ReportsPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Relatórios') };

export default function Reports() {
    return <ReportsPage />
}
