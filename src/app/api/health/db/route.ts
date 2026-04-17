import { NextResponse } from 'next/server';
import { getPool, sql, getUserFriendlyError } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/health/db — Database connectivity check
export async function GET() {
  const startTime = Date.now();

  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT 1 as healthcheck, @@VERSION as version');
    const duration = Date.now() - startTime;

    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
      responseTimeMs: duration,
      serverVersion: result.recordset[0]?.version || 'unknown',
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const duration = Date.now() - startTime;
    const rawMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[health/db] Database check failed:', rawMessage);

    return NextResponse.json(
      {
        status: 'unhealthy',
        database: 'disconnected',
        responseTimeMs: duration,
        error: getUserFriendlyError(err),
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
