import { describe, expect, it } from 'vitest';
import { decideLegacyIdMapAction } from '../legacyIdMap';

describe('decideLegacyIdMapAction', () => {
  const auth = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  it('inserts when map is missing (existing Location/Membership repair)', () => {
    expect(
      decideLegacyIdMapAction({
        entityName: 'branch',
        legacyKey: '1',
        authoritativeDrvoId: auth,
        existingMapDrvoId: null,
      }),
    ).toEqual({ action: 'insert', drvoId: auth });
  });

  it('accepts matching map', () => {
    expect(
      decideLegacyIdMapAction({
        entityName: 'staff_user',
        legacyKey: '9',
        authoritativeDrvoId: auth,
        existingMapDrvoId: auth.toUpperCase(),
      }),
    ).toEqual({ action: 'ok' });
  });

  it('aborts on conflicting DrvoId (never replaces authoritative id)', () => {
    const decision = decideLegacyIdMapAction({
      entityName: 'branch',
      legacyKey: '1',
      authoritativeDrvoId: auth,
      existingMapDrvoId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    expect(decision.action).toBe('abort');
    if (decision.action === 'abort') {
      expect(decision.reason).toMatch(/Conflicting LegacyIdMap/);
    }
  });
});
