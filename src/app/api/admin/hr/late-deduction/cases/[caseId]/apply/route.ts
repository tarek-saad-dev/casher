import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  LateDeductionActionError,
  applyManagerLatePenalty,
} from '@/lib/hr/late-deduction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ caseId: string }> };

/** POST — manager confirms manual late penalty */
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { caseId: raw } = await ctx.params;
    const caseId = Number(raw);
    if (!(caseId > 0)) {
      return NextResponse.json({ ok: false, error: 'caseId غير صالح' }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const amount = Number(body.amount);
    const notes = typeof body.notes === 'string' ? body.notes : null;

    const result = await applyManagerLatePenalty({
      caseId,
      amount,
      notes,
      userId: auth.userId,
    });
    return NextResponse.json({ ok: true, case: result });
  } catch (err) {
    if (err instanceof LateDeductionActionError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[late-deduction/apply]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
