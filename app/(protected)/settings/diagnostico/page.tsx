import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage';
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Diagnóstico') };

export default function SettingsDiagnostico() {
  return <SettingsPage tab="diagnostico" />;
}
