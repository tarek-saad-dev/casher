/**
 * Phase 1G — per-branch operational readiness report (pre-open checklist).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchByCode, getBranchById, branchNow } from './repository';
import { listBookableEmployeeIdsForBranch } from './bookingQueueOwnership';
import { getPartnerShareConfigurationTimeline } from './partnerShares';
import { auditEmployeeAssignmentIntegrity } from './assignmentIntegrity';

export type ReadinessCheck = {
  code: string;
  ok: boolean;
  severity: 'blocker' | 'warning' | 'info';
  message: string;
};

export type BranchReadinessReport = {
  checkedAt: string;
  branchId: number;
  branchCode: string;
  branchName: string;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  checks: ReadinessCheck[];
};

export async function evaluateBranchOperationalReadiness(
  branchRef: { branchId?: number; branchCode?: string },
  at: Date = branchNow(),
): Promise<BranchReadinessReport> {
  const day = at.toISOString().slice(0, 10);
  const branch = branchRef.branchId
    ? await getBranchById(branchRef.branchId)
    : branchRef.branchCode
      ? await getBranchByCode(branchRef.branchCode)
      : null;

  if (!branch) {
    return {
      checkedAt: at.toISOString(),
      branchId: branchRef.branchId ?? 0,
      branchCode: branchRef.branchCode ?? '',
      branchName: '',
      ready: false,
      blockers: ['BRANCH_NOT_FOUND'],
      warnings: [],
      checks: [
        {
          code: 'BRANCH_EXISTS',
          ok: false,
          severity: 'blocker',
          message: 'Branch not found',
        },
      ],
    };
  }

  const db = await getPool();
  const checks: ReadinessCheck[] = [];

  checks.push({
    code: 'BRANCH_ACTIVE',
    ok: branch.isActive,
    severity: 'blocker',
    message: branch.isActive ? 'Branch is active' : 'Branch IsActive=0',
  });

  checks.push({
    code: 'BRANCH_METADATA',
    ok: Boolean(branch.branchCode && branch.branchName && branch.timeZone && branch.businessDayCutoffTime),
    severity: 'blocker',
    message: 'Required metadata present (code, name, timezone, cutoff)',
  });

  const settings = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .query(`
      SELECT TOP 1 SettingID, BookingEnabled, SalonName, Timezone
      FROM dbo.QueueBookingSettings
      WHERE BranchID = @branchId
    `);
  const hasSettings = settings.recordset.length > 0;
  checks.push({
    code: 'QUEUE_SETTINGS',
    ok: hasSettings,
    severity: 'blocker',
    message: hasSettings
      ? 'QueueBookingSettings row exists'
      : 'Missing QueueBookingSettings for branch',
  });

  if (hasSettings) {
    const bookingEnabled = Boolean(settings.recordset[0].BookingEnabled);
    checks.push({
      code: 'PUBLIC_BOOKING_FLAG',
      ok: true,
      severity: bookingEnabled ? 'info' : 'warning',
      message: bookingEnabled
        ? 'Public BookingEnabled=1'
        : 'Public BookingEnabled=0 (ops may still work)',
    });
  }

  const bookable = await listBookableEmployeeIdsForBranch(branch.branchId, day);
  checks.push({
    code: 'ELIGIBLE_BARBER',
    ok: bookable.length > 0,
    severity: 'blocker',
    message:
      bookable.length > 0
        ? `${bookable.length} bookable employee(s) assigned`
        : 'No eligible barber with CanReceiveBookings on this branch',
  });

  const operators = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('at', sql.DateTime2, at)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblUserBranchAccess uba
      INNER JOIN dbo.TblUser u ON u.UserID = uba.UserID
      WHERE uba.BranchID = @branchId
        AND uba.IsActive = 1
        AND uba.CanOperate = 1
        AND ISNULL(u.isDeleted, 0) = 0
        AND uba.ValidFrom <= @at
        AND (uba.ValidTo IS NULL OR uba.ValidTo >= @at)
    `);
  const opCount = Number(operators.recordset[0].cnt);
  checks.push({
    code: 'OPERATOR_ACCESS',
    ok: opCount > 0,
    severity: 'blocker',
    message:
      opCount > 0
        ? `${opCount} user(s) with CanOperate access`
        : 'No user has CanOperate access on this branch (session cannot target it without access; switcher still deferred)',
  });

  const reportViewers = await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('at', sql.DateTime2, at)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblUserBranchAccess uba
      WHERE uba.BranchID = @branchId
        AND uba.IsActive = 1
        AND uba.CanViewReports = 1
        AND uba.ValidFrom <= @at
        AND (uba.ValidTo IS NULL OR uba.ValidTo >= @at)
    `);
  const viewerCount = Number(reportViewers.recordset[0].cnt);
  checks.push({
    code: 'REPORT_VISIBILITY',
    ok: viewerCount > 0,
    severity: 'warning',
    message:
      viewerCount > 0
        ? `${viewerCount} user(s) with CanViewReports`
        : 'No CanViewReports access yet',
  });

  const timeline = await getPartnerShareConfigurationTimeline(branch.branchId);
  const openShares = timeline.filter(
    (r) =>
      r.isActive &&
      r.effectiveFrom <= day &&
      (r.effectiveTo == null || r.effectiveTo >= day),
  );
  const shareSum = openShares.reduce((s, r) => s + r.sharePercent, 0);
  const sharesOk = openShares.length > 0 && Math.abs(shareSum - 100) < 0.0001;
  checks.push({
    code: 'PARTNER_SHARES',
    ok: sharesOk,
    severity: 'warning',
    message: sharesOk
      ? `Partner shares configured (sum=${shareSum})`
      : openShares.length
        ? `Partner shares sum ${shareSum} (expected ~100)`
        : 'No effective partner shares (partner reports will fail)',
  });

  // Business day / shift readiness: schema + service availability (no open required)
  const dayCol = await db.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.TblNewDay', N'BranchID') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  const shiftCol = await db.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.TblShiftMove', N'BranchID') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  checks.push({
    code: 'BUSINESS_DAY_SCHEMA',
    ok: Number(dayCol.recordset[0].ok) === 1,
    severity: 'blocker',
    message: 'TblNewDay.BranchID present',
  });
  checks.push({
    code: 'SHIFT_SCHEMA',
    ok: Number(shiftCol.recordset[0].ok) === 1,
    severity: 'blocker',
    message: 'TblShiftMove.BranchID present',
  });

  const bookingCol = await db.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.Bookings', N'BranchID') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  const queueCol = await db.request().query(`
    SELECT CASE WHEN COL_LENGTH(N'dbo.QueueTickets', N'BranchID') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  checks.push({
    code: 'BOOKING_SCHEMA',
    ok: Number(bookingCol.recordset[0].ok) === 1,
    severity: 'blocker',
    message: 'Bookings.BranchID present',
  });
  checks.push({
    code: 'QUEUE_SCHEMA',
    ok: Number(queueCol.recordset[0].ok) === 1,
    severity: 'blocker',
    message: 'QueueTickets.BranchID present',
  });

  const assignmentAudit = await auditEmployeeAssignmentIntegrity(at);
  const branchAssignmentErrors = assignmentAudit.issues.filter(
    (i) =>
      i.severity === 'error' &&
      (i.branchId == null || i.branchId === branch.branchId),
  );
  checks.push({
    code: 'ASSIGNMENT_INTEGRITY',
    ok: branchAssignmentErrors.length === 0,
    severity: 'blocker',
    message:
      branchAssignmentErrors.length === 0
        ? 'No assignment integrity errors for this branch scope'
        : `${branchAssignmentErrors.length} assignment integrity error(s)`,
  });

  const blockers = checks.filter((c) => !c.ok && c.severity === 'blocker').map((c) => c.code);
  const warnings = checks.filter((c) => !c.ok && c.severity === 'warning').map((c) => c.code);

  return {
    checkedAt: at.toISOString(),
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    ready: blockers.length === 0,
    blockers,
    warnings,
    checks,
  };
}
