import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Configurações') };

export default function Settings() {
    return <SettingsPage />
}
