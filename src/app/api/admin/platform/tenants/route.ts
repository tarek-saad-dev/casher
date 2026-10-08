import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { findIndustryPack } from '@/packs';
import { TenantAppError } from '@/platform/apps/errors';
import { listTenants, provisionTenant } from '@/platform/onboarding/provisionTenant';
import type { ProvisionTenantBrandInput } from '@/platform/onboarding/types';
import { rejectSystemControlledFields } from '@/platform/onboarding/validation';
import {
  PlatformRequestError,
  platformErrorResponse,
  readStringArray,
} from '../_shared/platformErrors';

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
  'origin',
  'trialEndsAt',
  'currentPeriodEndsAt',
  'ownerUserLevel',
  'ownerRole',
  'roles',
];

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}

function readBrand(value: unknown): ProvisionTenantBrandInput | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformRequestError('brand must be an object');
  }
  const b = value as Record<string, unknown>;
  return {
    logoUrl: optionalString(b.logoUrl),
    phone: optionalString(b.phone),
    address: optionalString(b.address),
    primaryColor: optionalString(b.primaryColor),
    accentColor: optionalString(b.accentColor),
    receiptFooter: optionalString(b.receiptFooter),
    publicBookingOrigins: readStringArray(b.publicBookingOrigins, 'brand.publicBookingOrigins'),
  };
}

/** GET /api/admin/platform/tenants — minimal tenant listing for platform operators. */
export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const tenants = await listTenants();
  return NextResponse.json({ tenants });
}

/**
 * POST /api/admin/platform/tenants — provision a tenant from an explicit Industry Pack,
 * app customizations and a commercial plan (default: starter trial). The owner always gets the
 * tenant `admin` role; role / user level are not accepted from the body.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    rejectSystemControlledFields(body, FORBIDDEN_BODY_FIELDS);

    const packCode = String(body.industryPackCode ?? body.packCode ?? '').trim();
    if (!packCode) {
      return NextResponse.json(
        { error: 'industryPackCode is required (onboarding has no default industry)', code: 'PACK_REQUIRED' },
        { status: 400 },
      );
    }
    const industryPack = findIndustryPack(packCode);
    if (!industryPack) {
      throw new TenantAppError('PACK_NOT_FOUND', `Unknown industry pack: ${packCode}`, 400);
    }
    const customizations = (body.appCustomizations ?? {}) as Record<string, unknown>;
    const requestedStatus = body.subscriptionStatus ?? 'trial';
    if (requestedStatus !== 'trial' && requestedStatus !== 'active') {
      return NextResponse.json(
        { error: 'subscriptionStatus must be trial or active', code: 'SUBSCRIPTION_STATUS_INVALID' },
        { status: 400 },
      );
    }

    const result = await provisionTenant(
      {
        tenantCode: String(body.tenantCode ?? ''),
        tenantDisplayName: String(body.tenantDisplayName ?? body.tenantName ?? ''),
        defaultTimezone: String(body.defaultTimezone ?? 'Africa/Cairo'),
        ownerUserName: String(body.ownerUserName ?? body.ownerDisplayName ?? ''),
        ownerLoginName: String(body.ownerLoginName ?? body.ownerUsername ?? ''),
        ownerPassword: String(body.ownerPassword ?? ''),
        firstBranchCode: String(body.firstBranchCode ?? body.branchCode ?? ''),
        firstBranchName: String(body.firstBranchName ?? body.branchName ?? ''),
        branchAddress: body.branchAddress != null ? String(body.branchAddress) : null,
        branchPhone: body.branchPhone != null ? String(body.branchPhone) : null,
        branchDefaultOpenTime:
          body.branchDefaultOpenTime != null ? String(body.branchDefaultOpenTime) : null,
        branchDefaultCloseTime:
          body.branchDefaultCloseTime != null ? String(body.branchDefaultCloseTime) : null,
        industryPack,
        appCustomizations: {
          add: readStringArray(customizations.add, 'appCustomizations.add'),
          remove: readStringArray(customizations.remove, 'appCustomizations.remove'),
        },
        planCode: body.planCode != null ? String(body.planCode) : undefined,
        subscriptionStatus: requestedStatus,
        brand: readBrand(body.brand),
      },
      { actorUserId: auth.userId, actorUserName: auth.userName },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants] POST error:', err);
    return NextResponse.json({ error: 'Tenant provisioning failed' }, { status: 500 });
  }
}