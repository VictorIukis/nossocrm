import type { Metadata } from 'next';
import { MessagingPage } from '@/features/messaging/MessagingPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Mensagens') };

export default function Messaging() {
    return <MessagingPage />
}
