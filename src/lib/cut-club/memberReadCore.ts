/**
 * CUT CLUB 2.0 — real-data-ready private member read boundary (#298).
 *
 * No public HTTP route or browser-selected clientId; this function may only
 * run after an AUTHORITATIVE revocable session + tenant-to-customer ownership
 * proof. No phone-only fallback while WhatsApp OTP is not active.
 */
import { resolveCutClubSession } from "./customerAuthFlow";
import type { OtpDurableRepository } from "./otpDomain";

export type ClubMemberKey = Readonly<{ tenantId: string; customerId: number }>;
export type MemberDbRow = Readonly<{
  ClientID: number;
  ClientName: string | null;
  ClientLoyaltyID: number | null;
  PointsBalance: number | null;
  LifetimeEarnedPoints: number | null;
  TotalVisits: number | null;
  TierCode: string | null;
  TierNameAr: string | null;
  LastVisitDate: Date | null;
}>;
export type LedgerDbRow = Readonly<{
  LedgerID: number;
  MovementType: string;
  PointsDelta: number;
  CreatedAt: Date;
}>;
export type VoucherDbRow = Readonly<{
  InventoryID: number;
  Status: string;
  NameAr: string;
  ExpiresAt: Date | null;
}>;

export type ClubMemberSnapshot = Readonly<{
  mode: "verified";
  member: Readonly<{
    displayName: string;
    memberId: string | null;
    tierCode: string;
    tierNameAr: string;
    visits: number;
    lastVisit: string | null;
  }>;
  wallet: Readonly<{
    availableCoins: number;
    lifetimeEarnedCoins: number;
    /** No invented EGP credit; a separate accounted ledger is required. */
    promotionalCreditAvailable: false;
    activity: readonly Readonly<{ id: number; kind: string; coinsDelta: number; at: string }>[];
    vouchers: readonly Readonly<{ id: number; label: string; status: "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED"; expiresAt: string | null }>[];
  }>;
  enabledActions: Readonly<{ redeem: false; buy: false; mysteryBox: false }>;
}>;

export interface MemberReadStore {
  /** MUST prove tenant -> legacy customer mapping from a trusted authority. */
  ownsCustomer(key: ClubMemberKey): Promise<boolean>;
  memberRow(key: ClubMemberKey): Promise<readonly MemberDbRow[]>;
  ledgerRows(key: ClubMemberKey): Promise<readonly LedgerDbRow[]>;
  voucherRows(key: ClubMemberKey): Promise<readonly VoucherDbRow[]>;
}

type SnapshotOutcome = Readonly<{ ok: true; data: ClubMemberSnapshot }> |
  Readonly<{ ok: false; error: "unavailable" }>;
const fail = (): SnapshotOutcome => ({ ok: false, error: "unavailable" });
const positive = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const nonnegative = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
/** Legacy SQL Coins may be DECIMAL(10,2). Never round or truncate balances. */
const validCoins = (x: unknown): x is number =>
  nonnegative(x) && x <= Number.MAX_SAFE_INTEGER / 100 && Number(x.toFixed(2)) === x;
const safeDate = (d: unknown) => d === null ? null :
  d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
const voucherStatuses = new Set(["ACTIVE", "USED", "EXPIRED", "CANCELLED"]);
const tenantUuid = (x: unknown): x is string => typeof x === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(x);

/**
 * enabled defaults to false in all future callers. Never build a public
 * endpoint that passes a hard-coded true or an arbitrary browser identity.
 * sessionRepo must be the durable store, not a process-local fake.
 */
export async function readCutClubMemberSnapshot(input: Readonly<{
  enabled: boolean;
  trustedTenantId: string;
  browserOpaqueCookie: unknown;
  nowSeconds: number;
  sessionRepo: OtpDurableRepository;
  source: MemberReadStore;
}>): Promise<SnapshotOutcome> {
  if (input.enabled !== true || !tenantUuid(input.trustedTenantId) ||
      !positive(input.nowSeconds)) return fail();

  const session = await resolveCutClubSession(input.sessionRepo, {
    trustedTenantId: input.trustedTenantId,
    opaqueCookieToken: input.browserOpaqueCookie,
    nowSeconds: input.nowSeconds,
  });
  if (!session || session.tenantId !== input.trustedTenantId || !positive(session.customerId))
    return fail();

  const key = Object.freeze({ tenantId: session.tenantId, customerId: session.customerId });
  try {
    // Ownership is checked by an independently trusted tenant->legacy client
    // resolver, never by clientId in request query, phone or URL.
    if (await input.source.ownsCustomer(key) !== true) return fail();
    const rows = await input.source.memberRow(key);
    // Ambiguous customer/loyalty joins fail CLOSED rather than choosing one.
    if (rows.length !== 1) return fail();
    const r = rows[0];
    if (r.ClientID !== key.customerId || typeof r.ClientName !== "string" ||
        r.ClientName.trim().length === 0 || r.ClientName.length > 160 ||
        !validCoins(r.PointsBalance ?? 0) ||
        !validCoins(r.LifetimeEarnedPoints ?? 0) ||
        !nonnegative(r.TotalVisits ?? 0) ||
        !Number.isSafeInteger(r.TotalVisits ?? 0) ||
        (r.ClientLoyaltyID !== null && !positive(r.ClientLoyaltyID)) ||
        safeDate(r.LastVisitDate) === undefined) return fail();

    const ledgerRows = await input.source.ledgerRows(key);
    const voucherRows = await input.source.voucherRows(key);
    // Bounded reads are enforced in the SQL adapter as well as at the edge.
    if (ledgerRows.length > 20 || voucherRows.length > 25) return fail();
    const seenLedger = new Set<number>(), seenVouchers = new Set<number>();
    const activity = ledgerRows.map(x => {
      const at = safeDate(x.CreatedAt);
      if (!positive(x.LedgerID) || seenLedger.has(x.LedgerID) ||
          !Number.isFinite(x.PointsDelta) || at === null || at === undefined ||
          typeof x.MovementType !== "string" || x.MovementType.length > 40)
        throw Error("invalid-ledger");
      seenLedger.add(x.LedgerID);
      return Object.freeze({ id: x.LedgerID, kind: x.MovementType, coinsDelta: x.PointsDelta, at });
    });
    const vouchers = voucherRows.map(x => {
      const expiry = safeDate(x.ExpiresAt);
      if (!positive(x.InventoryID) || seenVouchers.has(x.InventoryID) ||
          !voucherStatuses.has(x.Status) || typeof x.NameAr !== "string" ||
          !x.NameAr.trim() || x.NameAr.length > 150 || expiry === undefined)
        throw Error("invalid-voucher");
      seenVouchers.add(x.InventoryID);
      return Object.freeze({ id: x.InventoryID, label: x.NameAr, status: x.Status as "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED", expiresAt: expiry });
    });
    return { ok: true, data: Object.freeze({
      mode: "verified" as const,
      member: Object.freeze({
        displayName: r.ClientName.trim(),
        memberId: r.ClientLoyaltyID === null ? null : `CC-${String(r.ClientLoyaltyID).padStart(6, "0")}`,
        tierCode: (r.TierCode || "BRONZE").slice(0, 30),
        tierNameAr: (r.TierNameAr || "عضو CUT CLUB").slice(0, 100),
        visits: r.TotalVisits ?? 0,
        lastVisit: safeDate(r.LastVisitDate) ?? null,
      }),
      wallet: Object.freeze({
        availableCoins: r.PointsBalance ?? 0,
        lifetimeEarnedCoins: r.LifetimeEarnedPoints ?? 0,
        promotionalCreditAvailable: false as const,
        activity: Object.freeze(activity),
        vouchers: Object.freeze(vouchers),
      }),
      enabledActions: Object.freeze({ redeem: false as const, buy: false as const, mysteryBox: false as const }),
    }) };
  } catch {
    // Never disclose whether a tenant, customer or voucher exists.
    return fail();
  }
}
