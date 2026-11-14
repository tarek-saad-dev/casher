/**
 * CUT CLUB legacy financial-write quarantine — Issue #264.
 *
 * SECURITY BOUNDARY: clientId supplied by request URL is NOT authentication.
 * Until Casher has verified, revocable customer sessions and authoritative
 * tenant/account ownership, no unauthenticated public route may deduct Coins,
 * purchase vouchers, or open a mystery box. The legacy paths fail closed.
 *
 * No feature flag, debug query, API key, staff cookie or environment switch
 * can turn these routes back on. A future secure replacement gets separate
 * authenticated endpoints and explicit rollout/owner approval.
 */
import { NextResponse } from "next/server";
import type { StoreErrorResponse } from "@/lib/store/store.types";

export const LEGACY_FINANCIAL_WRITES_QUARANTINED = true as const;

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'",
  "Vary": "Origin",
} as const;

export function rejectUnauthenticatedFinancialWrite(): NextResponse<StoreErrorResponse> {
  return NextResponse.json<StoreErrorResponse>(
    { ok: false, error: "CUT CLUB purchases require verified customer sign-in" },
    { status: 403, headers },
  );
}
