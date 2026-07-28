/**
 * Booking Phase 7A — canonical public booking reader (lookup + upcoming).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  isValidDate,
  isValidPhone,
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';
import { isTestOrSmokeEmployeeName } from '@/lib/hr/testEmployeePolicy';
import {
  mapPublicBookingStatus,
  isUpcomingEligibleStatus,
} from '@/lib/booking/publicBookingStatus';
import {
  resolvePublicCancellationCutoff,
} from '@/lib/booking/publicBookingCancellationPolicy';
import {
  digestNormalizedPhone,
  mintBookingAccessToken,
  verifyBookingAccessToken,
} from '@/lib/booking/publicBookingAccessToken';
import type { PublicBookingErrorCode } from '@/lib/booking/publicBookingErrorCatalog';
import { resolveBarberPublicImageUrl } from '@/lib/booking/publicBookingBarberPolicy';

const DEFAULT_UPCOMING_LIMIT = 10;
const MAX_UPCOMING_LIMIT = 25;
const BOOKING_CODE_RE = /^BK-[A-HJ-NP-Z2-9]{4,12}$/i;
const INTERNAL_SOURCES = new Set([
  'smoke_seed',
  'phase1n-smoke',
  'internal_preview',
  'operations',
]);

export class PublicBookingReadError extends Error {
  readonly code: PublicBookingErrorCode;
  readonly metadata: Record<string, unknown>;
  constructor(code: PublicBookingErrorCode, metadata: Record<string, unknown> = {}) {
    super(code);
    this.name = 'PublicBookingReadError';
    this.code = code;
    this.metadata = metadata;
  }
}

export type PublicBookingViewMode = 'summary' | 'full' | 'minimal';

export type PublicBookingServiceLine = {
  serviceId: number;
  nameAr: string;
  nameEn?: string;
  price: number;
  durationMinutes: number;
  snapshotSource: 'booking_detail' | 'legacy_catalog_fallback';
};

export type PublicBookingDto = {
  code: string;
  status: string;
  statusLabel: string;
  statusLabelAr: string;
  branch: {
    branchCode: string;
    branchName: string;
    address: string | null;
    phone: string | null;
  } | null;
  barber: {
    empId: number | null;
    nameAr: string | null;
    imageUrl: string | null;
  } | null;
  assignmentStrategy: string | null;
  workDate: string | null;
  calendarDate: string | null;
  time: string | null;
  dayOffset: 0 | 1 | null;
  startDateTime: string | null;
  endDateTime: string | null;
  services: PublicBookingServiceLine[];
  servicesSummary?: string | null;
  totalDurationMinutes: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: 'EGP';
  notes: string | null;
  createdAt: string | null;
  canCancel: boolean;
  cancellation: null;
  dateSource: 'canonical' | 'legacy_derived' | 'ambiguous';
  meta?: { dateSource: string };
};

type BookingHeadRow = {
  BookingID: number;
  BookingCode: string | null;
  BranchID: number | null;
  BranchCode: string | null;
  BranchName: string | null;
  BranchAddress: string | null;
  BranchPhone: string | null;
  BookingDate: Date | string | null;
  StartTime: unknown;
  EndTime: unknown;
  Status: string | null;
  Notes: string | null;
  Source: string | null;
  CustomerName: string | null;
  CustomerPhone: string | null;
  BarberEmpID: number | null;
  BarberName: string | null;
  PublicWorkDate: Date | string | null;
  PublicDayOffset: number | null;
  AbsoluteStartUtc: Date | string | null;
  AbsoluteEndUtc: Date | string | null;
  CreatedAt: Date | string | null;
  CancelledAt: Date | string | null;
};

function ymd(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  try {
    return new Date(String(v)).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function hhmm(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const m = v.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
  }
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

function nextYmd(ymdStr: string): string {
  const d = new Date(`${ymdStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseP6Notes(notes: string | null): { workDate?: string; dayOffset?: 0 | 1 } {
  if (!notes) return {};
  const m = notes.match(/\[p6\]\s*workDate=(\d{4}-\d{2}-\d{2});dayOffset=([01])/i);
  if (!m) return {};
  return { workDate: m[1], dayOffset: Number(m[2]) as 0 | 1 };
}

/** Reject numeric BookingID and malformed codes before SQL. */
export function normalizePublicBookingCode(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!code) throw new PublicBookingReadError('INVALID_BOOKING_CODE');
  if (/^\d+$/.test(code)) throw new PublicBookingReadError('INVALID_BOOKING_CODE');
  if (!BOOKING_CODE_RE.test(code)) throw new PublicBookingReadError('INVALID_BOOKING_CODE');
  return code;
}

function sanitizeOwnerNotes(notes: string | null): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/\[p6\][^\n]*/gi, '')
    .replace(/\[SMOKE[^\]]*\]/gi, '')
    .trim();
  return cleaned.length ? cleaned.slice(0, 500) : null;
}

function isPublicOriginBooking(row: BookingHeadRow): boolean {
  const source = String(row.Source ?? '')
    .trim()
    .toLowerCase();
  if (INTERNAL_SOURCES.has(source)) return false;
  const notes = String(row.Notes ?? '');
  if (/\[SMOKE/i.test(notes)) return false;
  if (String(row.BookingCode ?? '').toUpperCase().startsWith('P6C-')) return false;
  // Source is authoritative for origin. Smoke barber/customer names are catalog concerns;
  // they must not hide a legitimate online booking from its owner.
  if (source === 'online' || source === 'website' || source === 'phone' || source === 'whatsapp') {
    return true;
  }
  if (isTestOrSmokeEmployeeName(row.BarberName)) return false;
  if (isTestOrSmokeEmployeeName(row.CustomerName)) return false;
  return source === '' || source === 'admin' || source === 'walk_in';
}

function formatCairoTime(d: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  } catch {
    return hhmm(d) ?? '00:00';
  }
}

function deriveDates(row: BookingHeadRow): {
  workDate: string | null;
  calendarDate: string | null;
  time: string | null;
  dayOffset: 0 | 1 | null;
  startDateTime: string | null;
  endDateTime: string | null;
  dateSource: 'canonical' | 'legacy_derived' | 'ambiguous';
} {
  const absStart = row.AbsoluteStartUtc ? new Date(row.AbsoluteStartUtc) : null;
  const absEnd = row.AbsoluteEndUtc ? new Date(row.AbsoluteEndUtc) : null;
  const publicWork = ymd(row.PublicWorkDate);
  const dayOff =
    row.PublicDayOffset === 0 || row.PublicDayOffset === 1
      ? (Number(row.PublicDayOffset) as 0 | 1)
      : null;

  if (publicWork && dayOff != null && absStart && !Number.isNaN(absStart.getTime())) {
    const calendarDate = dayOff === 1 ? nextYmd(publicWork) : publicWork;
    return {
      workDate: publicWork,
      calendarDate,
      time: hhmm(row.StartTime) ?? formatCairoTime(absStart),
      dayOffset: dayOff,
      startDateTime: absStart.toISOString(),
      endDateTime: absEnd && !Number.isNaN(absEnd.getTime()) ? absEnd.toISOString() : null,
      dateSource: 'canonical',
    };
  }

  const p6 = parseP6Notes(row.Notes);
  const bookingDate = ymd(row.BookingDate);
  const startT = hhmm(row.StartTime);
  if (p6.workDate && p6.dayOffset != null && startT) {
    return {
      workDate: p6.workDate,
      calendarDate: p6.dayOffset === 1 ? nextYmd(p6.workDate) : p6.workDate,
      time: startT,
      dayOffset: p6.dayOffset,
      startDateTime: null,
      endDateTime: null,
      dateSource: 'legacy_derived',
    };
  }

  if (bookingDate && startT) {
    const [h] = startT.split(':').map(Number);
    if (h < 5 && !publicWork) {
      return {
        workDate: null,
        calendarDate: bookingDate,
        time: startT,
        dayOffset: null,
        startDateTime: null,
        endDateTime: null,
        dateSource: 'ambiguous',
      };
    }
    return {
      workDate: bookingDate,
      calendarDate: bookingDate,
      time: startT,
      dayOffset: 0,
      startDateTime: null,
      endDateTime: null,
      dateSource: 'legacy_derived',
    };
  }

  return {
    workDate: null,
    calendarDate: bookingDate,
    time: startT,
    dayOffset: null,
    startDateTime: null,
    endDateTime: null,
    dateSource: 'ambiguous',
  };
}

function computeCanCancel(args: {
  statusCanCancel: boolean;
  statusRaw: unknown;
  absoluteStartUtc: Date | string | null | undefined;
  dateSource: 'canonical' | 'legacy_derived' | 'ambiguous';
  nowMs?: number;
}): boolean {
  if (!args.statusCanCancel) return false;
  const cutoff = resolvePublicCancellationCutoff({
    statusRaw: args.statusRaw,
    absoluteStartUtc: args.absoluteStartUtc,
    dateSource: args.dateSource,
    nowMs: args.nowMs,
  });
  return cutoff.windowOpen;
}

async function loadServiceLines(bookingId: number): Promise<PublicBookingServiceLine[]> {
  const map = await loadServiceLinesBatch([bookingId]);
  return map.get(bookingId) ?? [];
}

async function loadServiceLinesBatch(
  bookingIds: number[],
): Promise<Map<number, PublicBookingServiceLine[]>> {
  const out = new Map<number, PublicBookingServiceLine[]>();
  const ids = [...new Set(bookingIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return out;

  const db = await getPool();
  const req = db.request();
  const placeholders: string[] = [];
  ids.forEach((id, i) => {
    const key = `bid${i}`;
    req.input(key, sql.Int, id);
    placeholders.push(`@${key}`);
  });

  const r = await req.query(`
    SELECT
      bs.BookingID,
      bs.ProID,
      bs.Price,
      bs.DurationMinutes,
      p.ProName,
      p.ProNameAr
    FROM dbo.BookingServices bs
    LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
    WHERE bs.BookingID IN (${placeholders.join(',')})
    ORDER BY bs.BookingID, bs.ProID
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of r.recordset as any[]) {
    const bookingId = Number(row.BookingID);
    const price = Number(row.Price);
    const durationMinutes = Number(row.DurationMinutes);
    const hasSnapshot = Number.isFinite(price) && Number.isFinite(durationMinutes);
    const nameAr =
      String(row.ProNameAr ?? '').trim() ||
      String(row.ProName ?? '').trim() ||
      'خدمة';
    const line: PublicBookingServiceLine = {
      serviceId: Number(row.ProID),
      nameAr,
      nameEn: String(row.ProName ?? '').trim() || undefined,
      price: hasSnapshot ? price : 0,
      durationMinutes: hasSnapshot ? durationMinutes : 0,
      snapshotSource: hasSnapshot
        ? ('booking_detail' as const)
        : ('legacy_catalog_fallback' as const),
    };
    const list = out.get(bookingId) ?? [];
    list.push(line);
    out.set(bookingId, list);
  }
  return out;
}

function mapRowToDto(
  row: BookingHeadRow,
  services: PublicBookingServiceLine[],
  mode: PublicBookingViewMode,
): PublicBookingDto {
  const dates = deriveDates(row);
  const status = mapPublicBookingStatus(row.Status);
  const subtotal = services.reduce((s, x) => s + x.price, 0);
  const totalDurationMinutes = services.reduce((s, x) => s + x.durationMinutes, 0);

  const base: PublicBookingDto = {
    code: String(row.BookingCode ?? '').toUpperCase(),
    status: status.status,
    statusLabel: status.statusLabel,
    statusLabelAr: status.statusLabelAr,
    branch: row.BranchCode
      ? {
          branchCode: String(row.BranchCode),
          branchName: String(row.BranchName ?? row.BranchCode),
          address: row.BranchAddress ?? null,
          phone: row.BranchPhone ?? null,
        }
      : null,
    barber: {
      empId: row.BarberEmpID != null ? Number(row.BarberEmpID) : null,
      nameAr: row.BarberName ?? null,
      imageUrl: resolveBarberPublicImageUrl(null, row.BarberName),
    },
    assignmentStrategy: null,
    workDate: dates.workDate,
    calendarDate: dates.calendarDate,
    time: dates.time,
    dayOffset: dates.dayOffset,
    startDateTime: dates.startDateTime,
    endDateTime: dates.endDateTime,
    services: mode === 'summary' ? services.slice(0, 3) : services,
    servicesSummary: services.map((s) => s.nameAr).join('، ') || null,
    totalDurationMinutes,
    subtotal,
    discount: 0,
    total: subtotal,
    currency: 'EGP',
    notes: mode === 'full' ? sanitizeOwnerNotes(row.Notes) : null,
    createdAt: row.CreatedAt ? new Date(row.CreatedAt).toISOString() : null,
    canCancel: computeCanCancel({
      statusCanCancel: status.canCancel,
      statusRaw: row.Status,
      absoluteStartUtc: row.AbsoluteStartUtc,
      dateSource: dates.dateSource,
    }),
    cancellation: null,
    dateSource: dates.dateSource,
    meta: { dateSource: dates.dateSource },
  };

  if (mode === 'minimal') {
    return {
      ...base,
      notes: null,
      services: [],
    };
  }
  return base;
}

const HEAD_SELECT = `
  b.BookingID,
  b.BookingCode,
  b.BranchID,
  br.BranchCode,
  br.BranchName,
  br.Address AS BranchAddress,
  br.Phone AS BranchPhone,
  b.BookingDate,
  b.StartTime,
  b.EndTime,
  b.Status,
  b.Notes,
  b.Source,
  c.[Name] AS CustomerName,
  c.Mobile AS CustomerPhone,
  b.AssignedEmpID AS BarberEmpID,
  e.EmpName AS BarberName,
  b.PublicWorkDate,
  b.PublicDayOffset,
  b.AbsoluteStartUtc,
  b.AbsoluteEndUtc,
  CAST(NULL AS datetime2) AS CreatedAt,
  b.CancelledAt
`;

async function fetchHeadByCode(code: string): Promise<BookingHeadRow | null> {
  const db = await getPool();
  const r = await db.request().input('code', sql.NVarChar(32), code).query(`
    SELECT TOP 1 ${HEAD_SELECT}
    FROM dbo.Bookings b
    LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
    LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
    LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
    WHERE b.BookingCode = @code
  `);
  return (r.recordset[0] as BookingHeadRow) ?? null;
}

function assertOwnership(args: {
  row: BookingHeadRow;
  normalizedPhone?: string | null;
  accessToken?: string | null;
}): 'owner' | 'none' {
  const { row, normalizedPhone, accessToken } = args;
  const stored = normalizePublicBookingPhone(String(row.CustomerPhone ?? ''));

  if (accessToken) {
    const v = verifyBookingAccessToken({
      token: accessToken,
      bookingCode: String(row.BookingCode ?? ''),
      normalizedPhone: normalizedPhone || undefined,
    });
    if (!v.ok) {
      if (v.reason === 'expired') throw new PublicBookingReadError('BOOKING_ACCESS_TOKEN_EXPIRED');
      throw new PublicBookingReadError('BOOKING_ACCESS_TOKEN_INVALID');
    }
    if (normalizedPhone && digestNormalizedPhone(normalizedPhone) !== v.claims.phoneDigest) {
      throw new PublicBookingReadError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
    }
    // Token alone is enough when phoneDigest matches stored phone
    if (!normalizedPhone) {
      if (digestNormalizedPhone(stored) !== v.claims.phoneDigest) {
        throw new PublicBookingReadError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
      }
    }
    return 'owner';
  }

  if (normalizedPhone) {
    if (!stored || stored !== normalizedPhone) {
      throw new PublicBookingReadError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
    }
    return 'owner';
  }

  return 'none';
}

export async function getPublicBookingByCode(args: {
  code: unknown;
  phone?: unknown;
  accessToken?: unknown;
}): Promise<{
  booking: PublicBookingDto;
  bookingAccessToken?: string;
  ownership: 'owner' | 'minimal';
}> {
  const code = normalizePublicBookingCode(args.code);
  let normalizedPhone: string | null = null;
  if (args.phone != null && String(args.phone).trim() !== '') {
    normalizedPhone = normalizePublicBookingPhone(String(args.phone));
    if (!normalizedPhone || !isValidPhone(normalizedPhone)) {
      throw new PublicBookingReadError('INVALID_CUSTOMER_PHONE');
    }
  }
  const accessToken =
    args.accessToken != null && String(args.accessToken).trim()
      ? String(args.accessToken).trim()
      : null;

  let row: BookingHeadRow | null;
  try {
    row = await fetchHeadByCode(code);
  } catch {
    throw new PublicBookingReadError('BOOKING_LOOKUP_UNAVAILABLE');
  }

  if (!row || !isPublicOriginBooking(row)) {
    if (normalizedPhone || accessToken) {
      throw new PublicBookingReadError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
    }
    throw new PublicBookingReadError('BOOKING_NOT_FOUND');
  }

  let ownership: 'owner' | 'none';
  try {
    ownership = assertOwnership({ row, normalizedPhone, accessToken });
  } catch (err) {
    if (err instanceof PublicBookingReadError) throw err;
    throw new PublicBookingReadError('BOOKING_NOT_FOUND_OR_UNAUTHORIZED');
  }

  const services = await loadServiceLines(Number(row.BookingID));

  if (ownership === 'none') {
    return {
      booking: mapRowToDto(row, services, 'minimal'),
      ownership: 'minimal',
    };
  }

  const booking = mapRowToDto(row, services, 'full');
  const phoneForToken =
    normalizedPhone || normalizePublicBookingPhone(String(row.CustomerPhone ?? ''));
  let bookingAccessToken: string | undefined;
  if (phoneForToken && isValidPhone(phoneForToken)) {
    bookingAccessToken = mintBookingAccessToken({
      bookingCode: code,
      normalizedPhone: phoneForToken,
    }).token;
  }
  return { booking, bookingAccessToken, ownership: 'owner' };
}

export async function listPublicUpcomingBookings(args: {
  phone: unknown;
  fromDate?: unknown;
  limit?: unknown;
}): Promise<{ bookings: PublicBookingDto[]; meta: { count: number; hasMore: boolean } }> {
  const normalizedPhone = normalizePublicBookingPhone(String(args.phone ?? ''));
  if (!normalizedPhone || !isValidPhone(normalizedPhone)) {
    throw new PublicBookingReadError('INVALID_CUSTOMER_PHONE');
  }

  let fromDate: string | null = null;
  if (args.fromDate != null && String(args.fromDate).trim() !== '') {
    fromDate = String(args.fromDate).trim();
    if (!isValidDate(fromDate)) throw new PublicBookingReadError('INVALID_FROM_DATE');
  }

  let limit = DEFAULT_UPCOMING_LIMIT;
  if (args.limit != null && args.limit !== '') {
    const n = Number(args.limit);
    if (!Number.isInteger(n) || n < 1) throw new PublicBookingReadError('INVALID_LIMIT');
    limit = Math.min(n, MAX_UPCOMING_LIMIT);
  }

  const db = await getPool();
  const now = new Date();
  try {
    const req = db
      .request()
      .input('phone', sql.NVarChar(30), normalizedPhone)
      .input('now', sql.DateTime2, now)
      .input('take', sql.Int, limit + 1);
    if (fromDate) req.input('fromDate', sql.Date, fromDate);

    const r = await req.query(`
      SELECT TOP (@take) ${HEAD_SELECT}
      FROM dbo.Bookings b
      INNER JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
      LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      WHERE c.Mobile = @phone
        AND b.CancelledAt IS NULL
        AND (
          (b.AbsoluteEndUtc IS NOT NULL AND b.AbsoluteEndUtc > @now)
          OR (b.AbsoluteEndUtc IS NULL AND b.BookingDate >= CAST(@now AS date))
        )
        ${
          fromDate
            ? 'AND (b.PublicWorkDate >= @fromDate OR (b.PublicWorkDate IS NULL AND b.BookingDate >= @fromDate))'
            : ''
        }
      ORDER BY
        CASE WHEN b.AbsoluteStartUtc IS NULL THEN 1 ELSE 0 END,
        b.AbsoluteStartUtc ASC,
        b.BookingDate ASC,
        b.StartTime ASC
    `);

    const rows = r.recordset as BookingHeadRow[];
    const eligibleRows: BookingHeadRow[] = [];
    for (const row of rows) {
      if (!isPublicOriginBooking(row)) continue;
      if (!isUpcomingEligibleStatus(row.Status)) continue;
      eligibleRows.push(row);
      if (eligibleRows.length >= limit) break;
    }

    const serviceMap = await loadServiceLinesBatch(
      eligibleRows.map((row) => Number(row.BookingID)),
    );
    const out: PublicBookingDto[] = eligibleRows.map((row) =>
      mapRowToDto(row, serviceMap.get(Number(row.BookingID)) ?? [], 'summary'),
    );

    const hasMore = rows.length > limit && out.length >= limit;
    return { bookings: out, meta: { count: out.length, hasMore } };
  } catch (err) {
    if (err instanceof PublicBookingReadError) throw err;
    console.error('[listPublicUpcomingBookings]', err);
    throw new PublicBookingReadError('UPCOMING_BOOKINGS_UNAVAILABLE');
  }
}
