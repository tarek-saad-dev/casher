import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { grantStaffAccessToAllActiveBranches } from '@/lib/branch/userLoginBranch';
import { validateUserBranchAccess } from '@/lib/branch/access';
import { BranchDomainError } from '@/lib/branch/types';
import { branchErrorResponse } from '@/lib/branch/operationalGates';

// GET /api/users/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.view')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const db = await getPool();
    const result = await db
      .request()
      .input('id', sql.Int, parseInt(id, 10))
      .query(`
        SELECT u.UserID, u.UserName, u.UserLevel, u.loginName, u.ShiftID, u.CardNO,
               s.ShiftName,
               def.BranchID AS DefaultBranchID,
               b.BranchCode AS DefaultBranchCode,
               b.BranchName AS DefaultBranchName
        FROM [dbo].[TblUser] u
        LEFT JOIN [dbo].[TblShift] s ON u.ShiftID = s.ShiftID
        LEFT JOIN [dbo].[TblUserBranchAccess] def
          ON def.UserID = u.UserID AND def.IsDefault = 1 AND def.IsActive = 1
        LEFT JOIN [dbo].[TblBranch] b ON b.BranchID = def.BranchID
        WHERE u.UserID = @id AND u.isDeleted = 0
      `);
    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }
    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/users/[id] — Update user (optional BranchID sets login default)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.edit')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id, 10);
    const body = await req.json();
    const { UserName, loginName, Password, UserLevel, ShiftID, BranchID } = body;

    const db = await getPool();
    const r = db.request().input('id', sql.Int, userId);

    const sets: string[] = [];
    if (UserName) {
      r.input('UserName', sql.NVarChar(50), UserName);
      sets.push('UserName = @UserName');
    }
    if (loginName) {
      r.input('loginName', sql.NVarChar(50), loginName);
      sets.push('loginName = @loginName');
    }
    if (Password) {
      r.input('Password', sql.NVarChar(50), Password);
      sets.push('Password = @Password');
    }
    if (UserLevel) {
      r.input('UserLevel', sql.NVarChar(20), UserLevel);
      sets.push('UserLevel = @UserLevel');
    }
    if (ShiftID) {
      r.input('ShiftID', sql.Int, ShiftID);
      sets.push('ShiftID = @ShiftID');
    }

    if (sets.length === 0 && (BranchID == null || BranchID === '')) {
      return NextResponse.json({ error: 'لا توجد بيانات للتحديث' }, { status: 400 });
    }

    if (sets.length > 0) {
      await r.query(`UPDATE [dbo].[TblUser] SET ${sets.join(', ')} WHERE UserID = @id`);
    }

    let loginBranch: Awaited<ReturnType<typeof grantStaffAccessToAllActiveBranches>> | null = null;
    if (BranchID != null && BranchID !== '') {
      const branchId = Number(BranchID);
      if (!Number.isFinite(branchId) || branchId <= 0) {
        return NextResponse.json({ error: 'فرع غير صالح' }, { status: 400 });
      }
      await validateUserBranchAccess(sessionUser.UserID, branchId);
      // Heal missing access + enable free switching across all active branches.
      loginBranch = await grantStaffAccessToAllActiveBranches({
        userId,
        actorUserId: sessionUser.UserID,
        preferredBranchId: branchId,
        grantReason: 'user-edit-all-active-branches',
      });
    }

    console.log(`[users] Updated UserID=${id} by ${sessionUser.UserName}`);

    return NextResponse.json({
      ok: true,
      ...(loginBranch
        ? {
            DefaultBranchID: loginBranch.branchId,
            DefaultBranchCode: loginBranch.branchCode,
            DefaultBranchName: loginBranch.branchName,
          }
        : {}),
    });
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status || 403 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/users/[id] — Soft-delete user
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, 'users.delete')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const userID = parseInt(id, 10);

    if (sessionUser.UserID === userID) {
      return NextResponse.json({ error: 'لا يمكنك حذف حسابك الحالي' }, { status: 400 });
    }

    const db = await getPool();
    await db
      .request()
      .input('id', sql.Int, userID)
      .query(`UPDATE [dbo].[TblUser] SET isDeleted = 1 WHERE UserID = @id`);

    console.log(`[users] Soft-deleted UserID=${userID} by ${sessionUser.UserName}`);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
