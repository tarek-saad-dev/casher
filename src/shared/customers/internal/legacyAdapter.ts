import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type { ActorContext } from '@/platform/public';
import type { CustomerSnapshot, CustomersPort } from '../public/ports';

/** Anti-corruption adapter over legacy TblClient. */
export function createLegacyCustomersAdapter(): CustomersPort {
  return {
    async upsertByPhone(tx, _actor, input) {
      const req = new sql.Request(tx)
        .input('phone', sql.NVarChar(32), input.phone)
        .input('name', sql.NVarChar(200), input.displayName ?? null);
      const existing = await req.query(`
        SELECT TOP 1 ClientID FROM dbo.TblClient WITH (UPDLOCK, HOLDLOCK)
        WHERE Phone = @phone AND ISNULL(isDeleted, 0) = 0;
      `);
      if (existing.recordset.length) {
        return Number(existing.recordset[0].ClientID);
      }
      const insert = await new sql.Request(tx)
        .input('phone', sql.NVarChar(32), input.phone)
        .input('name', sql.NVarChar(200), input.displayName ?? input.phone)
        .query(`
          INSERT INTO dbo.TblClient (Phone, ClientName)
          OUTPUT INSERTED.ClientID AS id
          VALUES (@phone, @name);
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
          SELECT ClientID, Phone, ClientName
          FROM dbo.TblClient WITH (NOLOCK)
          WHERE ClientID = @id AND ISNULL(isDeleted, 0) = 0;
        `);
      if (!result.recordset.length) return null;
      const row = result.recordset[0] as {
        ClientID: number;
        Phone: string | null;
        ClientName: string | null;
      };
      return {
        customerId: row.ClientID,
        phone: row.Phone,
        displayName: row.ClientName,
      };
    },

    async findByPhone(_actor, phone) {
      const { getPool } = await import('@/lib/db');
      const db = await getPool();
      const result = await db
        .request()
        .input('phone', sql.NVarChar(32), phone)
        .query(`
          SELECT TOP 1 ClientID, Phone, ClientName
          FROM dbo.TblClient WITH (NOLOCK)
          WHERE Phone = @phone AND ISNULL(isDeleted, 0) = 0;
        `);
      if (!result.recordset.length) return null;
      const row = result.recordset[0] as {
        ClientID: number;
        Phone: string | null;
        ClientName: string | null;
      };
      return {
        customerId: row.ClientID,
        phone: row.Phone,
        displayName: row.ClientName,
      };
    },
  };
}

export type { CustomerSnapshot, CustomersPort };
