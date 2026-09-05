/**
 * O modelo é a primeira frase que o lead recebe da Bright. Preencher errado não
 * dá erro: a Meta manda do jeito que veio, e a pessoa lê "para a Fabricio".
 */
import { describe, it, expect } from 'vitest';
import {
  preencherModelo,
  quantasVariaveis,
} from '@/lib/messaging/providers/chatwoot/iniciarConversa';

// Os dois modelos que a Bright tem aprovados hoje. Um tem a empresa em {{1}};
// o outro, o nome. É por isso que a ordem não pode ser fixa no código.
const APRESENTACAO =
  'Aqui é a Sofia, do time da Bright. Vi que você acabou de pedir o Diagnóstico de Receita para a {{1}}. Certo?';
const ABERTURA = 'Oi {{1}}, tudo bem?';

describe('quantas variáveis o modelo tem', () => {
  it('conta as declaradas', () => {
    expect(quantasVariaveis(APRESENTACAO)).toBe(1);
    expect(quantasVariaveis('Oi {{1}}, sobre a {{2}}')).toBe(2);
  });

  it('modelo sem variável nenhuma', () => {
    expect(quantasVariaveis('Bom dia!')).toBe(0);
  });

  // {{2}} sozinho significa que o modelo espera duas, mesmo sem usar a primeira.
  it('usa o maior número, não a contagem', () => {
    expect(quantasVariaveis('Só a segunda: {{2}}')).toBe(2);
  });

  it('aguenta espaço dentro das chaves', () => {
    expect(quantasVariaveis('Oi {{ 1 }}')).toBe(1);
  });
});

describe('preencher', () => {
  it('troca pelo valor', () => {
    const r = preencherModelo(APRESENTACAO, ['Backbone Studio']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.texto).toContain('para a Backbone Studio. Certo?');
  });

  it('serve para o modelo que pede o nome', () => {
    const r = preencherModelo(ABERTURA, ['Fabricio']);
    if (r.ok) expect(r.texto).toBe('Oi Fabricio, tudo bem?');
  });

  // O erro que motivou o teste: eu tinha fixado dois valores no código, e o
  // modelo aprovado tem um. A Meta rejeitaria o envio inteiro.
  it('recusa quantidade diferente da declarada', () => {
    const r = preencherModelo(APRESENTACAO, ['Fabricio', 'Backbone Studio']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('declara 1');
  });

  it('recusa valor em branco, que a Meta também rejeita', () => {
    const r = preencherModelo(APRESENTACAO, ['   ']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('variável 1');
  });

  it('empresa vazia não vira "para a . Certo?"', () => {
    const r = preencherModelo(APRESENTACAO, ['']);
    expect(r.ok).toBe(false);
  });

  it('troca todas as ocorrências da mesma variável', () => {
    const r = preencherModelo('{{1}} e {{1}} de novo', ['Bright']);
    if (r.ok) expect(r.texto).toBe('Bright e Bright de novo');
  });
});
