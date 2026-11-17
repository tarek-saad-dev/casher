import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { generateReferralCustomerCode } from './referralPreviewPolicy';

export class ReferralActivationDeniedError extends Error {
  constructor() {
    super('Client has no qualifying paid sale in this tenant');
    this.name = 'ReferralActivationDeniedError';
  }
}

export type ActivateReferralCodeInput = {
  /** Authenticated tenant — never a customer-supplied tenant ID. */
  tenantId: string;
  referrerClientId: number;
  /** Invoice row already persisted within this same transaction. */
  invId: number;
  invType: 'مبيعات';
};

/**
 * INTERNAL ONLY. Call inside the authoritative SERIALIZABLE sale transaction,
 * after the invoice and its full payment have been persisted.
 *
 * The tenant/client row UPDLOCK+HOLDLOCK is the serialization point for
 * concurrent first-visit invoices. The database's unique indexes remain the
 * final protection against code/owner duplication. A failure must roll back
 * the entire calling sale transaction: never retry here outside that unit.
 *
 * This function is intentionally not wired to sale writers in #223.
 */
export async function activateCustomerReferralCodeInSale(
  transaction: Transaction,
  input: ActivateReferralCodeInput,
): Promise<string> {
  if (!Number.isInteger(input.referrerClientId) || input.referrerClientId <= 0 ||
      input.referrerClientId > 2_147_483_647 ||
      !Number.isInteger(input.invId) || input.invId <= 0 || input.invType !== 'مبيعات') {
    throw new ReferralActivationDeniedError();
  }

  // Lock the tenant's client row BEFORE selecting or inserting a permanent code.
  const paid = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.referrerClientId)
    .input('invId', sql.Int, input.invId)
    .input('invType', sql.NVarChar(20), input.invType)
    .query(`
      SELECT c.ClientID FROM dbo.TblClient c WITH (UPDLOCK, HOLDLOCK)
      WHERE c.TenantId = @tenantId AND c.ClientID = @clientId
        AND EXISTS (
          SELECT 1 FROM dbo.TblinvServHead h
          INNER JOIN dbo.Location l
            ON l.LegacyBranchId = h.BranchID AND l.TenantId = @tenantId
          WHERE h.ClientID = c.ClientID AND h.invID = @invId AND h.invType = @invType
            AND h.GrandTotal > 0 AND h.Payment >= h.GrandTotal
            AND ISNULL(h.PayDue, 0) <= 0 AND ISNULL(h.isActive, N'no') = N'no'
        )
    `);
  if (!paid.recordset.length) throw new ReferralActivationDeniedError();

  const previous = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.referrerClientId)
    .query(`
      SELECT Code, ActivatedAtUtc
      FROM dbo.TblReferralCustomerCode WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND ReferrerClientID = @clientId
    `);
  const existing = previous.recordset[0] as
    | { Code: string; ActivatedAtUtc: Date | null }
    | undefined;
  if (existing) {
    if (!existing.ActivatedAtUtc) {
      await new sql.Request(transaction)
        .input('tenantId', sql.UniqueIdentifier, input.tenantId)
        .input('clientId', sql.Int, input.referrerClientId)
        .query(`
          UPDATE dbo.TblReferralCustomerCode
          SET ActivatedAtUtc = SYSUTCDATETIME()
          WHERE TenantId = @tenantId AND ReferrerClientID = @clientId
            AND ActivatedAtUtc IS NULL
        `);
    }
    return existing.Code;
  }

  const code = generateReferralCustomerCode();
  await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('clientId', sql.Int, input.referrerClientId)
    .input('code', sql.NVarChar(32), code)
    .query(`
      INSERT INTO dbo.TblReferralCustomerCode
        (TenantId, ReferrerClientID, Code, ActivatedAtUtc)
      VALUES (@tenantId, @clientId, @code, SYSUTCDATETIME())
    `);
  return code;
}
