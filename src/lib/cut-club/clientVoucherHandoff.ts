/**
 * CUT CLUB client voucher handoff (#304) — secure proof of ownership to POS.
 *
 * Never call from an anonymous/phone-only client or make this a public route.
 * Backend session and authoritative customer ownership are required for each
 * voucher-code reveal. WhatsApp OTP transport remains deferred; default OFF.
 *
 * Returned code is sensitive capability data; send only through an authenticated
 * same-origin BFF over TLS with no-store, never logs, URLs, analytics or cache.
 */
import { resolveCutClubSession } from "./customerAuthFlow";
import type { OtpDurableRepository } from "./otpDomain";

export type VoucherOwner = Readonly<{ tenantId: string; customerId: number }>;
export type OwnedVoucherRecord = Readonly<{
  inventoryId: number;
  ownerCustomerId: number;
  status: "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED";
  voucherCode: string;
  expiresAt: Date | null;
}>;

export interface OwnedVoucherSource {
  proveTenantCustomerOwner(owner: VoucherOwner): Promise<boolean>;
  getVoucherForOwner(owner: VoucherOwner, inventoryId: number): Promise<OwnedVoucherRecord | null>;
}
export type ClientVoucherProof = Readonly<{
  inventoryId: number;
  voucherCode: string;
  expiresAt: string | null;
  shareInstructionAr: string;
}>;
export type ClientVoucherOutcome =
  Readonly<{ ok: true; voucher: ClientVoucherProof }> |
  Readonly<{ ok: false; reason: "unavailable" }>;
const failed = (): ClientVoucherOutcome => ({ ok: false, reason: "unavailable" });
const positive = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x > 0;
const uuid = (x: unknown): x is string => typeof x === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(x);

/** A code is NOT identity; sharing it never authorizes a private account read. */
export async function revealVerifiedClientVoucher(input: Readonly<{
  enabled: boolean;
  trustedTenantId: string;
  opaqueCookieToken: unknown;
  inventoryId: number;
  nowSeconds: number;
  sessions: OtpDurableRepository;
  source: OwnedVoucherSource;
}>): Promise<ClientVoucherOutcome> {
  if (input.enabled !== true || !uuid(input.trustedTenantId) ||
      !positive(input.inventoryId) || !positive(input.nowSeconds)) return failed();

  const verified = await resolveCutClubSession(input.sessions, {
    trustedTenantId: input.trustedTenantId,
    opaqueCookieToken: input.opaqueCookieToken,
    nowSeconds: input.nowSeconds,
  });
  if (!verified || verified.tenantId !== input.trustedTenantId || !positive(verified.customerId))
    return failed();
  const owner = Object.freeze({ tenantId: verified.tenantId, customerId: verified.customerId });

  try {
    if (await input.source.proveTenantCustomerOwner(owner) !== true) return failed();
    const item = await input.source.getVoucherForOwner(owner, input.inventoryId);
    if (!item || item.ownerCustomerId !== owner.customerId ||
        item.inventoryId !== input.inventoryId || item.status !== "ACTIVE" ||
        typeof item.voucherCode !== "string" ||
        !/^[A-Z0-9-]{6,100}$/.test(item.voucherCode)) return failed();
    if (item.expiresAt !== null &&
        (!(item.expiresAt instanceof Date) ||
         !Number.isFinite(item.expiresAt.getTime()) ||
         item.expiresAt.getTime() <= input.nowSeconds * 1000)) return failed();

    return { ok: true, voucher: Object.freeze({
      inventoryId: item.inventoryId,
      voucherCode: item.voucherCode,
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      shareInstructionAr: "اعرض الكود للكاشير عند زيارتك. الاستخدام يتم بعد التأكد من الفاتورة.",
    }) };
  } catch {
    return failed();
  }
}
