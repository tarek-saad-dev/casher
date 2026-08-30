import type { PublicBookingDto } from '@/lib/booking/publicBookingReader';
import type { UpcomingBookingSummary } from './types';
import { assertSafeCustomerCopy } from './types';

export function summarizePublicBooking(
  dto: PublicBookingDto,
  bookingId: number | null = null,
): UpcomingBookingSummary {
  return {
    bookingId: bookingId ?? dto.bookingId ?? null,
    bookingCode: dto.code,
    branchName: dto.branch?.branchName ?? null,
    branchCode: dto.branch?.branchCode ?? null,
    employeeName: dto.barber?.nameAr ?? null,
    empId: dto.barber?.empId ?? null,
    workDate: dto.workDate ?? dto.calendarDate ?? null,
    time: dto.time ?? null,
    endDateTime: dto.endDateTime ?? null,
    servicesSummary:
      dto.servicesSummary ??
      (dto.services.map((s) => s.nameAr).filter(Boolean).join(' + ') || null),
    serviceIds: dto.services.map((s) => s.serviceId).filter((id) => id > 0),
    status: dto.status,
    canCancel: Boolean(dto.canCancel),
  };
}

function formatWhen(b: UpcomingBookingSummary): string {
  const day = b.workDate ?? 'ميعاد';
  const time = b.time ?? '';
  return [day, time].filter(Boolean).join(' ').trim();
}

export function composeUpcomingLookupReply(bookings: UpcomingBookingSummary[]): string {
  let text: string;
  if (bookings.length === 0) {
    text = 'مفيش حجز قادم على الرقم ده حاليًا.';
  } else if (bookings.length === 1) {
    const b = bookings[0]!;
    const parts = [
      formatWhen(b),
      b.employeeName ? `مع ${b.employeeName}` : null,
      b.branchName ? `في ${b.branchName}` : null,
    ].filter(Boolean);
    text = `أيوه يا فندم، عند حضرتك حجز ${parts.join(' ')}.`;
  } else {
    const lines = bookings.map((b, i) => {
      const bits = [
        formatWhen(b),
        b.employeeName ?? null,
        b.branchName ?? null,
      ].filter(Boolean);
      return `${i + 1}) ${bits.join(' — ')}`;
    });
    text = `عند حضرتك ${bookings.length} حجوزات قادمة:\n${lines.join('\n')}`;
  }
  assertSafeCustomerCopy(text);
  return text;
}

export function composeBookingClarifyReply(candidates: UpcomingBookingSummary[]): string {
  const lines = candidates.map((b, i) => {
    const bits = [formatWhen(b), b.employeeName ? `مع ${b.employeeName}` : null].filter(
      Boolean,
    );
    return `${i + 1}) ${bits.join(' ')}`;
  });
  const text = `تقصد أنهي حجز؟\n${lines.join('\n')}`;
  assertSafeCustomerCopy(text);
  return text;
}

export function composeCancelPreviewReply(b: UpcomingBookingSummary): string {
  const parts = [
    formatWhen(b),
    b.employeeName ? `مع ${b.employeeName}` : null,
    b.branchName ? `في ${b.branchName}` : null,
  ].filter(Boolean);
  const text = `أأكد إلغاء حجز ${parts.join(' ')}؟`;
  assertSafeCustomerCopy(text);
  return text;
}

export function composeCancelSuccessReply(b: UpcomingBookingSummary): string {
  const text = b.bookingCode
    ? `تم إلغاء الحجز يا فندم (${b.bookingCode}).`
    : 'تم إلغاء الحجز يا فندم.';
  assertSafeCustomerCopy(text);
  return text;
}

export function composeModifyPreviewReply(args: {
  original: UpcomingBookingSummary;
  desired: {
    workDate: string | null;
    time: string | null;
    employeeName: string | null;
    branchName: string | null;
  };
}): string {
  const from = [
    formatWhen(args.original),
    args.original.employeeName ? `مع ${args.original.employeeName}` : null,
    args.original.branchName ? `في ${args.original.branchName}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const to = [
    [args.desired.workDate, args.desired.time].filter(Boolean).join(' '),
    args.desired.employeeName ? `مع ${args.desired.employeeName}` : null,
    args.desired.branchName ? `في ${args.desired.branchName}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const text = `الميعاد متاح.\nأغيّر الحجز من ${from} لـ ${to}؟`;
  assertSafeCustomerCopy(text);
  return text;
}

export function composeModifySuccessReply(args: {
  workDate: string | null;
  time: string | null;
  employeeName: string | null;
  branchName: string | null;
}): string {
  const bits = [
    [args.workDate, args.time].filter(Boolean).join(' '),
    args.employeeName ? `مع ${args.employeeName}` : null,
    args.branchName ? `في ${args.branchName}` : null,
  ].filter(Boolean);
  const text = `تم تعديل الحجز.\n${bits.join(' ')}.`;
  assertSafeCustomerCopy(text);
  return text;
}

export function composeUnavailableModifyReply(args: {
  employeeName: string | null;
  requestedTime: string | null;
  nextAvailableHint?: string | null;
}): string {
  const who = args.employeeName ?? 'الموظف';
  const when = args.requestedTime ? `الساعة ${args.requestedTime}` : 'الميعاد ده';
  let text = `${who} مش متاح ${when}.`;
  if (args.nextAvailableHint) {
    text += `\n${args.nextAvailableHint}`;
  } else {
    text += '\nقولي ميعاد تاني أو موظف تاني وأشوف لحضرتك.';
  }
  assertSafeCustomerCopy(text);
  return text;
}
