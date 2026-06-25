/**
 * Calculate changed fields between two snapshots.
 *
 * Used for audit records to store only the fields that actually changed.
 * Handles deep equality for arrays and plain objects, and treats dates as
 * comparable by normalizing them to ISO strings.
 */

export interface FieldChange {
  old: unknown;
  new: unknown;
}

export type ChangedFields = Record<string, FieldChange>;

function isDateLike(value: unknown): value is string | number | Date {
  if (value instanceof Date) return true;
  if (typeof value === 'string') {
    const d = new Date(value);
    return !isNaN(d.getTime()) && value.length >= 10;
  }
  return false;
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }

  if (isDateLike(a) && isDateLike(b)) {
    const na = normalizeDate(a);
    const nb = normalizeDate(b);
    if (na && nb) return na === nb;
  }

  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.0001;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => valuesEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => valuesEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }

  return false;
}

export function calculateChangedFields(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): ChangedFields | null {
  const oldObj = oldData || {};
  const newObj = newData || {};
  const changed: ChangedFields = {};

  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of allKeys) {
    if (!valuesEqual(oldObj[key], newObj[key])) {
      changed[key] = { old: oldObj[key], new: newObj[key] };
    }
  }

  return Object.keys(changed).length > 0 ? changed : null;
}
