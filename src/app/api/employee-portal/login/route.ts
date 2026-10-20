import { NextRequest, NextResponse } from 'next/server';
import { loginEmployee, logoutEmployee } from '@/lib/employee-portal/auth';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 415 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 2048) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 413 });
    const body = JSON.parse(raw) as { username?: unknown; password?: unknown };
    if (typeof body.username !== 'string' || typeof body.password !== 'string' ||
      !body.username.trim() || body.username.length > 100 || !body.password || body.password.length > 256) {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
    }
    const ok = await loginEmployee(body.username.trim(), body.password);
    return NextResponse.json(ok ? { ok: true } : { error: 'INVALID_CREDENTIALS' }, { status: ok ? 200 : 401 });
  } catch (err) {
    if (err instanceof SyntaxError) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
    console.error('[employee-portal/login] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'UNAVAILABLE' }, { status: 503 });
  }
}
export async function DELETE() {
  await logoutEmployee();
  return NextResponse.json({ ok: true });
}
