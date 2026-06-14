/**
 * Tests for queueLifecycleEngine.ts
 *
 * Verifies:
 * 1. 09:30–10:00 ticket disappears from peopleAhead at 10:01
 * 2. in_service after expected end becomes overdue_finish_required
 * 3. waiting/called/arrived after grace becomes no_show_candidate/expired_candidate
 * 4. After midnight 00:30 maps to previous business date
 * 5. Print happens once and only after DB commit (tested via API integration)
 *
 * Run with: npx vitest run src/lib/__tests__/queueLifecycleEngine.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  computeEffectiveTicket,
  computeEffectiveTickets,
  computePeopleAhead,
  getBlockingTickets,
  getActionRequiredTickets,
  type QueueTicketRaw,
  type LifecycleConfig,
} from '../queueLifecycleEngine';

import { getCairoBusinessDate } from '../businessDate';

// Helper to create a raw ticket
function makeTicket(overrides: Partial<QueueTicketRaw> = {}): QueueTicketRaw {
  return {
    QueueTicketID: 1,
    TicketCode: 'A1',
    TicketNumber: 1,
    Status: 'waiting',
    EmpID: 10,
    ClientID: 100,
    QueueDate: '2026-06-14',
    CreatedTime: '2026-06-14T09:00:00Z',
    CalledAt: null,
    ArrivedAt: null,
    ServiceStartedAt: null,
    ServiceEndedAt: null,
    EstimatedStartTime: null,
    ExpectedStartAt: null,
    ExpectedEndAt: null,
    DurationMinutes: 30,
    ...overrides,
  };
}

const config: LifecycleConfig = {
  graceMinutes: 15,
  defaultDurationMinutes: 30,
};

describe('queueLifecycleEngine', () => {
  describe('Test 1: 09:30–10:00 ticket disappears from peopleAhead at 10:01', () => {
    const ticket = makeTicket({
      Status: 'waiting',
      ExpectedStartAt: '2026-06-14T09:30:00Z',
      ExpectedEndAt: '2026-06-14T10:00:00Z',
      DurationMinutes: 30,
      EmpID: 10,
    });

    it('counts as ahead at 09:45', () => {
      const now = new Date('2026-06-14T09:45:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.isCountingAhead).toBe(true);
      expect(effective.effectiveStatus).toBe('waiting');
    });

    it('does NOT count as ahead at 10:01 (past ExpectedEndAt)', () => {
      const now = new Date('2026-06-14T10:01:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.isCountingAhead).toBe(false);
      expect(effective.needsOperatorAction).toBe(true);
    });

    it('computePeopleAhead returns 0 at 10:01', () => {
      const now = new Date('2026-06-14T10:01:00Z');
      const tickets = computeEffectiveTickets([ticket], now, config);
      const count = computePeopleAhead(tickets, 10, now);
      expect(count).toBe(0);
    });

    it('computePeopleAhead returns 1 at 09:45', () => {
      const now = new Date('2026-06-14T09:45:00Z');
      const tickets = computeEffectiveTickets([ticket], now, config);
      const count = computePeopleAhead(tickets, 10, now);
      expect(count).toBe(1);
    });
  });

  describe('Test 2: in_service after expected end becomes overdue_finish_required', () => {
    const ticket = makeTicket({
      Status: 'in_service',
      ServiceStartedAt: '2026-06-14T09:30:00Z',
      ExpectedEndAt: '2026-06-14T10:00:00Z',
      DurationMinutes: 30,
      EmpID: 10,
    });

    it('is active in_service at 09:50', () => {
      const now = new Date('2026-06-14T09:50:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.effectiveStatus).toBe('in_service');
      expect(effective.isBlockingAvailability).toBe(true);
      expect(effective.isCountingAhead).toBe(true);
      expect(effective.needsOperatorAction).toBe(false);
    });

    it('becomes overdue_finish_required at 10:16 (after 15min grace)', () => {
      const now = new Date('2026-06-14T10:16:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.effectiveStatus).toBe('overdue_finish_required');
      expect(effective.isBlockingAvailability).toBe(false);
      expect(effective.isCountingAhead).toBe(false);
      expect(effective.needsOperatorAction).toBe(true);
      expect(effective.overdueMinutes).toBeGreaterThanOrEqual(16);
    });

    it('is still in_service at 10:14 (within grace)', () => {
      const now = new Date('2026-06-14T10:14:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.effectiveStatus).toBe('in_service');
      expect(effective.isBlockingAvailability).toBe(true);
    });
  });

  describe('Test 3: waiting/called/arrived after grace becomes candidate', () => {
    it('waiting becomes no_show_candidate after grace', () => {
      const ticket = makeTicket({
        Status: 'waiting',
        ExpectedEndAt: '2026-06-14T10:00:00Z',
        DurationMinutes: 30,
      });
      const now = new Date('2026-06-14T10:16:00Z'); // 16 min past end, > 15 grace
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.effectiveStatus).toBe('no_show_candidate');
      expect(effective.isCountingAhead).toBe(false);
      expect(effective.needsOperatorAction).toBe(true);
    });

    it('called becomes no_show_candidate after grace', () => {
      const ticket = makeTicket({
        Status: 'called',
        ExpectedEndAt: '2026-06-14T10:00:00Z',
        DurationMinutes: 30,
      });
      const now = new Date('2026-06-14T10:16:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.effectiveStatus).toBe('no_show_candidate');
      expect(effective.isCountingAhead).toBe(false);
    });

    it('arrived becomes expired_candidate after grace', () => {
      const ticket = makeTicket({
        Status: 'arrived',
        ExpectedEndAt: '2026-06-14T10:00:00Z',
        DurationMinutes: 30,
      });
      const now = new Date('2026-06-14T10:16:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.effectiveStatus).toBe('expired_candidate');
      expect(effective.isCountingAhead).toBe(false);
      expect(effective.needsOperatorAction).toBe(true);
    });
  });

  describe('Test 4: after midnight 00:30 maps to previous business date', () => {
    it('getCairoBusinessDate at 00:30 Cairo returns yesterday', () => {
      // Simulate 2026-06-15 00:30 Cairo = 2026-06-14 21:30 UTC (Cairo is UTC+3 in summer)
      // Actually Cairo is UTC+2. So 00:30 Cairo = 22:30 UTC prev day
      const midnight30Cairo = new Date('2026-06-14T22:30:00Z'); // = 2026-06-15 00:30 Cairo (UTC+2)
      const businessDate = getCairoBusinessDate(midnight30Cairo);
      // Should be 2026-06-14 (yesterday) because Cairo hour < 4
      expect(businessDate).toBe('2026-06-14');
    });

    it('getCairoBusinessDate at 05:00 Cairo returns today', () => {
      // 05:00 Cairo = 03:00 UTC same day
      const morning5Cairo = new Date('2026-06-15T03:00:00Z'); // = 2026-06-15 05:00 Cairo
      const businessDate = getCairoBusinessDate(morning5Cairo);
      expect(businessDate).toBe('2026-06-15');
    });
  });

  describe('Closed statuses never block or count', () => {
    it('done ticket does not block', () => {
      const ticket = makeTicket({ Status: 'done' });
      const now = new Date('2026-06-14T09:00:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.isBlockingAvailability).toBe(false);
      expect(effective.isCountingAhead).toBe(false);
      expect(effective.needsOperatorAction).toBe(false);
    });

    it('cancelled ticket does not block', () => {
      const ticket = makeTicket({ Status: 'cancelled' });
      const now = new Date('2026-06-14T09:00:00Z');
      const effective = computeEffectiveTicket(ticket, now, config);
      expect(effective.isBlockingAvailability).toBe(false);
      expect(effective.isCountingAhead).toBe(false);
    });
  });

  describe('Batch helpers', () => {
    it('getActionRequiredTickets filters correctly', () => {
      const tickets = [
        makeTicket({ QueueTicketID: 1, Status: 'waiting', ExpectedEndAt: '2026-06-14T09:00:00Z' }),
        makeTicket({ QueueTicketID: 2, Status: 'in_service', ExpectedEndAt: '2026-06-14T09:00:00Z' }),
        makeTicket({ QueueTicketID: 3, Status: 'waiting', ExpectedEndAt: '2026-06-14T12:00:00Z' }),
      ];
      const now = new Date('2026-06-14T09:20:00Z'); // past grace for ticket 1 & 2
      const effective = computeEffectiveTickets(tickets, now, config);
      const actionRequired = getActionRequiredTickets(effective);
      expect(actionRequired.length).toBe(2);
      expect(actionRequired.map(t => t.QueueTicketID).sort()).toEqual([1, 2]);
    });

    it('getBlockingTickets returns only active within-time tickets', () => {
      const tickets = [
        makeTicket({ QueueTicketID: 1, Status: 'in_service', ExpectedEndAt: '2026-06-14T10:00:00Z', EmpID: 10 }),
        makeTicket({ QueueTicketID: 2, Status: 'waiting', ExpectedEndAt: '2026-06-14T10:30:00Z', EmpID: 10 }),
        makeTicket({ QueueTicketID: 3, Status: 'waiting', ExpectedEndAt: '2026-06-14T08:00:00Z', EmpID: 10 }),
      ];
      const now = new Date('2026-06-14T09:30:00Z');
      const effective = computeEffectiveTickets(tickets, now, config);
      const blocking = getBlockingTickets(effective, 10);
      expect(blocking.length).toBe(2); // tickets 1 and 2
      expect(blocking.map(t => t.QueueTicketID).sort()).toEqual([1, 2]);
    });
  });

  describe('Settle-expired eligibility', () => {
    it('only waiting/called past grace are eligible for settling (not in_service, not arrived)', () => {
      const tickets = [
        makeTicket({ QueueTicketID: 1, Status: 'waiting', ExpectedEndAt: '2026-06-14T09:00:00Z' }),   // expired
        makeTicket({ QueueTicketID: 2, Status: 'called', ExpectedEndAt: '2026-06-14T09:00:00Z' }),    // expired
        makeTicket({ QueueTicketID: 3, Status: 'arrived', ExpectedEndAt: '2026-06-14T09:00:00Z' }),   // expired_candidate (not no_show)
        makeTicket({ QueueTicketID: 4, Status: 'in_service', ExpectedEndAt: '2026-06-14T09:00:00Z' }), // overdue but not settle target
        makeTicket({ QueueTicketID: 5, Status: 'waiting', ExpectedEndAt: '2026-06-14T12:00:00Z' }),   // still valid
      ];
      const now = new Date('2026-06-14T09:20:00Z'); // 20 min past end > 15 grace
      const effective = computeEffectiveTickets(tickets, now, config);

      // Settle-expired targets: no_show_candidate (waiting/called past grace)
      const settleTargets = effective.filter(
        t => t.effectiveStatus === 'no_show_candidate'
      );
      expect(settleTargets.length).toBe(2);
      expect(settleTargets.map(t => t.QueueTicketID).sort()).toEqual([1, 2]);

      // in_service becomes overdue_finish_required (not a settle target)
      const overdueFinish = effective.filter(t => t.effectiveStatus === 'overdue_finish_required');
      expect(overdueFinish.length).toBe(1);
      expect(overdueFinish[0].QueueTicketID).toBe(4);

      // arrived becomes expired_candidate (different action needed)
      const expiredCandidates = effective.filter(t => t.effectiveStatus === 'expired_candidate');
      expect(expiredCandidates.length).toBe(1);
      expect(expiredCandidates[0].QueueTicketID).toBe(3);

      // ticket 5 still valid, counts ahead
      const valid = effective.find(t => t.QueueTicketID === 5);
      expect(valid?.isCountingAhead).toBe(true);
      expect(valid?.effectiveStatus).toBe('waiting');
    });
  });
});
