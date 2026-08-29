import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');

function needsSsl(connectionString: string) {
  return !/sslmode=disable/i.test(connectionString);
}

function stripSslModeParam(connectionString: string) {
  // Some drivers/envs treat `sslmode=require` inconsistently. We control SSL via `Client({ ssl })`.
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRetryableConnectError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('ENOTFOUND') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('timeout')
  );
}

/**
 * Conecta com retry/backoff, recriando o Client a cada tentativa.
 * Isso evita o erro: "Client has already been connected. You cannot reuse a client."
 */
async function connectClientWithRetry(
  createClient: () => Client,
  opts?: { maxAttempts?: number; initialDelayMs?: number }
): Promise<Client> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const initialDelayMs = opts?.initialDelayMs ?? 3000;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = createClient();
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      try {
        await client.end().catch(() => undefined);
      } catch {
        // ignore
      }

      if (!isRetryableConnectError(err) || attempt === maxAttempts) {
        throw err;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `[migrations] Conexão falhou (${msg}), tentativa ${attempt}/${maxAttempts}. Aguardando ${Math.round(
          delayMs / 1000
        )}s...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Falha ao conectar ao banco de dados'));
}

async function waitForStorageReady(client: Client, opts?: { timeoutMs?: number; pollMs?: number }) {
  const timeoutMs = typeof opts?.timeoutMs === 'number' ? opts.timeoutMs : 210_000;
  const pollMs = typeof opts?.pollMs === 'number' ? opts?.pollMs : 4_000;
  const t0 = Date.now();

  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await client.query<{ ready: boolean }>(
        `select (to_regclass('storage.buckets') is not null) as ready`
      );
      const ready = Boolean(r?.rows?.[0]?.ready);
      if (ready) return;
    } catch {
      // keep polling on transient errors
    }
    await sleep(pollMs);
  }

  throw new Error(
    'Supabase Storage ainda não está pronto (storage.buckets não existe). Aguarde o projeto terminar de provisionar e tente novamente.'
  );
}

/**
 * Lê a pasta de migrations em ordem de versão.
 *
 * A ordem é a do nome do arquivo (timestamp na frente), que é a mesma
 * convenção do CLI do Supabase. Ordenar por string aqui é correto porque
 * o timestamp tem largura fixa.
 */
function listarMigrations(): { version: string; name: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      // 20251201000000_schema_init.sql -> version 20251201000000
      version: f.split('_')[0],
      name: f,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'),
    }));
}

/**
 * Registra o que já rodou na mesma tabela que o CLI do Supabase usa.
 *
 * Sem isso a instalação não é retomável: se a décima migration falhar, rodar
 * de novo tentaria recriar as nove primeiras e morreria em "already exists".
 * Usar a tabela oficial também deixa um `supabase db push` futuro consistente.
 */
async function jaAplicadas(client: Client): Promise<Set<string>> {
  await client.query('create schema if not exists supabase_migrations');
  await client.query(
    `create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     )`
  );
  const r = await client.query<{ version: string }>(
    'select version from supabase_migrations.schema_migrations'
  );
  return new Set(r.rows.map((x) => x.version));
}

/**
 * Função pública `runSchemaMigration` do projeto.
 *
 * Aplica TODAS as migrations da pasta, e não só a inicial. O instalador
 * original rodava apenas 20251201000000_schema_init.sql, que está congelado
 * em dezembro: um CRM instalado por ele nascia sem o sistema de mensagens,
 * sem ai_pending_evaluations e sem board_ai_config, e as telas dessas partes
 * quebravam no primeiro acesso.
 */
export async function runSchemaMigration(dbUrl: string) {
  const normalizedDbUrl = stripSslModeParam(dbUrl);

  const createClient = () =>
    new Client({
      connectionString: normalizedDbUrl,
      // NOTE: Supabase DB uses TLS; on some networks a MITM/corporate proxy can inject a cert chain
      // that Node doesn't trust. For the installer/migrations step we prefer "no-verify" over failure.
      ssl: needsSsl(dbUrl) ? { rejectUnauthorized: false } : undefined,
    });

  const client = await connectClientWithRetry(createClient, { maxAttempts: 5, initialDelayMs: 3000 });

  try {
    // Never "skip" Storage. We wait until it's ready, then run migrations.
    await waitForStorageReady(client);

    const feitas = await jaAplicadas(client);
    const pendentes = listarMigrations().filter((m) => !feitas.has(m.version));

    console.log(
      `[migrations] ${pendentes.length} pendente(s) de ${listarMigrations().length}`
    );

    for (const m of pendentes) {
      // Cada migration é uma transação própria. Se uma quebrar, as anteriores
      // ficam gravadas e a reexecução continua de onde parou, em vez de
      // recomeçar do zero e bater em "already exists".
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query(
          'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing',
          [m.version, m.name]
        );
        await client.query('commit');
        console.log(`[migrations] ok ${m.name}`);
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Falha na migration ${m.name}: ${msg}`);
      }
    }
  } finally {
    await client.end();
  }
}
