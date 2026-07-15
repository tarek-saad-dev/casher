/**
 * Pure helpers: resolve (EmpID, WorkDate) scopes from invoice snapshots.
 * Header-discount allocation ⇒ always include ALL EmpIDs on the invoice dates.
 */

export interface InvoiceScopeSnapshot {
  workDate: string | null;
  empIds: number[];
}

export interface TargetRecalcScope {
  empId: number;
  workDate: string;
  reasons: string[];
}

function toWorkDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    // Prefer UTC date if midnight UTC (SQL date often arrives as UTC midnight)
    if (
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0
    ) {
      return value.toISOString().slice(0, 10);
    }
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

function uniqueEmpIds(raw: unknown[]): number[] {
  const ids = raw
    .map((v) => Number(v))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * Extract EmpIDs + workDate from getInvoiceSnapshot-shaped objects
 * or lightweight { header, details } / create payloads.
 */
export function extractInvoiceScopeSnapshot(snapshot: unknown): InvoiceScopeSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    return { workDate: null, empIds: [] };
  }
  const s = snapshot as Record<string, unknown>;
  const header = (s.header ?? s) as Record<string, unknown>;
  const workDate = toWorkDate(header.invDate ?? header.workDate ?? s.invDate ?? s.workDate);

  let details: unknown[] = [];
  if (Array.isArray(s.details)) details = s.details;
  else if (Array.isArray(s.items)) details = s.items;

  const empIds = uniqueEmpIds(
    details.map((d) => {
      if (!d || typeof d !== 'object') return null;
      const row = d as Record<string, unknown>;
      return row.EmpID ?? row.empId ?? row.empID;
    }),
  );

  return { workDate, empIds };
}

export function resolveInvoiceTargetRecalculationScope(params: {
  beforeSnapshot?: unknown | null;
  afterSnapshot?: unknown | null;
  reasons?: string[];
}): TargetRecalcScope[] {
  const before = extractInvoiceScopeSnapshot(params.beforeSnapshot ?? null);
  const after = extractInvoiceScopeSnapshot(params.afterSnapshot ?? null);
  const baseReasons = params.reasons?.length ? params.reasons : ['invoice_mutation'];

  const map = new Map<string, TargetRecalcScope>();

  const add = (empId: number, workDate: string | null, reason: string) => {
    if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return;
    if (!Number.isInteger(empId) || empId <= 0) return;
    const key = `${empId}|${workDate}`;
    const existing = map.get(key);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    map.set(key, { empId, workDate, reasons: [reason] });
  };

  for (const empId of before.empIds) {
    add(empId, before.workDate, baseReasons[0] ?? 'before');
  }
  for (const empId of after.empIds) {
    add(empId, after.workDate, baseReasons[0] ?? 'after');
  }

  // Date move: emp from before on old date already added; also place before empIds on new date if date changed
  if (
    before.workDate &&
    after.workDate &&
    before.workDate !== after.workDate
  ) {
    for (const empId of before.empIds) {
      add(empId, after.workDate, 'date_change');
    }
    for (const empId of after.empIds) {
      add(empId, before.workDate, 'date_change');
    }
  }

  // Stable order for deadlock avoidance: WorkDate, EmpID
  return [...map.values()].sort((a, b) =>
    a.workDate.localeCompare(b.workDate) || a.empId - b.empId,
  );
}

/** Deduplicate scopes (union reasons). */
export function dedupeTargetRecalcScopes(scopes: TargetRecalcScope[]): TargetRecalcScope[] {
  const map = new Map<string, TargetRecalcScope>();
  for (const s of scopes) {
    const key = `${s.empId}|${s.workDate}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { empId: s.empId, workDate: s.workDate, reasons: [...s.reasons] });
    } else {
      for (const r of s.reasons) {
        if (!existing.reasons.includes(r)) existing.reasons.push(r);
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    a.workDate.localeCompare(b.workDate) || a.empId - b.empId,
  );
}
