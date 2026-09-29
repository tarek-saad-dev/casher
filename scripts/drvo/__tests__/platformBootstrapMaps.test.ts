import { describe, expect, it } from 'vitest';
import { decideLegacyIdMapAction } from '../legacyIdMap';

/**
 * In-memory simulation of ensureLocations / ensureMemberships map repair rules.
 */
function repairBranchMaps(state: {
  locations: Array<{ branchId: number; locationId: string; branchCode: string }>;
  branches: Array<{ branchId: number; branchCode: string }>;
  maps: Array<{ legacyKey: string; drvoId: string }>;
}) {
  for (const branch of state.branches) {
    const locs = state.locations.filter((l) => l.branchId === branch.branchId);
    if (locs.length !== 1) throw new Error(`ambiguous location for ${branch.branchId}`);
    const loc = locs[0]!;
    if (loc.branchCode !== branch.branchCode) {
      throw new Error(`BranchCode mismatch for ${branch.branchId}`);
    }
    const existing = state.maps.filter((m) => m.legacyKey === String(branch.branchId));
    if (existing.length > 1) throw new Error('duplicate maps');
    const decision = decideLegacyIdMapAction({
      entityName: 'branch',
      legacyKey: String(branch.branchId),
      authoritativeDrvoId: loc.locationId,
      existingMapDrvoId: existing[0]?.drvoId ?? null,
    });
    if (decision.action === 'abort') throw new Error(decision.reason);
    if (decision.action === 'insert') {
      state.maps.push({ legacyKey: String(branch.branchId), drvoId: decision.drvoId });
    }
  }
}

function verifyBranchBaseline(state: {
  locations: Array<{ branchId: number; locationId: string; branchCode: string }>;
  branches: Array<{ branchId: number; branchCode: string }>;
  maps: Array<{ legacyKey: string; drvoId: string }>;
}): string[] {
  const failures: string[] = [];
  for (const branch of state.branches) {
    const locs = state.locations.filter((l) => l.branchId === branch.branchId);
    if (locs.length !== 1) {
      failures.push(`Location count for ${branch.branchId}`);
      continue;
    }
    if (locs[0]!.branchCode !== branch.branchCode) {
      failures.push(`BranchCode mismatch ${branch.branchId}`);
    }
    const maps = state.maps.filter((m) => m.legacyKey === String(branch.branchId));
    if (maps.length !== 1) failures.push(`LegacyIdMap count for ${branch.branchId}`);
    else if (maps[0]!.drvoId.toLowerCase() !== locs[0]!.locationId.toLowerCase()) {
      failures.push(`DrvoId mismatch for ${branch.branchId}`);
    }
  }
  return failures;
}

describe('platform bootstrap LegacyIdMap repair / abort (in-memory)', () => {
  it('existing Location + missing branch LegacyIdMap → repaired', () => {
    const state = {
      branches: [{ branchId: 1, branchCode: 'GLEEM' }],
      locations: [{ branchId: 1, locationId: 'loc-1', branchCode: 'GLEEM' }],
      maps: [] as Array<{ legacyKey: string; drvoId: string }>,
    };
    repairBranchMaps(state);
    expect(state.maps).toEqual([{ legacyKey: '1', drvoId: 'loc-1' }]);
    expect(verifyBranchBaseline(state)).toEqual([]);
  });

  it('existing membership + missing staff LegacyIdMap → repaired', () => {
    const membershipId = 'mem-1';
    const maps: Array<{ legacyKey: string; drvoId: string }> = [];
    const decision = decideLegacyIdMapAction({
      entityName: 'staff_user',
      legacyKey: '42',
      authoritativeDrvoId: membershipId,
      existingMapDrvoId: null,
    });
    expect(decision.action).toBe('insert');
    if (decision.action === 'insert') {
      maps.push({ legacyKey: '42', drvoId: decision.drvoId });
    }
    expect(maps).toEqual([{ legacyKey: '42', drvoId: membershipId }]);
  });

  it('conflicting branch mapping → fails', () => {
    const state = {
      branches: [{ branchId: 1, branchCode: 'GLEEM' }],
      locations: [{ branchId: 1, locationId: 'loc-1', branchCode: 'OTHER' }],
      maps: [{ legacyKey: '1', drvoId: 'loc-1' }],
    };
    expect(() => repairBranchMaps(state)).toThrow(/BranchCode mismatch/);
  });

  it('conflicting LegacyIdMap → fails', () => {
    const state = {
      branches: [{ branchId: 1, branchCode: 'GLEEM' }],
      locations: [{ branchId: 1, locationId: 'loc-1', branchCode: 'GLEEM' }],
      maps: [{ legacyKey: '1', drvoId: 'loc-OTHER' }],
    };
    expect(() => repairBranchMaps(state)).toThrow(/Conflicting LegacyIdMap/);
  });

  it('correct state → baseline accepted', () => {
    const state = {
      branches: [{ branchId: 1, branchCode: 'GLEEM' }],
      locations: [{ branchId: 1, locationId: 'loc-1', branchCode: 'GLEEM' }],
      maps: [{ legacyKey: '1', drvoId: 'loc-1' }],
    };
    repairBranchMaps(state);
    expect(state.maps).toHaveLength(1);
    expect(verifyBranchBaseline(state)).toEqual([]);
  });
});
