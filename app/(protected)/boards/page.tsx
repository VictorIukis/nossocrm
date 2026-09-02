import type { Metadata } from 'next';
import { BoardsPage } from '@/features/boards/BoardsPage'
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Funis') };

export default function Boards() {
    return <BoardsPage />
}
