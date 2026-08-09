import { NextRequest, NextResponse } from "next/server";
import { getPool, getUserFriendlyError, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { grantStaffAccessToAllActiveBranches } from "@/lib/branch/userLoginBranch";
import { validateUserBranchAccess } from "@/lib/branch/access";
import { BranchDomainError } from "@/lib/branch/types";
import { branchErrorResponse } from "@/lib/branch/operationalGates";

export const runtime = "nodejs";

// GET /api/users — Get all active users
export async function GET() {
  try {
    const user = await getSession();
    if (!user || !hasPermission(user.UserLevel, "users.view")) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const db = await getPool();
    const result = await db.request().query(`
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
      WHERE u.isDeleted = 0
      ORDER BY u.UserID
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/users] GET error:", rawMessage);
    return NextResponse.json(
      { error: getUserFriendlyError(err) },
      { status: 500 },
    );
  }
}

// POST /api/users — Create a new user + default branch login link
export async function POST(req: NextRequest) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser || !hasPermission(sessionUser.UserLevel, "users.create")) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = await req.json();
    const { UserName, loginName, Password, UserLevel, ShiftID, BranchID } = body;

    if (!UserName || !loginName || !Password) {
      return NextResponse.json(
        { error: "يجب إدخال جميع البيانات المطلوبة" },
        { status: 400 },
      );
    }

    const branchId = Number(BranchID) || sessionUser.ActiveBranchID;
    if (!branchId || !Number.isFinite(branchId)) {
      return NextResponse.json(
        { error: "يجب تحديد فرع البداية للمستخدم" },
        { status: 400 },
      );
    }

    // Creator must themselves have access to the starting branch they assign.
    await validateUserBranchAccess(sessionUser.UserID, branchId);

    const db = await getPool();

    // Check duplicate loginName
    const dup = await db
      .request()
      .input("loginName", sql.NVarChar(50), loginName)
      .query(
        `SELECT UserID FROM [dbo].[TblUser] WHERE loginName = @loginName AND isDeleted = 0`,
      );
    if (dup.recordset.length > 0) {
      return NextResponse.json(
        { error: "اسم الدخول مستخدم بالفعل" },
        { status: 400 },
      );
    }

    const result = await db
      .request()
      .input("UserName", sql.NVarChar(50), UserName)
      .input("loginName", sql.NVarChar(50), loginName)
      .input("Password", sql.NVarChar(50), Password)
      .input("UserLevel", sql.NVarChar(20), UserLevel || "user")
      .input("ShiftID", sql.Int, ShiftID || 1)
      .input("CardNO", sql.NVarChar(50), "").query(`
        INSERT INTO [dbo].[TblUser] (UserName, loginName, Password, UserLevel, ShiftID, CardNO, isDeleted)
        OUTPUT INSERTED.UserID, INSERTED.UserName, INSERTED.loginName, INSERTED.UserLevel, INSERTED.ShiftID
        VALUES (@UserName, @loginName, @Password, @UserLevel, @ShiftID, @CardNO, 0)
      `);

    const created = result.recordset[0];
    // Grant operate access on all active branches so staff can switch freely.
    const loginBranch = await grantStaffAccessToAllActiveBranches({
      userId: Number(created.UserID),
      actorUserId: sessionUser.UserID,
      preferredBranchId: branchId,
      grantReason: "user-create-all-active-branches",
    });

    console.log(
      `[users] Created user: ${created.UserName} (start=${loginBranch.branchCode}, branches=${loginBranch.grantedBranchIds.length}) by ${sessionUser.UserName}`,
    );
    return NextResponse.json(
      {
        ...created,
        DefaultBranchID: loginBranch.branchId,
        DefaultBranchCode: loginBranch.branchCode,
        DefaultBranchName: loginBranch.branchName,
        GrantedBranchIds: loginBranch.grantedBranchIds,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    if (err instanceof BranchDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status || 403 },
      );
    }
    const rawMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/users] POST error:", rawMessage);
    return NextResponse.json(
      { error: getUserFriendlyError(err) },
      { status: 500 },
    );
  }
}
