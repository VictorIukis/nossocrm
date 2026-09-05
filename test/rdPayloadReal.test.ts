/**
 * O corpo REAL que o RD Station manda.
 *
 * Copiado de um envio de verdade, capturado pelo botão "Verificar" do próprio
 * RD. Escrevi o leitor antes de ver isto, e o corpo real desmentiu três
 * suposições minhas de uma vez -- por isso este arquivo existe separado: ele é
 * a prova contra o formato de verdade, não contra o que eu imaginei.
 */
import { describe, it, expect } from 'vitest';
import { lerLeadDoRD } from '@/lib/rd/payload';

const CORPO_REAL = {
  leads: [
    {
      id: '5033391353',
      name: 'Fabricio Aguiar',
      uuid: '12422420-527c-4e7d-94d9-01a55bdbe7b5',
      email: 'contato@backbonestudio.com.br',
      phone: null,
      company: 'Backbone Studio',
      job_title: 'CEO / Founder',
      lead_stage: 'Lead',
      mobile_phone: null,
      personal_phone: null,
      custom_fields: {},
      last_conversion: {
        source: 'evento-bright-inscricao',
        content: {
          UF: null,
          Nome: 'Fabricio Aguiar',
          Cargo: 'CEO / Founder',
          Empresa: 'Backbone Studio',
          Linkedin: '',
          created_at: '2026-09-04T18:42:14Z',
          email_lead: 'contato@backbonestudio.com.br',
          event_type: 'CONVERSION',
          phone_lead: null,
          identificador: 'evento-bright-inscricao',
          conversion_url: 'https://evento.brightops.com.br/obrigado.html',
          traffic_source: 'encoded_eyJmaXJzdF9zZXNzaW9uIjp7InZhbHVlIjoiaHR0cHM6Ly9ldmVudG8=',
          event_timestamp: '2026-09-04T18:42:14Z',
          event_identifier: 'evento-bright-inscricao',
          conversion_domain: 'evento.brightops.com.br',
          // As respostas do formulário vêm aqui: JSON dentro de um texto.
          conversion_payload:
            '{"cf_faturamento_mensal":"Até R$ 500 mil","cf_investimento_trafego":"Até R$ 5 mil","cf_duvida_trafego":"Ter um acompanhamento inteligente com relatórios e dicas.","auditoria_conta":"sim"}',
          __cdp__original_event: {
            payload: { name: 'Fabricio Aguiar' },
            event_type: 'CONVERSION',
            event_uuid: '42f71f9e-4c58-43e4-83d2-0ccd115c1192',
            event_family: 'CDP',
            event_batch_uuid: 'ed6477cc-e7a3-4f29-9f86-3fe6d919fad4',
          },
          conversion_identifier: 'evento-bright-inscricao',
        },
        created_at: '2026-09-04T15:42:14.000-03:00',
        cumulative_sum: '2',
        conversion_origin: { medium: 'social', source: 'ig', channel: 'Social' },
      },
      first_conversion: {
        source: 'evento-bright-inscricao',
        content: {
          Nome: 'Fabricio Aguiar',
          Empresa: 'Backbone Studio',
          email_lead: 'contato@backbonestudio.com.br',
          identificador: 'evento-bright-inscricao',
          cf_duvida_trafego: 'Ter um acompanhamento inteligente com relatórios e dicas.',
          cf_faturamento_mensal: 'Até R$ 500 mil',
          cf_investimento_trafego: 'Até R$ 5 mil',
        },
      },
      number_conversions: '2',
    },
  ],
};

describe('corpo real do RD', () => {
  const lead = lerLeadDoRD(CORPO_REAL)!;

  it('lê nome, e-mail, empresa e cargo', () => {
    expect(lead.nome).toBe('Fabricio Aguiar');
    expect(lead.primeiroNome).toBe('Fabricio');
    expect(lead.email).toBe('contato@backbonestudio.com.br');
    expect(lead.empresa).toBe('Backbone Studio');
    expect(lead.cargo).toBe('CEO / Founder');
  });

  // Suposição desmentida nº 1: as respostas não vêm como campos; vêm num JSON
  // dentro de um texto. Sem abrir, o negócio guardava a string inteira e o
  // contexto da conversa ficava de fora.
  it('abre o conversion_payload e recupera as respostas', () => {
    expect(lead.respostas).toMatchObject({
      cf_faturamento_mensal: 'Até R$ 500 mil',
      cf_investimento_trafego: 'Até R$ 5 mil',
      cf_duvida_trafego: 'Ter um acompanhamento inteligente com relatórios e dicas.',
      auditoria_conta: 'sim',
    });
  });

  // Suposição desmentida nº 2: `last_conversion` não tem `id`. O que muda a
  // cada conversão é o uuid do evento do CDP.
  it('usa o uuid do evento como chave contra duplicata', () => {
    expect(lead.conversaoId).toBe('42f71f9e-4c58-43e4-83d2-0ccd115c1192');
  });

  // Suposição desmentida nº 3: as chaves vêm em português e com maiúscula
  // dentro da conversão, e em inglês na raiz -- no mesmo envio.
  it('não deixa lixo de controle virar campo do negócio', () => {
    for (const proibido of [
      'traffic_source', 'conversion_payload', '__cdp__original_event',
      'event_type', 'event_timestamp', 'event_identifier', 'conversion_identifier',
      'Nome', 'Empresa', 'Cargo', 'email_lead', 'UF',
    ]) {
      expect(lead.respostas).not.toHaveProperty(proibido);
    }
  });

  it('confirma que esta landing page não coleta telefone', () => {
    expect(lead.telefone).toBeNull();
  });

  it('identifica de qual formulário veio', () => {
    expect(lead.identificador).toBe('evento-bright-inscricao');
  });
});

describe('mesmo corpo, sem o conversion_payload', () => {
  it('cai para a primeira conversão, onde as respostas vêm abertas', () => {
    const corpo = JSON.parse(JSON.stringify(CORPO_REAL));
    delete corpo.leads[0].last_conversion.content.conversion_payload;

    const lead = lerLeadDoRD(corpo)!;
    expect(lead.respostas).toMatchObject({
      cf_faturamento_mensal: 'Até R$ 500 mil',
      cf_investimento_trafego: 'Até R$ 5 mil',
    });
  });
});
