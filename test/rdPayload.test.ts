/**
 * O que chega do RD vira o nome pelo qual a pessoa vai ser chamada e o número
 * para onde a mensagem vai. Errar aqui é falar "Oi null" ou mandar para outro
 * telefone -- os dois acontecem em silêncio.
 */
import { describe, it, expect } from 'vitest';
import { lerLeadDoRD, normalizarTelefone, primeiroNome, respostasEmTexto } from '@/lib/rd/payload';

// Formato real do webhook do RD Station Marketing, com os campos da LP da Bright.
const CORPO_RD = {
  leads: [
    {
      id: '5033391353',
      email: 'contato@backbonestudio.com.br',
      name: 'Fabricio Aguiar',
      company: 'Backbone Studio',
      job_title: 'CEO / Founder',
      mobile_phone: '(41) 99999-1234',
      custom_fields: { cf_faturamento_mensal: 'R$ 100 mil a R$ 500 mil' },
      last_conversion: {
        id: '12902483795',
        content: {
          identificador: 'diagnostico-bright',
          email: 'contato@backbonestudio.com.br',
          name: 'Fabricio Aguiar',
          company: 'Backbone Studio',
          cf_investimento_trafego: 'R$ 10 mil a R$ 30 mil/mês',
          cf_duvida_trafego: 'Não sei dizer qual campanha traz cliente de verdade',
          conversion_domain: 'evento.brightops.com.br',
        },
      },
    },
  ],
};

describe('lead do RD', () => {
  const lead = lerLeadDoRD(CORPO_RD)!;

  it('pega nome, empresa e cargo', () => {
    expect(lead.nome).toBe('Fabricio Aguiar');
    expect(lead.empresa).toBe('Backbone Studio');
    expect(lead.cargo).toBe('CEO / Founder');
  });

  it('separa o primeiro nome, que é como se chama alguém', () => {
    expect(lead.primeiroNome).toBe('Fabricio');
  });

  it('normaliza o telefone com país', () => {
    expect(lead.telefone).toBe('5541999991234');
  });

  it('guarda o identificador da conversão contra duplicata', () => {
    expect(lead.conversaoId).toBe('12902483795');
    expect(lead.identificador).toBe('diagnostico-bright');
  });

  // O contexto da conversa sai daqui: sem isso a IA fala genérico.
  it('junta as respostas e descarta os campos de controle', () => {
    expect(lead.respostas).toMatchObject({
      cf_faturamento_mensal: 'R$ 100 mil a R$ 500 mil',
      cf_investimento_trafego: 'R$ 10 mil a R$ 30 mil/mês',
      cf_duvida_trafego: 'Não sei dizer qual campanha traz cliente de verdade',
    });
    expect(lead.respostas).not.toHaveProperty('email');
    expect(lead.respostas).not.toHaveProperty('identificador');
    expect(lead.respostas).not.toHaveProperty('conversion_domain');
  });

  it('a resposta mais recente vence o cadastro antigo do RD', () => {
    const corpo = {
      leads: [
        { name: 'Nome Antigo', company: 'Empresa Antiga',
          last_conversion: { content: { name: 'Nome Novo', company: 'Empresa Nova' } } },
      ],
    };
    const l = lerLeadDoRD(corpo)!;
    expect(l.nome).toBe('Nome Novo');
    expect(l.empresa).toBe('Empresa Nova');
  });

  it('aceita o objeto solto que o botão "Verificar" do RD manda', () => {
    const l = lerLeadDoRD({ name: 'Teste RD', email: 'teste@rd.com' })!;
    expect(l.nome).toBe('Teste RD');
    expect(l.email).toBe('teste@rd.com');
  });

  it('sem telefone devolve null, e não string vazia', () => {
    const l = lerLeadDoRD({ leads: [{ name: 'Sem Fone', email: 'a@b.com' }] })!;
    expect(l.telefone).toBeNull();
  });
});

describe('telefone', () => {
  it('acrescenta o 55 quando falta', () => {
    expect(normalizarTelefone('(41) 99999-1234')).toBe('5541999991234');
    expect(normalizarTelefone('4133334444')).toBe('554133334444');
  });

  it('mantém o que já tem país', () => {
    expect(normalizarTelefone('+55 41 99999-1234')).toBe('5541999991234');
  });

  it('tira o zero de discagem nacional', () => {
    expect(normalizarTelefone('041999991234')).toBe('5541999991234');
  });

  // Número curto é engano de digitação. Melhor recusar do que mandar mensagem
  // para um número que não é da pessoa.
  it('recusa o que não dá para discar', () => {
    expect(normalizarTelefone('99999')).toBeNull();
    expect(normalizarTelefone('')).toBeNull();
    expect(normalizarTelefone(null)).toBeNull();
    expect(normalizarTelefone('não tenho')).toBeNull();
  });
});

describe('primeiro nome', () => {
  it('conserta nome gritado', () => {
    expect(primeiroNome('FABRICIO AGUIAR')).toBe('Fabricio');
  });

  it('aguenta nome com espaços sobrando', () => {
    expect(primeiroNome('  Ana   Paula ')).toBe('Ana');
  });

  it('sem nome, null', () => {
    expect(primeiroNome(null)).toBeNull();
    expect(primeiroNome('   ')).toBeNull();
  });
});

describe('respostas viram contexto legível', () => {
  it('tira o cf_ e o underline', () => {
    expect(respostasEmTexto({ cf_faturamento_mensal: 'R$ 100 mil' }))
      .toBe('faturamento mensal: R$ 100 mil');
  });
});
