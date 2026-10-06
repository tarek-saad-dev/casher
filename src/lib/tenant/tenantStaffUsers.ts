import 'server-only';
import { getPool, sql } from '@/lib/db';
import { assertCanAddUser } from '@/platform/commercial/limits';
import { ensureLegacyIdMapInTransaction } from '@/platform/onboarding/legacyIdMap';

export type CreatedTenantStaffUser = {
  UserID: number;
  UserName: string;
  loginName: string;
  UserLevel: string;
  ShiftID: number;
  membershipId: string;
};

export type CreateTenantStaffUserResult =
  | { ok: true; user: CreatedTenantStaffUser }
  | { ok: false; code: 'LOGIN_NAME_TAKEN' };

/**
 * DRVO-013: a legacy TblUser row is only reachable through a TenantMembership. The user, its
 * membership in the creator's tenant and the LegacyIdMap row are written atomically, behind the
 * DRVO-012 tenant user limit (which also serializes concurrent adds for the tenant).
 * loginName stays globally unique because login has no tenant selector.
 */
export async function createTenantStaffUser(input: {
  tenantId: string;
  userName: string;
  loginName: string;
  password: string;
  userLevel: string;
  shiftId: number;
}): Promise<CreateTenantStaffUserResult> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await assertCanAddUser(tx, input.tenantId);

    const dup = await new sql.Request(tx)
      .input('loginName', sql.NVarChar(50), input.loginName)
      .query(`
        SELECT UserID FROM dbo.TblUser WITH (UPDLOCK, HOLDLOCK)
        WHERE loginName = @loginName AND ISNULL(isDeleted, 0) = 0;
      `);
    if (dup.recordset.length > 0) {
      await tx.rollback();
      return { ok: false, code: 'LOGIN_NAME_TAKEN' };
    }

    const inserted = await new sql.Request(tx)
      .input('UserName', sql.NVarChar(50), input.userName)
      .input('loginName', sql.NVarChar(50), input.loginName)
      .input('Password', sql.NVarChar(50), input.password)
      .input('UserLevel', sql.NVarChar(20), input.userLevel)
      .input('ShiftID', sql.Int, input.shiftId)
      .input('CardNO', sql.NVarChar(50), '')
      .query(`
        INSERT INTO dbo.TblUser (UserName, loginName, Password, UserLevel, ShiftID, CardNO, isDeleted)
        OUTPUT INSERTED.UserID, INSERTED.UserName, INSERTED.loginName, INSERTED.UserLevel, INSERTED.ShiftID
        VALUES (@UserName, @loginName, @Password, @UserLevel, @ShiftID, @CardNO, 0);
      `);
    const row = inserted.recordset[0] as {
      UserID: number;
      UserName: string;
      loginName: string;
      UserLevel: string;
      ShiftID: number;
    };

    const membership = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .input('legacyUserId', sql.Int, row.UserID)
      .query(`
        INSERT INTO dbo.TenantMembership (TenantId, LegacyUserId)
        OUTPUT INSERTED.MembershipId AS membershipId
        VALUES (@tenantId, @legacyUserId);
      `);
    const membershipId = String(
      (membership.recordset[0] as { membershipId: string }).membershipId,
    );

    await ensureLegacyIdMapInTransaction(tx, {
      tenantId: input.tenantId,
      entityName: 'staff_user',
      legacyKey: String(row.UserID),
      authoritativeDrvoId: membershipId,
    });

    await tx.commit();
    return {
      ok: true,
      user: {
        UserID: Number(row.UserID),
        UserName: String(row.UserName),
        loginName: String(row.loginName),
        UserLevel: String(row.UserLevel),
        ShiftID: Number(row.ShiftID),
        membershipId,
      },
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
