import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export type PublicApiAuthResult =
  | { ok: true; organizationId: string; organizationName: string; apiKeyId: string; apiKeyPrefix: string }
  | { ok: false; status: number; body: { error: string; code?: string } };

/**
 * Cliente de servico para conferir a chave de API.
 *
 * Antes usava a chave anonima, e isso tinha dois problemas.
 *
 * O pratico: `validate_api_key` nao e executavel pelo papel `anon`, entao a
 * conferencia falhava com "permission denied" e TODA chamada a API publica
 * seria recusada como chave invalida -- inclusive com a chave certa. Ninguem
 * tinha sentido ainda so porque nenhuma chave havia sido criada.
 *
 * O de fundo: se fosse executavel por anon, qualquer pessoa poderia bater no
 * endpoint REST do banco tentando adivinhar chave. A conferencia e trabalho de
 * servidor, e a credencial de servidor e a certa para ela.
 */
function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createSupabaseClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function authPublicApi(request: Request): Promise<PublicApiAuthResult> {
  const token = request.headers.get('x-api-key') || '';
  if (!token.trim()) {
    return { ok: false, status: 401, body: { error: 'Missing X-Api-Key', code: 'AUTH_MISSING' } };
  }

  const sb = getServiceSupabase();
  if (!sb) {
    return { ok: false, status: 500, body: { error: 'Supabase not configured', code: 'SERVER_NOT_CONFIGURED' } };
  }

  type ValidateApiKeyRow = {
    api_key_id: string;
    api_key_prefix: string;
    organization_id: string;
    organization_name: string;
  };

  // Supabase RPC return types are not strongly typed here (no generated Database types),
  // so we validate the shape defensively.
  const { data, error } = await sb.rpc('validate_api_key', { p_token: token }).maybeSingle();
  const row = (data ?? null) as ValidateApiKeyRow | null;
  if (
    error ||
    !row ||
    typeof row.organization_id !== 'string' ||
    !row.organization_id.trim() ||
    typeof row.organization_name !== 'string' ||
    typeof row.api_key_id !== 'string' ||
    typeof row.api_key_prefix !== 'string'
  ) {
    return { ok: false, status: 401, body: { error: 'Invalid API key', code: 'AUTH_INVALID' } };
  }

  return {
    ok: true,
    apiKeyId: row.api_key_id,
    apiKeyPrefix: row.api_key_prefix,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
}

