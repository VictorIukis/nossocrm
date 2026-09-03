'use client';

/**
 * Aviso de dado fabricado.
 *
 * Fica no topo do painel, sempre visível, nunca dispensável. Número inventado
 * numa tela de investimento é útil para demonstrar e perigoso para decidir: sem
 * este aviso, quem abre a tela no meio de uma reunião não tem como saber a
 * diferença, e a mesma tela que ajuda a vender passa a mentir.
 */

import { FlaskConical } from 'lucide-react';

export function AvisoDemo() {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 mb-5 rounded-xl px-4 py-3
        border border-amber-300 bg-amber-50 text-amber-900
        dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <FlaskConical size={16} className="mt-0.5 shrink-0" />
      <p className="text-sm">
        <strong>Modo demonstração.</strong> Todos os números desta tela são fictícios, de uma conta
        inventada. Nada aqui vem de conta de anúncios real, e nenhuma API de anúncio foi consultada.
      </p>
    </div>
  );
}
