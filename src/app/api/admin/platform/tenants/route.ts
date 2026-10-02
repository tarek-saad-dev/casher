import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { TenantOnboardingError } from '@/platform/onboarding/errors';
import {
  getTenantByCode,
  listTenants,
  provisionTenant,
} from '@/platform/onboarding/provisionTenant';
import { rejectSystemControlledFields } from '@/platform/onboarding/validation';

export const runtime = 'nodejs';

const FORBIDDEN_BODY_FIELDS = [
  'tenantId',
  'TenantId',
  'locationId',
  'LocationId',
  'membershipId',
  'MembershipId',
  'legacyBranchId',
  'legacyUserId',
  'status',
  'entitlements',
];

function onboardingErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof TenantOnboardingError)) return null;
  return NextResponse.json(
    { error: err.message, code: err.code },
    { status: err.status },
  );
}

/** GET /api/admin/platform/tenants — minimal tenant listing for platform operators. */
export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const tenants = await listTenants();
  return NextResponse.json({ tenants });
}

/** POST /api/admin/platform/tenants — create a new salon tenant onboarding bundle. */
export async function POST(req: NextRequest) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    rejectSystemControlledFields(body, FORBIDDEN_BODY_FIELDS);

    const result = await provisionTenant(
      {
        tenantCode: String(body.tenantCode ?? ''),
        tenantDisplayName: String(body.tenantDisplayName ?? body.tenantName ?? ''),
        defaultTimezone: String(body.defaultTimezone ?? 'Africa/Cairo'),
        ownerUserName: String(body.ownerUserName ?? body.ownerDisplayName ?? ''),
        ownerLoginName: String(body.ownerLoginName ?? body.ownerUsername ?? ''),
        ownerPassword: String(body.ownerPassword ?? ''),
        ownerUserLevel: body.ownerUserLevel != null ? String(body.ownerUserLevel) : 'admin',
        firstBranchCode: String(body.firstBranchCode ?? body.branchCode ?? ''),
        firstBranchName: String(body.firstBranchName ?? body.branchName ?? ''),
        branchAddress: body.branchAddress != null ? String(body.branchAddress) : null,
        branchPhone: body.branchPhone != null ? String(body.branchPhone) : null,
        branchDefaultOpenTime:
          body.branchDefaultOpenTime != null ? String(body.branchDefaultOpenTime) : null,
        branchDefaultCloseTime:
          body.branchDefaultCloseTime != null ? String(body.branchDefaultCloseTime) : null,
        packCode: body.packCode != null ? String(body.packCode) : 'salon',
      },
      { actorUserId: auth.userId, actorUserName: auth.userName },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const mapped = onboardingErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants] POST error:', err);
    return NextResponse.json({ error: 'Tenant provisioning failed' }, { status: 500 });
  }
}
