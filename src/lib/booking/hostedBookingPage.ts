/**
 * DRVO-019 — hosted tenant booking page (/book/[branchCode]) data loader.
 *
 * Returns null (page answers 404) when the branch code is malformed or unknown, the branch is
 * inactive / not public / booking-disabled, it has no tenant, or its tenant does not have the
 * booking app — the same non-disclosing outcome as the public booking APIs.
 */
import 'server-only';
import {
  PublicBookingBranchContextError,
  resolvePublicBookingBranchContext,
  tryNormalizePublicBranchCode,
} from '@/lib/booking/publicBookingBranchContext';
import { getTenantBrandProfileCached } from '@/platform/branding/brandRepository';

export type HostedBookingPageData = {
  branchCode: string;
  branchName: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  brand: {
    displayName: string;
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function safeColor(value: string | null | undefined): string | null {
  return value && HEX_COLOR.test(value) ? value : null;
}

function safeLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function loadHostedBookingPage(rawBranchCode: string): Promise<HostedBookingPageData | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(String(rawBranchCode ?? ''));
  } catch {
    return null;
  }
  const normalized = tryNormalizePublicBranchCode(decoded);
  if (!normalized.ok) return null;

  let ctx;
  try {
    ctx = await resolvePublicBookingBranchContext({
      branchCode: normalized.code,
      purpose: 'public_booking',
    });
  } catch (err) {
    if (err instanceof PublicBookingBranchContextError) return null;
    throw err;
  }
  if (!ctx.bookingEnabled || !ctx.publicBookingEnabled) return null;

  const brand = await getTenantBrandProfileCached(ctx.tenantId);
  return {
    branchCode: ctx.branchCode,
    branchName: ctx.branchName,
    address: ctx.address,
    phone: ctx.phone,
    timezone: ctx.timezone,
    brand: {
      displayName: brand?.displayName ?? ctx.branchName,
      logoUrl: safeLogoUrl(brand?.logoUrl),
      primaryColor: safeColor(brand?.primaryColor),
      accentColor: safeColor(brand?.accentColor),
    },
  };
}
