/**
 * CUT CLUB 2.0 legacy account-private GET quarantine (#274).
 *
 * URL/clientId/phone is NOT customer authentication. This is a temporary
 * fail-closed policy for the old member endpoints until a new, separately
 * routed, tenant+customer-authorized API is built from verified OTP sessions.
 *
 * Public booking, staff POS and non-personal package catalogs are unaffected.
 * No runtime flag or caller-supplied token can enable old reads.
 */
import { NextResponse } from "next/server";

export const LEGACY_MEMBER_READS_QUARANTINED = true as const;

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'",
  "Vary": "Origin",
} as const;

/** Same generic response regardless of customer/reward/item existence. */
export function rejectLegacyMemberRead() {
  return NextResponse.json(
    { ok: false, error: "Verified CUT CLUB customer sign-in required" },
    { status: 403, headers },
  );
}
