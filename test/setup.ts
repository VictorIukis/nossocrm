import { loadEnvFile } from './helpers/env';
import { cleanupFixtures } from './helpers/fixtures';
import { getRunId } from './helpers/runId';

// Next.js server/client boundary helpers.
// In runtime do Next, `server-only` previne import acidental em Client Components.
// Em testes Node (Vitest), queremos que seja um no-op.
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

/**
 * Test noise suppression (targeted).
 *
 * These are known noisy logs from third-party libs (Supabase) and from our
 * integration-style tests (expected 4xx on negative-path assertions).
 *
 * We DO NOT want these to pollute CI output; failures are still asserted by tests.
 */
const SUPPRESSED_CONSOLE_PATTERNS: RegExp[] = [
  /Multiple GoTrueClient instances detected/i,
  /\[supabase\]\s+Not configured - auth will not work/i,
];

const SUPPRESSED_STDERR_PATTERNS: RegExp[] = [
  // happy-dom/network logging style lines that are expected in negative-path tests
  /^GET https:\/\/.*\s406\s\(Not Acceptable\)\s*$/m,
  /^DELETE https:\/\/.*\s400\s\(Bad Request\)\s*$/m,
];

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  // Our tools log with "[AI] ..." — keep it opt-in during tests.
  if (msg.startsWith('[AI]')) return;
  originalConsoleLog(...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  if (SUPPRESSED_CONSOLE_PATTERNS.some((r) => r.test(msg))) return;
  originalConsoleWarn(...args);
};

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  if (SUPPRESSED_CONSOLE_PATTERNS.some((r) => r.test(msg))) return;
  originalConsoleError(...args);
};

const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: any, ...rest: any[]) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  if (SUPPRESSED_STDERR_PATTERNS.some((r) => r.test(text))) {
    return true;
  }
  return originalStderrWrite(chunk, ...rest);
}) as any;

// Prefer envs from THIS project folder so crmia-next can be moved to its own repo.
// (When running inside the monorepo, we keep the old root .env as a fallback.)
loadEnvFile(new URL('../.env', import.meta.url).pathname);
loadEnvFile(new URL('../.env.local', import.meta.url).pathname, { override: true });

// Monorepo fallback (no override)
loadEnvFile(new URL('../../.env', import.meta.url).pathname);
loadEnvFile(new URL('../../.env.local', import.meta.url).pathname);

// Best-effort cleanup: if a prior run crashed, make a quick attempt to remove leftovers.
// This won't block tests if cleanup fails (it can fail due to missing tables in dev).
beforeAll(async () => {
  const runId = getRunId('next-ai');
  try {
    await cleanupFixtures(runId);
  } catch {
    // ignore
  }
});

afterAll(async () => {
  const runId = getRunId('next-ai');
  try {
    await cleanupFixtures(runId);
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Nenhum teste fala com a rede de fora
// ---------------------------------------------------------------------------
//
// A suíte imprimia dois `ENOTFOUND test.supabase.co` em toda execução. Ninguém
// falhava por isso, e é justamente o problema: erro que aparece sempre e não
// quebra nada ensina a pessoa a passar o olho pela saída dos testes sem ler. O
// dia em que um erro de verdade aparecer ali, ele vai parecer com o de sempre.
//
// Em vez de caçar a chamada, a suíte passa a recusar rede externa e a dizer
// quem tentou. Endereço local continua liberado: o teste que confere o formato
// das requisições do Chatwoot sobe um servidor em 127.0.0.1 de propósito.
const fetchOriginal = globalThis.fetch;

const ENDERECO_LOCAL = /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i;

globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof entrada === 'string'
      ? entrada
      : entrada instanceof URL
        ? entrada.toString()
        : (entrada as Request).url;

  if (ENDERECO_LOCAL.test(url)) return fetchOriginal(entrada as RequestInfo, init);

  throw new Error(
    `Teste tentou falar com a rede: ${url}\n` +
      'Rede externa está bloqueada na suíte de propósito. Use vi.mock no módulo ' +
      'que faz a chamada, ou suba um servidor local (127.0.0.1), como faz ' +
      'test/chatwootAbrirConversa.test.ts.'
  );
}) as typeof fetch;
