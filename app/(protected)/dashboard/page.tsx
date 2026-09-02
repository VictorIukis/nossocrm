import type { Metadata } from 'next';
import DashboardPage from '@/features/dashboard/DashboardPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Dashboard') };

export default function Dashboard() {
    return <DashboardPage />
}
