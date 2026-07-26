import { describe, expect, it } from 'vitest';
import {
  assertCampCaesarOvernightBoundaries,
  evaluateOvernightSlot,
  CAMP_CAESAR_OVERNIGHT_HOURS,
} from '@/lib/branch/overnightOperatingHours';

describe('phase1oCampCaesarOvernightHours', () => {
  it('Camp Caesar overnight boundary matrix', () => {
    const cases = assertCampCaesarOvernightBoundaries();
    expect(cases.length).toBeGreaterThanOrEqual(7);
    expect(evaluateOvernightSlot('01:15', CAMP_CAESAR_OVERNIGHT_HOURS).dayOffset).toBe(1);
    expect(evaluateOvernightSlot('23:45', CAMP_CAESAR_OVERNIGHT_HOURS).dayOffset).toBe(0);
  });
});
