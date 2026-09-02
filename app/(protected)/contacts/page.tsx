import type { Metadata } from 'next';
import { ContactsPage } from '@/features/contacts/ContactsPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Contatos') };

export default function Contacts() {
    return <ContactsPage />
}
