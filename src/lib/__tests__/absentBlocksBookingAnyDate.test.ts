import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

describe('absent blocks booking on any work date', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('booking engine blocks Absent via loadDayOffSet (no duplicate Absent query)', () => {
    const src = read('src/lib/bookingAvailabilityEngine.ts');
    expect(src).toContain('loadDayOffSet already includes Absent');
    expect(src).not.toMatch(/isToday \? loadAbsentEmpIds/);
    expect(src).not.toContain('loadAbsentEmpIds(db, barberIds, date)');
    const dayOff = src.slice(src.indexOf('async function loadDayOffSet'));
    expect(dayOff).toContain("Status = N'Absent'");
  });

  it('loadDayOffSet includes Absent without isToday gate', () => {
    const src = read('src/lib/bookingAvailabilityEngine.ts');
    const fn = src.slice(src.indexOf('async function loadDayOffSet'));
    const end = fn.indexOf('\nfunction hhmmToMinutes');
    const body = fn.slice(0, end);
    expect(body).toContain("Status = N'Absent'");
    expect(body).not.toContain('if (isToday)');
  });

  it('availabilityEngine treats Absent on any date as unavailable', () => {
    const src = read('src/lib/availabilityEngine.ts');
    expect(src).not.toMatch(/isToday &&\s*\n\s*attendance !== null &&\s*\n\s*attendance\.status === \"Absent\"/);
    // Current contract: isAbsent flag (from attendance Status = Absent) blocks any date
    expect(src).toContain('if (status.isAbsent)');
    expect(src).toContain("TblEmpAttendance.Status = 'Absent'");
  });

  it('attendance save syncs Absent ↔ day_off override', () => {
    const sync = read('src/lib/hr/attendance-shift-schedule-sync.ts');
    const command = read(
      'src/modules/attendance/application/AttendanceCommandService.ts',
    );
    expect(sync).toContain('syncAttendanceAbsenceToDayOffOverride');
    expect(sync).toContain("Type = N'day_off'");
    expect(sync).toContain('attendance-absent');
    expect(command).toContain('syncAttendanceAbsenceToDayOffOverride');
    expect(command).toContain('saveAdminAttendanceBulk');
  });

  it('schedule-control day_off always mirrors Absent attendance', () => {
    const src = read('src/app/api/operations/schedule-control/apply/route.ts');
    const repo = read('src/modules/attendance/infra/AttendanceRepository.ts');
    expect(src).toContain('if (type === "day_off")');
    expect(src).not.toContain('if (type === "day_off" && isToday)');
    expect(src).toContain('applyScheduleControlDayOffAttendance');
    expect(repo).toContain("Status = 'Absent'");
  });

  it('Present/Late/EarlyLeave clear day_off; Absent ensures day_off', () => {
    const sync = read('src/lib/hr/attendance-shift-schedule-sync.ts');
    const fn = sync.slice(sync.indexOf('syncAttendanceAbsenceToDayOffOverride'));
    expect(fn).toContain("normalized === 'Present'");
    expect(fn).toContain("normalized === 'Late'");
    expect(fn).toContain("normalized === 'EarlyLeave'");
    expect(fn).toContain("Type = N'day_off'");
    expect(fn).toContain('IsActive = 0');
    expect(fn).toContain("normalized !== 'Absent'");
    expect(fn).toContain('attendance-absent');
  });

  it('barberAvailability does not gate Absent on calendar today only', () => {
    const src = read('src/lib/barberAvailability.ts');
    expect(src).not.toMatch(/isToday\s*&&[\s\S]{0,80}Absent/);
    expect(src).toMatch(/Absent/);
  });

  it('cross-branch horizon attaches Absent for requested dates not only business today', () => {
    const src = read('src/lib/booking/publicBookingCrossBranchAvailability.ts');
    // Must not only attach Absent when date === todayBusinessDate
    expect(src).not.toMatch(/todayBusinessDate[\s\S]{0,120}Absent/);
  });
});
