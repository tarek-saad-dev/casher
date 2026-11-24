import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

const MAX_LEN = 300;

function clip(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_LEN) : '';
}

/**
 * POST /api/route-access/report
 *
 * Receives would-be page-access denials from RouteAccessGate (report mode) and
 * writes one structured server log line per event. No DB writes: the goal is
 * to find users whose page grants are missing before enforcement is enabled.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!isAuthResult(auth)) return auth;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const required = Array.isArray(body.required)
    ? body.required.filter((r): r is string => typeof r === 'string').slice(0, 5).map(clip)
    : [];

  console.warn(
    '[route-access]',
    JSON.stringify({
      mode: clip(body.mode) || 'report',
      tenantId: auth.tenantId,
      userId: auth.userId,
      userName: auth.userName,
      roles: auth.roles,
      path: clip(body.path),
      search: clip(body.search),
      reason: clip(body.reason),
      required,
    }),
  );

  return NextResponse.json({ ok: true });
}
