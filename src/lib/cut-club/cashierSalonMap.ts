/**
 * CUT CLUB POS: legacy StoreItem.SalonID is NOT necessarily a branch ID.
 * Never equate BranchID and SalonID. This exact reviewed mapping is set ONLY
 * by a trusted server operator after Production metadata inspection.
 * No fallback, auto-discovery, network or user-supplied override.
 */
const uuid = (x: string) =>
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(x);
const posInt = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;

/**
 * Example env JSON (NOT live values):
 * { "c9413a3e-dc87-4a70-bc6e-d00d76f9066b:7": 15 }
 * Requiring a mapping keeps cashier endpoints CLOSED until authority proven.
 */
export function resolveTrustedLegacySalonId(input: Readonly<{
  trustedTenantId: string;
  trustedBranchId: number;
  mappingJson?: string;
}>): number | null {
  if (!uuid(input.trustedTenantId) || !posInt(input.trustedBranchId)) return null;
  const raw = input.mappingJson ??
    process.env.CUT_CLUB_POS_LEGACY_SALON_MAP_JSON;
  if (!raw || raw.length > 4096) return null;
  try {
    const map: unknown = JSON.parse(raw);
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const key = input.trustedTenantId.toLowerCase() + ":" + String(input.trustedBranchId);
    const value = (map as Record<string, unknown>)[key];
    return posInt(value) ? value : null;
  } catch {
    return null;
  }
}
