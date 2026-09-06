/**
 * Phase E — ops Booking/Queue polish consistency tests.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { opsModalAllowsEscape } from '@/components/operations/useOpsModalChrome';

const root = process.cwd();
function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Phase E — shared primitives', () => {
  it('extracts error banner + step tabs + context card used by multiple flows', () => {
    expect(existsSync(join(root, 'src/components/operations/OpsFlowErrorBanner.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/components/operations/OpsFlowStepTabs.tsx'))).toBe(true);
    expect(existsSync(join(root, 'src/components/operations/OpsSelectedContextCard.tsx'))).toBe(true);

    const lane = read('src/components/operations/BarberQueueWorkspaceModal.tsx');
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    const nearest = read('src/components/operations/FindNearestQueueDrawer.tsx');
    const confirm = read('src/components/operations/booking-workspace/BookingStepConfirm.tsx');

    expect(lane).toContain('OpsFlowErrorBanner');
    expect(lane).toContain('OpsFlowStepTabs');
    expect(simple).toContain('OpsFlowErrorBanner');
    expect(simple).toContain('OpsFlowStepTabs');
    expect(nearest).toContain('OpsFlowErrorBanner');
    expect(confirm).toContain('OpsFlowErrorBanner');
  });

  it('does not introduce OpsFlowShell generic framework', () => {
    expect(existsSync(join(root, 'src/components/operations/OpsFlowShell.tsx'))).toBe(false);
  });
});

describe('Phase E — CTA / double-submit / escape', () => {
  it('Escape is blocked while submitting', () => {
    expect(opsModalAllowsEscape(false)).toBe(true);
    expect(opsModalAllowsEscape(true)).toBe(false);
  });

  it('queue modals use shared chrome + createPendingRef', () => {
    for (const file of [
      'src/components/operations/BarberQueueWorkspaceModal.tsx',
      'src/components/operations/SimpleCreateQueueDrawer.tsx',
      'src/components/operations/FindNearestQueueDrawer.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('useOpsModalChrome');
      expect(src).toContain('createPendingRef');
      expect(src).toContain('allowEscape');
    }
  });

  it('booking Escape remains gated on submitting', () => {
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain("e.key === 'Escape' && !submitting");
    expect(ws).toContain('acquireSubmitGuard');
  });

  it('general queue confirm CTA lives in sticky footer (single primary)', () => {
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    // Primary confirm in footer region after border-t
    const footerIdx = simple.lastIndexOf('border-t');
    const afterFooter = simple.slice(footerIdx);
    expect(afterFooter).toContain('إضافة للدور');
    // Body should not still contain a duplicate full-width create button block before footer.
    const body = simple.slice(0, footerIdx);
    expect(body).not.toMatch(/onClick=\{\(\) => void handleCreate\(\)\}[\s\S]{0,200}إضافة للدور/);
  });
});

describe('Phase E — dead code decisions', () => {
  it('BookingStepReview removed from active tree', () => {
    expect(existsSync(join(root, 'src/components/operations/booking-workspace/BookingStepReview.tsx'))).toBe(false);
    const modal = read('src/components/operations/booking-workspace/BookingWorkspaceModal.tsx');
    expect(modal).not.toContain('BookingStepReview');
  });

  it('CreateQueueDrawer retained as documented orphan', () => {
    const orphan = read('src/components/operations/CreateQueueDrawer.tsx');
    expect(orphan).toContain('LEGACY / ORPHAN');
    expect(orphan).toContain('export function CreateQueueDrawer');
    const page = read('src/app/operations/OperationsPageClient.tsx');
    expect(page).not.toContain('operations/CreateQueueDrawer');
  });
});

describe('Phase E — walk-in customer language consistency', () => {
  it('queue flows expose walk-in default messaging', () => {
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    const nearest = read('src/components/operations/FindNearestQueueDrawer.tsx');
    const lane = read('src/components/operations/BarberQueueWorkspaceModal.tsx');
    expect(simple).toContain('OpsWalkInHint');
    expect(nearest).toContain('OpsWalkInHint');
    expect(lane).toContain('OpsWalkInHint');
  });
});
