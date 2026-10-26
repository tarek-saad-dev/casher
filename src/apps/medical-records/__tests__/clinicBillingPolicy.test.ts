import { describe, expect, it } from 'vitest';
import {
  ClinicBillingConflict,
  matchesClinicBookedServices,
  parseClinicEncounterId,
} from '../application/clinicBillingPolicy';

const booked = [{ ProID: 9, SPrice1: 300, Bonus: 20 }, { ProID: 20, SPrice1: 200, Bonus: 10 }];
const items = [
  { proId: 9, empId: 7, sPrice: 300, bonus: 20, qty: 1 },
  { proId: 20, empId: 7, sPrice: 200, bonus: 10, qty: 1 },
];

describe('Clinic → Shared POS billing contract', () => {
  it('requires canonical UUID rather than an untrusted booking/invoice integer', () => {
    expect(parseClinicEncounterId('f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2')).toBe(
      'f8e4b6ec-118e-42d5-9ae7-f1c6b4d59fd2',
    );
    for (const raw of ['1', '', '00000000-0000-0000-0000-000000000000', null, 'abc', 'x'.repeat(36)]) {
      expect(parseClinicEncounterId(raw)).toBeNull();
    }
  });

  it('requires every booked service exactly once, current catalog price and assigned doctor', () => {
    expect(matchesClinicBookedServices(items, booked, 7)).toBe(true);
    expect(matchesClinicBookedServices([...items].reverse(), booked, 7)).toBe(true);
    expect(matchesClinicBookedServices(items.slice(0, 1), booked, 7)).toBe(false);
    expect(matchesClinicBookedServices([...items, items[0]], booked, 7)).toBe(false);
    expect(matchesClinicBookedServices([{ ...items[0], empId: 11 }, items[1]], booked, 7)).toBe(false);
    expect(matchesClinicBookedServices([{ ...items[0], proId: 8 }, items[1]], booked, 7)).toBe(false);
    expect(matchesClinicBookedServices([{ ...items[0], sPrice: 1 }, items[1]], booked, 7)).toBe(false);
    expect(matchesClinicBookedServices([{ ...items[0], qty: 2 }, items[1]], booked, 7)).toBe(false);
    expect(matchesClinicBookedServices([{ ...items[0], bonus: 999 }, items[1]], booked, 7)).toBe(false);
    expect(matchesClinicBookedServices(items, [{ ProID: 9, SPrice1: 300, Bonus: 20 }, { ProID: 9, SPrice1: 300, Bonus: 20 }], 7)).toBe(false);
  });

  it('makes duplicate billing an explicit conflict', () => {
    expect(new ClinicBillingConflict('ALREADY_BILLED', 'duplicate').code).toBe('ALREADY_BILLED');
  });
});
