/**
 * CUT CLUB 2.0 — authoritative, READ-ONLY SQL customer ownership seam.
 *
 * Used only on trusted server after tenant resolution. A phone lookup by
 * itself is NEVER login; the caller MUST have atomically consumed the OTP
 * bound to this exact verified phone before minting a revocable session.
 *
 * This module does NOT create a pool, expose a public route, send an OTP,
 * issue a session or write any customer/Coins/voucher data.
 */
import "server-only";
import sql from "mssql";
import type { CustomerMatch } from "./otpDomain";

const validTenant = (id: unknown): id is string => typeof id === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id);
const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;

/** E.164 for Egyptian numbers only; rejects ambiguous, short, foreign phones. */
export function normalizeCutClubEgyptianPhone(phone: unknown): string | null {
  if (typeof phone !== "string" || phone.length > 32) return null;
  const compact = phone.trim().replace(/[\s()\-]/g, "");
  let local = compact;
  if (compact.startsWith("+20")) local = "0" + compact.slice(3);
  else if (compact.startsWith("20")) local = "0" + compact.slice(2);
  if (!/^01[0125][0-9]{8}$/.test(local)) return null;
  return "+20" + local.slice(1);
}

export type TrustedCustomerKey = Readonly<{ tenantId: string; customerId: number }>;
export interface CutClubCustomerAuthority {
  proveOwnedCustomer(key: TrustedCustomerKey): Promise<boolean>;
  /** Call ONLY after one-time-code consumption confirms phone ownership. */
  resolveByVerifiedWhatsAppPhone(input: Readonly<{
    trustedTenantId: string;
    verifiedPhoneE164: string;
  }>): Promise<readonly CustomerMatch[]>;
}

export function createSqlCutClubCustomerAuthority(pool: sql.ConnectionPool): CutClubCustomerAuthority {
  return {
    async proveOwnedCustomer({ tenantId, customerId }) {
      if (!validTenant(tenantId) || !positive(customerId)) return false;
      try {
        const r = await pool.request()
          .input("tenantId", sql.UniqueIdentifier, tenantId)
          .input("clientId", sql.Int, customerId)
          .query<{ ClientID: number }>(`
            SELECT TOP (2) c.ClientID
            FROM dbo.TblClient AS c
            WHERE c.TenantId=@tenantId AND c.ClientID=@clientId
          `);
        return r.recordset.length === 1 &&
          r.recordset[0].ClientID === customerId;
      } catch {
        return false;
      }
    },

    async resolveByVerifiedWhatsAppPhone({ trustedTenantId, verifiedPhoneE164 }) {
      if (!validTenant(trustedTenantId) ||
          normalizeCutClubEgyptianPhone(verifiedPhoneE164) !== verifiedPhoneE164) return [];
      const local = "0" + verifiedPhoneE164.slice(3);
      const digits = verifiedPhoneE164.slice(1);
      try {
        const r = await pool.request()
          .input("tenantId", sql.UniqueIdentifier, trustedTenantId)
          .input("e164", sql.NVarChar(20), verifiedPhoneE164)
          .input("local", sql.NVarChar(20), local)
          .input("digits", sql.NVarChar(20), digits)
          .query<{ ClientID: number; TenantId: string; Active: boolean | number }>(`
            SELECT DISTINCT TOP (3)
              c.ClientID, c.TenantId,
              CASE WHEN EXISTS (
                SELECT 1 FROM dbo.TblClientLoyalty AS cl
                WHERE cl.ClientID=c.ClientID AND cl.IsActive=1
              ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS Active
            FROM dbo.TblClient AS c
            WHERE c.TenantId=@tenantId
              AND c.Mobile IN (@local,@e164,@digits)
          `);
        // Never return phone/name/loyalty balance; only tenant-owned IDs and
        // active flag. Two matches => caller bindVerifiedCustomer DENIES.
        // A mixed/corrupt dataset must never silently discard foreign rows
        // and incorrectly turn an ambiguous phone into one authorized match.
        if (r.recordset.some(row => !positive(row.ClientID) ||
            typeof row.TenantId !== "string" ||
            row.TenantId.toLowerCase() !== trustedTenantId.toLowerCase()))
          return [];
        return r.recordset.map(row => Object.freeze({
          customerId: row.ClientID,
          tenantId: trustedTenantId,
          active: row.Active === true || row.Active === 1,
        }));
      } catch {
        return [];
      }
    },
  };
}
