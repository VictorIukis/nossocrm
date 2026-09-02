/**
 * Identidade da marca, em um lugar so.
 *
 * Antes disto o nome do produto estava escrito na mao em 39 arquivos: titulo de
 * cada pagina, barra lateral, cabecalho do chat, modal de consentimento, banner
 * de instalacao, manifesto do PWA e o rodape dos PDFs de relatorio. Trocar de
 * marca significava cacar string por string, e esquecer uma so significa entregar
 * um PDF com a marca errada na mao do cliente.
 *
 * Para renomear o produto inteiro, mude os valores abaixo. Nada mais.
 */
export const MARCA = {
  /** Nome completo. Aparece em titulo de aba, barra lateral e rodape de PDF. */
  nome: 'CRM Glow Holding',

  /** Nome curto, para o PWA e espacos apertados. */
  nomeCurto: 'CRM Glow',

  /** Como o assistente de IA se apresenta dentro do produto. */
  assistente: 'Pilot',

  /**
   * Lockup horizontal (simbolo + palavra), usado com a barra lateral aberta.
   * Vazio faz cair para o nome em texto.
   */
  logo: '/marca/glow.png',

  /** Proporcao do lockup, para reservar espaco sem provocar salto de layout. */
  logoProporcao: 730 / 145,

  /** So o simbolo, para a barra lateral recolhida e para o icone do app. */
  logoSimbolo: '/marca/glow-simbolo.png',

  /**
   * A logo e monocromatica escura. No tema escuro ela sumiria no fundo, entao a
   * interface a inverte por CSS em vez de manter dois arquivos para sincronizar.
   */
  logoInverteNoEscuro: true,

  /** Letra ou sigla usada como marca d'agua quando nao ha logo (ex.: no PDF). */
  inicial: 'G',
} as const;

/**
 * Titulo de aba padronizado: "Contatos | NossoCRM".
 * Sem secao, devolve so o nome do produto.
 */
export function tituloDaPagina(secao?: string): string {
  return secao ? `${secao} | ${MARCA.nome}` : MARCA.nome;
}

/** Como o assistente aparece no cabecalho do chat: "NossoCRM Pilot". */
export function nomeDoAssistente(): string {
  return `${MARCA.nome} ${MARCA.assistente}`.trim();
}
