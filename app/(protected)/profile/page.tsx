import type { Metadata } from 'next';
import { ProfilePage } from '@/features/profile/ProfilePage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Perfil') };

export default function Profile() {
    return <ProfilePage />
}
