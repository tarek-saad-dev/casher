import { describe, it, expect } from 'vitest';
import { describeMoveFailure } from '@/lib/bookingDragReschedule';

describe('describeMoveFailure — stable-code driven messages', () => {
  it('renders single unsupported service using the code + details (not string matching)', () => {
    const msg = describeMoveFailure({
      code: 'EMPLOYEE_SERVICE_UNSUPPORTED',
      message: 'ignored generic message',
      details: {
        employeeName: 'كريم',
        unsupportedServices: [{ serviceId: 12, serviceName: 'تنظيف بشرة' }],
      },
    });
    expect(msg).toBe('لا يمكن نقل الموعد إلى كريم لأنه لا يقدم خدمة: تنظيف بشرة');
  });

  it('lists multiple unsupported services', () => {
    const msg = describeMoveFailure({
      code: 'EMPLOYEE_SERVICE_UNSUPPORTED',
      details: {
        employeeName: 'كريم',
        unsupportedServices: [
          { serviceId: 12, serviceName: 'تنظيف بشرة' },
          { serviceId: 13, serviceName: 'بروتين' },
        ],
      },
    });
    expect(msg).toContain('الخدمات التالية');
    expect(msg).toContain('تنظيف بشرة، بروتين');
  });

  it('renders the no-schedule admin state', () => {
    const msg = describeMoveFailure({
      code: 'NO_SCHEDULE',
      message: 'لا يوجد جدول عمل أسبوعي لهذا الموظف',
    });
    expect(msg).toBe('لا يوجد جدول عمل أسبوعي لهذا الموظف');
  });

  it('falls back to the generic prefixed message for other codes', () => {
    const msg = describeMoveFailure({
      code: 'SCHEDULE_CONFLICT',
      message: 'الفترة تتداخل مع حجز BK-1',
    });
    expect(msg).toBe('لا يمكن النقل: الفترة تتداخل مع حجز BK-1');
  });
});
