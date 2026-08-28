import os from 'node:os';
import { getCurrentDbTarget, getDbConnectionInfo, getPool, sql } from '@/lib/db';
import { percentile } from '@/modules/messaging/conversation/observability/inboxProcessorPerf';

export type DbHostCategory =
  | 'loopback'
  | 'private_lan'
  | 'azure_sql'
  | 'public_or_remote'
  | 'unknown';

export type DbLatencyBenchmarkResult = {
  connection: {
    target: string;
    server: string;
    database: string;
    port: number | null;
    hostCategory: DbHostCategory;
    authMode: 'trusted/windows' | 'sql';
    clientHost: string;
  };
  coldFirstSelect1Ms: number;
  poolConnectMs: number;
  warmSelect1: { count: number; p50: number | null; p95: number | null; min: number | null; max: number | null };
  warmUtc: { count: number; p50: number | null; p95: number | null; min: number | null; max: number | null };
  poolAcquisition: { count: number; p50: number | null; p95: number | null };
  transaction: {
    beginCommitP50: number | null;
    beginCommitP95: number | null;
    beginQueryCommitP50: number | null;
    beginQueryCommitP95: number | null;
  };
  driver: {
    package: 'mssql';
    implementation: 'tedious' | 'msnodesqlv8';
  };
};

function normalizeServerHost(server: string): string {
  const raw = String(server || '').trim();
  if (!raw) return raw;
  if (raw.startsWith('.\\')) return `${os.hostname()}\\${raw.slice(2)}`;
  if (raw === '.' || raw.toLowerCase() === '(local)') return '127.0.0.1';
  const host = raw.split('\\')[0]?.split(',')[0]?.trim() ?? raw;
  return host.toLowerCase();
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  return false;
}

export function categorizeDbHost(server: string): DbHostCategory {
  const host = normalizeServerHost(server);
  if (!host) return 'unknown';
  if (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host === '(local)'
    || host.startsWith('127.')
  ) {
    return 'loopback';
  }
  if (/\.database\.windows\.net$/i.test(server)) return 'azure_sql';
  if (isPrivateIpv4(host)) return 'private_lan';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return 'public_or_remote';
  if (host.includes('.')) return 'public_or_remote';
  return 'unknown';
}

async function timeMs(fn: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await fn();
  return Math.max(0, Math.round(performance.now() - started));
}

export async function benchmarkDbLatency(options?: {
  warmSamples?: number;
}): Promise<DbLatencyBenchmarkResult> {
  const warmSamples = Math.max(10, options?.warmSamples ?? 40);
  const info = getDbConnectionInfo();
  const target = getCurrentDbTarget();
  const active = target === 'local' ? info.local : info.cloud;
  const server = String(active.server || '');
  const database = String(active.database || '');
  const portRaw = process.env.LOCAL_DB_PORT || process.env.DB_PORT || process.env.CLOUD_DB_PORT;
  const port = portRaw ? Number(portRaw) : null;
  const authMode =
    !String(process.env.LOCAL_DB_USER || process.env.DB_USER || '').trim()
    && categorizeDbHost(server) !== 'azure_sql'
      ? 'trusted/windows'
      : 'sql';

  const connectStarted = performance.now();
  const pool = await getPool();
  const poolConnectMs = Math.max(0, Math.round(performance.now() - connectStarted));

  const coldSelectStarted = performance.now();
  await pool.request().query('SELECT 1 AS n');
  const coldFirstSelect1Ms = Math.max(0, Math.round(performance.now() - coldSelectStarted));

  const select1Samples: number[] = [];
  const utcSamples: number[] = [];
  const poolAcquireSamples: number[] = [];

  for (let i = 0; i < warmSamples; i += 1) {
    const acquireMs = await timeMs(async () => {
      await getPool();
    });
    poolAcquireSamples.push(acquireMs);

    const selectMs = await timeMs(async () => {
      await pool.request().query('SELECT 1 AS n');
    });
    select1Samples.push(selectMs);

    const utcMs = await timeMs(async () => {
      await pool.request().query('SELECT SYSUTCDATETIME() AS utc');
    });
    utcSamples.push(utcMs);
  }

  const beginCommitSamples: number[] = [];
  const beginQueryCommitSamples: number[] = [];
  for (let i = 0; i < Math.min(20, warmSamples); i += 1) {
    beginCommitSamples.push(
      await timeMs(async () => {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        await tx.commit();
      }),
    );

    beginQueryCommitSamples.push(
      await timeMs(async () => {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        await new sql.Request(tx).query('SELECT 1 AS n');
        await tx.commit();
      }),
    );
  }

  return {
    connection: {
      target,
      server: normalizeServerHost(server) || server,
      database,
      port: Number.isFinite(port) ? port : null,
      hostCategory: categorizeDbHost(server),
      authMode,
      clientHost: os.hostname(),
    },
    coldFirstSelect1Ms,
    poolConnectMs,
    warmSelect1: {
      count: select1Samples.length,
      p50: percentile(select1Samples, 50),
      p95: percentile(select1Samples, 95),
      min: select1Samples.length ? Math.min(...select1Samples) : null,
      max: select1Samples.length ? Math.max(...select1Samples) : null,
    },
    warmUtc: {
      count: utcSamples.length,
      p50: percentile(utcSamples, 50),
      p95: percentile(utcSamples, 95),
      min: utcSamples.length ? Math.min(...utcSamples) : null,
      max: utcSamples.length ? Math.max(...utcSamples) : null,
    },
    poolAcquisition: {
      count: poolAcquireSamples.length,
      p50: percentile(poolAcquireSamples, 50),
      p95: percentile(poolAcquireSamples, 95),
    },
    transaction: {
      beginCommitP50: percentile(beginCommitSamples, 50),
      beginCommitP95: percentile(beginCommitSamples, 95),
      beginQueryCommitP50: percentile(beginQueryCommitSamples, 50),
      beginQueryCommitP95: percentile(beginQueryCommitSamples, 95),
    },
    driver: {
      package: 'mssql',
      implementation: String((sql as { MSNODESQLV8?: unknown }).MSNODESQLV8 ?? '') ? 'msnodesqlv8' : 'tedious',
    },
  };
}
