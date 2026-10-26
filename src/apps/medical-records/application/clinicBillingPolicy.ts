/** Clinic to Shared POS contract. A consultation can have one initial linked invoice. */
export type ClinicBillingItem = { proId: number; empId: number; sPrice: number };

export class ClinicBillingConflict extends Error {
  constructor(
    public readonly code:
      | 'NOT_READY'
      | 'ALREADY_BILLED'
      | 'INVALID_ITEMS'
      | 'MIGRATION_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'ClinicBillingConflict';
  }
}

export function parseClinicEncounterId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function matchesClinicBookedServices(
  requested: ClinicBillingItem[],
  booked: Array<{ ProID: number; SPrice1: number }>,
  expectedDoctor: number,
): boolean {
  if (!requested.length || !booked.length || requested.length !== booked.length) return false;
  const ids = booked.map(s => Number(s.ProID));
  const prices = new Map(booked.map(s => [Number(s.ProID), Number(s.SPrice1)]));
  if (new Set(ids).size !== ids.length) return false;
  if (new Set(requested.map(s => s.proId)).size !== requested.length) return false;
  return requested.every(s =>
    Number.isSafeInteger(s.proId) && ids.includes(s.proId)
    && s.empId === expectedDoctor && Number.isFinite(s.sPrice) && s.sPrice > 0
    && Math.abs(s.sPrice - (prices.get(s.proId) ?? 0)) < 0.005);
}
