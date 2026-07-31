import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getConfig } from '@/lib/integrations/whatsapp/config';
import {
  sendQuickWhatsAppMessage,
  isWhatsAppEnabled,
  type WhatsAppSendResult,
} from '@/lib/integrations/whatsapp';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';
import { getFullDayReport } from '@/lib/reports/full-day-report';
import { listActiveBranches } from '@/lib/branch';
import { composeOwnerDailyWhatsAppMessage } from '@/lib/hr/owner-daily-whatsapp-message';
import { dailyWaReasonAr } from '@/lib/hr/employee-daily-whatsapp-reasons';
import { JobType } from '@/lib/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_PREFERRED_NAME = 'طارق';

export type OwnerBranchWhatsAppMessage = {
  branchId: number;
  branchCode: string;
  branchName: string;
  message: string;
};

export type OwnerBranchWhatsAppSendResult = OwnerBranchWhatsAppMessage & {
  status: 'sent' | 'skipped' | 'failed' | 'dry_run';
  reason?: string;
  reasonAr?: string;
  result?: WhatsAppSendResult;
};

/**
 * Phase 1I: owner WhatsApp has no request session — iterate every *active*
 * branch independently. Never prefer GLEEM as an operational fallback when
 * other branches are active; with only GLEEM active, behavior is unchanged.
 *
 * SETUP / inactive branches are excluded so each live salon gets its own message.
 */
async function resolveOwnerReportBranchIds(): Promise<
  Array<{ branchId: number; branchCode: string; branchName: string }>
> {
  const active = await listActiveBranches();
  const operational = active.filter(
    (b) => b.isActive && b.lifecycleStatus !== 'SETUP',
  );
  const list = operational.length > 0 ? operational : active;
  if (list.length === 0) {
    throw new Error('لا يوجد فرع نشط لإرسال تقرير المالك');
  }
  return list.map((b) => ({
    branchId: b.branchId,
    branchCode: b.branchCode,
    branchName: b.branchName,
  }));
}

async function resolveOwnerPhone(): Promise<{
  phone: string | null;
  name: string;
  empId: number | null;
  source: 'manager_employee' | 'named_employee' | 'none';
}> {
  try {
    const db = await getPool();

    // Prefer registered manager employee (Job=مدير), match طارق first when multiple
    const managerResult = await db
      .request()
      .input('job', sql.NVarChar(50), JobType.MANAGER)
      .input('preferredName', sql.NVarChar(100), OWNER_PREFERRED_NAME)
      .query(`
      SELECT
        EmpID,
        EmpName,
        WhatsApp,
        Mobile,
        Job
      FROM dbo.TblEmp
      WHERE ISNULL(isActive, 1) = 1
        AND LTRIM(RTRIM(ISNULL(Job, N''))) = @job
      ORDER BY
        CASE
          WHEN EmpName = @preferredName THEN 0
          WHEN EmpName LIKE @preferredName + N'%' THEN 1
          WHEN EmpName LIKE N'%' + @preferredName + N'%' THEN 2
          ELSE 3
        END,
        EmpID
    `);

    const managerRow = managerResult.recordset[0] as
      | {
          EmpID: number;
          EmpName: string;
          WhatsApp: string | null;
          Mobile: string | null;
        }
      | undefined;

    if (managerRow) {
      return {
        phone: resolveEmployeeWhatsAppPhone(managerRow.WhatsApp, managerRow.Mobile),
        name: managerRow.EmpName || OWNER_PREFERRED_NAME,
        empId: Number(managerRow.EmpID),
        source: 'manager_employee',
      };
    }

    // Fallback: active employee named طارق (even if Job not set to مدير yet)
    const namedResult = await db
      .request()
      .input('name', sql.NVarChar(100), OWNER_PREFERRED_NAME)
      .query(`
        SELECT TOP 1 EmpID, EmpName, WhatsApp, Mobile
        FROM dbo.TblEmp
        WHERE ISNULL(isActive, 1) = 1
          AND (
            EmpName = @name
            OR EmpName LIKE @name + N'%'
            OR EmpName LIKE N'%' + @name + N'%'
          )
        ORDER BY
          CASE WHEN EmpName = @name THEN 0 ELSE 1 END,
          EmpID
      `);

    const namedRow = namedResult.recordset[0] as
      | {
          EmpID: number;
          EmpName: string;
          WhatsApp: string | null;
          Mobile: string | null;
        }
      | undefined;

    if (!namedRow) {
      return {
        phone: null,
        name: OWNER_PREFERRED_NAME,
        empId: null,
        source: 'none',
      };
    }

    return {
      phone: resolveEmployeeWhatsAppPhone(namedRow.WhatsApp, namedRow.Mobile),
      name: namedRow.EmpName || OWNER_PREFERRED_NAME,
      empId: Number(namedRow.EmpID),
      source: 'named_employee',
    };
  } catch (err) {
    console.warn('[owner-daily-whatsapp] phone lookup failed', err);
    return {
      phone: null,
      name: OWNER_PREFERRED_NAME,
      empId: null,
      source: 'none',
    };
  }
}

export interface OwnerReportRecipient {
  empId: number;
  name: string;
  /** الوظيفة/الدور كما هو مسجّل في النظام (TblEmp.Job) */
  role: string | null;
  phone: string | null;
  hasPhone: boolean;
  /** هل هو المستلم الأساسي الذي سيصله التقرير فعليًا */
  isPrimary: boolean;
}

/**
 * من الذي يستلم تقرير المالك اليومي؟
 * الأساس: كل موظف نشط دوره "مدير" (Job=مدير). المستلم الأساسي يفضّل طارق.
 * fallback: لو مفيش مدير مسجّل، نرجّع الموظف المسمى طارق.
 */
export async function resolveOwnerReportRecipients(): Promise<{
  recipients: OwnerReportRecipient[];
  primaryEmpId: number | null;
  roleLabel: string;
}> {
  const roleLabel = JobType.MANAGER;
  try {
    const db = await getPool();

    const managersResult = await db
      .request()
      .input('job', sql.NVarChar(50), JobType.MANAGER)
      .input('preferredName', sql.NVarChar(100), OWNER_PREFERRED_NAME)
      .query(`
        SELECT EmpID, EmpName, WhatsApp, Mobile, Job
        FROM dbo.TblEmp
        WHERE ISNULL(isActive, 1) = 1
          AND LTRIM(RTRIM(ISNULL(Job, N''))) = @job
        ORDER BY
          CASE
            WHEN EmpName = @preferredName THEN 0
            WHEN EmpName LIKE @preferredName + N'%' THEN 1
            WHEN EmpName LIKE N'%' + @preferredName + N'%' THEN 2
            ELSE 3
          END,
          EmpID
      `);

    const managerRows = managersResult.recordset as Array<{
      EmpID: number;
      EmpName: string;
      WhatsApp: string | null;
      Mobile: string | null;
      Job: string | null;
    }>;

    if (managerRows.length > 0) {
      const owner = await resolveOwnerPhone();
      const primaryEmpId = owner.empId ?? Number(managerRows[0].EmpID);
      const recipients: OwnerReportRecipient[] = managerRows.map((r) => {
        const phone = resolveEmployeeWhatsAppPhone(r.WhatsApp, r.Mobile);
        return {
          empId: Number(r.EmpID),
          name: r.EmpName || OWNER_PREFERRED_NAME,
          role: (r.Job && r.Job.trim()) || JobType.MANAGER,
          phone,
          hasPhone: !!phone,
          isPrimary: Number(r.EmpID) === primaryEmpId,
        };
      });
      return { recipients, primaryEmpId, roleLabel };
    }

    // Fallback: employee named طارق even if role not set to مدير
    const owner = await resolveOwnerPhone();
    if (owner.empId != null) {
      return {
        recipients: [
          {
            empId: owner.empId,
            name: owner.name,
            role: null,
            phone: owner.phone,
            hasPhone: !!owner.phone,
            isPrimary: true,
          },
        ],
        primaryEmpId: owner.empId,
        roleLabel,
      };
    }

    return { recipients: [], primaryEmpId: null, roleLabel };
  } catch (err) {
    console.warn('[owner-daily-whatsapp] recipients lookup failed', err);
    return { recipients: [], primaryEmpId: null, roleLabel };
  }
}

async function buildOwnerBranchMessages(
  workDate: string,
): Promise<OwnerBranchWhatsAppMessage[]> {
  const branches = await resolveOwnerReportBranchIds();
  const messages: OwnerBranchWhatsAppMessage[] = [];
  for (const b of branches) {
    const report = await getFullDayReport(workDate, b.branchId);
    const message = composeOwnerDailyWhatsAppMessage(report, {
      branchName: b.branchName,
    });
    messages.push({
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
      message,
    });
  }
  return messages;
}

export async function previewOwnerDailyWhatsApp(workDate: string): Promise<{
  workDate: string;
  ownerName: string;
  empId: number | null;
  phone: string | null;
  phoneSource: 'manager_employee' | 'named_employee' | 'none';
  /** Separate WhatsApp body per branch (one message each when sending). */
  messages: OwnerBranchWhatsAppMessage[];
  /** Joined preview for UI/logs only — not what gets sent as a single bubble. */
  message: string;
  ready: boolean;
  skipReason: string | null;
}> {
  if (!DATE_RE.test(workDate)) {
    throw new Error('workDate يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const cfg = getConfig();
  const messages = await buildOwnerBranchMessages(workDate);
  const message = messages
    .map((m) => `—— ${m.branchName} (${m.branchCode}) ——\n${m.message}`)
    .join('\n\n');
  const owner = await resolveOwnerPhone();

  let skipReason: string | null = null;
  if (!owner.phone) skipReason = 'no_phone';
  else if (!isWhatsAppEnabled()) skipReason = 'development_only';
  else if (!cfg.ownerDailyReportEnabled) skipReason = 'message_type_disabled';

  return {
    workDate,
    ownerName: owner.name,
    empId: owner.empId,
    phone: owner.phone,
    phoneSource: owner.source,
    messages,
    message,
    ready: skipReason == null,
    skipReason,
  };
}

export async function sendOwnerDailyWhatsApp(params: {
  workDate: string;
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  workDate: string;
  dryRun: boolean;
  ownerName: string;
  phone: string | null;
  message: string;
  messages: OwnerBranchWhatsAppSendResult[];
  status: 'sent' | 'skipped' | 'failed' | 'dry_run' | 'partial';
  reason?: string;
  reasonAr?: string;
  sentCount: number;
  failedCount: number;
}> {
  const preview = await previewOwnerDailyWhatsApp(params.workDate);
  const dryRun = Boolean(params.dryRun);

  if (dryRun) {
    return {
      ok: true,
      workDate: preview.workDate,
      dryRun: true,
      ownerName: preview.ownerName,
      phone: preview.phone,
      message: preview.message,
      messages: preview.messages.map((m) => ({ ...m, status: 'dry_run' as const })),
      status: 'dry_run',
      reason: 'dry_run',
      reasonAr: dailyWaReasonAr('dry_run'),
      sentCount: 0,
      failedCount: 0,
    };
  }

  if (!preview.ready || !preview.phone) {
    const reason = preview.skipReason ?? 'no_phone';
    return {
      ok: false,
      workDate: preview.workDate,
      dryRun: false,
      ownerName: preview.ownerName,
      phone: preview.phone,
      message: preview.message,
      messages: preview.messages.map((m) => ({
        ...m,
        status: 'skipped' as const,
        reason,
        reasonAr: dailyWaReasonAr(reason),
      })),
      status: 'skipped',
      reason,
      reasonAr: dailyWaReasonAr(reason),
      sentCount: 0,
      failedCount: 0,
    };
  }

  const branchResults: OwnerBranchWhatsAppSendResult[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const branchMsg of preview.messages) {
    console.log(
      `[owner-daily-whatsapp] sending workDate=${preview.workDate} branch=${branchMsg.branchCode} -> ${preview.ownerName} (${preview.phone})`,
    );

    const result = await sendQuickWhatsAppMessage({
      phone: preview.phone,
      customerName: preview.ownerName,
      message: branchMsg.message,
    });

    if (result.sent) {
      sentCount += 1;
      branchResults.push({ ...branchMsg, status: 'sent', result });
      continue;
    }

    if (result.skipped) {
      failedCount += 1;
      branchResults.push({
        ...branchMsg,
        status: 'skipped',
        reason: result.reason,
        reasonAr: dailyWaReasonAr(result.reason),
        result,
      });
      continue;
    }

    failedCount += 1;
    const failReason = ('error' in result && result.error) || result.reason;
    branchResults.push({
      ...branchMsg,
      status: 'failed',
      reason: failReason,
      reasonAr: dailyWaReasonAr(failReason),
      result,
    });
  }

  if (sentCount === preview.messages.length && failedCount === 0) {
    return {
      ok: true,
      workDate: preview.workDate,
      dryRun: false,
      ownerName: preview.ownerName,
      phone: preview.phone,
      message: preview.message,
      messages: branchResults,
      status: 'sent',
      sentCount,
      failedCount,
    };
  }

  if (sentCount === 0) {
    const firstFail = branchResults.find((m) => m.status !== 'sent');
    return {
      ok: false,
      workDate: preview.workDate,
      dryRun: false,
      ownerName: preview.ownerName,
      phone: preview.phone,
      message: preview.message,
      messages: branchResults,
      status: 'failed',
      reason: firstFail?.reason ?? 'send_failed',
      reasonAr: firstFail?.reasonAr ?? dailyWaReasonAr('send_failed'),
      sentCount,
      failedCount,
    };
  }

  return {
    ok: false,
    workDate: preview.workDate,
    dryRun: false,
    ownerName: preview.ownerName,
    phone: preview.phone,
    message: preview.message,
    messages: branchResults,
    status: 'partial',
    reason: 'partial_branch_send',
    reasonAr: `اتبعت ${sentCount} من ${preview.messages.length} فروع — في فروع فشلت`,
    sentCount,
    failedCount,
  };
}
