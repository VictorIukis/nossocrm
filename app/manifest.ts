import type { MetadataRoute } from 'next';
import { MARCA } from '@/lib/marca';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: MARCA.nome,
    short_name: MARCA.nome,
    description: 'CRM Inteligente para Gestão de Vendas',
    start_url: '/boards',
    display: 'standalone',
    background_color: '#f2f1ed',   // off-white da Glow
    theme_color: '#0e1013',        // tinta da Glow
    icons: [
      // Gerados a partir do simbolo em public/marca/. Os maskable levam fundo
      // solido e 22% de folga, porque o Android recorta o icone em circulo e
      // sem essa margem a esfera fica com as bordas cortadas.
      { src: '/icons/icone-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icone-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

