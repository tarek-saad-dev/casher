export type HandoffStatus = 'pending' | 'loaded' | 'charged' | 'cancelled' | 'superseded';
export type HandoffServiceSource = 'booked' | 'added';
export type PortalHandoffStatus = 'none' | 'pending' | 'charged';

export type HandoffServiceLine = {
  proId: number;
  qty: number;
  source: HandoffServiceSource;
};

export type HandoffPayload = {
  services: HandoffServiceLine[];
};

export function parseHandoffPayload(raw: string | null | undefined): HandoffPayload {
  if (!raw) return { services: [] };
  try {
    const parsed = JSON.parse(raw) as { services?: unknown };
    const services = Array.isArray(parsed.services)
      ? parsed.services
          .map((row) => {
            const r = row as { proId?: unknown; qty?: unknown; source?: unknown };
            const proId = Number(r.proId);
            const qty = Number(r.qty);
            const source: HandoffServiceSource =
              r.source === 'added' ? 'added' : 'booked';
            if (!Number.isInteger(proId) || proId <= 0) return null;
            if (!Number.isFinite(qty) || qty <= 0) return null;
            return { proId, qty: Math.min(99, Math.floor(qty)), source };
          })
          .filter((x): x is HandoffServiceLine => x != null)
      : [];
    return { services };
  } catch {
    return { services: [] };
  }
}

export function serializeHandoffPayload(payload: HandoffPayload): string {
  return JSON.stringify({
    services: payload.services.map((s) => ({
      proId: s.proId,
      qty: s.qty,
      source: s.source === 'added' ? 'added' : 'booked',
    })),
  });
}

export function normalizeHandoffServices(
  services: Array<{ proId: number; qty?: number; source?: string }>,
): HandoffServiceLine[] {
  const merged = new Map<number, HandoffServiceLine>();
  for (const raw of services) {
    const proId = Number(raw.proId);
    const rawQty = Number(raw.qty ?? 1);
    if (!Number.isFinite(rawQty) || rawQty <= 0) continue;
    const qty = Math.min(99, Math.max(1, Math.floor(rawQty)));
    if (!Number.isInteger(proId) || proId <= 0) continue;
    const source: HandoffServiceSource = raw.source === 'added' ? 'added' : 'booked';
    const prev = merged.get(proId);
    if (prev) {
      merged.set(proId, {
        proId,
        qty: Math.min(99, prev.qty + qty),
        source: prev.source === 'booked' || source === 'booked' ? 'booked' : 'added',
      });
    } else {
      merged.set(proId, { proId, qty, source });
    }
  }
  return [...merged.values()];
}

export function mapPortalHandoffStatus(
  status: string | null | undefined,
): PortalHandoffStatus {
  const s = String(status ?? '').toLowerCase();
  if (s === 'charged') return 'charged';
  if (s === 'pending' || s === 'loaded') return 'pending';
  return 'none';
}
