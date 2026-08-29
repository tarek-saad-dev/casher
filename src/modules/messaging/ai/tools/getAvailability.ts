import 'server-only';
import {
  listPublicDiscoverableBranches,
  resolvePublicBookingBranchContext,
  PublicBookingBranchContextError,
} from '@/lib/booking/publicBookingBranchContext';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
import { listPublicBookingBarbers } from '@/lib/booking/publicBookingBarbers';
import {
  getPublicAvailableSlots,
  PublicBookingAvailabilityError,
} from '@/lib/booking/publicBookingAvailability';
import { MAX_AVAILABILITY_SLOTS, type AiToolCallRequest, type AiToolResult } from './types';
import { resolveCustomerDateText, scoreServiceMatch } from './dateText';

async function defaultBranchCode(branchCode?: string | null): Promise<string | null> {
  if (branchCode?.trim()) return branchCode.trim().toUpperCase();
  const pubs = await listPublicDiscoverableBranches();
  return pubs[0]?.branchCode ?? null;
}

async function resolveServiceIds(args: {
  branchCode: string;
  serviceQuery?: string | null;
  serviceIds?: number[] | null;
}): Promise<{ serviceIds: number[]; matchedNames: string[]; errorCode?: string }> {
  if (args.serviceIds?.length) {
    return { serviceIds: args.serviceIds.map(Number).filter((n) => n > 0), matchedNames: [] };
  }
  if (!args.serviceQuery?.trim()) {
    return { serviceIds: [], matchedNames: [], errorCode: 'SERVICE_REQUIRED' };
  }
  const ctx = await resolvePublicBookingBranchContext({
    branchCode: args.branchCode,
    purpose: 'public_booking',
  });
  const catalog = await getPublicBookingServicesCatalog(ctx);
  const q = args.serviceQuery.trim();
  const ranked = catalog.services
    .map((s) => ({
      service: s,
      score: Math.max(
        scoreServiceMatch(s.nameAr, q),
        scoreServiceMatch(s.nameEn || '', q),
        scoreServiceMatch(s.name, q),
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { serviceIds: [], matchedNames: [], errorCode: 'SERVICE_NOT_FOUND' };
  const best = ranked[0]!.score;
  const chosen = ranked.filter((x) => x.score === best).slice(0, 2);
  return {
    serviceIds: chosen.map((x) => x.service.serviceId),
    matchedNames: chosen.map((x) => x.service.nameAr || x.service.name),
  };
}

async function resolveEmpId(args: {
  branchCode: string;
  employeeName?: string | null;
  empId?: number | null;
  date?: string | null;
}): Promise<{ empId: number | null; ambiguous: boolean; matches: Array<{ empId: number; name: string }> }> {
  if (args.empId != null && args.empId > 0) {
    return { empId: args.empId, ambiguous: false, matches: [] };
  }
  if (!args.employeeName?.trim()) {
    return { empId: null, ambiguous: false, matches: [] };
  }
  const list = await listPublicBookingBarbers({
    mode: 'branch',
    branchCode: args.branchCode,
    date: args.date ?? null,
  });
  const q = args.employeeName.trim();
  const matches = list.barbers
    .filter(
      (b) =>
        textMatchesQuery(b.nameAr, q) ||
        textMatchesQuery(b.nameEn || '', q) ||
        textMatchesQuery(b.name, q),
    )
    .map((b) => ({ empId: b.empId, name: b.nameAr || b.name }));
  if (matches.length === 1) return { empId: matches[0]!.empId, ambiguous: false, matches };
  if (matches.length > 1) return { empId: null, ambiguous: true, matches: matches.slice(0, 5) };
  return { empId: null, ambiguous: false, matches: [] };
}

export async function executeGetAvailability(
  request: AiToolCallRequest,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  const branchCode = await defaultBranchCode(request.branchCode);
  const dateResolved = resolveCustomerDateText(request.dateText);
  const input: Record<string, unknown> = {
    branchCode,
    serviceQuery: request.serviceQuery ?? null,
    employeeName: request.employeeName ?? null,
    dateText: request.dateText ?? null,
    date: dateResolved.date,
    timePreference: request.timePreference ?? null,
  };

  if (!branchCode) {
    return {
      name: 'get_availability',
      ok: false,
      input,
      errorCode: 'BRANCH_REQUIRED',
      errorMessage: 'No public branch for availability',
    };
  }
  if (!dateResolved.date) {
    return {
      name: 'get_availability',
      ok: false,
      input,
      errorCode: dateResolved.errorCode ?? 'DATE_REQUIRED',
      errorMessage: 'Need a concrete date for availability',
    };
  }

  try {
    const services = await resolveServiceIds({
      branchCode,
      serviceQuery: request.serviceQuery,
      serviceIds: request.serviceIds,
    });
    input.serviceIds = services.serviceIds;
    input.matchedServiceNames = services.matchedNames;
    if (!services.serviceIds.length) {
      return {
        name: 'get_availability',
        ok: false,
        input,
        errorCode: services.errorCode ?? 'SERVICE_REQUIRED',
        errorMessage: 'Need a known service to check slots',
      };
    }

    const emp = await resolveEmpId({
      branchCode,
      employeeName: request.employeeName,
      empId: request.empId,
      date: dateResolved.date,
    });
    input.empId = emp.empId;
    input.employeeMatches = emp.matches;
    if (emp.ambiguous) {
      return {
        name: 'get_availability',
        ok: false,
        input,
        errorCode: 'EMPLOYEE_AMBIGUOUS',
        errorMessage: 'Multiple employees match that name',
        data: { matches: emp.matches },
      };
    }
    if (request.employeeName?.trim() && emp.empId == null && emp.matches.length === 0) {
      return {
        name: 'get_availability',
        ok: false,
        input,
        errorCode: 'EMPLOYEE_NOT_FOUND',
        errorMessage: 'Employee not found on this branch roster',
      };
    }

    const slotsResp = await getPublicAvailableSlots({
      branchCode,
      date: dateResolved.date,
      serviceIds: services.serviceIds,
      empId: emp.empId,
    });

    let slots = slotsResp.slots.slice(0, MAX_AVAILABILITY_SLOTS);
    if (request.timePreference?.trim()) {
      const pref = request.timePreference.trim();
      const filtered = slots.filter((s) => String(s.time || '').includes(pref));
      if (filtered.length) slots = filtered;
    }

    return {
      name: 'get_availability',
      ok: true,
      input,
      data: {
        branch: slotsResp.branch,
        date: slotsResp.date,
        mode: slotsResp.mode,
        services: slotsResp.services,
        slotCount: slots.length,
        slots: slots.map((s) => ({
          time: s.time,
          dayOffset: s.dayOffset,
          empId: s.barbers[0]?.empId ?? null,
          empName: s.barbers[0]?.nameAr ?? null,
          barberCount: s.barbers.length,
        })),
        reasonCode: slotsResp.reasonCode ?? null,
        messageAr: slotsResp.messageAr ?? slotsResp.message ?? null,
        noSlots: slots.length === 0,
      },
    };
  } catch (err) {
    const code =
      err instanceof PublicBookingAvailabilityError || err instanceof PublicBookingBranchContextError
        ? err.code
        : (err as { code?: string })?.code ?? 'AVAILABILITY_FAILED';
    return {
      name: 'get_availability',
      ok: false,
      input,
      errorCode: String(code),
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
