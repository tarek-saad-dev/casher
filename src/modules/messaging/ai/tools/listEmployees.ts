import 'server-only';
import { listPublicBookingBarbers } from '@/lib/booking/publicBookingBarbers';
import { getPublicBarberCalendar } from '@/lib/booking/publicBookingBarbers';
import { MAX_EMPLOYEES_RETURNED, type AiToolCallRequest, type AiToolResult } from './types';
import { resolveCustomerDateText, textMatchesQuery } from './dateText';

export async function executeListEmployees(
  request: AiToolCallRequest,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  const dateResolved = resolveCustomerDateText(request.dateText);
  const input = {
    branchCode: request.branchCode ?? null,
    employeeName: request.employeeName ?? null,
    dateText: request.dateText ?? null,
    date: dateResolved.date,
  };

  try {
    const mode = request.branchCode ? 'branch' : 'global';
    const list = await listPublicBookingBarbers({
      mode,
      branchCode: request.branchCode ?? null,
      date: dateResolved.date,
    });

    let barbers = list.barbers.map((b) => ({
      empId: b.empId,
      name: b.name,
      nameAr: b.nameAr,
      nameEn: b.nameEn,
      branches: b.branches,
      isBookableOnline: b.isBookableOnline,
      assigned: true as const,
    }));

    if (request.employeeName && request.employeeName.trim()) {
      const q = request.employeeName.trim();
      barbers = barbers.filter(
        (b) =>
          textMatchesQuery(b.nameAr, q) ||
          textMatchesQuery(b.nameEn || '', q) ||
          textMatchesQuery(b.name, q),
      );
    }

    const bounded = barbers.slice(0, MAX_EMPLOYEES_RETURNED);

    // Optional calendar status for a single named employee + date
    let calendar: unknown = null;
    if (bounded.length === 1 && dateResolved.date) {
      try {
        const cal = await getPublicBarberCalendar({
          empId: bounded[0]!.empId,
          from: dateResolved.date,
          to: dateResolved.date,
          branchCode: request.branchCode ?? null,
        });
        calendar = {
          empId: bounded[0]!.empId,
          date: dateResolved.date,
          days: cal.days?.slice(0, 1) ?? [],
        };
      } catch {
        calendar = null;
      }
    }

    return {
      name: 'list_employees',
      ok: true,
      input,
      data: {
        mode: list.mode,
        branch: list.branch ?? null,
        count: bounded.length,
        ambiguous: Boolean(request.employeeName) && bounded.length > 1,
        employees: bounded.map((b) => ({
          empId: b.empId,
          name: b.nameAr || b.name,
          branches: b.branches,
          assigned: true,
          // Presence/bookable from list is roster eligibility, not free slots.
          rosterEligible: b.isBookableOnline,
        })),
        calendar,
        note:
          'rosterEligible means assigned/active for public booking; use get_availability for actual free slots.',
      },
    };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? 'EMPLOYEE_LOOKUP_FAILED';
    return {
      name: 'list_employees',
      ok: false,
      input,
      errorCode: String(code),
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
