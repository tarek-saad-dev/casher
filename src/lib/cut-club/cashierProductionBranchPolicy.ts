/**
 * CUT CLUB V2 cashier production branch release gate.
 *
 * This is a SERVER-only allowlist, not the SQL Location.Status value.
 * PH1GTEST was active in Production on 2026-11-17: status alone is not
 * approval to handle customer vouchers or payment-like discounts.
 *
 * Never trust a browser-supplied tenant or branch. Both MUST come from
 * authenticated staff session after the operable branch authorization.
 * No value is enabled by default; do not auto-map BranchID to SalonID.
 */
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(s);
const id = (s: unknown): s is number =>
  typeof s === "number" && Number.isSafeInteger(s) && s > 0;

/**
 * Expected JSON shape (values ONLY after owner release authorization):
 * ["tenant-uuid:1", "tenant-uuid:3"]
 *
 * No defaults, test/demo exemptions or wildcard entries allowed.
 */
export function isCutClubCashierBranchApproved(input: Readonly<{
  trustedTenantId: string;
  trustedBranchId: number;
  allowlistJson?: string;
}>): boolean {
  if (!uuid(input.trustedTenantId) || !id(input.trustedBranchId)) return false;
  const raw = input.allowlistJson ??
    process.env.CUT_CLUB_CASHIER_APPROVED_BRANCHES_JSON;
  if (!raw || raw.length > 4096) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 30 ||
        parsed.some(item => typeof item !== "string" ||
          !/^[a-f\d-]{36}:[1-9][0-9]{0,9}$/i.test(item))) return false;
    const desired = input.trustedTenantId.toLowerCase() + ":" +
      String(input.trustedBranchId);
    return parsed.some(item => (item as string).toLowerCase() === desired);
  } catch {
    return false;
  }
}
