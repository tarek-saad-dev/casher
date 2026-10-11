import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { createSession } from '@/lib/session';
import { BRANCH_SESSION_VERSION } from '@/lib/session-types';
import {
  PublicSignupError,
  provisionPublicSignup,
} from '@/platform/publicSignup/service';

export const runtime = 'nodejs';

function requestIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || null;
  return req.headers.get('x-real-ip')?.trim() || null;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'بيانات التسجيل غير صحيحة.', code: 'BODY_INVALID' },
      { status: 400 },
    );
  }

  try {
    const result = await provisionPublicSignup(body, { ip: requestIp(req) });

    const pool = await getPool();
    const session = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, result.tenantId)
      .input('loginName', sql.NVarChar(50), result.ownerLoginName)
      .input('branchCode', sql.NVarChar(64), result.branchCode)
      .query(`
        SELECT TOP 1
          u.UserID,
          u.UserName,
          u.UserLevel,
          m.MembershipId,
          l.LegacyBranchId AS BranchID,
          l.BranchCode
        FROM dbo.TenantMembership m
        INNER JOIN dbo.TblUser u
          ON u.UserID=m.LegacyUserId AND ISNULL(u.isDeleted,0)=0
        INNER JOIN dbo.Location l
          ON l.TenantId=m.TenantId AND l.BranchCode=@branchCode
        WHERE m.TenantId=@tenantId
          AND u.loginName=@loginName;
      `);
    const row = session.recordset[0] as
      | {
          UserID: number;
          UserName: string;
          UserLevel: 'admin' | 'user';
          MembershipId: string;
          BranchID: number;
          BranchCode: string;
        }
      | undefined;
    if (!row) {
      throw new PublicSignupError(
        'SESSION_BOOTSTRAP_FAILED',
        'الحساب اتعمل، لكن تعذر فتحه تلقائياً. استخدم تسجيل الدخول.',
        500,
      );
    }

    await createSession({
      UserID: Number(row.UserID),
      UserName: String(row.UserName),
      UserLevel: row.UserLevel === 'admin' ? 'admin' : 'user',
      ActiveBranchID: Number(row.BranchID),
      ActiveBranchCode: String(row.BranchCode),
      BranchSessionVersion: BRANCH_SESSION_VERSION,
      TenantId: result.tenantId,
      MembershipId: String(row.MembershipId),
    });

    return NextResponse.json(
      {
        ok: true,
        tenantId: result.tenantId,
        tenantCode: result.tenantCode,
        ownerLoginName: result.ownerLoginName,
        trialEndsAt: result.trialEndsAt,
        nextPath: result.nextPath,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof PublicSignupError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    console.error('[public-signup] unexpected failure', err);
    return NextResponse.json(
      { error: 'تعذر إنشاء الحساب دلوقتي.', code: 'SIGNUP_FAILED' },
      { status: 500 },
    );
  }
}
