import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  TBL_CLIENT_MOBILE_SUFFIX_SQL,
  getClientMobileLookupSuffix,
  type PublicClientWebsiteProfile,
  type PublicClientWebsiteUpdateInput,
  validateClientWebsiteEmail,
} from '@/lib/client/publicClientWebsite.helpers';

let tblClientHasEmailColumn: boolean | null = null;

async function hasEmailColumn(db: Awaited<ReturnType<typeof getPool>>): Promise<boolean> {
  if (tblClientHasEmailColumn !== null) return tblClientHasEmailColumn;
  const result = await db.request().query(`
    SELECT COL_LENGTH(N'dbo.TblClient', N'Email') AS Len
  `);
  tblClientHasEmailColumn = Number(result.recordset[0]?.Len ?? 0) > 0;
  return tblClientHasEmailColumn;
}

function mapProfileRow(
  row: Record<string, unknown>,
  includeEmail: boolean,
): PublicClientWebsiteProfile {
  return {
    id: Number(row.id),
    name: row.name != null ? String(row.name) : null,
    mobile: row.mobile != null ? String(row.mobile) : null,
    phone: row.phone != null ? String(row.phone) : null,
    address: row.address != null ? String(row.address) : null,
    email: includeEmail && row.email != null ? String(row.email) : null,
  };
}

export async function lookupClientByMobile(
  mobile: string,
): Promise<PublicClientWebsiteProfile | null> {
  const suffix = getClientMobileLookupSuffix(mobile);
  if (!suffix) return null;

  const db = await getPool();
  const includeEmail = await hasEmailColumn(db);
  const emailSelect = includeEmail ? ', Email AS email' : ', NULL AS email';

  const result = await db
    .request()
    .input('suffix', sql.NVarChar(10), suffix)
    .query(`
      SELECT TOP 1
        ClientID AS id,
        [Name] AS name,
        Mobile AS mobile,
        Phone AS phone,
        Address AS address
        ${emailSelect}
      FROM dbo.TblClient
      WHERE ${TBL_CLIENT_MOBILE_SUFFIX_SQL} = @suffix
    `);

  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return mapProfileRow(row, includeEmail);
}

export async function updateClientWebsiteProfile(
  input: PublicClientWebsiteUpdateInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { clientId, name, phone, mobile, address, email } = input;

  if (name !== undefined && name.trim().length === 0) {
    return { ok: false, message: 'name cannot be empty' };
  }

  const emailError = validateClientWebsiteEmail(email);
  if (emailError) {
    return { ok: false, message: emailError };
  }

  const db = await getPool();
  const includeEmail = email !== undefined ? await hasEmailColumn(db) : false;

  if (email !== undefined && !includeEmail) {
    return { ok: false, message: 'email is not supported' };
  }

  const setClauses: string[] = [];
  const request = db.request().input('clientID', sql.Int, clientId);

  if (name !== undefined) {
    setClauses.push('[Name] = @name');
    request.input('name', sql.NVarChar(100), name.trim());
  }
  if (phone !== undefined) {
    setClauses.push('Phone = @phone');
    request.input('phone', sql.NVarChar(30), phone);
  }
  if (mobile !== undefined) {
    setClauses.push('Mobile = @mobile');
    request.input('mobile', sql.NVarChar(30), mobile);
  }
  if (address !== undefined) {
    setClauses.push('Address = @address');
    request.input('address', sql.NVarChar(200), address);
  }
  if (email !== undefined && includeEmail) {
    setClauses.push('Email = @email');
    request.input('email', sql.NVarChar(200), email);
  }

  if (setClauses.length === 0) {
    return { ok: false, message: 'No fields to update' };
  }

  const updateResult = await request.query(`
    UPDATE dbo.TblClient
    SET ${setClauses.join(', ')}
    WHERE ClientID = @clientID
  `);

  const rowsAffected = updateResult.rowsAffected?.[0] ?? 0;
  if (rowsAffected === 0) {
    return { ok: false, message: 'Client not found' };
  }

  return { ok: true };
}
