import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  sendEmployeeAdvanceWhatsAppMessage,
  sendEmployeeFundingWhatsAppMessage,
  sendOtherWhatsAppMessage,
} from '@/lib/integrations/whatsapp';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';
import { composeEmployeeTipWhatsAppMessage } from '@/lib/hr/tip-whatsapp-message';
import {
  resolveAdvanceEmployeeFromExpINID,
  resolveRevenueEmployeeFromExpINID,
} from '@/lib/services/employeeLedgerDualWrite';

export interface EmployeeAdvanceWhatsAppNotifyInput {
  empId: number;
  employeeName: string;
  invID: number;
  amount: number;
  paymentMethodId?: number;
  notes?: string;
}

export type EmployeeFundingWhatsAppNotifyInput = EmployeeAdvanceWhatsAppNotifyInput;

export interface EmployeeTipWhatsAppNotifyInput {
  empId: number;
  employeeName: string;
  invID: number;
  tipAmount: number;
  invoiceTotal: number;
  amountPaid: number;
  newBalance: number;
  paymentMethodId?: number;
}

/** Serialize employee WhatsApp sends — the bot handles one Chrome/WA request at a time. */
let employeeWhatsAppChain: Promise<void> = Promise.resolve();

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

export async function notifyEmployeeFundingWhatsApp(
  input: EmployeeFundingWhatsAppNotifyInput,
): Promise<void> {
  try {
    const phone = await fetchEmployeeWhatsAppPhone(input.empId);
    if (!phone) {
      console.log(
        `[pos-api]   ℹ️ Employee funding WhatsApp skipped: no phone for EmpID=${input.empId}`,
      );
      return;
    }

    const paymentMethod = await fetchPaymentMethodLabel(input.paymentMethodId);
    console.log(
      `[pos-api]   📱 Employee funding WhatsApp: ${input.employeeName} (${phone}) FUND-${input.invID} amount=${input.amount}`,
    );

    const result = await sendEmployeeFundingWhatsAppMessage({
      phone,
      employeeName: input.employeeName,
      invID: input.invID,
      amount: input.amount,
      paymentMethod,
      notes: input.notes,
    });

    if (result.sent) {
      console.log(
        `[pos-api]   ✅ Employee funding WhatsApp sent for ${input.employeeName} FUND-${input.invID}`,
      );
      return;
    }

    if (result.skipped) {
      console.log(
        `[pos-api]   ℹ️ Employee funding WhatsApp skipped for ${input.employeeName}: ${result.reason}`,
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
      `[pos-api]   ⚠️ Employee funding WhatsApp not sent for ${input.employeeName}: ${detail}`,
    );
  } catch (err) {
    console.log(
      `[pos-api]   ⚠️ Employee funding WhatsApp error (non-critical): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}

export async function notifyEmployeeTipWhatsApp(
  input: EmployeeTipWhatsAppNotifyInput,
): Promise<void> {
  try {
    const phone = await fetchEmployeeWhatsAppPhone(input.empId);
    if (!phone) {
      console.log(
        `[pos-api]   ℹ️ Employee tip WhatsApp skipped: no phone for EmpID=${input.empId}`,
      );
      return;
    }

    const paymentMethod = await fetchPaymentMethodLabel(input.paymentMethodId);
    const message = composeEmployeeTipWhatsAppMessage({
      employeeName: input.employeeName,
      tipAmount: input.tipAmount,
      invoiceTotal: input.invoiceTotal,
      amountPaid: input.amountPaid,
      newBalance: input.newBalance,
      paymentMethod,
    });
    console.log(
      `[pos-api]   📱 Employee tip WhatsApp: ${input.employeeName} (${phone}) TIP-${input.invID} amount=${input.tipAmount}`,
    );

    const result = await sendOtherWhatsAppMessage({
      phone,
      customerName: input.employeeName,
      message,
    });

    if (result.sent) {
      console.log(
        `[pos-api]   ✅ Employee tip WhatsApp sent for ${input.employeeName} TIP-${input.invID}`,
      );
      return;
    }

    if (result.skipped) {
      console.log(
        `[pos-api]   ℹ️ Employee tip WhatsApp skipped for ${input.employeeName}: ${result.reason}`,
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
      `[pos-api]   ⚠️ Employee tip WhatsApp not sent for ${input.employeeName}: ${detail}`,
    );
  } catch (err) {
    console.log(
      `[pos-api]   ⚠️ Employee tip WhatsApp error (non-critical): ${
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
  employeeWhatsAppChain = employeeWhatsAppChain
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

export function scheduleEmployeeFundingWhatsApp(
  input: EmployeeFundingWhatsAppNotifyInput,
): void {
  employeeWhatsAppChain = employeeWhatsAppChain
    .then(async () => {
      await notifyEmployeeFundingWhatsApp(input);
      await new Promise((resolve) => setTimeout(resolve, QUEUE_GAP_MS));
    })
    .catch((err) => {
      console.log(
        `[pos-api]   ⚠️ Funding WhatsApp queue error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
}

export function scheduleEmployeeTipWhatsApp(
  input: EmployeeTipWhatsAppNotifyInput,
): void {
  employeeWhatsAppChain = employeeWhatsAppChain
    .then(async () => {
      await notifyEmployeeTipWhatsApp(input);
      await new Promise((resolve) => setTimeout(resolve, QUEUE_GAP_MS));
    })
    .catch((err) => {
      console.log(
        `[pos-api]   ⚠️ Tip WhatsApp queue error: ${
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

/**
 * If ExpINID is an employee revenue/funding category, enqueue
 * type=employee_funding WhatsApp (separate bot template from advances).
 */
export async function maybeScheduleFundingWhatsAppFromIncomeCategory(input: {
  expINID: number;
  invID: number;
  amount: number;
  paymentMethodId?: number;
  notes?: string;
}): Promise<{ scheduled: boolean }> {
  const db = await getPool();
  const resolution = await resolveRevenueEmployeeFromExpINID(db, input.expINID);
  if (resolution.kind !== 'resolved') return { scheduled: false };

  scheduleEmployeeFundingWhatsApp({
    empId: resolution.empId,
    employeeName: resolution.empName?.trim() || 'موظف',
    invID: input.invID,
    amount: input.amount,
    paymentMethodId: input.paymentMethodId,
    notes: input.notes,
  });
  return { scheduled: true };
}
