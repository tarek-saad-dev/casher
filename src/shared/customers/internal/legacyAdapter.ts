import 'server-only';
import { sql } from '@/lib/db';
import type { CustomerSnapshot, CustomersPort } from '../public/ports';

/**
 * Anti-corruption adapter over legacy TblClient.
 * Live rows use [Name] and Mobile. Do not filter or write a deletion flag.
 */
export function createLegacyCustomersAdapter(): CustomersPort {
  return {
    async upsertByPhone(tx, _actor, input) {
      const existing = await new sql.Request(tx)
        .input('phone', sql.NVarChar(200), input.phone)
        .query(`
          SELECT TOP 1 ClientID
          FROM dbo.TblClient WITH (UPDLOCK, HOLDLOCK)
          WHERE Mobile = @phone;
        `);
      if (existing.recordset.length) {
        return Number(existing.recordset[0].ClientID);
      }
      const insert = await new sql.Request(tx)
        .input('phone', sql.NVarChar(200), input.phone)
        .input('name', sql.NVarChar(200), input.displayName ?? input.phone)
        .query(`
          INSERT INTO dbo.TblClient ([Name], Mobile, RegisterDate)
          OUTPUT INSERTED.ClientID AS id
          VALUES (@name, @phone, GETDATE());
        `);
      return Number(insert.recordset[0].id);
    },

    async get(_actor, customerId) {
      const { getPool } = await import('@/lib/db');
      const db = await getPool();
      const result = await db
        .request()
        .input('id', sql.Int, customerId)
        .query(`
          SELECT ClientID, [Name], Mobile
          FROM dbo.TblClient WITH (NOLOCK)
          WHERE ClientID = @id;
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

    async findByPhone(_actor, phone) {
      const { getPool } = await import('@/lib/db');
      const db = await getPool();
      const result = await db
        .request()
        .input('phone', sql.NVarChar(200), phone)
        .query(`
          SELECT TOP 1 ClientID, [Name], Mobile
          FROM dbo.TblClient WITH (NOLOCK)
          WHERE Mobile = @phone;
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
