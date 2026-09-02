import type { Metadata } from 'next';
import { AIHubPage } from '@/features/ai-hub/AIHubPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('AI Hub') };

export default function AIHub() {
    return <AIHubPage />
}
