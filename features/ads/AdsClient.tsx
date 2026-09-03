'use client';

/**
 * Casca da tela de Ads: escolhe entre as fontes de mídia paga.
 *
 * Os painéis são separados, e não somados num total único, porque Meta e Google
 * não medem a mesma coisa. "Resultado" na Meta varia por conta -- pode ser
 * compra, cadastro ou conversa iniciada; no Google é conversão, definida na
 * própria conta. Somar os dois daria um número com aparência de verdade e
 * significado nenhum, e é justamente esse número que alguém usaria para decidir
 * onde colocar mais dinheiro.
 *
 * Comparar os canais é útil e vale fazer -- mas exige combinar antes o que
 * conta como resultado em cada um. É trabalho de decisão, não de tela.
 */

import { useState } from 'react';
import { PainelMeta } from './PainelMeta';
import { PainelGoogle } from './PainelGoogle';

type Fonte = 'meta' | 'google';

export function AdsClient() {
  const [fonte, setFonte] = useState<Fonte>('meta');

  return (
    <div className="pb-10">
      <div className="flex items-center gap-1 mb-5 border-b border-slate-200 dark:border-white/10">
        {([
          { id: 'meta' as const, rotulo: 'Meta Ads' },
          { id: 'google' as const, rotulo: 'Google Ads' },
        ]).map((f) => (
          <button
            key={f.id}
            onClick={() => setFonte(f.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              fonte === f.id
                ? 'border-primary-600 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {fonte === 'meta' ? <PainelMeta /> : <PainelGoogle />}
    </div>
  );
}
