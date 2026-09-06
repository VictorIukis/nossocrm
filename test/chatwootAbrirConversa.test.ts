// @vitest-environment node
//
// Ambiente node, e nao o happy-dom do resto da suite: o happy-dom aplica
// politica de origem no fetch e recusa falar com o servidor local do teste.
/**
 * O caminho que abre conversa no WhatsApp, contra um Chatwoot de mentira.
 *
 * Este código nunca rodou de verdade quando foi escrito, e é o que vai rodar
 * sozinho: de minuto em minuto, mandando mensagem para gente real. Testar
 * contra o Chatwoot verdadeiro significaria mandar WhatsApp para alguém, então
 * aqui sobe um servidor HTTP local que responde no formato do Chatwoot e
 * confere, requisição por requisição, o que sai daqui.
 *
 * O que estes testes protegem, em ordem de estrago:
 *
 *  - mandar o modelo com o número errado de variáveis, que faz a Meta recusar
 *    o envio inteiro com um erro que não diz qual faltou;
 *  - criar contato duplicado no Chatwoot, que separa o histórico da mesma
 *    pessoa em duas fichas e quem atende deixa de ver o que já foi falado;
 *  - tratar "conversa aberta mas modelo recusado" como sucesso, que deixaria a
 *    fila marcada como enviada sem ninguém ter recebido nada.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  abrirConversaComModelo,
  type ContaChatwoot,
} from '@/lib/messaging/providers/chatwoot/iniciarConversa';

interface Chamada {
  metodo: string;
  caminho: string;
  corpo: Record<string, unknown> | null;
  token: string | null;
}

let servidor: Server;
let conta: ContaChatwoot;
let chamadas: Chamada[] = [];

/** O que o Chatwoot de mentira responde, ajustável por teste. */
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeAll(async () => {
  servidor = createServer((req, res) => {
    let bruto = '';
    req.on('data', (p) => (bruto += p));
    req.on('end', () => {
      const caminho = (req.url || '').replace('/api/v1/accounts/1', '');
      chamadas.push({
        metodo: req.method || '',
        caminho,
        corpo: bruto ? (JSON.parse(bruto) as Record<string, unknown>) : null,
        token: req.headers['api_access_token'] as string,
      });

      // O caminho mais específico vence: `/conversations` e
      // `/conversations/555/messages` casam os dois, e pegar o primeiro fazia o
      // teste achar que a mensagem tinha saído quando quem respondeu foi a
      // abertura da conversa.
      const chave = Object.keys(respostas)
        .filter((k) => caminho.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      const r = chave ? respostas[chave] : { status: 404, corpo: { error: 'sem resposta' } };
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.corpo));
    });
  });

  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const porta = (servidor.address() as AddressInfo).port;

  conta = {
    baseUrl: `http://127.0.0.1:${porta}`,
    accountId: '1',
    inboxId: '3',
    apiAccessToken: 'token-de-teste',
  };
});

afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

function limpar() {
  chamadas = [];
  respostas = {};
}

const MODELO = {
  nome: 'bright_t0_apresentacao',
  idioma: 'pt_BR',
  categoria: 'marketing',
  textoFinal: 'Aqui é a Sofia. Vi que você pediu o Diagnóstico para a Backbone Studio. Certo?',
  variaveis: ['Backbone Studio'],
};

describe('contato que ainda não existe no Chatwoot', () => {
  it('cria o contato, abre a conversa e manda o modelo', async () => {
    limpar();
    respostas = {
      '/contacts/search': { status: 200, corpo: { payload: [] } },
      '/contacts': {
        status: 200,
        corpo: { payload: { contact: { id: 77, contact_inboxes: [{ source_id: '5541999991234' }] } } },
      },
      '/conversations': { status: 200, corpo: { id: 555 } },
    };
    respostas['/conversations/555/messages'] = { status: 200, corpo: { id: 999 } };

    const r = await abrirConversaComModelo(conta, '5541999991234', 'Fabricio', null, MODELO);

    expect(r).toEqual({ ok: true, conversaId: '555', mensagemId: '999' });

    const criacao = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/contacts');
    expect(criacao?.corpo).toMatchObject({
      inbox_id: 3,
      name: 'Fabricio',
      phone_number: '+5541999991234',
    });

    const envio = chamadas.find((c) => c.caminho.includes('/messages'));
    expect(envio?.corpo).toMatchObject({
      message_type: 'outgoing',
      template_params: {
        name: 'bright_t0_apresentacao',
        language: 'pt_BR',
        category: 'marketing',
        processed_params: { '1': 'Backbone Studio' },
      },
    });
  });

  it('o telefone sai com o mais na frente, como a Meta espera', async () => {
    limpar();
    respostas = {
      '/contacts/search': { status: 200, corpo: { payload: [] } },
      '/contacts': { status: 200, corpo: { payload: { contact: { id: 1, contact_inboxes: [{ source_id: 'x' }] } } } },
      '/conversations': { status: 200, corpo: { id: 2 } },
    };
    respostas['/conversations/2/messages'] = { status: 200, corpo: { id: 3 } };

    await abrirConversaComModelo(conta, '5541988887777', null, null, MODELO);
    const criacao = chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/contacts');
    expect(criacao?.corpo?.phone_number).toBe('+5541988887777');
  });
});

describe('contato que já existe', () => {
  it('reaproveita em vez de criar outro', async () => {
    limpar();
    respostas = {
      '/contacts/search': {
        status: 200,
        corpo: {
          payload: [
            {
              id: 42,
              phone_number: '+5541999991234',
              contact_inboxes: [{ source_id: 'origem-antiga', inbox: { id: 3 } }],
            },
          ],
        },
      },
      '/conversations': { status: 200, corpo: { id: 10 } },
    };
    respostas['/conversations/10/messages'] = { status: 200, corpo: { id: 11 } };

    const r = await abrirConversaComModelo(conta, '5541999991234', 'Fabricio', null, MODELO);
    expect(r.ok).toBe(true);

    // Nenhum POST em /contacts: criar duplicado separaria o histórico da mesma
    // pessoa em duas fichas.
    expect(chamadas.filter((c) => c.metodo === 'POST' && c.caminho === '/contacts')).toHaveLength(0);

    const conversa = chamadas.find((c) => c.caminho === '/conversations');
    expect(conversa?.corpo).toMatchObject({ contact_id: 42, source_id: 'origem-antiga', inbox_id: 3 });
  });

  it('existe, mas nunca falou por este número: cria o vínculo', async () => {
    limpar();
    respostas = {
      '/contacts/search': {
        status: 200,
        corpo: { payload: [{ id: 42, phone_number: '+5541999991234', contact_inboxes: [] }] },
      },
      '/contacts/42/contact_inboxes': { status: 200, corpo: { source_id: 'vinculo-novo' } },
      '/conversations': { status: 200, corpo: { id: 12 } },
    };
    respostas['/conversations/12/messages'] = { status: 200, corpo: { id: 13 } };

    const r = await abrirConversaComModelo(conta, '5541999991234', 'Fabricio', null, MODELO);
    expect(r.ok).toBe(true);

    const vinculo = chamadas.find((c) => c.caminho.includes('contact_inboxes'));
    expect(vinculo?.corpo).toMatchObject({ inbox_id: 3, source_id: '5541999991234' });
  });
});

describe('quando dá errado', () => {
  it('conversa aberta e modelo recusado não é sucesso', async () => {
    limpar();
    respostas = {
      '/contacts/search': { status: 200, corpo: { payload: [] } },
      '/contacts': { status: 200, corpo: { payload: { contact: { id: 1, contact_inboxes: [{ source_id: 'x' }] } } } },
      '/conversations': { status: 200, corpo: { id: 20 } },
    };
    // É o caso real: modelo com nome errado, ou variável a menos.
    respostas['/conversations/20/messages'] = {
      status: 422,
      corpo: { error: 'template not found' },
    };

    const r = await abrirConversaComModelo(conta, '5541999991234', 'Fabricio', null, MODELO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain('template not found');
      // 422 é erro nosso: repetir manda a mesma coisa errada de novo.
      expect(r.recuperavel).toBe(false);
    }
  });

  it('instância fora do ar é falha que vale repetir', async () => {
    limpar();
    respostas = {
      '/contacts/search': { status: 200, corpo: { payload: [] } },
      '/contacts': { status: 200, corpo: { payload: { contact: { id: 1, contact_inboxes: [{ source_id: 'x' }] } } } },
      '/conversations': { status: 502, corpo: { error: 'bad gateway' } },
    };

    const r = await abrirConversaComModelo(conta, '5541999991234', 'Fabricio', null, MODELO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recuperavel).toBe(true);
  });

  it('canal sem token recusa antes de sair da máquina', async () => {
    limpar();
    const r = await abrirConversaComModelo(
      { ...conta, apiAccessToken: '' }, '5541999991234', 'F', null, MODELO
    );
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('canal sem caixa de entrada recusa antes de sair da máquina', async () => {
    limpar();
    const r = await abrirConversaComModelo(
      { ...conta, inboxId: '' }, '5541999991234', 'F', null, MODELO
    );
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});

describe('o token vai em todas as chamadas', () => {
  it('nenhuma requisição sai sem autenticação', async () => {
    limpar();
    respostas = {
      '/contacts/search': { status: 200, corpo: { payload: [] } },
      '/contacts': { status: 200, corpo: { payload: { contact: { id: 1, contact_inboxes: [{ source_id: 'x' }] } } } },
      '/conversations': { status: 200, corpo: { id: 30 } },
    };
    respostas['/conversations/30/messages'] = { status: 200, corpo: { id: 31 } };

    await abrirConversaComModelo(conta, '5541999991234', 'F', null, MODELO);
    expect(chamadas.length).toBeGreaterThan(2);
    for (const c of chamadas) expect(c.token).toBe('token-de-teste');
  });
});
