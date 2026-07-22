import { NextResponse } from "next/server";
import { getSession, destroySession } from "@/lib/session";
import { getPool, getUserFriendlyError, sql } from "@/lib/db";
import { getPermissions } from "@/lib/permissions";
import { getUserAccess } from "@/lib/permissions-server";
import { getUserActiveStatus } from "@/lib/branch/repository";
import { getActiveBranchContext } from "@/lib/branch/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildAuthoritativePermissions(args: {
  userLevel: string;
  isSuperAdmin: boolean;
  roles: string[];
  isPartnerOnly: boolean;
  allowedPageKeys: string[];
}): string[] {
  const isAuthAdmin =
    args.isSuperAdmin ||
    args.userLevel === "admin" ||
    args.roles.includes("admin") ||
    args.roles.includes("super_admin");

  if (args.isPartnerOnly) {
    return [...args.allowedPageKeys];
  }

  const legacy = getPermissions(isAuthAdmin ? "admin" : "user");
  return [...new Set([...legacy, ...args.allowedPageKeys])];
}

// GET /api/auth/session — returns full operational session state
export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({
        user: null,
        day: null,
        shift: null,
        permissions: [],
        roles: [],
        allowedPagePaths: [],
        activeBranch: null,
      });
    }

    const status = await getUserActiveStatus(user.UserID);
    if (!status.exists || status.isDeleted) {
      await destroySession();
      return NextResponse.json(
        {
          user: null,
          day: null,
          shift: null,
          permissions: [],
          roles: [],
          allowedPagePaths: [],
          activeBranch: null,
          error: "تم تعطيل الحساب",
          code: "USER_DELETED",
        },
        { status: 401 },
      );
    }

    const branchContext = await getActiveBranchContext();
    if (!branchContext) {
      await destroySession();
      return NextResponse.json(
        {
          user: null,
          day: null,
          shift: null,
          permissions: [],
          roles: [],
          allowedPagePaths: [],
          activeBranch: null,
          error: "يلزم إعادة تسجيل الدخول لتحديث جلسة الفرع",
          code: "SESSION_UPGRADE_REQUIRED",
        },
        { status: 401 },
      );
    }

    const db = await getPool();

    // Get current open business day (unchanged singleton logic in Phase 1B)
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay, Status
      FROM [dbo].[TblNewDay]
      WHERE Status = 1
      ORDER BY ID DESC
    `);
    const day = dayResult.recordset.length > 0 ? dayResult.recordset[0] : null;

    // Get current open shift for THIS authenticated user only
    const shiftResult = await db.request().input("userID", sql.Int, user.UserID)
      .query(`
        SELECT TOP 1
          sm.ID, sm.NewDay, sm.UserID, sm.ShiftID,
          sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
          u.UserName,
          s.ShiftName
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.Status = 1 AND sm.UserID = @userID
        ORDER BY sm.ID DESC
      `);
    const shift =
      shiftResult.recordset.length > 0 ? shiftResult.recordset[0] : null;

    const access = await getUserAccess(user.UserID, user.UserName, user.UserLevel);
    const permissions = buildAuthoritativePermissions({
      userLevel: user.UserLevel,
      isSuperAdmin: access.isSuperAdmin,
      roles: access.roles,
      isPartnerOnly: access.isPartnerOnly,
      allowedPageKeys: access.allowedPageKeys,
    });

    return NextResponse.json({
      user: {
        UserID: user.UserID,
        UserName: user.UserName,
        UserLevel: user.UserLevel,
        ActiveBranchID: user.ActiveBranchID,
        ActiveBranchCode: user.ActiveBranchCode,
        BranchSessionVersion: user.BranchSessionVersion,
      },
      day,
      shift,
      permissions,
      roles: access.roles,
      allowedPagePaths: access.allowedPagePaths,
      activeBranch: {
        BranchID: branchContext.branchId,
        BranchCode: branchContext.branchCode,
        BranchName: branchContext.branchName,
        ShortName: branchContext.shortName,
        TimeZone: branchContext.timeZone,
        BusinessDayCutoffTime: branchContext.businessDayCutoffTime,
        CanOperate: branchContext.canOperate,
        CanViewReports: branchContext.canViewReports,
        CanSwitch: branchContext.canSwitch,
      },
    });
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/session] GET error:", rawMessage);
    const userMessage = getUserFriendlyError(err);
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}

// DELETE /api/auth/session — logout
export async function DELETE() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/session] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
