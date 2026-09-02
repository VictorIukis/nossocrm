/**
 * Confere se uma chave de IA funciona, antes de guardar.
 *
 * Feito no servidor de proposito. A versao anterior chamava a API do Google
 * direto do navegador, o que tem dois problemas: a chave passeia pelo cliente, e
 * com a Anthropic nem funcionaria, porque o navegador bloqueia a chamada por
 * politica de origem.
 *
 * Aqui a chave vai do formulario ao nosso servidor, que e para onde ela ia de
 * qualquer jeito ao ser salva, e so ele fala com o provedor.
 */

import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { normalizarModelo } from '@/lib/ai/defaults';

export const runtime = 'nodejs';

function json<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ valid: false, error: 'Origem não permitida' }, 403);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ valid: false, error: 'Não autenticado' }, 401);

  // Só administrador conecta provedor de IA da organização.
  const { data: perfil } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (perfil?.role !== 'admin') return json({ valid: false, error: 'Sem permissão' }, 403);

  const corpo = await req.json().catch(() => null) as
    { apiKey?: string; provider?: string; model?: string } | null;

  const chave = corpo?.apiKey?.trim();
  const provedor = corpo?.provider === 'google' ? 'google' : 'anthropic';

  if (!chave || chave.length < 10) {
    return json({ valid: false, error: 'Chave muito curta' });
  }

  // Ao trocar de provedor, o modelo antigo continua salvo no banco e chega aqui.
  // Sem esta linha, a chave da Anthropic seria testada contra um modelo do
  // Google e o "modelo nao encontrado" apareceria como chave invalida.
  const modelo = normalizarModelo(provedor, corpo?.model);

  try {
    if (provedor === 'anthropic') {
      // Uma mensagem minima e o teste mais barato possivel: 1 token de saida.
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': chave,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'oi' }],
        }),
      });

      if (r.ok) return json({ valid: true });

      // 429 significa chave boa que bateu no limite de uso, e nao chave ruim.
      if (r.status === 429) return json({ valid: true });

      const erro = await r.json().catch(() => null) as { error?: { message?: string; type?: string } } | null;

      if (r.status === 401) return json({ valid: false, error: 'Chave recusada pela Anthropic.' });
      if (r.status === 403) return json({ valid: false, error: 'Chave sem permissão para este modelo.' });
      if (r.status === 404) {
        return json({ valid: false, error: `Modelo "${modelo}" não existe nesta conta.` });
      }
      return json({ valid: false, error: erro?.error?.message || `Anthropic respondeu ${r.status}.` });
    }

    // Google, mantido para quem ainda usar Gemini.
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${chave}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'oi' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      }
    );

    if (r.ok || r.status === 429) return json({ valid: true });
    const erro = await r.json().catch(() => null) as { error?: { message?: string } } | null;
    return json({ valid: false, error: erro?.error?.message || `Google respondeu ${r.status}.` });
  } catch (e) {
    return json({
      valid: false,
      error: e instanceof Error ? e.message : 'Não foi possível falar com o provedor.',
    });
  }
}
