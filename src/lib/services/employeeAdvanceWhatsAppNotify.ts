import 'server-only';

import { getPool, sql } from '@/lib/db';
import { sendEmployeeAdvanceWhatsAppMessage } from '@/lib/integrations/whatsapp';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';
import { resolveAdvanceEmployeeFromExpINID } from '@/lib/services/employeeLedgerDualWrite';

export interface EmployeeAdvanceWhatsAppNotifyInput {
  empId: number;
  employeeName: string;
  invID: number;
  amount: number;
  paymentMethodId?: number;
  notes?: string;
}

/** Serialize advance WhatsApp sends — the bot handles one Chrome/WA request at a time. */
let advanceWhatsAppChain: Promise<void> = Promise.resolve();

const QUEUE_GAP_MS = 2000;

async function fetchEmployeeWhatsAppPhone(empId: number): Promise<string | null> {
  const db = await getPool();
  const result = await db.request().input('empId', sql.Int, empId).query(`
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
  `);

  if (result.recordset.length === 0) return null;
  const row = result.recordset[0];
  return resolveEmployeeWhatsAppPhone(row.WhatsApp, row.Mobile);
}

async function fetchPaymentMethodLabel(paymentMethodId?: number): Promise<string | undefined> {
  if (!paymentMethodId) return undefined;
  const db = await getPool();
  const result = await db
    .request()
    .input('paymentMethodId', sql.Int, paymentMethodId)
    .query(`
      SELECT PaymentMethod
      FROM dbo.TblPaymentMethods
      WHERE PaymentID = @paymentMethodId
    `);
  return result.recordset[0]?.PaymentMethod as string | undefined;
}

export async function notifyEmployeeAdvanceWhatsApp(
  input: EmployeeAdvanceWhatsAppNotifyInput,
): Promise<void> {
  try {
    const phone = await fetchEmployeeWhatsAppPhone(input.empId);
    if (!phone) {
      console.log(
        `[pos-api]   ℹ️ Employee advance WhatsApp skipped: no phone for EmpID=${input.empId}`,
      );
      return;
    }

    const paymentMethod = await fetchPaymentMethodLabel(input.paymentMethodId);
    console.log(
      `[pos-api]   📱 Employee advance WhatsApp: ${input.employeeName} (${phone}) ADV-${input.invID} amount=${input.amount}`,
    );

    const result = await sendEmployeeAdvanceWhatsAppMessage({
      phone,
      employeeName: input.employeeName,
      invID: input.invID,
      amount: input.amount,
      paymentMethod,
      notes: input.notes,
    });

    if (result.sent) {
      console.log(
        `[pos-api]   ✅ Employee advance WhatsApp sent for ${input.employeeName} ADV-${input.invID}`,
      );
      return;
    }

    if (result.skipped) {
      console.log(
        `[pos-api]   ℹ️ Employee advance WhatsApp skipped for ${input.employeeName}: ${result.reason}`,
      );
      return;
    }

    const detail =
      'error' in result && result.error
        ? result.error
        : 'reason' in result
          ? result.reason
          : 'unknown';
    console.log(
      `[pos-api]   ⚠️ Employee advance WhatsApp not sent for ${input.employeeName}: ${detail}`,
    );
  } catch (err) {
    console.log(
      `[pos-api]   ⚠️ Employee advance WhatsApp error (non-critical): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}

/**
 * Enqueue advance WhatsApp after DB commit (non-blocking for the HTTP response).
 * Messages are sent one-by-one so the WhatsApp bot is not flooded.
 */
export function scheduleEmployeeAdvanceWhatsApp(
  input: EmployeeAdvanceWhatsAppNotifyInput,
): void {
  advanceWhatsAppChain = advanceWhatsAppChain
    .then(async () => {
      await notifyEmployeeAdvanceWhatsApp(input);
      await new Promise((resolve) => setTimeout(resolve, QUEUE_GAP_MS));
    })
    .catch((err) => {
      console.log(
        `[pos-api]   ⚠️ Advance WhatsApp queue error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
}

/**
 * If ExpINID is an employee advance category, enqueue WhatsApp.
 * Resolves quickly after lookup + enqueue (does not wait for bot send).
 */
export async function maybeScheduleAdvanceWhatsAppFromExpenseCategory(input: {
  expINID: number;
  invID: number;
  amount: number;
  paymentMethodId?: number;
  notes?: string;
}): Promise<{ scheduled: boolean }> {
  const db = await getPool();
  const resolution = await resolveAdvanceEmployeeFromExpINID(db, input.expINID);
  if (resolution.kind !== 'resolved') return { scheduled: false };

  scheduleEmployeeAdvanceWhatsApp({
    empId: resolution.empId,
    employeeName: resolution.empName?.trim() || 'موظف',
    invID: input.invID,
    amount: input.amount,
    paymentMethodId: input.paymentMethodId,
    notes: input.notes,
  });
  return { scheduled: true };
}
