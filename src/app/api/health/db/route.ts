import { NextResponse } from 'next/server';
import { getPool, sql, getUserFriendlyError } from '@/lib/db';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';

export const runtime = 'nodejs';

// GET /api/health/db — Database connectivity check (admin only; exposes server metadata)
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const startTime = Date.now();

  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT 1 as healthcheck,
             @@VERSION as version,
             DB_NAME() as dbName,
             @@SERVERNAME as serverName
    `);
    const duration = Date.now() - startTime;
    const row = result.recordset[0] || {};

    // Temporary A/B identity (no secrets): confirms which DB the live pool hit.
    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
      responseTimeMs: duration,
      serverVersion: row.version || 'unknown',
      dbName: row.dbName || null,
      serverName: row.serverName || null,
      envServer: process.env.DB_SERVER || null,
      envDatabase: process.env.DB_DATABASE || process.env.DB_NAME || null,
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
