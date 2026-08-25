import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { requireActiveBranchContext } from '@/lib/branch/context';

export type WhatsAppTemplateAdminContext = {
  userId: number;
  branchId: number;
};

export async function requireWhatsAppTemplateAdmin(): Promise<
  WhatsAppTemplateAdminContext | NextResponse
> {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const branch = await requireActiveBranchContext();
  if (branch instanceof NextResponse) return branch;

  return {
    userId: auth.userId,
    branchId: branch.branchId,
  };
}

export function isWhatsAppTemplateAdmin(
  value: WhatsAppTemplateAdminContext | NextResponse,
): value is WhatsAppTemplateAdminContext {
  return !(value instanceof NextResponse);
}
