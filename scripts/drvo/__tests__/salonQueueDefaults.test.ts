import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeBranchQueueDuration } from '../../../src/lib/queue/queueBranchDuration';

const source = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('Salon Pack — branch queue duration', () => {
  it('uses the current branch duration and neutral 30-minute fallback', () => {
    expect(normalizeBranchQueueDuration(45)).toBe(45);
    expect(normalizeBranchQueueDuration('60')).toBe(60);
    expect(normalizeBranchQueueDuration(30)).toBe(30);
    for (const invalid of [null, undefined, -1, 0, NaN, 241, 2, 17.5, 'invalid']) {
      expect(normalizeBranchQueueDuration(invalid)).toBe(30);
    }
  });

  it('never borrows global CUT duration for a branch-owned queue', () => {
    const engine = source('src/lib/queueEstimateEngine.ts');
    const start = engine.indexOf('export async function getDefaultDuration(');
    const end = engine.indexOf('export async function getServicesDuration(', start);
    const duration = engine.slice(start, end);
    expect(duration).toContain('WHERE BranchID = @branchId');
    expect(duration).toContain("normalizeBranchQueueDuration(result.recordset[0]?.DefaultServiceMinutes)");
    expect(duration.indexOf('if (branchId != null)')).toBeLessThan(duration.indexOf('getGlobalTimingDefaults()'));
    expect(engine).toContain('const defaultDur = await getDefaultDuration(db, branchId)');
  });

  it('passes the active branch into ticket creation and both ETA modes', () => {
    const create = source('src/app/api/queue/route.ts');
    const estimate = source('src/app/api/queue/estimate/route.ts');
    expect(create).toContain('getDefaultDuration(db, branch.branchId)');
    expect(estimate).toContain('computeBarberEstimate(empId, resolvedEmpName, serviceIds, requestedAt, undefined, branch.branchId)');
    expect(estimate).toContain('computeBarberEstimate(b.EmpID, b.EmpName, serviceIds, requestedAt, undefined, branchId)');
  });
});
