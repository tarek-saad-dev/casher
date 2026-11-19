/**
 * CUT CLUB legacy phone-only profile lookup — quarantine #278.
 * The old endpoint accepted an unverified phone and could expose customer data.
 * Customer-specific profile reads require a NEW OTP/session-authorized API.
 * Booking, POS and public catalog endpoints are not modified here.
 */
import { rejectAnonymousPhoneProfileLookup } from "@/lib/cut-club/legacyPhoneLookupQuarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No phone lookup, request parsing or database call. */
export async function GET() {
  return rejectAnonymousPhoneProfileLookup();
}

/** Do not grant CORS preflight for unverified personal reads. */
export async function OPTIONS() {
  return rejectAnonymousPhoneProfileLookup();
}
