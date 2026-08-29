import {
  listPublicDiscoverableBranches,
  resolvePublicBookingBranchContext,
} from '@/lib/booking/publicBookingBranchContext';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
import { listPublicBookingBarbers } from '@/lib/booking/publicBookingBarbers';
import { resolveCustomerDateText, scoreServiceMatch, textMatchesQuery } from '../tools/dateText';

export type ResolvedService = {
  serviceId: number;
  name: string;
};

export type ResolvedEmployee = {
  empId: number;
  name: string;
  branchCode: string | null;
};

export type ResolveServicesResult =
  | { ok: true; services: ResolvedService[] }
  | { ok: false; ambiguous: ResolvedService[]; errorCode: string };

export type ResolveEmployeeResult =
  | { ok: true; employee: ResolvedEmployee | null }
  | { ok: false; ambiguous: ResolvedEmployee[]; errorCode: string };

export async function defaultPublicBranch(): Promise<{
  branchCode: string;
  branchId: number;
  branchName: string;
} | null> {
  const pubs = await listPublicDiscoverableBranches();
  const first = pubs[0];
  if (!first) return null;
  return {
    branchCode: first.branchCode,
    branchId: first.branchId,
    branchName: first.branchName || first.shortName || first.branchCode,
  };
}

export async function resolveBranchByText(branchText: string | null | undefined): Promise<{
  branchCode: string | null;
  branchId: number | null;
  branchName: string | null;
  ambiguous: Array<{ branchCode: string; branchName: string }>;
}> {
  const pubs = await listPublicDiscoverableBranches();
  if (!branchText?.trim()) {
    const d = pubs[0];
    return d
      ? {
          branchCode: d.branchCode,
          branchId: d.branchId,
          branchName: d.branchName || d.shortName || d.branchCode,
          ambiguous: [],
        }
      : { branchCode: null, branchId: null, branchName: null, ambiguous: [] };
  }
  const q = branchText.trim();
  const matches = pubs.filter(
    (b) =>
      textMatchesQuery(b.branchName || '', q) ||
      textMatchesQuery(b.shortName || '', q) ||
      textMatchesQuery(b.branchCode || '', q),
  );
  if (matches.length === 1) {
    const m = matches[0]!;
    return {
      branchCode: m.branchCode,
      branchId: m.branchId,
      branchName: m.branchName || m.shortName || m.branchCode,
      ambiguous: [],
    };
  }
  if (matches.length > 1) {
    return {
      branchCode: null,
      branchId: null,
      branchName: null,
      ambiguous: matches.slice(0, 5).map((m) => ({
        branchCode: m.branchCode,
        branchName: m.branchName || m.shortName || m.branchCode,
      })),
    };
  }
  return { branchCode: null, branchId: null, branchName: null, ambiguous: [] };
}

export async function resolveServicesByText(args: {
  branchCode: string;
  serviceText: string;
}): Promise<ResolveServicesResult> {
  const ctx = await resolvePublicBookingBranchContext({
    branchCode: args.branchCode,
    purpose: 'public_booking',
  });
  const catalog = await getPublicBookingServicesCatalog(ctx);
  const q = args.serviceText.trim();
  const ranked = catalog.services
    .map((s) => ({
      serviceId: s.serviceId,
      name: s.nameAr || s.name,
      score: Math.max(
        scoreServiceMatch(s.nameAr, q),
        scoreServiceMatch(s.nameEn || '', q),
        scoreServiceMatch(s.name, q),
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { ok: false, ambiguous: [], errorCode: 'SERVICE_NOT_FOUND' };
  const best = ranked[0]!.score;
  const chosen = ranked.filter((x) => x.score === best);
  if (chosen.length > 1) {
    return {
      ok: false,
      ambiguous: chosen.slice(0, 5).map((c) => ({ serviceId: c.serviceId, name: c.name })),
      errorCode: 'SERVICE_AMBIGUOUS',
    };
  }
  return {
    ok: true,
    services: [{ serviceId: chosen[0]!.serviceId, name: chosen[0]!.name }],
  };
}

export async function resolveEmployeeByText(args: {
  branchCode: string;
  employeeName: string;
  date?: string | null;
}): Promise<ResolveEmployeeResult> {
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
    .map((b) => ({
      empId: b.empId,
      name: b.nameAr || b.name,
      branchCode: args.branchCode,
    }));
  if (matches.length === 1) return { ok: true, employee: matches[0]! };
  if (matches.length > 1) {
    return { ok: false, ambiguous: matches.slice(0, 5), errorCode: 'EMPLOYEE_AMBIGUOUS' };
  }
  return { ok: false, ambiguous: [], errorCode: 'EMPLOYEE_NOT_FOUND' };
}

export function resolveDateText(dateText: string | null | undefined): {
  date: string | null;
  errorCode?: string;
} {
  return resolveCustomerDateText(dateText);
}

/** Detect booking intent from free text without relying solely on Gemini. */
export function looksLikeBookingIntent(text: string): boolean {
  return /حجز|احجز|أحجز|عاوز أحجز|عايز أحجز|ميعاد|موعد|أقرب ميعاد|اقرب ميعاد/.test(text);
}

export function looksLikePlannerCancel(text: string): boolean {
  return /الغى الحجز|الغي الحجز|إلغاء الحجز|الغاء الحجز|ابدأ من جديد|ابدء من جديد|نبدأ من الأول|نبدأ من الاول/.test(
    text,
  );
}

export function looksLikePlannerResume(text: string): boolean {
  return /كمل الحجز|كمّل الحجز|كملي|كمّلي|رجع للحجز|كمل/.test(text) && /حجز|كم/.test(text);
}
