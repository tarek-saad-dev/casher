import 'server-only';

import { getPool, sql } from '@/lib/db';
import { sendMessage } from '@/modules/messaging';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';

let lateDeductionWhatsAppChain: Promise<void> = Promise.resolve();
const QUEUE_GAP_MS = 2000;

async function fetchEmployeePhone(
  empId: number,
  branchId?: number,
): Promise<{ phone: string; employeeName: string } | null> {
  const db = await getPool();
  const result = await db.request().input('empId', sql.Int, empId).input('hrBranchId', sql.Int, branchId ?? null)
    .query(`
      SELECT
        CASE
          WHEN EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp'
          ) THEN e.WhatsApp
          ELSE NULL
        END AS WhatsApp,
        e.Mobile,
        e.EmpName
      FROM dbo.TblEmp e
      WHERE e.EmpID = @empId
        AND (@hrBranchId IS NULL OR e.TenantId IN (
          SELECT tloc.TenantId FROM dbo.Location tloc WHERE tloc.LegacyBranchId = @hrBranchId
        ))
    `);
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  const phone = resolveEmployeeWhatsAppPhone(row.WhatsApp, row.Mobile);
  if (!phone) return null;
  return {
    phone,
    employeeName: String(row.EmpName ?? '').trim() || 'موظف',
  };
}

export async function sendLateDeductionWhatsApp(params: {
  empId: number;
  branchId?: number;
  text: string;
  metadata?: Record<string, unknown>;
}): Promise<{ sent: boolean; skipped?: boolean; reason?: string }> {
  try {
    const contact = await fetchEmployeePhone(params.empId, params.branchId);
    if (!contact) {
      return { sent: false, skipped: true, reason: 'missing_phone' };
    }
    const result = await sendMessage({
      channel: 'whatsapp',
      recipient: { phone: contact.phone },
      content: { text: params.text },
      metadata: {
        employeeId: params.empId,
        feature: 'late_deduction',
        ...(params.metadata ?? {}),
        ...(typeof params.branchId === 'number' ? { branchId: params.branchId } : {}),
      },
    });
    if (result.sent) return { sent: true };
    return {
      sent: false,
      skipped: Boolean(result.skipped),
      reason: 'reason' in result ? String(result.reason) : 'not_sent',
    };
  } catch (err) {
    console.warn(
      '[late-deduction-whatsapp] send failed (non-critical):',
      err instanceof Error ? err.message : err,
    );
    return { sent: false, reason: 'exception' };
  }
}

/** Non-blocking queue — attendance/payroll must continue if WhatsApp fails. */
export function scheduleLateDeductionWhatsApp(params: {
  empId: number;
  branchId?: number;
  text: string;
  metadata?: Record<string, unknown>;
}): void {
  lateDeductionWhatsAppChain = lateDeductionWhatsAppChain
    .then(async () => {
      await sendLateDeductionWhatsApp(params);
      await new Promise((r) => setTimeout(r, QUEUE_GAP_MS));
    })
    .catch((err) => {
      console.warn(
        '[late-deduction-whatsapp] queue error:',
        err instanceof Error ? err.message : String(err),
      );
    });
}
