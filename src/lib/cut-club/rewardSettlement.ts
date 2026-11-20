/**
 * CUT CLUB reward purchase settlement (ported from #300/#320 onto the live
 * member-session system). Atomic: stock, Coins debit, ledger, owned voucher and
 * idempotency record commit together or not at all.
 */
import { randomBytes } from "node:crypto";

export type RewardOwner = Readonly<{ tenantId: string; customerId: number; salonId: number }>;
export type RewardItemForPurchase = Readonly<{
  itemId: number;
  priceCoins: number;
  isActive: boolean;
  /** Entitlement must have a verifiable POS benefit BEFORE any Coins debit. */
  itemType: string;
  serviceId: number | null;
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

export type PurchaseFailure = "unavailable" | "not_eligible" | "insufficient_coins" | "out_of_stock" | "conflict";
export type PurchaseOutcome =
  | Readonly<{ ok: true; replayed: boolean; receipt: PurchaseReceipt }>
  | Readonly<{ ok: false; reason: PurchaseFailure }>;
const failed = (reason: PurchaseFailure = "unavailable"): PurchaseOutcome => ({ ok: false, reason });
const reasons: Record<string, PurchaseFailure> = {
  CUT_NOT_ELIGIBLE: "not_eligible", CUT_INSUFFICIENT_COINS: "insufficient_coins",
  CUT_STOCK_UNAVAILABLE: "out_of_stock", CUT_IDEMPOTENCY_CONFLICT: "conflict",
};
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
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
 * Pure settlement core. `owner` MUST come from a server-verified member session
 * (tenant + ACTIVE legacy client) and a configured salon — never from request input.
 * Every write shares ONE SERIALIZABLE transaction; any failure rolls back all.
 */
export async function runRewardPurchase(input: Readonly<{
  owner: RewardOwner;
  itemId: number;
  idempotencyKey: string;
  nowSeconds: number;
  verifyOwnedCustomerAndSalon: (owner: RewardOwner) => Promise<boolean>;
  port: RewardPurchasePort;
}>): Promise<PurchaseOutcome> {
  const owner = Object.freeze({ ...input.owner });
  if (!uuid(owner.tenantId) || !positive(owner.customerId) || !positive(owner.salonId) ||
      !positive(input.itemId) || !positive(input.nowSeconds) || !idem(input.idempotencyKey)) return failed();
  try {
    if (await input.verifyOwnedCustomerAndSalon(owner) !== true) return failed();
    return await input.port.serializable(async tx => {
      if (!await tx.lockMember(owner)) throw Error("CUT_LOCK_UNAVAILABLE");
      const previous = await tx.findCommand(owner, input.idempotencyKey);
      if (previous) {
        if (previous.itemId !== input.itemId) throw Error("CUT_IDEMPOTENCY_CONFLICT");
        return { ok: true, replayed: true, receipt: previous.receipt } as const;
      }
      const item = await tx.findPublishedItem(owner, input.itemId);
      const member = await tx.lockMemberBalance(owner);
      // Live last132 has 4 ACTIVE FREE_SERVICE rewards with ServiceID=NULL.
      // Until service mapping and invoice settlement are approved, no customer
      // should pay Coins for a voucher the cashier cannot honor.
      if (!item || !member || !item.isActive || item.itemId !== input.itemId ||
          item.itemType !== "FREE_SERVICE" || !positive(item.serviceId) ||
          !positive(member.clientLoyaltyId) || !positive(member.tierRank) ||
          !positive(item.requiresTierRank) ||
          !coin(item.priceCoins) || item.priceCoins <= 0 ||
          !coin(member.balanceCoins) ||
          member.tierRank < item.requiresTierRank) throw Error("CUT_NOT_ELIGIBLE");
      if (member.balanceCoins < item.priceCoins) throw Error("CUT_INSUFFICIENT_COINS");

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
      return { ok: true, replayed: false, receipt } as const;
    });
  } catch (error) {
    return failed(reasons[error instanceof Error ? error.message : ""] ?? "unavailable");
  }
}
