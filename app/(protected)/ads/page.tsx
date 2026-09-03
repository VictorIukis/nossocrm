import type { Metadata } from 'next';
import { AdsClient } from '@/features/ads/AdsClient';
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Ads') };

export default function AdsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-slate-900 dark:text-white">Ads</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Quanto está saindo em mídia paga, e o que está voltando.
        </p>
      </div>
      <AdsClient />
    </div>
  );
}
