import { NextRequest, NextResponse } from "next/server";
import { getPool, getUserFriendlyError, sql } from "@/lib/db";
import { requireTenantSession } from "@/lib/api-auth";
import { hasPermission } from "@/lib/permissions";
import { grantStaffAccessToAllActiveBranches } from "@/lib/branch/userLoginBranch";
import { validateUserBranchAccess } from "@/lib/branch/access";
import { BranchDomainError } from "@/lib/branch/types";
import { branchErrorResponse } from "@/lib/branch/operationalGates";
import { createTenantStaffUser } from "@/lib/tenant/tenantStaffUsers";
import { CommercialError } from "@/platform/commercial/errors";
import {
  assertLegacyBranchInTenant,
  isTenantContextError,
} from "@/platform/tenant/tenantContext";

export const runtime = "nodejs";

// GET /api/users — Get all active users
export async function GET() {
  try {
    const user = await requireTenantSession();
    if (user instanceof NextResponse) return user;
    if (!hasPermission(user.UserLevel, "users.view")) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const db = await getPool();
    const result = await db
      .request()
      .input("tenantId", sql.UniqueIdentifier, user.TenantId)
      .query(`
      SELECT u.UserID, u.UserName, u.UserLevel, u.loginName, u.ShiftID, u.CardNO,
             s.ShiftName,
             def.BranchID AS DefaultBranchID,
             b.BranchCode AS DefaultBranchCode,
             b.BranchName AS DefaultBranchName
      FROM [dbo].[TblUser] u
      INNER JOIN [dbo].[TenantMembership] m
        ON m.LegacyUserId = u.UserID AND m.TenantId = @tenantId
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
    const sessionUser = await requireTenantSession();
    if (sessionUser instanceof NextResponse) return sessionUser;
    if (!hasPermission(sessionUser.UserLevel, "users.create")) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }
    const tenantId = sessionUser.TenantId;

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

    // Creator must themselves have access to the starting branch they assign,
    // and the branch must be a Location of the creator's tenant (non-disclosing).
    await validateUserBranchAccess(sessionUser.UserID, branchId);
    try {
      await assertLegacyBranchInTenant(tenantId, branchId);
    } catch (err) {
      if (isTenantContextError(err)) {
        return NextResponse.json({ error: "الفرع غير موجود" }, { status: 404 });
      }
      throw err;
    }

    const createdResult = await createTenantStaffUser({
      tenantId,
      userName: UserName,
      loginName,
      password: Password,
      userLevel: UserLevel || "user",
      shiftId: ShiftID || 1,
    });
    if (!createdResult.ok) {
      return NextResponse.json(
        { error: "اسم الدخول مستخدم بالفعل" },
        { status: 400 },
      );
    }
    const { UserID, UserName: createdName, loginName: createdLogin, UserLevel: createdLevel, ShiftID: createdShift } =
      createdResult.user;
    const created = {
      UserID,
      UserName: createdName,
      loginName: createdLogin,
      UserLevel: createdLevel,
      ShiftID: createdShift,
    };
    // Grant operate access on all active tenant branches so staff can switch freely.
    const loginBranch = await grantStaffAccessToAllActiveBranches({
      tenantId,
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
    if (err instanceof CommercialError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
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
