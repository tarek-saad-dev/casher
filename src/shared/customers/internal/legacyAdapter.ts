import 'server-only';
import { sql } from '@/lib/db';
import {
  isUsableCustomerPhone,
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import type { CustomerSnapshot, CustomersPort } from '../public/ports';

/**
 * Anti-corruption adapter over legacy TblClient.
 * Live rows use [Name] and Mobile. Do not filter or write a deletion flag.
 * Every read/write is bound to the actor's authoritative TenantId (DRVO-015).
 *
 * Empty / placeholder phones never match existing rows (avoids smoke-client collision).
 * On usable-phone match, displayName is applied when it differs from the stored name.
 */
export function createLegacyCustomersAdapter(): CustomersPort {
  return {
    async upsertByPhone(tx, actor, input) {
      const tenantId = requireMasterDataTenantId(actor.tenantId, 'customers.upsertByPhone');
      const cleanedPhone = normalizePublicBookingPhone(input.phone ?? '');
      const usablePhone = isUsableCustomerPhone(cleanedPhone) ? cleanedPhone : '';
      const displayName = String(input.displayName ?? '').trim() || usablePhone || cleanedPhone || 'عميل';

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
          const previous = existing.recordset[0].Name != null
            ? String(existing.recordset[0].Name)
            : null;
          if (
            displayName.length >= 2 &&
            displayName.localeCompare(previous ?? '', undefined, { sensitivity: 'accent' }) !== 0
          ) {
            await new sql.Request(tx)
              .input('tenantId', sql.UniqueIdentifier, tenantId)
              .input('id', sql.Int, clientId)
              .input('name', sql.NVarChar(200), displayName)
              .query(`
                UPDATE dbo.TblClient
                SET [Name] = @name
                WHERE ClientID = @id AND TenantId = @tenantId;
              `);
          }
          return clientId;
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
      }

      // Placeholder / empty phone: always create a new client (Mobile NULL).
      const insert = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('name', sql.NVarChar(200), displayName)
        .query(`
          INSERT INTO dbo.TblClient (TenantId, [Name], Mobile, RegisterDate)
          OUTPUT INSERTED.ClientID AS id
          VALUES (@tenantId, @name, NULL, GETDATE());
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
      const cleanedPhone = normalizePublicBookingPhone(phone ?? '');
      if (!isUsableCustomerPhone(cleanedPhone)) return null;
      const { getPool } = await import('@/lib/db');
      const db = await getPool();
      const result = await db
        .request()
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('phone', sql.NVarChar(200), cleanedPhone)
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
