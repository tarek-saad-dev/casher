import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { getCurrentDbTarget, getDbConnectionInfo } from '@/lib/db';
import { categorizeDbHost } from '@/lib/db/benchmarkDbLatency';

export type DbPathKind =
  | 'loopback_direct'
  | 'loopback_forwarded'
  | 'private_lan'
  | 'public_same_host'
  | 'public_remote'
  | 'azure_sql'
  | 'unknown';

export type DbTopologyReport = {
  measuredAt: string;
  runtime: {
    hostname: string;
    platform: string;
    nodeVersion: string;
    nodeEnv: string | null;
    cwd: string;
    pid: number;
    likelyProduction: boolean;
    likelyVpsAppHost: boolean;
  };
  processContext: {
    systemdUnit: string | null;
    invokedByNpmScript: string | null;
  };
  envFiles: {
    dotEnv: boolean;
    dotEnvLocal: boolean;
    loadedPattern: string;
  };
  effectiveConfig: {
    dbTarget: string;
    server: string;
    port: number | null;
    database: string;
    encrypt: boolean | null;
    trustServerCertificate: boolean | null;
    hostCategory: ReturnType<typeof categorizeDbHost>;
    pathKind: DbPathKind;
    usesForwardedDevPort: boolean;
    configuredUserPresent: boolean;
  };
  productionSignals: {
    deployAppDir: string;
    casherSystemdUnitExpected: boolean;
    messagingInboxWorkerUnitPresent: boolean;
    messagingOutboxWorkerUnitPresent: boolean;
    sqlServerSystemdDependency: boolean;
  };
  interpretation: {
    isDeveloperTunnelPath: boolean;
    isLikelyProductionDirectSql: boolean;
    recommendedProductionServer: string;
    recommendedProductionPort: number;
    notes: string[];
  };
};

function envFlag(name: string): boolean {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envString(...names: string[]): string {
  for (const name of names) {
    const v = String(process.env[name] || '').trim();
    if (v) return v;
  }
  return '';
}

function envPort(): number | null {
  const raw = envString('LOCAL_DB_PORT', 'DB_PORT', 'CLOUD_DB_PORT');
  const n = Number(raw || '1433');
  return Number.isFinite(n) ? n : null;
}

function classifyPathKind(
  server: string,
  port: number | null,
  localIpAddresses: string[] = [],
): DbPathKind {
  const host = server.toLowerCase();
  const category = categorizeDbHost(server);
  if (/\.database\.windows\.net$/i.test(server)) return 'azure_sql';
  if (category === 'loopback') {
    if (port != null && port !== 1433) return 'loopback_forwarded';
    return 'loopback_direct';
  }
  if (category === 'private_lan') return 'private_lan';
  if (category === 'public_or_remote') {
    if (localIpAddresses.map((ip) => ip.toLowerCase()).includes(host)) return 'public_same_host';
    return 'public_remote';
  }
  return 'unknown';
}

export function classifyDbPathKindForDiagnostics(
  server: string,
  port: number | null,
  localIpAddresses?: string[],
): DbPathKind {
  return classifyPathKind(server, port, localIpAddresses ?? collectLocalIpAddresses());
}

function collectLocalIpAddresses(): string[] {
  const ips: string[] = [];
  for (const net of Object.values(os.networkInterfaces())) {
    for (const iface of net ?? []) {
      if (iface?.address) ips.push(iface.address.toLowerCase());
    }
  }
  return ips;
}

function readSystemdUnit(): string | null {
  return process.env.INVOCATION_ID ? process.env.JOURNAL_STREAM ?? 'systemd' : null;
}

export function diagnoseDbTopology(cwd = process.cwd()): DbTopologyReport {
  const info = getDbConnectionInfo();
  const target = getCurrentDbTarget();
  const active = target === 'local' ? info.local : info.cloud;
  const server = envString('LOCAL_DB_SERVER', 'DB_SERVER', 'CLOUD_DB_SERVER') || active.server;
  const database =
    envString('LOCAL_DB_NAME', 'DB_DATABASE', 'DB_NAME', 'CLOUD_DB_NAME') || active.database;
  const port = envPort();
  const pathKind = classifyPathKind(server, port, collectLocalIpAddresses());
  const usesForwardedDevPort = pathKind === 'loopback_forwarded';
  const hostname = os.hostname();
  const likelyVpsAppHost =
    cwd.startsWith('/home/casher/app') || hostname.toLowerCase().includes('srv');
  const likelyProduction = process.env.NODE_ENV === 'production' || likelyVpsAppHost;

  const notes: string[] = [];
  if (usesForwardedDevPort) {
    notes.push(
      `Configured loopback port ${port} is not the default SQL listener (1433); this is commonly an SSH tunnel or port-forward from a developer machine.`,
    );
  }
  if (pathKind === 'public_same_host') {
    notes.push(
      'Application is configured to reach SQL via this host public IP. If SQL Server runs on the same VPS, prefer 127.0.0.1:<direct-listener-port> to avoid hairpin routing.',
    );
  }
  if (pathKind === 'public_remote') {
    notes.push('Application reaches SQL over a remote/public network path.');
  }
  if (pathKind === 'loopback_direct' && likelyProduction) {
    notes.push('Configured loopback direct SQL path — appropriate when Node and SQL share the host.');
  }

  const deployInbox = fs.existsSync(path.join(cwd, 'deploy', 'messaging-inbox-worker.service'));
  const deployOutbox = fs.existsSync(path.join(cwd, 'deploy', 'messaging-worker.service'));

  return {
    measuredAt: new Date().toISOString(),
    runtime: {
      hostname,
      platform: `${os.type()} ${os.release()}`,
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? null,
      cwd,
      pid: process.pid,
      likelyProduction,
      likelyVpsAppHost,
    },
    processContext: {
      systemdUnit: readSystemdUnit(),
      invokedByNpmScript: process.env.npm_lifecycle_event ?? null,
    },
    envFiles: {
      dotEnv: fs.existsSync(path.join(cwd, '.env')),
      dotEnvLocal: fs.existsSync(path.join(cwd, '.env.local')),
      loadedPattern: '.env then .env.local (override)',
    },
    effectiveConfig: {
      dbTarget: target,
      server,
      port,
      database,
      encrypt:
        envFlag('DB_ENCRYPT') || envFlag('LOCAL_DB_ENCRYPT') || envFlag('CLOUD_DB_ENCRYPT')
          ? true
          : process.env.DB_ENCRYPT === 'false' || process.env.LOCAL_DB_ENCRYPT === 'false'
            ? false
            : null,
      trustServerCertificate:
        envFlag('DB_TRUST_SERVER_CERTIFICATE') || envFlag('DB_TRUST_CERT') || envFlag('LOCAL_DB_TRUST_CERT')
          ? true
          : null,
      hostCategory: categorizeDbHost(server),
      pathKind,
      usesForwardedDevPort,
      configuredUserPresent: Boolean(envString('LOCAL_DB_USER', 'DB_USER', 'CLOUD_DB_USER')),
    },
    productionSignals: {
      deployAppDir: '/home/casher/app',
      casherSystemdUnitExpected: true,
      messagingInboxWorkerUnitPresent: deployInbox,
      messagingOutboxWorkerUnitPresent: deployOutbox,
      sqlServerSystemdDependency: deployInbox || deployOutbox,
    },
    interpretation: {
      isDeveloperTunnelPath: usesForwardedDevPort && !likelyProduction,
      isLikelyProductionDirectSql: pathKind === 'loopback_direct' && likelyProduction,
      recommendedProductionServer: '127.0.0.1',
      recommendedProductionPort: 1433,
      notes,
    },
  };
}
