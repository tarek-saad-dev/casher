/**
 * Pure [groomPackage] Notes / Notes2 metadata — safe for client/server bundles.
 * Kept separate from groomPackageBooking.ts (server-only + DB).
 */

export function buildGroomPackageMetadataNote(args: {
  packageId: number;
  packagePrice: number;
  addonProIds: number[];
  requiredServiceIds: number[];
  totalPrice: number;
}): string {
  // Compact key=value; keep under Notes NVARCHAR(500) budget with other notes.
  return (
    `[groomPackage] packageId=${args.packageId};` +
    `packagePrice=${args.packagePrice};` +
    `addons=${args.addonProIds.join(',') || '-'};` +
    `required=${args.requiredServiceIds.join(',')};` +
    `total=${args.totalPrice}`
  );
}

export function parseGroomPackageMetadataNote(
  notes: string | null | undefined,
): {
  packageId: number;
  packagePrice: number;
  addonProIds: number[];
  requiredServiceIds: number[];
  totalPrice: number;
} | null {
  if (!notes) return null;
  const m = notes.match(/\[groomPackage\]\s*([^\n\r]*)/);
  if (!m) return null;
  const body = m[1];
  const get = (key: string) => {
    const hit = body.match(new RegExp(`(?:^|;)${key}=([^;]+)`));
    return hit?.[1]?.trim() ?? '';
  };
  const packageId = Number(get('packageId'));
  const packagePrice = Number(get('packagePrice'));
  const totalRaw = get('total');
  const totalPrice = Number(String(totalRaw).replace(/[^\d.]/g, ''));
  const addonsRaw = get('addons');
  const requiredRaw = get('required');
  if (!Number.isInteger(packageId) || packageId <= 0) return null;
  return {
    packageId,
    packagePrice: Number.isFinite(packagePrice) ? packagePrice : 0,
    totalPrice: Number.isFinite(totalPrice) ? totalPrice : 0,
    addonProIds:
      !addonsRaw || addonsRaw === '-'
        ? []
        : addonsRaw
            .split(',')
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0),
    requiredServiceIds: requiredRaw
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}
