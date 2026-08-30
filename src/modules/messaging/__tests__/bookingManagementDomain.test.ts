import { describe, expect, it } from 'vitest';
import {
  isBookingManagementActiveForPhone,
  isBookingManagementV1Enabled,
} from '@/modules/messaging/ai/bookingManagement/featureFlag';
import {
  parseBookingSelectionOrdinal,
  resolveBookingTarget,
} from '@/modules/messaging/ai/bookingManagement/targetResolver';
import {
  composeCancelPreviewReply,
  composeUpcomingLookupReply,
} from '@/modules/messaging/ai/bookingManagement/responseCopy';
import { buildDesiredBookingState } from '@/modules/messaging/ai/bookingManagement/desiredState';
import { detectBookingManagementSpeech } from '@/modules/messaging/ai/bookingManagement/detectSpeech';
import {
  assertSafeCustomerCopy,
  buildManagementIdempotencyKey,
  type UpcomingBookingSummary,
} from '@/modules/messaging/ai/bookingManagement/types';

function booking(over: Partial<UpcomingBookingSummary> = {}): UpcomingBookingSummary {
  return {
    bookingId: 1,
    bookingCode: 'BK-A',
    branchName: 'جليم',
    branchCode: 'GLEEM',
    employeeName: 'كريم',
    empId: 10,
    workDate: '2026-09-04',
    time: '20:00',
    endDateTime: null,
    servicesSummary: 'شعر ودقن',
    status: 'confirmed',
    canCancel: true,
    ...over,
  };
}

describe('BOOKING_MANAGEMENT_V1 flag', () => {
  it('is off by default', () => {
    expect(isBookingManagementV1Enabled({})).toBe(false);
    expect(isBookingManagementActiveForPhone('0155', {})).toBe(false);
  });

  it('canary phones gate when on', () => {
    const env = {
      BOOKING_MANAGEMENT_V1: 'true',
      BOOKING_MANAGEMENT_CANARY_PHONES: '01557994946',
    } as NodeJS.ProcessEnv;
    expect(isBookingManagementActiveForPhone('201557994946', env)).toBe(true);
    expect(isBookingManagementActiveForPhone('201555000000', env)).toBe(false);
    expect(
      isBookingManagementActiveForPhone('201555000000', {
        BOOKING_MANAGEMENT_V1: 'true',
        BOOKING_MANAGEMENT_CANARY_PHONES: '',
      }),
    ).toBe(true);
  });
});

describe('upcoming lookup copy', () => {
  it('handles none / one / multiple', () => {
    expect(composeUpcomingLookupReply([])).toMatch(/مفيش حجز قادم/);
    expect(composeUpcomingLookupReply([booking()])).toMatch(/كريم/);
    expect(
      composeUpcomingLookupReply([
        booking(),
        booking({ bookingCode: 'BK-B', employeeName: 'عمر', workDate: '2026-09-06' }),
      ]),
    ).toMatch(/2 حجوزات/);
  });
});

describe('target resolver', () => {
  const a = booking();
  const b = booking({
    bookingId: 2,
    bookingCode: 'BK-B',
    employeeName: 'عمر',
    workDate: '2026-09-06',
    time: '17:00',
  });

  it('selects single upcoming', () => {
    const r = resolveBookingTarget({ upcoming: [a] });
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.reason).toBe('single_upcoming');
  });

  it('clarifies when multiple', () => {
    const r = resolveBookingTarget({ upcoming: [a, b] });
    expect(r.kind).toBe('clarify');
  });

  it('resolves explicit code and ordinal pending', () => {
    expect(
      resolveBookingTarget({ upcoming: [a, b], explicitCode: 'BK-B' }).kind,
    ).toBe('resolved');
    const ord = resolveBookingTarget({
      upcoming: [a, b],
      pendingCandidateCodes: ['BK-A', 'BK-B'],
      ordinalOneBased: 2,
    });
    expect(ord.kind).toBe('resolved');
    if (ord.kind === 'resolved') expect(ord.booking.bookingCode).toBe('BK-B');
  });

  it('resolves employee reference on pending', () => {
    const r = resolveBookingTarget({
      upcoming: [a, b],
      pendingCandidateCodes: ['BK-A', 'BK-B'],
      referenceText: 'بتاع عمر',
    });
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.booking.employeeName).toBe('عمر');
  });

  it('uses lastRelevant when still upcoming', () => {
    const r = resolveBookingTarget({
      upcoming: [a, b],
      lastRelevant: {
        bookingId: 2,
        bookingCode: 'BK-B',
        snapshot: b,
        lastReferencedAt: new Date().toISOString(),
      },
    });
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.reason).toBe('last_relevant');
  });

  it('parses ordinals', () => {
    expect(parseBookingSelectionOrdinal('الأول')).toBe(1);
    expect(parseBookingSelectionOrdinal('التاني')).toBe(2);
    expect(parseBookingSelectionOrdinal('3')).toBe(3);
  });
});

describe('desired state + cancel preview safety', () => {
  it('applies only deltas', () => {
    const d = buildDesiredBookingState(booking(), { time: '21:00' });
    expect(d.time).toBe('21:00');
    expect(d.employeeName).toBe('كريم');
    expect(d.workDate).toBe('2026-09-04');
  });

  it('cancel preview asks confirm and rejects fake progress', () => {
    const preview = composeCancelPreviewReply(booking());
    expect(preview).toMatch(/أأكد إلغاء/);
    expect(() => assertSafeCustomerCopy('جاري إلغاء الحجز دلوقتي')).toThrow(/fake_progress/);
    expect(() => assertSafeCustomerCopy('تمام يا باشا')).toThrow(/banned_address/);
  });

  it('builds stable idempotency keys', () => {
    expect(
      buildManagementIdempotencyKey({
        conversationId: 9,
        planId: 3,
        confirmationVersion: 2,
      }),
    ).toBe('booking-management:9:3:v2');
  });
});

describe('speech detection', () => {
  it('detects lookup / cancel / modify', () => {
    expect(detectBookingManagementSpeech('عندي حجز؟').kind).toBe('lookup_upcoming');
    expect(detectBookingManagementSpeech('عاوز ألغي حجزي').kind).toBe('cancel');
    expect(detectBookingManagementSpeech('خليه الساعة 9').kind).toBe('modify');
    expect(detectBookingManagementSpeech('جليم بيفتح امتى؟').kind).toBe('none');
  });
});

describe('parseManagementDeltas', () => {
  it('parses time and employee swap', async () => {
    const { parseManagementDeltas } = await import(
      '@/modules/messaging/ai/bookingManagement/parseManagementDeltas'
    );
    const t = parseManagementDeltas('خليه الساعة 9', '20:00');
    expect(t.changes.time).toMatch(/^21:00$|^09:00$/);
    const e = parseManagementDeltas('بدل كريم خلي عمر');
    expect(e.employeeNameHint).toMatch(/عمر/);
    expect(e.hasAnyDelta).toBe(true);
  });
});

describe('modify preview copy', () => {
  it('asks confirm without fake progress', async () => {
    const { composeModifyPreviewReply, composeModifySuccessReply } = await import(
      '@/modules/messaging/ai/bookingManagement/responseCopy'
    );
    const preview = composeModifyPreviewReply({
      original: booking(),
      desired: {
        workDate: '2026-09-04',
        time: '21:00',
        employeeName: 'كريم',
        branchName: 'جليم',
      },
    });
    expect(preview).toMatch(/أغيّر/);
    expect(() => assertSafeCustomerCopy(preview)).not.toThrow();
    const ok = composeModifySuccessReply({
      workDate: '2026-09-04',
      time: '21:00',
      employeeName: 'كريم',
      branchName: 'جليم',
    });
    expect(ok).toMatch(/^تم تعديل/);
  });
});

describe('reschedule fingerprint', () => {
  it('is stable for same desired state', async () => {
    const {
      buildRescheduleRequestFingerprint,
      BOOKING_RESCHEDULE_CONTRACT_VERSION,
    } = await import('@/lib/booking/publicBookingRescheduleIdempotency');
    const a = buildRescheduleRequestFingerprint({
      contractVersion: BOOKING_RESCHEDULE_CONTRACT_VERSION,
      bookingCode: 'BK-A',
      ownershipDigest: 'abc',
      workDate: '2026-09-04',
      time: '21:00',
      empId: 10,
      branchCode: 'GLEEM',
      serviceIds: [2, 1],
    });
    const b = buildRescheduleRequestFingerprint({
      contractVersion: BOOKING_RESCHEDULE_CONTRACT_VERSION,
      bookingCode: 'BK-A',
      ownershipDigest: 'abc',
      workDate: '2026-09-04',
      time: '21:00',
      empId: 10,
      branchCode: 'GLEEM',
      serviceIds: [1, 2],
    });
    expect(a).toBe(b);
  });
});
