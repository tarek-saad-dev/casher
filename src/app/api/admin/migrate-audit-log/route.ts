/**
 * POST /api/admin/migrate-audit-log
 * Runs the sensitive audit log migration (idempotent).
 * Protected: platform operator only (global schema/data maintenance).
 */
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requirePlatformOperator } from '@/lib/api-auth';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const operator = await requirePlatformOperator();
    if (operator instanceof NextResponse) return operator;

    const db = await getPool();
    const sqlPath = join(process.cwd(), 'src', 'lib', 'migrations', 'sensitive-audit-log.sql');
    const sqlText = readFileSync(sqlPath, 'utf-8');
    await db.request().batch(sqlText);

    return NextResponse.json({ ok: true, message: 'Audit log migration complete' });
  } catch (err) {
    console.error('[migrate-audit-log]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Migration failed' },
      { status: 500 }
    );
  }
}
