/**
 * Decide se um Enter no campo de mensagem deve enviar.
 *
 * Vive fora do componente para poder ser testado. A regra parece obvia, mas as
 * duas excecoes sao justamente as que quebram na mao de quem escreve em
 * portugues, e some sem deixar rastro:
 *
 *  - Shift+Enter e quebra de linha, nao envio.
 *  - Enter durante composicao de acento NAO envia. Para escrever "ã" ou "ç" o
 *    sistema abre uma composicao e usa o Enter para confirma-la; sem esta
 *    guarda, a mensagem ia embora no meio da palavra.
 *
 * O keyCode 229 e o valor que navegadores antigos usam para "tecla dentro de
 * uma composicao", quando `isComposing` nao existe.
 */
export interface TeclaDeEnvio {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
}

export function deveEnviarComEnter(e: TeclaDeEnvio): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  return e.key === 'Enter' && !e.shiftKey;
}
