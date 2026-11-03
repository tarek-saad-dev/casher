import 'server-only';
import { sql } from '@/lib/db';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import type { CustomerSnapshot, CustomersPort } from '../public/ports';
import { isUsableCustomerPhone, normalizePublicBookingPhone } from '@/lib/publicBookingHelpers';

/**
 * Anti-corruption adapter over legacy TblClient.
 * Live rows use [Name] and Mobile. Do not filter or write a deletion flag.
 * Every read/write is bound to the actor's authoritative TenantId (DRVO-015).
 */
export function createLegacyCustomersAdapter(): CustomersPort {
  return {
    async upsertByPhone(tx, actor, input) {
      const tenantId = requireMasterDataTenantId(actor.tenantId, 'customers.upsertByPhone');
      const normalizedPhone = normalizePublicBookingPhone(input.phone ?? '');
      const usablePhone = isUsableCustomerPhone(normalizedPhone) ? normalizedPhone : null;
      const displayName = String(input.displayName ?? '').trim() || normalizedPhone || 'عميل بدون اسم';

      // Placeholder phone values are not customer identities: always create a new row.
      if (usablePhone) {
        const existing = await new sql.Request(tx)
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .input('phone', sql.NVarChar(200), usablePhone)
          .query(`
            SELECT TOP 1 ClientID, [Name]
            FROM dbo.TblClient WITH (UPDLOCK, HOLDLOCK)
            WHERE TenantId = @tenantId AND Mobile = @phone;
          `);
        if (existing.recordset.length) {
          const clientId = Number(existing.recordset[0].ClientID);
          if (String(input.displayName ?? '').trim() &&
              String(existing.recordset[0].Name ?? '').trim() !== displayName) {
            await new sql.Request(tx)
              .input('tenantId', sql.UniqueIdentifier, tenantId)
              .input('clientId', sql.Int, clientId)
              .input('name', sql.NVarChar(200), displayName)
              .query(`UPDATE dbo.TblClient SET [Name] = @name
                      WHERE TenantId = @tenantId AND ClientID = @clientId;`);
          }
          return clientId;
        }
      }
      const insert = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('phone', sql.NVarChar(200), usablePhone)
        .input('name', sql.NVarChar(200), displayName)
        .query(`
          INSERT INTO dbo.TblClient (TenantId, [Name], Mobile, RegisterDate)
          OUTPUT INSERTED.ClientID AS id
          VALUES (@tenantId, @name, @phone, GETDATE());
        `);
      return Number(insert.recordset[0].id);
    },

    async get(actor, customerId) {
      const tenantId = requireMasterDataTenantId(actor.tenantId, 'customers.get');
      const { getPool } = await import('@/lib/db');
      const db = await getPool();
      const result = await db
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('id', sql.Int, customerId)
        .query(`
          SELECT ClientID, [Name], Mobile
          FROM dbo.TblClient WITH (NOLOCK)
          WHERE ClientID = @id AND TenantId = @tenantId;
        `);
      if (!result.recordset.length) return null;
      const row = result.recordset[0] as {
        ClientID: number;
        Name: string | null;
        Mobile: string | null;
      };
      return {
        customerId: row.ClientID,
        phone: row.Mobile,
        displayName: row.Name,
      };
    },

    async findByPhone(actor, phone) {
      const tenantId = requireMasterDataTenantId(actor.tenantId, 'customers.findByPhone');
      const { getPool } = await import('@/lib/db');
      const db = await getPool();
      const result = await db
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('phone', sql.NVarChar(200), phone)
        .query(`
          SELECT TOP 1 ClientID, [Name], Mobile
          FROM dbo.TblClient WITH (NOLOCK)
          WHERE TenantId = @tenantId AND Mobile = @phone;
        `);
      if (!result.recordset.length) return null;
      const row = result.recordset[0] as {
        ClientID: number;
        Name: string | null;
        Mobile: string | null;
      };
      return {
        customerId: row.ClientID,
        phone: row.Mobile,
        displayName: row.Name,
      };
    },
  };
}

export type { CustomerSnapshot, CustomersPort };
