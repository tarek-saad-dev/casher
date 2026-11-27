/**
 * CUT CLUB — staging-only secure Coins settlement adapted for CURRENT verified OTP sessions.
 *
 * Only staging-only route access; production fails closed both at route and SQL transaction.
 * Uses the current CUT CLUB revocable SQL OTP member session, not old auth adapters.
 * All balance/stock/ledger/voucher/idempotency writes MUST share ONE SQL
 * SERIALIZABLE transaction (rollback on any failure).
 *
 * Production purchase must stay OFF pending real SQL acceptance and POS voucher claim.
 */
import { randomBytes } from "node:crypto";
import { getCutClubSession } from "./memberOtp";

export type RewardOwner = Readonly<{ tenantId: string; customerId: number; branchId: number }>;
export type RewardItemForPurchase = Readonly<{
  itemId: number;
  priceCoins: number;
  isActive: boolean;
  requiresTierRank: number;
  unlimitedStock: boolean;
  expiresAfterDays: number | null;
}>;
export type MemberBalanceForPurchase = Readonly<{
  clientLoyaltyId: number;
  balanceCoins: number;
  tierRank: number;
}>;
export type PurchaseReceipt = Readonly<{
  itemId: number;
  inventoryId: number;
  coinsCharged: number;
  balanceAfter: number;
  /** Only exposed to trusted authenticated server caller after commit. */
  voucherCode: string;
}>;
export type StoredPurchaseCommand = Readonly<{
  itemId: number;
  receipt: PurchaseReceipt;
}>;

export interface RewardPurchaseTransaction {
  /** Exclusive transaction-scoped lock keyed on owner, serializes spend. */
  lockMember(owner: RewardOwner): Promise<boolean>;
  /** Revalidate the exact opaque session and linked owner on the transaction connection. */
  authorizeSession(owner: RewardOwner, token: unknown): Promise<boolean>;
  findCommand(owner: RewardOwner, idempotencyKey: string): Promise<StoredPurchaseCommand | null>;
  findPublishedItem(owner: RewardOwner, itemId: number): Promise<RewardItemForPurchase | null>;
  lockMemberBalance(owner: RewardOwner): Promise<MemberBalanceForPurchase | null>;
  reserveOneStock(owner: RewardOwner, itemId: number): Promise<boolean>;
  debitCoins(owner: RewardOwner, loyaltyId: number, amount: number): Promise<{ before: number; after: number } | null>;
  createLedger(owner: RewardOwner, input: Readonly<{
    clientLoyaltyId: number; itemId: number; before: number; after: number;
    priceCoins: number; idempotencyKey: string;
  }>): Promise<boolean>;
  createOwnedVoucher(owner: RewardOwner, input: Readonly<{
    itemId: number; priceCoins: number; voucherCode: string; expiresAt: Date | null;
  }>): Promise<number | null>;
  recordCommand(owner: RewardOwner, idempotencyKey: string, receipt: PurchaseReceipt): Promise<boolean>;
}
export interface RewardPurchasePort {
  /** MUST rollback on throws, commit on successful callback return, and use SERIALIZABLE. */
  serializable<T>(work: (tx: RewardPurchaseTransaction) => Promise<T>): Promise<T>;
}

export type PurchaseOutcome =
  | Readonly<{ ok: true; replayed: boolean; receipt: PurchaseReceipt }>
  | Readonly<{ ok: false; reason: "unavailable" }>;
const failed = (): PurchaseOutcome => ({ ok: false, reason: "unavailable" });
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const idem = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
const coin = (v: unknown): v is number => typeof v === "number" &&
  Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER / 100 &&
  Number(v.toFixed(2)) === v;

function expiry(days: number | null, nowSeconds: number): Date | null {
  if (days === null) return null;
  if (!Number.isSafeInteger(days) || days <= 0 || days > 3650) throw Error("INVALID_EXPIRY");
  const date = new Date((nowSeconds + days * 86400) * 1000);
  if (!Number.isFinite(date.getTime())) throw Error("INVALID_EXPIRY");
  return date;
}

/**
 * The caller CANNOT override customer ID. The only customer identity comes
 * from a server-validated, persisted, revocable session. The branchId MUST
 * come from an authoritative branch↔tenant mapping, NOT URL/body input.
 */
export async function purchaseRewardWithVerifiedSession(input: Readonly<{
  enabled: boolean;
  trustedTenantId: string;
  trustedBranchId: number;
  cookieToken: unknown;
  nowSeconds: number;
  itemId: number;
  idempotencyKey: string;
  /** Confirms the SAME SQL connection is staging-only BEFORE owner verification. */
  stageReady: () => Promise<boolean>;
  verifyOwnedCustomerAndBranch: (owner: RewardOwner) => Promise<boolean>;
  port: RewardPurchasePort;
}>): Promise<PurchaseOutcome> {
  if (input.enabled !== true || !uuid(input.trustedTenantId) ||
      !positive(input.trustedBranchId) || !positive(input.itemId) ||
      !positive(input.nowSeconds) || !idem(input.idempotencyKey)) return failed();
  // The staging flag alone is NOT sufficient: require an authoritative
  // database/login identity before accepting a transaction.
  try {
    if(!await input.stageReady())return failed();
  } catch { return failed(); }
  const session = await getCutClubSession(input.cookieToken);
  if (!session || session.linkStatus !== 'ACTIVE' ||
      !positive(session.legacyClientId) ||
      session.tenantId.toLowerCase() !== input.trustedTenantId.toLowerCase())
    return failed();
  const owner: RewardOwner = Object.freeze({
    tenantId: session.tenantId,
    customerId: session.legacyClientId,
    branchId: input.trustedBranchId,
  });
  try {
    if (await input.verifyOwnedCustomerAndBranch(owner) !== true) return failed();
    return await input.port.serializable(async tx => {
      if (!await tx.lockMember(owner)) throw Error("CUT_LOCK_UNAVAILABLE");
      if (!await tx.authorizeSession(owner, input.cookieToken)) throw Error("CUT_SESSION_CHANGED");
      const previous = await tx.findCommand(owner, input.idempotencyKey);
      if (previous) {
        if (previous.itemId !== input.itemId) throw Error("CUT_IDEMPOTENCY_CONFLICT");
        if (!await tx.authorizeSession(owner, input.cookieToken)) throw Error("CUT_SESSION_CHANGED");
        return { ok: true, replayed: true, receipt: previous.receipt } as const;
      }
      const item = await tx.findPublishedItem(owner, input.itemId);
      const member = await tx.lockMemberBalance(owner);
      if (!item || !member || !item.isActive || item.itemId !== input.itemId ||
          !positive(member.clientLoyaltyId) || !positive(member.tierRank) ||
          !positive(item.requiresTierRank) ||
          !coin(item.priceCoins) || item.priceCoins <= 0 ||
          !coin(member.balanceCoins) || member.balanceCoins < item.priceCoins ||
          member.tierRank < item.requiresTierRank) throw Error("CUT_NOT_ELIGIBLE");

      // Reserve stock before spending. A failure MUST roll back entire transaction.
      if (!item.unlimitedStock && !await tx.reserveOneStock(owner, input.itemId))
        throw Error("CUT_STOCK_UNAVAILABLE");
      const debit = await tx.debitCoins(owner, member.clientLoyaltyId, item.priceCoins);
      if (!debit || !coin(debit.before) || !coin(debit.after) ||
          debit.after !== Number((debit.before - item.priceCoins).toFixed(2)) ||
          debit.before !== member.balanceCoins) throw Error("CUT_WALLET_CHANGED");
      if (!await tx.createLedger(owner, {
        clientLoyaltyId: member.clientLoyaltyId,
        itemId: input.itemId, before: debit.before, after: debit.after,
        priceCoins: item.priceCoins, idempotencyKey: input.idempotencyKey,
      })) throw Error("CUT_LEDGER_FAILED");

      // Generated server-side, never a predictable clientId-based voucher.
      const voucherCode = "CUT-" + randomBytes(20).toString("hex").toUpperCase();
      const inventoryId = await tx.createOwnedVoucher(owner, {
        itemId: item.itemId, priceCoins: item.priceCoins, voucherCode,
        expiresAt: expiry(item.expiresAfterDays, input.nowSeconds),
      });
      if (!positive(inventoryId)) throw Error("CUT_VOUCHER_FAILED");
      const receipt: PurchaseReceipt = Object.freeze({
        itemId: item.itemId, inventoryId,
        coinsCharged: item.priceCoins, balanceAfter: debit.after, voucherCode,
      });
      if (!await tx.recordCommand(owner, input.idempotencyKey, receipt))
        throw Error("CUT_SETTLEMENT_NOT_RECORDED");
      // Locks protect session/owner state; recheck expiry again just before commit.
      if (!await tx.authorizeSession(owner, input.cookieToken)) throw Error("CUT_SESSION_CHANGED");
      return { ok: true, replayed: false, receipt } as const;
    });
  } catch {
    return failed();
  }
}
