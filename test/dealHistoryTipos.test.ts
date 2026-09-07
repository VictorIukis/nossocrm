/**
 * Os nomes dos tipos do histórico.
 *
 * A tabela guarda `ai_stage_advanced` e `hitl_pending_created`; quem lê o
 * negócio precisa ver "Etapa avançada pela IA" e "IA sugeriu avanço". Tipo sem
 * tradução aparece cru na tela, e o CHECK do banco é fechado -- então dá para
 * garantir que a lista está completa em vez de descobrir pela tela.
 */
import { describe, it, expect } from 'vitest';
import { NOME_DO_TIPO } from '@/lib/query/hooks/useDealHistoryQuery';

// A lista exata que o CHECK de deal_activities aceita, conferida no banco.
const TIPOS_DO_BANCO = [
  'created', 'updated', 'contacted', 'qualified', 'proposal_sent',
  'negotiation', 'won', 'lost', 'note', 'assigned', 'unassigned',
  'stage_changed', 'ai_response', 'ai_stage_advanced', 'ai_handoff',
  'hitl_pending_created', 'hitl_pending_approved', 'hitl_pending_rejected',
  'hitl_alert',
];

describe('tradução dos tipos', () => {
  it('todo tipo que o banco aceita tem nome em português', () => {
    const semNome = TIPOS_DO_BANCO.filter((t) => !NOME_DO_TIPO[t]);
    expect(semNome).toEqual([]);
  });

  it('não sobra tradução para tipo que o banco recusa', () => {
    const inventados = Object.keys(NOME_DO_TIPO).filter((t) => !TIPOS_DO_BANCO.includes(t));
    expect(inventados).toEqual([]);
  });

  it('os nomes falam de negócio, não de sistema', () => {
    expect(NOME_DO_TIPO.ai_stage_advanced).toBe('Etapa avançada pela IA');
    expect(NOME_DO_TIPO.hitl_pending_created).toBe('IA sugeriu avanço');
    expect(NOME_DO_TIPO.stage_changed).toBe('Mudou de etapa');
  });
});
