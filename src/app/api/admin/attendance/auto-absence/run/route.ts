/**
 * POST /api/admin/attendance/auto-absence/run
 * Admin session OR CRON_SECRET Bearer (system job).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSystemJobAuth } from '@/lib/api-auth';
import { runAutoAbsenceScan } from '@/lib/hr/attendance/autoAbsence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = await requireSystemJobAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await runAutoAbsenceScan({
      businessDate: typeof body.businessDate === 'string' ? body.businessDate : undefined,
      branchId: Number(body.branchId) > 0 ? Number(body.branchId) : undefined,
    });
    return NextResponse.json({ ok: true, via: auth.via, ...result });
  } catch (err) {
    console.error('[auto-absence/run]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل فحص الغياب التلقائي' },
      { status: 500 },
    );
  }
}
