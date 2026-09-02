import type { Metadata } from 'next';
import { InboxPage } from '@/features/inbox/InboxPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Inbox') };

export default function Inbox() {
    return <InboxPage />
}
