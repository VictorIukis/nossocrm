import type { Metadata } from 'next'
import { Inter, Instrument_Serif } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { InstallBanner } from '@/components/pwa/InstallBanner'
import { tituloDaPagina } from '@/lib/marca';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
// Fonte de display da Glow, extraida de glowholding.com.br. So peso 400 existe.
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: tituloDaPagina(),
  description: 'CRM Inteligente para Gestão de Vendas',
}

/**
 * Componente React `RootLayout`.
 *
 * @param {{ children: ReactNode; }} {
  children,
} - Parâmetro `{
  children,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: necessário porque a classe "dark" é aplicada no servidor mas pode ser sobrescrita por tema do sistema no cliente
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${instrumentSerif.variable} font-sans antialiased bg-[var(--color-bg)] text-[var(--color-text-primary)]`}>
        <ServiceWorkerRegister />
        <InstallBanner />
        {children}
      </body>
    </html>
  )
}
