/**
 * Schedule-control restore-present: future dates unlock booking; attendance only today.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('scheduleControlRestorePresentFuture', () => {
  const route = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/app/api/operations/schedule-control/restore-present/route.ts',
    ),
    'utf8',
  );
  const modal = fs.readFileSync(
    path.join(process.cwd(), 'src/components/operations/ScheduleControlModal.tsx'),
    'utf8',
  );

  it('allows future dates with schedule unlock and skips attendance when not today', () => {
    expect(route).toContain('unlockScheduleForWorkOnDayOff');
    expect(route).toContain('attendanceRecorded: isToday');
    expect(route).toContain('تاريخ مستقبلي فقط');
    expect(route).not.toMatch(/if \(date !== todayStr\)[\s\S]{0,120}تسجيل الحضور السريع متاح لليوم الحالي فقط/);
  });

  it('UI enables restore button on future dates with unlock-only copy', () => {
    expect(modal).toContain('تشغيل هذا اليوم للحجز');
    expect(modal).toContain('disabled={restoringEmpId === b.empId}');
    expect(modal).not.toContain('disabled={restoringEmpId === b.empId || !isToday}');
    expect(modal).not.toContain('التسجيل السريع متاح لتاريخ اليوم فقط');
  });
});
