import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Integrações') };

export default function SettingsIntegracoes() {
  return <SettingsPage tab="integrations" />
}
