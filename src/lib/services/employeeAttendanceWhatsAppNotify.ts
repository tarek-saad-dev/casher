import 'server-only';

import { getPool, sql } from '@/lib/db';
import { sendOtherWhatsAppMessage } from '@/lib/integrations/whatsapp';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';
import {
  composeAttendanceCheckInWhatsAppMessage,
  composeAttendanceCheckOutWhatsAppMessage,
  shouldNotifyAttendanceTimeChange,
} from '@/lib/hr/attendance-whatsapp-message';
import { sqlTimeToHHmm } from '@/lib/timeUtils';

export type AttendanceWhatsAppEvent = 'check_in' | 'check_out';

export interface EmployeeAttendanceWhatsAppNotifyInput {
  empId: number;
  employeeName?: string;
  event: AttendanceWhatsAppEvent;
  time: string;
}

/** Serialize employee WhatsApp sends — the bot handles one Chrome/WA request at a time. */
let employeeAttendanceWhatsAppChain: Promise<void> = Promise.resolve();

const QUEUE_GAP_MS = 2000;

async function fetchEmployeeWhatsAppContact(
  empId: number,
): Promise<{ phone: string; employeeName: string } | null> {
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
  const phone = resolveEmployeeWhatsAppPhone(row.WhatsApp, row.Mobile);
  if (!phone) return null;
  return {
    phone,
    employeeName: (row.EmpName as string | null)?.trim() || 'موظف',
  };
}

export { shouldNotifyAttendanceTimeChange };

export async function notifyEmployeeAttendanceWhatsApp(
  input: EmployeeAttendanceWhatsAppNotifyInput,
): Promise<void> {
  try {
    const contact = await fetchEmployeeWhatsAppContact(input.empId);
    if (!contact) {
      console.log(
        `[pos-api]   ℹ️ Attendance WhatsApp skipped: no phone for EmpID=${input.empId}`,
      );
      return;
    }

    const employeeName = input.employeeName?.trim() || contact.employeeName;
    const message =
      input.event === 'check_in'
        ? composeAttendanceCheckInWhatsAppMessage(input.time)
        : composeAttendanceCheckOutWhatsAppMessage(input.time);

    console.log(
      `[pos-api]   📱 Attendance WhatsApp (${input.event}): ${employeeName} (${contact.phone}) ${input.time}`,
    );

    const result = await sendOtherWhatsAppMessage({
      phone: contact.phone,
      customerName: employeeName,
      message,
    });

    if (result.sent) {
      console.log(
        `[pos-api]   ✅ Attendance WhatsApp sent for ${employeeName} (${input.event})`,
      );
      return;
    }

    if (result.skipped) {
      console.log(
        `[pos-api]   ℹ️ Attendance WhatsApp skipped for ${employeeName}: ${result.reason}`,
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
      `[pos-api]   ⚠️ Attendance WhatsApp not sent for ${employeeName}: ${detail}`,
    );
  } catch (err) {
    console.log(
      `[pos-api]   ⚠️ Attendance WhatsApp error (non-critical): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
}

/**
 * Enqueue attendance WhatsApp after DB commit (non-blocking for the HTTP response).
 */
export function scheduleEmployeeAttendanceWhatsApp(
  input: EmployeeAttendanceWhatsAppNotifyInput,
): void {
  employeeAttendanceWhatsAppChain = employeeAttendanceWhatsAppChain
    .then(async () => {
      await notifyEmployeeAttendanceWhatsApp(input);
      await new Promise((resolve) => setTimeout(resolve, QUEUE_GAP_MS));
    })
    .catch((err) => {
      console.log(
        `[pos-api]   ⚠️ Attendance WhatsApp queue error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
}

export function scheduleAttendanceCheckInOutWhatsApp(input: {
  empId: number;
  employeeName?: string;
  previousCheckIn?: unknown;
  previousCheckOut?: unknown;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}): void {
  if (shouldNotifyAttendanceTimeChange(input.previousCheckIn, input.checkInTime)) {
    scheduleEmployeeAttendanceWhatsApp({
      empId: input.empId,
      employeeName: input.employeeName,
      event: 'check_in',
      time: sqlTimeToHHmm(input.checkInTime)!,
    });
  }
  if (shouldNotifyAttendanceTimeChange(input.previousCheckOut, input.checkOutTime)) {
    scheduleEmployeeAttendanceWhatsApp({
      empId: input.empId,
      employeeName: input.employeeName,
      event: 'check_out',
      time: sqlTimeToHHmm(input.checkOutTime)!,
    });
  }
}
