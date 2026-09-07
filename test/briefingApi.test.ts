/**
 * A API do briefing, depois de separar ler de gerar.
 *
 * Antes existia só o GET, e ele gerava: abrir a gaveta duas vezes custava duas
 * chamadas de IA e duas esperas pelo mesmo texto. Agora GET lê o que está
 * guardado e POST gera.
 *
 * A garantia que estes testes protegem, e que não existia antes, é negativa:
 * GET NÃO chama a IA. É o tipo de regressão que ninguém percebe olhando a tela
 * -- o briefing aparece igual -- e que só se manifesta na fatura e na espera.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5'
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6'
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6'

const CONTEUDO = {
  dealId: DEAL_ID,
  dealTitle: 'Projeto X',
  contactName: 'João Silva',
  currentStage: 'Proposta',
  keyInsights: ['Cliente tem orçamento confirmado'],
  suggestedTopics: ['Apresentar proposta final'],
  recentActivities: [],
  generatedAt: '2026-09-07T10:00:00Z',
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/ai/briefing/briefing.service', () => ({
  generateMeetingBriefing: vi.fn(async () => CONTEUDO),
}))

/** O que a tabela do briefing devolve neste teste. */
let guardado: {
  conteudo: unknown
  base_em: string
  gerado_em: string
  gerado_por: string
} | null = null

/** Até quando o negócio andou, para o cálculo de "envelheceu". */
let mexidoEm = '2026-09-07T09:00:00Z'

let clienteComSessao: Record<string, unknown>
let usuario: string | null = USER_ID
let organizacaoDoPerfil: string | null = ORG_ID
let negocioEhDaOrganizacao = true
let escritas: Array<Record<string, unknown>> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => clienteComSessao),
}))

vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: vi.fn(() => ({
    from: (tabela: string) => {
      if (tabela !== 'deal_briefings') throw new Error(`tabela inesperada: ${tabela}`)
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: guardado, error: null }) }),
        }),
        upsert: async (linha: Record<string, unknown>) => {
          escritas.push(linha)
          return { error: null }
        },
      }
    },
    rpc: async (nome: string) => {
      if (nome === 'negocio_mexido_em') return { data: mexidoEm, error: null }
      return { data: null, error: null }
    },
  })),
}))

vi.mock('@/lib/security/sameOrigin', () => ({
  isAllowedOrigin: vi.fn(() => true),
}))

import { GET, POST } from '@/app/api/ai/briefing/[dealId]/route'
import { generateMeetingBriefing } from '@/lib/ai/briefing/briefing.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function montarCliente() {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: usuario ? { id: usuario } : null },
        error: null,
      })),
    },
    from: vi.fn((tabela: string) => {
      if (tabela === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({
            data: organizacaoDoPerfil ? { organization_id: organizacaoDoPerfil } : null,
            error: null,
          })),
        }
      }
      if (tabela === 'deals') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: negocioEhDaOrganizacao ? { id: DEAL_ID } : null,
            error: null,
          })),
        }
      }
      throw new Error(`tabela inesperada: ${tabela}`)
    }),
  }
}

const chamarGet = (dealId: string) =>
  GET(new Request(`http://localhost/api/ai/briefing/${dealId}`) as never, {
    params: Promise.resolve({ dealId }),
  } as never)

const chamarPost = (dealId: string) =>
  POST(new Request(`http://localhost/api/ai/briefing/${dealId}`, { method: 'POST' }) as never, {
    params: Promise.resolve({ dealId }),
  } as never)

beforeEach(() => {
  vi.clearAllMocks()
  usuario = USER_ID
  organizacaoDoPerfil = ORG_ID
  negocioEhDaOrganizacao = true
  guardado = null
  mexidoEm = '2026-09-07T09:00:00Z'
  escritas = []
  clienteComSessao = montarCliente()
})

// ---------------------------------------------------------------------------

describe('quem pode pedir', () => {
  it('recusa dealId que não é UUID', async () => {
    const res = await chamarGet('nao-e-uuid')
    expect(res.status).toBe(400)
  })

  it('recusa quem não está autenticado', async () => {
    usuario = null
    expect((await chamarGet(DEAL_ID)).status).toBe(401)
  })

  it('recusa perfil sem organização', async () => {
    organizacaoDoPerfil = null
    expect((await chamarGet(DEAL_ID)).status).toBe(404)
  })

  // Multi-inquilino: o negócio de outra empresa não existe para quem pede.
  it('recusa negócio de outra organização', async () => {
    negocioEhDaOrganizacao = false
    expect((await chamarGet(DEAL_ID)).status).toBe(404)
  })

  it('POST recusa origem não permitida', async () => {
    const { isAllowedOrigin } = await import('@/lib/security/sameOrigin')
    vi.mocked(isAllowedOrigin).mockReturnValueOnce(false)
    expect((await chamarPost(DEAL_ID)).status).toBe(403)
  })
})

describe('GET: ler não gasta IA', () => {
  // É a razão de existir da mudança. Se alguém religar a geração no GET, a tela
  // continua igual e o custo volta em silêncio.
  it('nunca chama a IA, nem quando não há briefing guardado', async () => {
    const res = await chamarGet(DEAL_ID)
    const corpo = await res.json()

    expect(res.status).toBe(200)
    expect(corpo.existe).toBe(false)
    expect(generateMeetingBriefing).not.toHaveBeenCalled()
  })

  it('"ainda não existe" responde 200, não 404', async () => {
    // A tela precisa distinguir "não existe" de erro para oferecer o botão de
    // gerar em vez de mostrar vermelho.
    const res = await chamarGet(DEAL_ID)
    expect(res.status).toBe(200)
  })

  it('devolve o que está guardado', async () => {
    guardado = {
      conteudo: CONTEUDO,
      base_em: '2026-09-07T09:00:00Z',
      gerado_em: '2026-09-07T09:05:00Z',
      gerado_por: 'rotina',
    }

    const corpo = await (await chamarGet(DEAL_ID)).json()
    expect(corpo.existe).toBe(true)
    expect(corpo.conteudo.dealTitle).toBe('Projeto X')
    expect(corpo.geradoPor).toBe('rotina')
    expect(generateMeetingBriefing).not.toHaveBeenCalled()
  })
})

describe('GET: quando o briefing envelheceu', () => {
  it('negócio andou depois: desatualizado', async () => {
    guardado = {
      conteudo: CONTEUDO,
      base_em: '2026-09-07T09:00:00Z',
      gerado_em: '2026-09-07T09:00:00Z',
      gerado_por: 'pessoa',
    }
    mexidoEm = '2026-09-07T11:00:00Z'

    const corpo = await (await chamarGet(DEAL_ID)).json()
    expect(corpo.desatualizado).toBe(true)
  })

  it('nada aconteceu depois: continua valendo', async () => {
    guardado = {
      conteudo: CONTEUDO,
      base_em: '2026-09-07T11:00:00Z',
      gerado_em: '2026-09-07T11:00:00Z',
      gerado_por: 'pessoa',
    }
    mexidoEm = '2026-09-07T11:00:00Z'

    const corpo = await (await chamarGet(DEAL_ID)).json()
    expect(corpo.desatualizado).toBe(false)
  })
})

describe('POST: gerar é deliberado', () => {
  it('chama a IA e guarda o resultado', async () => {
    const corpo = await (await chamarPost(DEAL_ID)).json()

    expect(generateMeetingBriefing).toHaveBeenCalledTimes(1)
    expect(corpo.existe).toBe(true)
    expect(escritas).toHaveLength(1)
    expect(escritas[0]).toMatchObject({
      deal_id: DEAL_ID,
      organization_id: ORG_ID,
      gerado_por: 'pessoa',
    })
  })

  // O base_em sai de antes da chamada da IA: se uma mensagem chegar durante a
  // geração, o briefing não sabe dela, e marcar como se soubesse esconderia
  // exatamente a informação nova.
  it('marca o briefing com o estado de ANTES da geração', async () => {
    mexidoEm = '2026-09-07T09:00:00Z'
    await chamarPost(DEAL_ID)
    expect(escritas[0].base_em).toBe('2026-09-07T09:00:00Z')
  })

  it('falta de configuração de IA é 400, não 500', async () => {
    vi.mocked(generateMeetingBriefing).mockRejectedValueOnce(
      new Error('AI not configured for this organization')
    )
    expect((await chamarPost(DEAL_ID)).status).toBe(400)
  })

  it('erro inesperado é 500', async () => {
    vi.mocked(generateMeetingBriefing).mockRejectedValueOnce(new Error('deu ruim'))
    expect((await chamarPost(DEAL_ID)).status).toBe(500)
  })
})
