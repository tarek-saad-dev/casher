/**
 * ViewBranch vs OperationalBranch — action-based shift gate (no page blocking on mismatch).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  classifyShiftWriteGate,
  shiftWriteReady,
} from '@/lib/operations/shiftOperationalGate';

const root = path.join(__dirname, '..', '..', '..');

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('shift operational write gate', () => {
  it('view CAMP + operate GLEEM is valid split state — not handoff until write', () => {
    expect(
      classifyShiftWriteGate({
        loading: false,
        isAuthenticated: true,
        hasActiveDay: true,
        hasOpenShift: true,
        viewBranchId: 2,
        operationalBranchId: 1,
      }),
    ).toBe('handoff_required');
    expect(shiftWriteReady('handoff_required')).toBe(false);
  });

  it('view == operational with open shift is ready', () => {
    expect(
      classifyShiftWriteGate({
        loading: false,
        isAuthenticated: true,
        hasActiveDay: true,
        hasOpenShift: true,
        viewBranchId: 1,
        operationalBranchId: 1,
      }),
    ).toBe('ready');
  });

  it('no open shift on viewed branch → start shift flow', () => {
    expect(
      classifyShiftWriteGate({
        loading: false,
        isAuthenticated: true,
        hasActiveDay: true,
        hasOpenShift: false,
        viewBranchId: 2,
        operationalBranchId: null,
      }),
    ).toBe('no_shift');
  });

  it('no day on viewed branch → day not ready', () => {
    expect(
      classifyShiftWriteGate({
        loading: false,
        isAuthenticated: true,
        hasActiveDay: false,
        hasOpenShift: false,
        viewBranchId: 2,
        operationalBranchId: null,
      }),
    ).toBe('no_day');
  });
});

describe('view/operational mismatch UX contracts', () => {
  it('no page-level ShiftRequiredOverlay remains', () => {
    const pos = read('src/app/income/pos/page.tsx');
    const expenses = read('src/app/expenses/page.tsx');
    const deductions = read('src/app/deductions/page.tsx');
    expect(pos).not.toContain('ShiftRequiredOverlay');
    expect(expenses).not.toContain('ShiftRequiredOverlay');
    expect(deductions).not.toContain('ShiftRequiredOverlay');
    expect(() => read('src/components/session/ShiftRequiredOverlay.tsx')).toThrow();
  });

  it('gate provider is action-based — no full-page blocking overlay', () => {
    const gate = read('src/components/session/ShiftOperationalGateProvider.tsx');
    const shell = read('src/components/layout/AuthenticatedAppShell.tsx');
    expect(gate).toContain('ensureShiftWrite');
    expect(gate).toContain('handoff_required');
    expect(gate).not.toContain('absolute inset-0');
    expect(gate).not.toContain('viewingOtherOperational');
    expect(gate).not.toContain('needsGate');
    expect(shell).toContain('ShiftOperationalGateProvider');
  });

  it('POS reloads branch-scoped data when ViewBranch changes', () => {
    const pos = read('src/app/income/pos/page.tsx');
    const attendance = read('src/hooks/useTeamAttendance.ts');
    expect(pos).toContain('viewBranch?.branchId');
    expect(pos).toContain('/api/barbers?scope=barber');
    expect(pos).toContain('/api/services');
    expect(attendance).toContain('viewBranchId');
  });

  it('POS gates writes and shift quick actions only', () => {
    const pos = read('src/app/income/pos/page.tsx');
    expect(pos).toContain('ensureShiftWrite');
    expect(pos).toContain('payment-transfer');
    expect(pos).toContain('quick-expense');
    expect(pos).not.toContain('ShiftRequiredOverlay');
  });

  it('expenses/deductions gate save on action not page mount', () => {
    const expenses = read('src/app/expenses/page.tsx');
    const deductions = read('src/app/deductions/page.tsx');
    expect(expenses).toContain('ensureShiftWrite');
    expect(deductions).toContain('ensureShiftWrite');
    expect(expenses).not.toMatch(/disabled=\{saving \|\| !hasActiveShift\}/);
  });

  it('handoff uses one atomic SessionProvider command', () => {
    const gate = read('src/components/session/ShiftOperationalGateProvider.tsx');
    const provider = read('src/components/session/SessionProvider.tsx');
    expect(gate).toContain('handoffMyShift');
    expect(gate).not.toContain('/api/shift/close');
    expect(gate).not.toContain('/api/shift/open');
    expect(provider).toContain('/api/operations/shift/handoff');
  });

  it('handoff aligns ViewBranch cookie with handoff target', () => {
    const provider = read('src/components/session/SessionProvider.tsx');
    const client = read('src/lib/branch/postSwitchClient.ts');
    expect(provider).toContain('syncViewBranchCookie');
    expect(client).toContain('syncViewBranchCookie');
  });

  it('BranchSwitcher derives label from session viewBranch', () => {
    const switcher = read('src/components/session/BranchSwitcher.tsx');
    expect(switcher).toContain('session.viewBranch');
    expect(switcher).toContain('session.revision');
    expect(switcher).not.toContain('setActive(');
  });

  it('branch switch shows global loading indicator during wait', () => {
    const client = read('src/lib/branch/postSwitchClient.ts');
    const indicator = read('src/components/session/ViewBranchSwitchIndicator.tsx');
    const shell = read('src/components/layout/AuthenticatedAppShell.tsx');
    expect(client).toContain('setViewBranchSwitchUi');
    expect(indicator).toContain('جاري تبديل الفرع المعروض');
    expect(indicator).toContain('animate-spin');
    expect(shell).toContain('ViewBranchSwitchIndicator');
  });

  it('branch switch does not mutate shift or show mandatory overlay', () => {
    const switcher = read('src/components/session/BranchSwitcher.tsx');
    const client = read('src/lib/branch/postSwitchClient.ts');
    expect(switcher).not.toContain('handoffMyShift');
    expect(switcher).not.toContain('ShiftRequiredOverlay');
    expect(switcher).not.toContain('ensureShiftWrite');
    expect(client).not.toContain('/api/shift');
  });

  it('backend SHIFT ownership gate unchanged', () => {
    const gates = read('src/lib/branch/operationalGates.ts');
    expect(gates).toContain("scope: 'SHIFT'");
    expect(gates).toContain('getUserOpenShift');
  });
});
