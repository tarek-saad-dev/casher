import { NextRequest, NextResponse } from 'next/server';
import {
  isSystemJobAuthResult,
  requireSystemJobAuth,
} from '@/lib/api-auth';
import { listInboxMessages } from '@/modules/messaging/inbox/application/listInboxMessages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/internal/messaging/inbox
 *
 * Operational inbox inspection (newest first).
 * Auth: Bearer CRON_SECRET or authenticated admin session.
 */
export async function GET(req: NextRequest) {
  const jobAuth = await requireSystemJobAuth(req);
  if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status');
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw == null ? undefined : Number(limitRaw);

    const result = await listInboxMessages({ status, limit });
    return NextResponse.json({
      ok: true,
      items: result.items,
      limit: result.limit,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/internal/messaging/inbox] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
