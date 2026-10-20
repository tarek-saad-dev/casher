import { NextRequest, NextResponse } from 'next/server';
import { changeEmployeePassword } from '@/lib/employee-portal/auth';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'INVALID_REQUEST' }, {status:415});
  try {
    const body = await request.json() as { current?: unknown; next?: unknown };
    if (typeof body.current !== 'string' || typeof body.next !== 'string') return NextResponse.json({error:'INVALID_INPUT'},{status:400});
    const ok = await changeEmployeePassword(body.current,body.next);
    return NextResponse.json(ok ? {ok:true, relogin:true} : {error:'PASSWORD_CHANGE_FAILED'}, {status:ok?200:400});
  } catch { return NextResponse.json({error:'INVALID_REQUEST'},{status:400}); }
}
