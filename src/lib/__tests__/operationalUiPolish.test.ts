/**
 * Operational UI/UX polish — source contracts + pure helpers (no live DB).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  branchDisplayName,
  formatShiftElapsed,
  formatShiftStartTime,
  mapOperationalError,
  parseShiftStart,
  viewMatchesOperational,
} from '@/lib/operations/viewOperationalState';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('operational UX helpers', () => {
  it('formats elapsed shift time compactly', () => {
    const now = new Date('2026-08-25T14:18:00');
    expect(formatShiftElapsed('2026-08-25', '11:00 AM', now)).toBe('3 س 18 د');
    expect(formatShiftElapsed('2026-08-25', '14:00', now)).toBe('18 د');
  });

  it('formats start clock time', () => {
    const clock = formatShiftStartTime('2026-08-25', '11:04 AM') || '';
    // ar-EG may emit Latin or Eastern Arabic digits
    expect(clock.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())).toMatch(
      /11:04/,
    );
  });

  it('parses am/pm and 24h start times', () => {
    expect(parseShiftStart('2026-08-25', '11:04 AM')?.getHours()).toBe(11);
    expect(parseShiftStart('2026-08-25', '1:05 PM')?.getHours()).toBe(13);
    expect(parseShiftStart('2026-08-25', '14:30')?.getHours()).toBe(14);
  });

  it('maps domain errors to friendly Arabic', () => {
    expect(mapOperationalError({ code: 'NO_OPEN_DAY', message: 'x' })).toContain(
      'اليوم التشغيلي غير جاهز',
    );
    expect(
      mapOperationalError({ code: 'BUSINESS_DAY_RECONCILIATION_FAILED', message: 'fail' }),
    ).toContain('تجهيز يوم العمل');
    expect(mapOperationalError({ code: 'ALREADY_OPEN_SHIFT', message: 'وردية مفتوحة بالفعل' })).toContain(
      'مفتوحة بالفعل',
    );
    expect(mapOperationalError({ code: 'OPEN_SHIFTS', message: 'open' })).toContain(
      'الورديات المفتوحة',
    );
  });

  it('viewMatchesOperational is false when either side is null', () => {
    expect(viewMatchesOperational(1, 1)).toBe(true);
    expect(viewMatchesOperational(1, 2)).toBe(false);
    expect(viewMatchesOperational(1, null)).toBe(false);
    expect(branchDisplayName({ shortName: 'كامب', branchName: 'كامب شيزار', branchCode: 'CAMP' })).toBe(
      'كامب',
    );
  });
});

describe('operational UX source contracts', () => {
  it('cross-branch handoff is action-gated, not a page block', () => {
    const gate = read('src/components/session/ShiftOperationalGateProvider.tsx');
    expect(gate).toContain('handoff_required');
    expect(gate).toContain('handoffMyShift');
    expect(gate).toContain('HandoffConfirmDialog');
    expect(gate).not.toContain('window.confirm');
    expect(gate).not.toContain('Operational mismatch');
    expect(gate).not.toContain('ShiftMove');
    expect(gate).not.toContain('absolute inset-0');
  });

  it('handoff branch picker is available from the operational bar without mutating view switch', () => {
    const bar = read('src/components/session/ActiveSessionBar.tsx');
    const control = read('src/components/session/OperationalHandoffControl.tsx');
    const dialog = read('src/components/session/HandoffBranchDialog.tsx');
    expect(bar).toContain('OperationalHandoffControl');
    expect(control).toContain('handoffMyShift');
    expect(control).toContain('HandoffBranchDialog');
    expect(dialog).toContain('نقل التشغيل');
    expect(dialog).toContain('اختر الفرع');
    expect(control).not.toContain('/api/shift/close');
    expect(control).not.toContain('/api/shift/open');
  });

  it('view switch does not mutate shift', () => {
    const switcher = read('src/components/session/BranchSwitcher.tsx');
    const client = read('src/lib/branch/postSwitchClient.ts');
    expect(switcher).not.toContain('handoffMyShift');
    expect(switcher).not.toContain('closeMyShift');
    expect(switcher).not.toContain('openMyShift');
    expect(client).not.toContain('/api/shift');
  });

  it('atomic handoff is called once via SessionProvider only', () => {
    const provider = read('src/components/session/SessionProvider.tsx');
    const overlay = read('src/components/session/ShiftOperationalGateProvider.tsx');
    const control = read('src/components/session/OperationalHandoffControl.tsx');
    expect(provider).toContain('/api/operations/shift/handoff');
    expect((provider.match(/\/api\/operations\/shift\/handoff/g) || []).length).toBe(1);
    expect(overlay).toContain('handoffMyShift');
    expect(overlay).not.toContain('/api/shift/close');
    expect(overlay).not.toContain('/api/shift/open');
    expect(control).toContain('handoffMyShift');
    expect(control).not.toContain('/api/shift/close');
    expect(control).not.toContain('/api/shift/open');
  });

  it('successful handoff applies bootstrap without clearing shift first', () => {
    const provider = read('src/components/session/SessionProvider.tsx');
    const handoff = provider.slice(provider.indexOf('const handoffMyShift'));
    const body = handoff.slice(0, handoff.indexOf('}, [user, applyBootstrap'));
    expect(body).toContain('data.bootstrap');
    expect(body).toContain('applyBootstrap');
    expect(body).not.toContain('setShift(null)');
  });

  it('close shift updates state via SessionProvider', () => {
    const provider = read('src/components/session/SessionProvider.tsx');
    const bar = read('src/components/session/ActiveSessionBar.tsx');
    expect(provider).toContain('setShift(null)');
    expect(provider).toContain('closeMyShift');
    expect(bar).toContain('OperationalHandoffControl');
    expect(bar).toContain('closeMyShift');
  });

  it('normal staff do not see manual Day controls in shell / POS menu', () => {
    const bar = read('src/components/session/ActiveSessionBar.tsx');
    const mobile = read('src/components/pos/mobile/MobilePosHeader.tsx');
    expect(bar).not.toContain('onCloseDayClick');
    expect(bar).not.toContain('day.close');
    expect(bar).not.toContain('/admin/day');
    expect(mobile).not.toContain('/admin/day');
    expect(mobile).toContain("user?.UserLevel === 'admin'");
    expect(mobile).toContain('/admin/operations');
  });

  it('admin operations shows Business Day + rollover status + open shifts', () => {
    const page = read('src/app/admin/operations/page.tsx');
    const dayCard = read('src/components/operations/DayControlCard.tsx');
    expect(page).toContain('التشغيل التلقائي لليوم');
    expect(page).toContain('الورديات المفتوحة');
    expect(page).toContain('DayControlCard');
    expect(page).toContain('stale');
    expect(dayCard).toContain('اليوم التشغيلي');
    expect(dayCard).toContain('إغلاق اليوم بالقوة');
    expect(dayCard).toContain('لا يمكن إغلاق اليوم');
  });

  it('stale bootstrap shows one operational warning banner', () => {
    const banner = read('src/components/session/OperationalStaleBanner.tsx');
    const shell = read('src/components/layout/AuthenticatedAppShell.tsx');
    expect(banner).toContain('تعذر تجهيز يوم العمل الحالي');
    expect(banner).toContain('العمليات المالية متوقفة مؤقتًا');
    expect(banner).toContain('إعادة المحاولة');
    expect(shell).toMatch(/import OperationalStaleBanner/);
    expect(shell).toMatch(/<OperationalStaleBanner\s*\/>/);
  });

  it('mobile chip opens operational Bottom Sheet', () => {
    const mobile = read('src/components/pos/mobile/MobilePosHeader.tsx');
    const sheet = read('src/components/session/OperationalMobileSheet.tsx');
    const bar = read('src/components/session/ActiveSessionBar.tsx');
    expect(mobile).toContain('OperationalMobileSheet');
    expect(mobile).toContain('setSheetOpen(true)');
    expect(sheet).toContain('MobileBottomSheet');
    expect(sheet).toContain('الفرع المعروض');
    expect(sheet).toContain('الفرع التشغيلي');
    expect(bar).toContain('OperationalMobileSheet');
    expect(bar).toContain('OperationalHandoffControl');
    expect(mobile).toContain('OperationalHandoffControl');
  });

  it('no operational 60s polling; bootstrap remains canonical', () => {
    const provider = read('src/components/session/SessionProvider.tsx');
    expect(provider).toContain('/api/operations/bootstrap');
    expect((provider.match(/\/api\/operations\/bootstrap/g) || []).length).toBe(1);
    expect(provider).not.toMatch(/setInterval\([^)]*60_000/);
    // logout may DELETE /api/auth/session — must not load operational state from it
    expect(provider).toMatch(
      /fetch\(\s*['"`]\/api\/auth\/session['"`]\s*,\s*\{\s*method:\s*['"]DELETE['"]/,
    );
    expect((provider.match(/\/api\/auth\/session/g) || []).length).toBe(1);
    expect(provider).not.toContain('/api/day/current');
    expect(provider).not.toContain('/api/shift/current');
  });

  it('shift actions avoid full-page reload paths', () => {
    const overlay = read('src/components/session/ShiftOperationalGateProvider.tsx');
    const bar = read('src/components/session/ActiveSessionBar.tsx');
    expect(overlay).not.toContain('window.location.reload');
    expect(overlay).not.toContain('router.push');
    expect(bar).not.toContain('window.location.reload');
  });
});
