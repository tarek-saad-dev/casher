import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import {
  listBranchesForPartnerAssignment,
  listPartnerUsersWithBranches,
} from '@/lib/branch/partnerHomeBranch';

export const runtime = 'nodejs';

/**
 * GET /api/admin/partners
 * Partner login users + their home/default branch links.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!isAuthResult(auth)) return auth;

    const [partners, branches] = await Promise.all([
      listPartnerUsersWithBranches(),
      listBranchesForPartnerAssignment(),
    ]);

    return NextResponse.json({ partners, branches });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/partners] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
