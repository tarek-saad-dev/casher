import { getPool, sql } from '@/lib/db';
import {
  getClientMobileLookupSuffix,
  TBL_CLIENT_MOBILE_SUFFIX_SQL,
} from '@/lib/client/publicClientWebsite.helpers';

export type ClientPhoneLookupResult = {
  clientId: number | null;
  ambiguous: boolean;
  matchCount: number;
};

/**
 * Read-only ERP client resolution by phone suffix.
 * Reuses canonical TblClient mobile suffix matching — no customer creation.
 */
export async function lookupClientIdByPhone(phone: string): Promise<ClientPhoneLookupResult> {
  const suffix = getClientMobileLookupSuffix(phone);
  if (!suffix) {
    return { clientId: null, ambiguous: false, matchCount: 0 };
  }

  const pool = await getPool();
  const result = await pool
    .request()
    .input('suffix', sql.NVarChar(10), suffix)
    .query(`
      SELECT [ClientID] AS clientId
      FROM [dbo].[TblClient]
      WHERE ${TBL_CLIENT_MOBILE_SUFFIX_SQL} = @suffix
    `);

  const rows = result.recordset as Array<{ clientId: number | string }>;
  const matchCount = rows.length;
  if (matchCount === 0) {
    return { clientId: null, ambiguous: false, matchCount: 0 };
  }
  if (matchCount > 1) {
    return { clientId: null, ambiguous: true, matchCount };
  }
  return { clientId: Number(rows[0]!.clientId), ambiguous: false, matchCount: 1 };
}
