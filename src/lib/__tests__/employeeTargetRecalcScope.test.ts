import { describe, it, expect } from 'vitest';
import {
  resolveInvoiceTargetRecalculationScope,
  dedupeTargetRecalcScopes,
  extractInvoiceScopeSnapshot,
  expandTargetRecalcScopesForMtdCascade,
} from '@/lib/payroll/employee-target/employee-target-recalc-scope';

describe('resolveInvoiceTargetRecalculationScope', () => {
  it('create: all empIds on new date', () => {
    const scopes = resolveInvoiceTargetRecalculationScope({
      afterSnapshot: {
        header: { invDate: '2026-07-15', BranchID: 1 },
        details: [{ EmpID: 12 }, { EmpID: 15 }, { EmpID: 12 }],
      },
      reasons: ['invoice_create'],
    });
    expect(scopes.map((s) => s.empId).sort((a, b) => a - b)).toEqual([12, 15]);
    expect(scopes.every((s) => s.workDate === '2026-07-15')).toBe(true);
    expect(scopes.every((s) => s.branchId === 1)).toBe(true);
  });

  it('employee change unions old and new', () => {
    const scopes = resolveInvoiceTargetRecalculationScope({
      beforeSnapshot: {
        header: { invDate: '2026-07-14', BranchID: 1 },
        details: [{ EmpID: 12 }, { EmpID: 7 }],
      },
      afterSnapshot: {
        header: { invDate: '2026-07-14', BranchID: 1 },
        details: [{ EmpID: 15 }, { EmpID: 7 }],
      },
      reasons: ['invoice_update'],
    });
    expect(scopes.map((s) => s.empId).sort((a, b) => a - b)).toEqual([7, 12, 15]);
  });

  it('date change covers both days for affected emps', () => {
    const scopes = resolveInvoiceTargetRecalculationScope({
      beforeSnapshot: {
        header: { invDate: '2026-07-14', BranchID: 1 },
        details: [{ EmpID: 12 }],
      },
      afterSnapshot: {
        header: { invDate: '2026-07-15', BranchID: 1 },
        details: [{ EmpID: 12 }],
      },
      reasons: ['date_change'],
    });
    const keys = scopes.map((s) => `${s.empId}@${s.workDate}`).sort();
    expect(keys).toEqual(['12@2026-07-14', '12@2026-07-15']);
  });

  it('delete uses before snapshot only', () => {
    const scopes = resolveInvoiceTargetRecalculationScope({
      beforeSnapshot: {
        header: { invDate: '2026-07-14', BranchID: 1 },
        details: [{ EmpID: 5 }, { EmpID: 7 }],
      },
      afterSnapshot: null,
      reasons: ['invoice_delete'],
    });
    expect(scopes).toHaveLength(2);
    expect(scopes.every((s) => s.workDate === '2026-07-14')).toBe(true);
  });

  it('header discount scenario includes all invoice employees', () => {
    const snap = extractInvoiceScopeSnapshot({
      header: { invDate: '2026-07-14', BranchID: 1, GrandTotal: 1000, SubTotal: 1200 },
      details: [{ EmpID: 1 }, { EmpID: 2 }, { EmpID: 3 }],
    });
    expect(snap.empIds).toEqual([1, 2, 3]);
    const scopes = resolveInvoiceTargetRecalculationScope({
      beforeSnapshot: snap,
      afterSnapshot: {
        header: { invDate: '2026-07-14', BranchID: 1, GrandTotal: 900, SubTotal: 1200 },
        details: [{ EmpID: 1 }, { EmpID: 2 }, { EmpID: 3 }],
      },
      reasons: ['header_discount'],
    });
    expect(scopes.map((s) => s.empId)).toEqual([1, 2, 3]);
  });

  it('dedupe merges reasons', () => {
    const out = dedupeTargetRecalcScopes([
      { empId: 1, branchId: 1, workDate: '2026-07-14', reasons: ['a'] },
      { empId: 1, branchId: 1, workDate: '2026-07-14', reasons: ['b'] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reasons).toEqual(['a', 'b']);
  });
});

describe('expandTargetRecalcScopesForMtdCascade', () => {
  it('expands day D through cascadeEnd within the same month', () => {
    const expanded = expandTargetRecalcScopesForMtdCascade(
      [{ empId: 12, branchId: 1, workDate: '2026-07-10', reasons: ['invoice_update'] }],
      '2026-07-12',
    );
    expect(expanded.map((s) => s.workDate)).toEqual([
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]);
    expect(expanded.every((s) => s.empId === 12 && s.branchId === 1)).toBe(true);
  });

  it('caps cascade at month end', () => {
    const expanded = expandTargetRecalcScopesForMtdCascade(
      [{ empId: 1, branchId: 1, workDate: '2026-07-30', reasons: ['x'] }],
      '2026-08-15',
    );
    expect(expanded.map((s) => s.workDate)).toEqual(['2026-07-30', '2026-07-31']);
  });
});
