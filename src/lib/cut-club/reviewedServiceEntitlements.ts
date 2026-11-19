/**
 * CUT CLUB approved reward -> real POS service mapping.
 *
 * The live last132 store rewards (15/16/17/18) currently have NULL ServiceID.
 * Their names are NOT identity. No inferred mapping, seed, auto-migration or
 * default approval. Keep all 14 ACTIVE / 60 USED historical inventory rows.
 *
 * A trusted operator may configure this server-only JSON AFTER validating the
 * correct active TblPro service, customer entitlement and business policy.
 * Mapping config alone is not proof that a ZERO-price invoice was actually
 * settled with the voucher: cashier financial use remains separately gated.
 *
 * Example, deliberately fictitious values:
 * { "c9413a3e-dc87-4a70-bc6e-d00d76f9066b:15": 39 }
 */
const uuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(x);
const positive = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0;

/**
 * Server-only policy resolution. The browser must NOT control approvalJson,
 * tenantId or rewardItemId; callers use validated session + SQL source values.
 * Requiring a matching explicit mapping also detects stale DB ServiceIDs.
 */
export function approvedCutClubServiceId(input: Readonly<{
  trustedTenantId: string;
  rewardItemId: number;
  dbServiceId: number | null;
  approvalJson?: string;
}>): number | null {
  if (!uuid(input.trustedTenantId) || !positive(input.rewardItemId) ||
      (input.dbServiceId !== null && !positive(input.dbServiceId))) return null;
  const raw = input.approvalJson ?? process.env.CUT_CLUB_REVIEWED_REWARD_SERVICE_MAP_JSON;
  if (!raw || raw.length > 4096) return null;
  try {
    const mapping: unknown = JSON.parse(raw);
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return null;
    const entries = Object.entries(mapping);
    if (entries.length === 0 || entries.length > 50 ||
        entries.some(([key, value]) =>
          !/^[a-f\d-]{36}:[1-9][0-9]{0,9}$/i.test(key) || !positive(value))) return null;
    const key = input.trustedTenantId.toLowerCase() + ":" + String(input.rewardItemId);
    const matches = entries.filter(([entry]) => entry.toLowerCase() === key);
    if (matches.length !== 1) return null;
    const serviceId = matches[0][1] as number;
    return input.dbServiceId !== null && input.dbServiceId !== serviceId
      ? null : serviceId;
  } catch {
    return null;
  }
}

/**
 * Require an *actual* un-deleted service belonging to the same tenant.
 * Adapter is intentionally injected: no DB access or customer row reads
 * occur in a unit test/import; SQL caller must pass a tenant-bound lookup.
 */
export async function verifyApprovedCutClubService(input: Readonly<{
  trustedTenantId: string;
  rewardItemId: number;
  dbServiceId: number | null;
  approvalJson?: string;
  isActiveTenantService: (tenantId: string, serviceId: number) => Promise<boolean>;
}>): Promise<number | null> {
  const serviceId = approvedCutClubServiceId(input);
  if (serviceId === null) return null;
  try {
    return await input.isActiveTenantService(input.trustedTenantId, serviceId)
      ? serviceId : null;
  } catch {
    return null;
  }
}
