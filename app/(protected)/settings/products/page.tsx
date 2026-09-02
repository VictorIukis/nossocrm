import type { Metadata } from 'next';
import SettingsPage from '@/features/settings/SettingsPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Produtos') };

export default function SettingsProducts() {
  return <SettingsPage tab="products" />
}
