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
import { composeOwnerDailyWhatsAppMessage } from '@/lib/hr/owner-daily-whatsapp-message';
import { dailyWaReasonAr } from '@/lib/hr/employee-daily-whatsapp-reasons';
import { JobType } from '@/lib/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OWNER_PREFERRED_NAME = 'طارق';

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

export async function previewOwnerDailyWhatsApp(workDate: string): Promise<{
  workDate: string;
  ownerName: string;
  empId: number | null;
  phone: string | null;
  phoneSource: 'manager_employee' | 'named_employee' | 'none';
  message: string;
  ready: boolean;
  skipReason: string | null;
}> {
  if (!DATE_RE.test(workDate)) {
    throw new Error('workDate يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const cfg = getConfig();
  const report = await getFullDayReport(workDate);
  const message = composeOwnerDailyWhatsAppMessage(report);
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
  status: 'sent' | 'skipped' | 'failed' | 'dry_run';
  reason?: string;
  reasonAr?: string;
  result?: WhatsAppSendResult;
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
      status: 'dry_run',
      reason: 'dry_run',
      reasonAr: dailyWaReasonAr('dry_run'),
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
      status: 'skipped',
      reason,
      reasonAr: dailyWaReasonAr(reason),
    };
  }

  console.log(
    `[owner-daily-whatsapp] sending workDate=${preview.workDate} -> ${preview.ownerName} (${preview.phone})`,
  );

  const result = await sendQuickWhatsAppMessage({
    phone: preview.phone,
    customerName: preview.ownerName,
    message: preview.message,
  });

  if (result.sent) {
    return {
      ok: true,
      workDate: preview.workDate,
      dryRun: false,
      ownerName: preview.ownerName,
      phone: preview.phone,
      message: preview.message,
      status: 'sent',
      result,
    };
  }

  if (result.skipped) {
    return {
      ok: false,
      workDate: preview.workDate,
      dryRun: false,
      ownerName: preview.ownerName,
      phone: preview.phone,
      message: preview.message,
      status: 'skipped',
      reason: result.reason,
      reasonAr: dailyWaReasonAr(result.reason),
      result,
    };
  }

  return {
    ok: false,
    workDate: preview.workDate,
    dryRun: false,
    ownerName: preview.ownerName,
    phone: preview.phone,
    message: preview.message,
    status: 'failed',
    reason: ('error' in result && result.error) || result.reason,
    reasonAr: dailyWaReasonAr(
      ('error' in result && result.error) || result.reason,
    ),
    result,
  };
}
