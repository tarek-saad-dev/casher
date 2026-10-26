import { describe, expect, it } from 'vitest';
import {
  parseTreatmentUuid, parseTreatmentInteger, validateTreatmentPlan,
  treatmentProgress, treatmentSessionState, type TreatmentSessionView,
} from '../application/treatmentPlanPolicy';

const session = (updates: Partial<TreatmentSessionView>): TreatmentSessionView => ({
  sessionNumber: 1, bookingId: null, bookingDate: null,
  bookingStatus: null, encounterId: null, encounterStatus: null, ...updates,
});

describe('Clinic Treatment Plans: source-of-truth projection', () => {
  it('validates plan title and planned count without rounding, coercion or empty plans', () => {
    expect(validateTreatmentPlan({ title: '  علاج طبيعي  ', totalSessions: 6 })).toEqual({
      ok: true, title: 'علاج طبيعي', totalSessions: 6,
    });
    for (const count of [0, -1, 2.5, 51, '4', null]) {
      expect(validateTreatmentPlan({ title: 'علاج طبيعي', totalSessions: count }).ok).toBe(false);
    }
    expect(validateTreatmentPlan({ title: 'x', totalSessions: 2 }).ok).toBe(false);
    expect(parseTreatmentInteger('01', 50)).toBeNull();
    expect(parseTreatmentInteger('50', 50)).toBe(50);
    expect(parseTreatmentInteger('51', 50)).toBeNull();
    expect(parseTreatmentUuid('not-uuid')).toBeNull();
  });

  it('counts a session as completed ONLY when the linked clinical encounter is completed', () => {
    const items = [
      session({ sessionNumber: 1 }),
      session({ sessionNumber: 2, bookingId: 19, bookingStatus: 'confirmed' }),
      session({ sessionNumber: 3, bookingId: 20, bookingStatus: 'in_service',
        encounterId: 'visit-20', encounterStatus: 'in_progress' }),
      session({ sessionNumber: 4, bookingId: 21, bookingStatus: 'completed',
        encounterId: 'visit-21', encounterStatus: 'completed' }),
      session({ sessionNumber: 5, bookingId: 22, bookingStatus: 'cancelled' }),
    ];
    expect(items.map(treatmentSessionState)).toEqual([
      'unbooked','booked','booked','completed','needs_rebooking',
    ]);
    expect(treatmentProgress(items)).toEqual({
      total: 5, completed: 1, remaining: 4, booked: 2,
      needsRebooking: 1, percent: 20,
    });
  });

  it('does not treat legacy Booking completed status as proof of performed treatment', () => {
    const s = session({ bookingId: 19, bookingStatus: 'completed' });
    expect(treatmentSessionState(s)).not.toBe('completed');
    expect(treatmentProgress([s]).completed).toBe(0);
  });
});
