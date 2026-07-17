import { describe, expect, it } from 'vitest';
import {
  composeAttendanceCheckInWhatsAppMessage,
  composeAttendanceCheckOutWhatsAppMessage,
  shouldNotifyAttendanceTimeChange,
} from '@/lib/hr/attendance-whatsapp-message';
import { buildOtherPayload } from '@/lib/integrations/whatsapp/payload-builders';
import { validateOtherPayload, validatePayload } from '@/lib/integrations/whatsapp/schemas';
import { WhatsAppValidationError } from '@/lib/integrations/whatsapp/errors';

describe('attendance WhatsApp messages', () => {
  it('composes check-in confirmation with 12h Arabic time', () => {
    expect(composeAttendanceCheckInWhatsAppMessage('09:15')).toBe(
      'تم تسجيل حضورك الساعة 9:15 ص',
    );
  });

  it('composes check-out confirmation with 12h Arabic time', () => {
    expect(composeAttendanceCheckOutWhatsAppMessage('17:30')).toBe(
      'تم تسجيل انصرافك الساعة 5:30 م',
    );
  });
});

describe('shouldNotifyAttendanceTimeChange', () => {
  it('notifies when time is newly set', () => {
    expect(shouldNotifyAttendanceTimeChange(null, '09:00')).toBe(true);
  });

  it('notifies when time value changes', () => {
    expect(shouldNotifyAttendanceTimeChange('09:00', '09:15')).toBe(true);
  });

  it('skips when time is unchanged', () => {
    expect(shouldNotifyAttendanceTimeChange('09:00', '09:00')).toBe(false);
    expect(shouldNotifyAttendanceTimeChange('09:00:00', '09:00')).toBe(false);
  });

  it('skips when next time is empty', () => {
    expect(shouldNotifyAttendanceTimeChange('09:00', null)).toBe(false);
    expect(shouldNotifyAttendanceTimeChange(null, '')).toBe(false);
  });
});

describe('WhatsApp type=other', () => {
  it('builds and validates a filled message payload', () => {
    const payload = buildOtherPayload({
      phone: '01557994946',
      customerName: 'أحمد',
      message: 'تم تسجيل حضورك الساعة 9:15 ص',
    });

    expect(payload.type).toBe('other');
    expect(payload.message).toBe('تم تسجيل حضورك الساعة 9:15 ص');
    expect(validateOtherPayload(payload).type).toBe('other');
    expect(validatePayload(payload).type).toBe('other');
  });

  it('requires message', () => {
    expect(() =>
      validateOtherPayload({
        type: 'other',
        phone: '01557994946',
        customerName: 'أحمد',
      }),
    ).toThrow(WhatsAppValidationError);
  });
});
