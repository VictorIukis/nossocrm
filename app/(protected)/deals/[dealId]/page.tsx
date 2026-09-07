/**
 * Link direto para um negócio.
 *
 *   /deals/<id>
 *
 * Não existia: negócio só abria em modal, a partir do quadro. Então não havia
 * como mandar "olha esse negócio" para alguém do time, nem colar o endereço num
 * card de tarefa ou numa conversa. O que existia era `/deals/<id>/cockpit`, que
 * é outra tela e não a ficha.
 *
 * A página confere antes de mandar para o quadro. Isso importa por dois
 * motivos:
 *
 *  - negócio de outra organização deve responder "não encontrado", e não abrir
 *    um modal vazio que parece defeito do sistema;
 *  - negócio apagado idem. Sem a conferência, o link antigo levaria a um quadro
 *    com um modal que nunca carrega, e a pessoa ficaria esperando.
 *
 * Quem lida com o link é o quadro, que já sabe abrir pelo `?deal=`. Duplicar a
 * ficha numa página própria significaria manter duas telas iguais.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { tituloDaPagina } from '@/lib/marca';

export const metadata: Metadata = { title: tituloDaPagina('Negócio') };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NaoEncontrado({ motivo }: { motivo: string }) {
  return (
    <div className="max-w-md py-16 mx-auto text-center px-6">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
        Negócio não encontrado
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{motivo}</p>
      <Link
        href="/boards"
        className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold
          bg-primary-600 text-white hover:bg-primary-700 transition-colors"
      >
        Ir para os funis
      </Link>
    </div>
  );
}

export default async function PaginaDoNegocio({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  if (!UUID.test(dealId)) {
    return <NaoEncontrado motivo="Este endereço não aponta para um negócio válido." />;
  }

  const supabase = await createClient();

  // A leitura passa pelo RLS com a sessão de quem abriu: negócio de outra
  // organização simplesmente não aparece, sem precisar de conferência à mão.
  const { data: negocio } = await supabase
    .from('deals')
    .select('id, board_id, deleted_at')
    .eq('id', dealId)
    .maybeSingle();

  if (!negocio) {
    return (
      <NaoEncontrado motivo="Ele pode ter sido apagado, ou pertencer a outra organização." />
    );
  }

  if ((negocio as { deleted_at: string | null }).deleted_at) {
    return <NaoEncontrado motivo="Este negócio foi apagado." />;
  }

  const boardId = (negocio as { board_id: string | null }).board_id;

  // O quadro já sabe abrir pelo `?deal=`. O `board` vai junto para o link
  // funcionar de qualquer funil: sem ele, quem tem outro quadro aberto veria a
  // ficha sobre a coluna errada, o que confunde ao arrastar depois.
  redirect(boardId ? `/boards?board=${boardId}&deal=${dealId}` : `/boards?deal=${dealId}`);
}
