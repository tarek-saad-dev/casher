import tediousSql from 'mssql';
import { percentile } from '@/modules/messaging/conversation/observability/inboxProcessorPerf';
import { categorizeDbHost } from '@/lib/db/benchmarkDbLatency';

export type DbPathBenchmarkInput = {
  label: string;
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  warmSamples?: number;
};

export type DbPathBenchmarkResult = {
  label: string;
  server: string;
  port: number;
  database: string;
  hostCategory: ReturnType<typeof categorizeDbHost>;
  driver: 'tedious';
  reachable: boolean;
  error: string | null;
  coldConnectMs: number | null;
  coldSelect1Ms: number | null;
  warmSelect1: { count: number; p50: number | null; p95: number | null };
  warmTransaction: { count: number; p50: number | null; p95: number | null };
};

async function timeMs(fn: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await fn();
  return Math.max(0, Math.round(performance.now() - started));
}

export async function benchmarkDbPath(
  input: DbPathBenchmarkInput,
): Promise<DbPathBenchmarkResult> {
  const warmSamples = Math.max(10, input.warmSamples ?? 40);
  const config: tediousSql.config = {
    server: input.server,
    port: input.port,
    database: input.database,
    user: input.user,
    password: input.password,
    options: {
      encrypt: input.encrypt ?? false,
      trustServerCertificate: input.trustServerCertificate ?? true,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 5000 },
  };

  let pool: tediousSql.ConnectionPool | null = null;
  try {
    const connectStarted = performance.now();
    pool = await new tediousSql.ConnectionPool(config).connect();
    const coldConnectMs = Math.max(0, Math.round(performance.now() - connectStarted));

    const coldSelectStarted = performance.now();
    await pool.request().query('SELECT 1 AS n');
    const coldSelect1Ms = Math.max(0, Math.round(performance.now() - coldSelectStarted));

    const select1: number[] = [];
    const txSamples: number[] = [];
    for (let i = 0; i < warmSamples; i += 1) {
      select1.push(
        await timeMs(async () => {
          await pool!.request().query('SELECT 1 AS n');
        }),
      );
    }
    for (let i = 0; i < Math.min(20, warmSamples); i += 1) {
      txSamples.push(
        await timeMs(async () => {
          const tx = new tediousSql.Transaction(pool!);
          await tx.begin();
          await new tediousSql.Request(tx).query('SELECT 1 AS n');
          await tx.commit();
        }),
      );
    }

    await pool.close();
    return {
      label: input.label,
      server: input.server,
      port: input.port,
      database: input.database,
      hostCategory: categorizeDbHost(input.server),
      driver: 'tedious',
      reachable: true,
      error: null,
      coldConnectMs,
      coldSelect1Ms,
      warmSelect1: {
        count: select1.length,
        p50: percentile(select1, 50),
        p95: percentile(select1, 95),
      },
      warmTransaction: {
        count: txSamples.length,
        p50: percentile(txSamples, 50),
        p95: percentile(txSamples, 95),
      },
    };
  } catch (err) {
    if (pool) {
      try {
        await pool.close();
      } catch {
        /* ignore */
      }
    }
    return {
      label: input.label,
      server: input.server,
      port: input.port,
      database: input.database,
      hostCategory: categorizeDbHost(input.server),
      driver: 'tedious',
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
      coldConnectMs: null,
      coldSelect1Ms: null,
      warmSelect1: { count: 0, p50: null, p95: null },
      warmTransaction: { count: 0, p50: null, p95: null },
    };
  }
}

export function resolveDbCredentialsFromEnv(): {
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
} {
  const database =
    process.env.LOCAL_DB_NAME ||
    process.env.DB_DATABASE ||
    process.env.DB_NAME ||
    process.env.CLOUD_DB_NAME ||
    '';
  const user =
    process.env.LOCAL_DB_USER || process.env.DB_USER || process.env.CLOUD_DB_USER || '';
  const password =
    process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || process.env.CLOUD_DB_PASSWORD || '';
  const encrypt =
    process.env.DB_ENCRYPT === 'true' ||
    process.env.LOCAL_DB_ENCRYPT === 'true' ||
    process.env.CLOUD_DB_ENCRYPT === 'true';
  const trustServerCertificate =
    process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' ||
    process.env.DB_TRUST_CERT === 'true' ||
    process.env.LOCAL_DB_TRUST_CERT === 'true' ||
    process.env.CLOUD_DB_TRUST_CERT === 'true' ||
    true;
  return { database, user, password, encrypt, trustServerCertificate };
}

export function buildCandidateDbPathsFromEnv(): DbPathBenchmarkInput[] {
  const creds = resolveDbCredentialsFromEnv();
  const configuredServer =
    process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || process.env.CLOUD_DB_SERVER || '127.0.0.1';
  const configuredPort = Number(
    process.env.LOCAL_DB_PORT || process.env.DB_PORT || process.env.CLOUD_DB_PORT || '1433',
  );

  const candidates: DbPathBenchmarkInput[] = [
    {
      label: 'configured',
      server: configuredServer,
      port: configuredPort,
      ...creds,
    },
  ];

  const add = (label: string, server: string, port: number) => {
    if (!candidates.some((c) => c.server === server && c.port === port)) {
      candidates.push({ label, server, port, ...creds });
    }
  };

  add('loopback_1433', '127.0.0.1', 1433);
  if (configuredPort !== 14330) add('loopback_14330', '127.0.0.1', 14330);
  add('localhost_1433', 'localhost', 1433);

  const publicVps = process.env.DB_BENCHMARK_PUBLIC_VPS_IP?.trim();
  if (publicVps) add('public_vps_ip_1433', publicVps, 1433);

  return candidates;
}
