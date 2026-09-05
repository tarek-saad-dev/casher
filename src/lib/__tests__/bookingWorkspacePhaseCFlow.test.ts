/**
 * Phase C — Booking Workspace 3-step flow architecture tests.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  hydrateCustomerFieldsFromClient,
  OPS_BOOKING_CONFLICT_RECOVERY_STEP,
  OPS_BOOKING_FLOW_LABELS,
  OPS_BOOKING_FLOW_STEP_COUNT,
  opsBookingCanLeaveServices,
  opsBookingCanLeaveTime,
  opsBookingCanSubmit,
  opsBookingHasCustomer,
  opsBookingInvalidationForChange,
} from '@/lib/operations/bookingWorkspaceFlow';

const root = process.cwd();

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Phase C — booking workspace flow architecture', () => {
  it('active flow is 3 steps: Services → Time → Customer+Confirm', () => {
    expect(OPS_BOOKING_FLOW_STEP_COUNT).toBe(3);
    expect([...OPS_BOOKING_FLOW_LABELS]).toEqual([
      'الخدمات',
      'الموعد',
      'العميل والتأكيد',
    ]);
    const types = read('src/components/operations/booking-workspace/types.ts');
    expect(types).toContain("export type BookingStep = 1 | 2 | 3");
    expect(types).toContain("label: 'الخدمات'");
    expect(types).toContain("label: 'الموعد'");
    expect(types).toContain("label: 'العميل والتأكيد'");
    expect(types).not.toContain("label: 'المراجعة'");
    expect(types).not.toMatch(/BookingStep = 1 \| 2 \| 3 \| 4 \| 5/);
  });

  it('1 — normal nearest path gates: services → slot → customer → submit', () => {
    expect(opsBookingCanLeaveServices({ isDatePast: false, selectedServicesCount: 1 })).toBe(true);
    expect(
      opsBookingCanLeaveTime({
        selectedSlot: { durationMinutes: 30 },
        slotsAreCurrent: true,
        slotsViewState: 'ready',
        totalDuration: 30,
        mode: 'nearest',
        selectedBarberId: null,
      }),
    ).toBe(true);
    expect(opsBookingHasCustomer({ customerName: '', selectedClient: { Name: 'Ahmed' } })).toBe(true);
    expect(opsBookingCanSubmit({ canLeaveTime: true, hasCustomer: true })).toBe(true);
  });

  it('2 — locked barber: services first; specific mode does not require re-picking for leave-services', () => {
    // Leaving services only needs services; locked employee is contextual on Time.
    expect(opsBookingCanLeaveServices({ isDatePast: false, selectedServicesCount: 1 })).toBe(true);
    expect(
      opsBookingCanLeaveTime({
        selectedSlot: { durationMinutes: 30 },
        slotsAreCurrent: true,
        slotsViewState: 'ready',
        totalDuration: 30,
        mode: 'specific',
        selectedBarberId: 12,
      }),
    ).toBe(true);
    const modal = read('src/components/operations/booking-workspace/BookingWorkspaceModal.tsx');
    expect(modal).toContain('BookingStepServices');
    expect(modal).toContain('BookingStepTime');
    expect(modal).toContain('BookingStepConfirm');
    expect(modal).not.toContain('BookingStepReview');
    // Step 1 is services, not a mandatory standalone Barber step.
    expect(modal).toMatch(/ws\.step === 1 &&[\s\S]*BookingStepServices/);
  });

  it('3 — specific barber without selection cannot leave Time', () => {
    expect(
      opsBookingCanLeaveTime({
        selectedSlot: { durationMinutes: 30 },
        slotsAreCurrent: true,
        slotsViewState: 'ready',
        totalDuration: 30,
        mode: 'specific',
        selectedBarberId: null,
      }),
    ).toBe(false);
  });

  it('4/5 — service change invalidates slot; back preserves services conceptually', () => {
    expect(opsBookingInvalidationForChange('services')).toBe('slot');
    expect(opsBookingInvalidationForChange('duration')).toBe('slot');
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain('invalidateSlotSelection()');
    expect(ws).toMatch(/handleMainSelect[\s\S]*invalidateSlotSelection/);
    expect(ws).toMatch(/removeService[\s\S]*invalidateSlotSelection/);
  });

  it('6 — customer change does not invalidate availability/slot', () => {
    expect(opsBookingInvalidationForChange('customer')).toBe('none');
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain('handleSelectClient');
    expect(ws).not.toMatch(/handleSelectClient[\s\S]{0,200}invalidateSlotSelection/);
  });

  it('7 — date change invalidates slot', () => {
    expect(opsBookingInvalidationForChange('date')).toBe('slot');
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toMatch(/handleDateChange[\s\S]*invalidateSlotSelection/);
  });

  it('8 — existing customer selection hydrates visible name/phone', () => {
    const fields = hydrateCustomerFieldsFromClient({
      Name: 'محمد علي',
      Mobile: '01001234567',
    });
    expect(fields).toEqual({
      customerName: 'محمد علي',
      customerPhone: '01001234567',
    });
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain('hydrateCustomerFieldsFromClient');
    expect(ws).toContain('setCustomerName(fields.customerName)');
    expect(ws).toContain('setCustomerPhone(fields.customerPhone)');
  });

  it('9 — Review step gone from active modal; confirm is final', () => {
    const modal = read('src/components/operations/booking-workspace/BookingWorkspaceModal.tsx');
    expect(modal).not.toContain('BookingStepReview');
    expect(modal).toContain('isFinalStep={ws.step === 3}');
    expect(modal).toContain('BookingStepConfirm');
    const summary = read('src/components/operations/booking-workspace/BookingWorkspaceSummary.tsx');
    expect(summary).toContain('من 3');
    expect(summary).not.toContain('من 5');
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain('OPS_BOOKING_CONFLICT_RECOVERY_STEP');
    expect(OPS_BOOKING_CONFLICT_RECOVERY_STEP).toBe(2);
    expect(ws).not.toMatch(/setStep\(5\)/);
    expect(ws).not.toMatch(/step < 5/);
  });

  it('10 — close/reopen resets via resetWorkspace on open', () => {
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain('resetWorkspace');
    expect(ws).toMatch(/resetWorkspace\(\);\s*markOpsBookingUx\('modal_visible'\)/);
    expect(ws).toContain("setStep(1)");
    expect(ws).toContain("setMode(initialEmpId ? 'specific' : 'nearest')");
  });

  it('create contract path unchanged', () => {
    const ws = read('src/components/operations/booking-workspace/useBookingWorkspace.ts');
    expect(ws).toContain("/api/public/booking/create");
    expect(ws).toContain("source: 'operations'");
    expect(ws).not.toContain('/api/public/booking/v2/create');
  });

  it('nearest recommendation is not silent auto-select (click required)', () => {
    const appt = read('src/components/operations/booking-workspace/BookingStepAppointment.tsx');
    expect(appt).toContain('أقرب موعد');
    expect(appt).toContain('موصى به');
    expect(appt).toContain('onClick={() => onSelectSlot(nearest)}');
  });
});
