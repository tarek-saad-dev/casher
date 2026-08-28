import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { fillYoussefMohamedGleemAugust } from '@/lib/hr/opsFillYoussefMohamedGleemAugust';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** POST — dev admin only: fill يوسف محمد Gleem August attendance + payroll + ledger */
export async function POST() {
  const auth = await requireDevelopmentAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const result = await fillYoussefMohamedGleemAugust();
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/dev/youssef-mohamed-fill] error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
