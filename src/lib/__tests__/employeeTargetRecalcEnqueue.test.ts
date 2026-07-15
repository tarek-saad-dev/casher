import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const enqueueTargetRecalcInTransaction = vi.fn();
const claimTargetRecalcRequests = vi.fn();
const finalizeTargetRecalcSuccess = vi.fn();
const finalizeTargetRecalcFailure = vi.fn();
const generateEmployeeDailyTargets = vi.fn();

vi.mock('@/lib/payroll/employee-target/employee-target-recalc.repository', () => ({
  enqueueTargetRecalcInTransaction: (...a: unknown[]) => enqueueTargetRecalcInTransaction(...a),
  claimTargetRecalcRequests: (...a: unknown[]) => claimTargetRecalcRequests(...a),
  finalizeTargetRecalcSuccess: (...a: unknown[]) => finalizeTargetRecalcSuccess(...a),
  finalizeTargetRecalcFailure: (...a: unknown[]) => finalizeTargetRecalcFailure(...a),
  listTargetRecalcRequests: vi.fn(async () => []),
  listTargetRecalcRequestsForDate: vi.fn(async () => []),
  mapRecalcRequest: vi.fn(),
}));

vi.mock('@/lib/payroll/employee-target/employee-daily-target-generation.service', () => ({
  generateEmployeeDailyTargets: (...a: unknown[]) => generateEmployeeDailyTargets(...a),
}));

import { enqueueEmployeeTargetRecalculations } from '@/lib/payroll/employee-target/employee-target-recalc-enqueue.service';
import { processEmployeeTargetRecalcRequests } from '@/lib/payroll/employee-target/employee-target-recalc-process.service';
import {
  parseEnqueueRecalcBody,
  parseProcessRecalcBody,
} from '@/lib/payroll/employee-target/employee-target-recalc.schemas';
import { deriveTargetSyncStatus } from '@/lib/payroll/employee-target/employee-daily-target-query.service';

const tx = {} as never;

describe('recalc schemas', () => {
  it('defaults processNow true and rejects unlimited process', () => {
    expect(parseEnqueueRecalcBody({ workDate: '2026-07-15' }).processNow).toBe(true);
    expect(() => parseProcessRecalcBody({})).toThrow(/نطاق/);
  });
});

describe('enqueueEmployeeTargetRecalculations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueTargetRecalcInTransaction
      .mockResolvedValueOnce({ id: 1, requestedVersion: 1, created: true })
      .mockResolvedValueOnce({ id: 2, requestedVersion: 2, created: false });
  });

  it('dedupes and sorts WorkDate then EmpID', async () => {
    await enqueueEmployeeTargetRecalculations({
      transaction: tx,
      scopes: [
        { empId: 20, workDate: '2026-07-15', reasons: ['x'] },
        { empId: 10, workDate: '2026-07-14', reasons: ['x'] },
        { empId: 20, workDate: '2026-07-15', reasons: ['y'] },
      ],
      reason: 'test',
      sourceType: 'test',
      sourceRef: '1',
    });
    expect(enqueueTargetRecalcInTransaction).toHaveBeenCalledTimes(2);
    expect(enqueueTargetRecalcInTransaction.mock.calls[0][1].empId).toBe(10);
    expect(enqueueTargetRecalcInTransaction.mock.calls[0][1].workDate).toBe('2026-07-14');
    expect(enqueueTargetRecalcInTransaction.mock.calls[1][1].empId).toBe(20);
  });
});

describe('processEmployeeTargetRecalcRequests versioning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks completed when version unchanged', async () => {
    claimTargetRecalcRequests.mockResolvedValue([
      {
        id: 9,
        empId: 12,
        workDate: '2026-07-14',
        requestedVersion: 4,
        status: 'processing',
      },
    ]);
    generateEmployeeDailyTargets.mockResolvedValue({ totals: {}, employees: [] });
    finalizeTargetRecalcSuccess.mockResolvedValue('completed');

    const r = await processEmployeeTargetRecalcRequests({
      workDate: '2026-07-14',
      actorUserId: 1,
      maxRequests: 10,
    });
    expect(r.completed).toBe(1);
    expect(finalizeTargetRecalcSuccess).toHaveBeenCalledWith({
      requestId: 9,
      processingVersion: 4,
    });
  });

  it('keeps pending_newer when RequestedVersion advanced during processing', async () => {
    claimTargetRecalcRequests.mockResolvedValue([
      {
        id: 9,
        empId: 12,
        workDate: '2026-07-14',
        requestedVersion: 1,
        status: 'processing',
      },
    ]);
    generateEmployeeDailyTargets.mockResolvedValue({ totals: {}, employees: [] });
    finalizeTargetRecalcSuccess.mockResolvedValue('pending_newer');

    const r = await processEmployeeTargetRecalcRequests({
      workDate: '2026-07-14',
      actorUserId: 1,
    });
    expect(r.pendingNewer).toBe(1);
    expect(r.completed).toBe(0);
  });

  it('marks failed with safe error and does not throw', async () => {
    claimTargetRecalcRequests.mockResolvedValue([
      {
        id: 3,
        empId: 1,
        workDate: '2026-07-14',
        requestedVersion: 1,
        status: 'processing',
      },
    ]);
    generateEmployeeDailyTargets.mockRejectedValue(new Error('Invalid object name TblX'));
    finalizeTargetRecalcFailure.mockResolvedValue(undefined);

    const r = await processEmployeeTargetRecalcRequests({
      workDate: '2026-07-14',
      actorUserId: null,
    });
    expect(r.failed).toBe(1);
    expect(finalizeTargetRecalcFailure.mock.calls[0][0].errorSafe).not.toMatch(/Invalid object/i);
  });
});

describe('deriveTargetSyncStatus', () => {
  it('maps statuses', () => {
    expect(deriveTargetSyncStatus(null).syncStatus).toBe('up_to_date');
    expect(
      deriveTargetSyncStatus({
        id: 1,
        empId: 1,
        workDate: '2026-07-14',
        status: 'pending',
        requestedVersion: 2,
        processedVersion: 1,
        attemptCount: 0,
        lastReason: null,
        sourceType: null,
        sourceRef: null,
        lastError: null,
        requestedAt: 'x',
        processingAt: null,
        processedAt: null,
        createdAt: 'x',
        updatedAt: null,
      }).syncStatus,
    ).toBe('pending');
  });
});
