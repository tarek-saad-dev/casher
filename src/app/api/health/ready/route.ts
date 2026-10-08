import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { assertSessionSecretConfigured } from '@/lib/session';
import { createLogger } from '@/lib/observability/logger';
import { evaluateReadiness } from '@/lib/observability/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/health/ready — public readiness probe: 200 when the app can serve traffic, else 503
export async function GET() {
  const report = await evaluateReadiness({
    database: async () => {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
    },
    sessionSecret: async () => {
      assertSessionSecretConfigured();
    },
  });

  if (report.status !== 'ready') {
    createLogger({ scope: 'health/ready' }).warn('not_ready', {
      failed: report.checks.filter((c) => !c.ok).map((c) => c.name),
    });
  }

  return NextResponse.json(report, {
    status: report.status === 'ready' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
